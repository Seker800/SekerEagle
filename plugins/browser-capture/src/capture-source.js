const MAX_CANDIDATES = 12;
const SUPPORTED_SOURCE_PROTOCOLS = new Set(['http:', 'https:', 'data:', 'blob:']);

export function normalizeCaptureSourceCandidates(payload, limit = MAX_CANDIDATES) {
  const requested = Array.isArray(payload?.sourceCandidates) ? payload.sourceCandidates : [];
  const candidates = [...requested, payload?.sourceUrl];
  const normalized = [];
  const seen = new Set();

  for (const value of candidates) {
    const candidate = normalizeSourceUrl(value);
    if (!candidate || seen.has(candidate)) continue;
    seen.add(candidate);
    normalized.push(candidate);
    if (normalized.length >= limit) break;
  }
  return normalized;
}

function normalizeSourceUrl(value) {
  if (typeof value !== 'string') return null;
  const candidate = value.trim();
  if (!candidate) return null;
  try {
    const url = new URL(candidate);
    return SUPPORTED_SOURCE_PROTOCOLS.has(url.protocol) ? url.href : null;
  } catch {
    return null;
  }
}
