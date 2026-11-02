/** Opt-in, local-only diagnostic. Paste the function into DevTools and call it
 * with window. No application import, persistence, image content or telemetry. */
export function installClientCacheProbe(host) {
  const scenarios = [];
  const historicalResources = [];
  const observers = [];
  const nativeFetch = host.fetch;
  const document = host.document;
  const now = () => Math.round(host.performance.now());
  let current;
  let stopped = false;
  let dropped = 0;
  // Bounds diagnostic memory during long manual sessions, not library actions.
  const maximumRecords = 4096;
  const record = (list, value) => {
    if (list.length === maximumRecords) {
      list.shift();
      dropped++;
    }
    list.push(value);
  };
  function kind(input) {
    const url = new host.URL(
      typeof input === 'string' ? input : (input.url ?? String(input)),
      host.location.href,
    );
    if (url.protocol === 'sekereagle-media:')
      return url.pathname.startsWith('/photo/') ? 'photo-desktop-media' : 'material-desktop-media';
    if (url.origin !== host.location.origin) return null;
    const match = /^\/api\/(photos|eagle)\/assets(\/|$)/u.exec(url.pathname);
    if (match) {
      const mode = match[1] === 'photos' ? 'photo' : 'material';
      return `${mode}-${url.pathname.endsWith('/assets') ? 'list' : url.pathname.includes('/renditions/') ? 'image' : 'asset-other'}`;
    }
    if (url.pathname === '/api/library/changes') return 'change-check';
    if (url.pathname.startsWith('/api/auth/')) return 'session';
    return null;
  }
  function begin(name) {
    if (
      ![
        'startup',
        'folder-open',
        'folder-return',
        'viewer-open',
        'viewer-next',
        'navigation',
        'interaction',
      ].includes(name)
    )
      throw new Error('Use a scenario name, never a photo or folder name.');
    if (stopped) throw new Error('Probe stopped');
    if (current) current.endMs = now();
    current = { scenario: name, startMs: now(), requests: [], firstVisibleImageMs: null };
    record(scenarios, current);
    return current.startMs;
  }
  const wrappedFetch = async function (...args) {
    const category = kind(args[0]);
    const scenario = current;
    const start = now();
    try {
      const response = await nativeFetch.apply(this, args);
      if (!stopped && category && scenario)
        record(scenario.requests, {
          kind: category,
          startMs: start - scenario.startMs,
          headersMs: now() - start,
          status: response.status,
          cacheResult: ['LOCAL', 'REVALIDATED', 'MISS', 'COALESCED'].includes(
            response.headers.get('x-sekereagle-cache-result'),
          )
            ? response.headers.get('x-sekereagle-cache-result')
            : 'UNOBSERVED',
        });
      return response;
    } catch (error) {
      if (!stopped && category && scenario)
        record(scenario.requests, {
          kind: category,
          startMs: start - scenario.startMs,
          headersMs: now() - start,
          status: 0,
          cacheResult: 'UNOBSERVED',
        });
      throw error;
    }
  };
  host.fetch = wrappedFetch;
  const onLoad = (event) => {
    const image = event.target;
    const scenario = current;
    if (
      !scenario ||
      scenario.firstVisibleImageMs !== null ||
      !(image instanceof host.HTMLImageElement)
    )
      return;
    const bounds = image.getBoundingClientRect();
    if (
      bounds.width < 32 ||
      bounds.height < 32 ||
      bounds.bottom <= 0 ||
      bounds.top >= host.innerHeight ||
      bounds.right <= 0 ||
      bounds.left >= host.innerWidth
    )
      return;
    host.requestAnimationFrame?.(() =>
      host.requestAnimationFrame(() => {
        if (!stopped && scenario.firstVisibleImageMs === null)
          scenario.firstVisibleImageMs = now() - scenario.startMs;
      }),
    );
  };
  const onClick = (event) => {
    if (event.target.closest?.('button,[role=button],[role=treeitem]')) begin('interaction');
  };
  document.addEventListener('load', onLoad, true);
  document.addEventListener('click', onClick, true);
  if (host.PerformanceObserver) {
    const observer = new host.PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        const category = kind(entry.name);
        if (category)
          record(historicalResources, {
            kind: category,
            startMs: Math.round(entry.startTime),
            durationMs: Math.round(entry.duration),
            transferBytes: entry.transferSize,
            status: entry.responseStatus,
          });
      }
    });
    observer.observe({ type: 'resource', buffered: true });
    observers.push(observer);
  }
  return {
    begin,
    report() {
      return {
        viewport: { width: host.innerWidth, height: host.innerHeight },
        navigationMs:
          host.performance
            .getEntriesByType?.('navigation')
            .map((entry) => ({
              responseEnd: Math.round(entry.responseEnd),
              domContentLoaded: Math.round(entry.domContentLoadedEventEnd),
              load: Math.round(entry.loadEventEnd),
            })) ?? [],
        scenarios: scenarios.map((scenario) => ({
          ...scenario,
          requests: scenario.requests.map((entry) => ({ ...entry })),
        })),
        resources: historicalResources.map((entry) => ({ ...entry })),
        dropped,
        caveat:
          'headersMs ends at response headers, not body/decode/paint. firstVisibleImageMs is the first visible image load plus two animation frames; it may be retained content. No cold-start or complete-viewport claim is inferred.',
      };
    },
    stop() {
      stopped = true;
      if (host.fetch === wrappedFetch) host.fetch = nativeFetch;
      document.removeEventListener('load', onLoad, true);
      document.removeEventListener('click', onClick, true);
      observers.forEach((observer) => observer.disconnect());
    },
  };
}
