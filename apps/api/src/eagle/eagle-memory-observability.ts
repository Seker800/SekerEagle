export const LIBRARY_READ_ACTIONS = [
  'page',
  'count',
  'statistics',
  'facets',
  'peopleCounts',
  'smartFolderPage',
  'colorPage',
] as const;
export type LibraryReadAction = (typeof LIBRARY_READ_ACTIONS)[number];
export const DEFAULT_LIBRARY_READ_ACTIONS =
  'statistics,facets,peopleCounts,smartFolderPage,colorPage';
export function readerActionEnabled(action: LibraryReadAction, configured: string | undefined) {
  return (configured ?? DEFAULT_LIBRARY_READ_ACTIONS)
    .split(',')
    .map((value) => value.trim())
    .includes(action);
}
const buckets = [1, 2, 5, 10, 20, 50, 100, 200, 500, 1000, 2000, 5000, Infinity];
type Outcome =
  | 'hit'
  | 'timeout'
  | 'unavailable'
  | 'invalid'
  | 'stale'
  | 'disabled'
  | 'unconfigured'
  | 'unsupported'
  | 'circuitOpen';
const skipped = new Set<Outcome>(['disabled', 'unconfigured', 'unsupported', 'circuitOpen']);
function counters() {
  return {
    requests: 0,
    attempts: 0,
    hits: 0,
    fallbacks: 0,
    bypassed: 0,
    durationMs: 0,
    histogram: buckets.map(() => 0),
    reasons: Object.fromEntries(
      [
        'timeout',
        'unavailable',
        'invalid',
        'stale',
        'disabled',
        'unconfigured',
        'unsupported',
        'circuitOpen',
      ].map((key) => [key, 0]),
    ) as Record<Exclude<Outcome, 'hit'>, number>,
  };
}
/** Finite process-wide aggregates: no user input, owner identifiers, tokens or unbounded sample arrays. */
export class LibraryReadObserver {
  private readonly actions = Object.fromEntries(
    LIBRARY_READ_ACTIONS.map((action) => [action, counters()]),
  ) as Record<LibraryReadAction, ReturnType<typeof counters>>;
  private readonly circuits = new Map<
    LibraryReadAction,
    { endpoint: string; until: number; probing: boolean }
  >();
  enter(action: LibraryReadAction, endpoint: string, now = Date.now()) {
    const state = this.circuits.get(action);
    if (!state || state.endpoint !== endpoint) {
      this.circuits.delete(action);
      return true;
    }
    if (state.until > now || state.probing) return false;
    state.probing = true;
    return true;
  }
  failed(action: LibraryReadAction, endpoint: string, delayMs: number, now = Date.now()) {
    this.circuits.set(action, { endpoint, until: now + delayMs, probing: false });
  }
  recovered(action: LibraryReadAction) {
    this.circuits.delete(action);
  }
  record(action: LibraryReadAction, outcome: Outcome, durationMs = 0) {
    const row = this.actions[action];
    row.requests++;
    if (skipped.has(outcome)) row.bypassed++;
    else {
      row.attempts++;
      row.durationMs += durationMs;
      row.histogram[buckets.findIndex((bound) => durationMs <= bound)]!++;
      if (outcome === 'hit') row.hits++;
      else row.fallbacks++;
    }
    if (outcome !== 'hit') row.reasons[outcome]++;
  }
  rejectHit(action: LibraryReadAction) {
    const row = this.actions[action];
    row.hits--;
    row.fallbacks++;
    row.reasons.stale++;
  }
  snapshot() {
    const quantile = (histogram: number[], count: number, fraction: number) => {
      if (!count) return null;
      let seen = 0;
      const at = histogram.findIndex((value) => {
        seen += value;
        return seen >= Math.ceil(count * fraction);
      });
      return Number.isFinite(buckets[at]) ? buckets[at]! : null;
    };
    return {
      measurement:
        'reader attempt duration; bucket upper bounds, excludes SQL fallback and API hydration',
      actions: Object.fromEntries(
        LIBRARY_READ_ACTIONS.map((action) => {
          const { histogram, ...row } = this.actions[action];
          return [
            action,
            {
              ...row,
              reasons: { ...row.reasons },
              hitRate: row.attempts ? row.hits / row.attempts : null,
              fallbackRate: row.attempts ? row.fallbacks / row.attempts : null,
              p50UpperBoundMs: quantile(histogram, row.attempts, 0.5),
              p95UpperBoundMs: quantile(histogram, row.attempts, 0.95),
              latencyBucketsMs: buckets.map((upper, index) => ({
                upperBoundMs: Number.isFinite(upper) ? upper : null,
                count: histogram[index],
              })),
            },
          ];
        }),
      ) as Record<
        LibraryReadAction,
        Omit<ReturnType<typeof counters>, 'histogram'> & {
          hitRate: number | null;
          fallbackRate: number | null;
          p50UpperBoundMs: number | null;
          p95UpperBoundMs: number | null;
          latencyBucketsMs: { upperBoundMs: number | null; count: number | undefined }[];
        }
      >,
    };
  }
}
export const libraryReadObserver = new LibraryReadObserver();
