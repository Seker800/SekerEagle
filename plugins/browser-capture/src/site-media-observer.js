const OBSERVED_MEDIA_KEY = '__sekereagleObservedMediaUrls';
const OBSERVED_X_RECORDS_KEY = '__sekereagleObservedXMediaRecords';
const X_MEDIA_MESSAGE_TYPE = 'sekereagle:x-media';
const MAX_OBSERVED_MEDIA_URLS = 200;
const MAX_X_MEDIA_RECORDS = 100;

if (isXHost(location.hostname)) {
  const observed = (window[OBSERVED_MEDIA_KEY] ??= []);
  const records = (window[OBSERVED_X_RECORDS_KEY] ??= []);
  const remember = (value) => {
    const candidate = normalizeXVideoUrl(value);
    if (!candidate) return;
    const existing = observed.indexOf(candidate);
    if (existing >= 0) observed.splice(existing, 1);
    observed.push(candidate);
    if (observed.length > MAX_OBSERVED_MEDIA_URLS) {
      observed.splice(0, observed.length - MAX_OBSERVED_MEDIA_URLS);
    }
  };

  window.addEventListener('message', (event) => {
    if (event.source !== window || event.origin !== location.origin) return;
    const record = normalizeXMediaRecord(event.data);
    if (!record) return;
    const existing = records.findIndex((item) => item.tweetId === record.tweetId);
    if (existing >= 0) records.splice(existing, 1);
    records.push(record);
    if (records.length > MAX_X_MEDIA_RECORDS) {
      records.splice(0, records.length - MAX_X_MEDIA_RECORDS);
    }
  });

  if (typeof globalThis.PerformanceObserver === 'function') {
    try {
      for (const entry of globalThis.performance.getEntriesByType('resource')) remember(entry.name);
      new globalThis.PerformanceObserver((list) => {
        for (const entry of list.getEntries()) remember(entry.name);
      }).observe({ type: 'resource', buffered: true });
    } catch {
      // Resource timing remains a fallback when X changes its response structure.
    }
  }
}

function normalizeXMediaRecord(message) {
  if (message?.type !== X_MEDIA_MESSAGE_TYPE || !/^\d+$/.test(String(message.tweetId || ''))) {
    return null;
  }
  if (!Array.isArray(message.mediaGroups) || message.mediaGroups.length > 20) return null;
  const mediaGroups = message.mediaGroups.map((group) =>
    (Array.isArray(group) ? group : [])
      .map((variant) => ({
        url: normalizeXVideoUrl(variant?.url),
        bitrate: Number(variant?.bitrate) || 0,
      }))
      .filter((variant) => variant.url && variant.bitrate > 0)
      .sort((left, right) => right.bitrate - left.bitrate)
      .slice(0, 10),
  );
  return mediaGroups.some((group) => group.length)
    ? { tweetId: String(message.tweetId), mediaGroups }
    : null;
}

function normalizeXVideoUrl(value) {
  try {
    const url = new URL(String(value || ''));
    if (url.protocol !== 'https:' || url.hostname !== 'video.twimg.com') return null;
    if (!/\.mp4$/i.test(url.pathname)) return null;
    return url.href;
  } catch {
    return null;
  }
}

function isXHost(hostname) {
  return hostname === 'x.com' || hostname.endsWith('.x.com') || hostname === 'twitter.com';
}
