import { resolveCaptureUrl } from './image-source-resolver.js';

const MAX_SOURCE_CANDIDATES = 12;
const X_VIDEO_HOST = 'video.twimg.com';
const XIAOHONGSHU_STREAM_TIERS = ['EF7', 'EF6', 'EF5', 'EF4', 'h264', 'H264'];

export function resolveVideoSourceTarget(
  element,
  baseUrl,
  observedMediaUrls = [],
  observedXMediaRecords = [],
) {
  if (String(element?.tagName || '').toUpperCase() !== 'VIDEO') return null;

  const siteTarget =
    resolveXVideo(element, baseUrl, observedMediaUrls, observedXMediaRecords) ||
    resolveXiaohongshuVideo(element, baseUrl);
  const directCandidates = directVideoCandidates(element, baseUrl);
  const sourceCandidates = uniqueUrls([
    ...(siteTarget?.sourceCandidates || []),
    ...directCandidates,
  ]).slice(0, MAX_SOURCE_CANDIDATES);
  if (!sourceCandidates.length) return null;

  return {
    mediaType: 'video',
    sourceUrl: sourceCandidates[0],
    sourceCandidates,
    posterUrl: resolveCaptureUrl(element.poster || element.getAttribute?.('poster'), baseUrl),
    altText: cleanText(
      siteTarget?.altText ||
        element.getAttribute?.('aria-label') ||
        element.getAttribute?.('title'),
    ),
  };
}

export async function resolveVideoSourceTargetAsync(
  element,
  baseUrl,
  target,
  fetchImpl = globalThis.fetch,
) {
  if (!isXiaohongshuPage(baseUrl) || typeof fetchImpl !== 'function') return target;
  const noteUrl = xiaohongshuNoteUrl(element, baseUrl);
  if (!noteUrl) return target;

  try {
    const response = await fetchImpl(noteUrl.href, { credentials: 'include', cache: 'no-store' });
    if (!response?.ok) return target;
    const detailMap = extractJsonObjectAfter(await response.text(), '"noteDetailMap":');
    const note = detailMap?.[noteUrl.noteId]?.note || Object.values(detailMap || {})[0]?.note;
    const streamTarget = xiaohongshuStreamTarget(note?.video?.media?.stream, baseUrl, note);
    return streamTarget
      ? mergeVideoTargets(streamTarget, target || emptyVideoTarget(element, baseUrl))
      : target;
  } catch {
    return target;
  }
}

function resolveXVideo(element, baseUrl, observedMediaUrls, observedXMediaRecords) {
  let page;
  try {
    page = new URL(baseUrl);
  } catch {
    return null;
  }
  if (!isXHost(page.hostname)) return null;

  const tweetId = xTweetId(element, page);
  const mediaIndex = xMediaIndex(element);
  const record = [...observedXMediaRecords].reverse().find((item) => item?.tweetId === tweetId);
  const recordGroups = record?.mediaGroups || [];
  const selectedGroup = recordGroups[mediaIndex] || recordGroups.find((group) => group?.length);
  const apiCandidates = (selectedGroup || [])
    .slice()
    .sort((left, right) => Number(right?.bitrate) - Number(left?.bitrate))
    .map((variant) => normalizeXVideoUrl(variant?.url))
    .filter(Boolean);

  const mediaId = xMediaIdFromPoster(element.poster || element.getAttribute?.('poster'));
  const timingCandidates = mediaId
    ? observedMediaUrls
        .map((value) => normalizeObservedXVideo(value, mediaId))
        .filter(Boolean)
        .sort((left, right) => videoQuality(right) - videoQuality(left))
    : [];
  const candidates = uniqueUrls([...apiCandidates, ...timingCandidates]);
  return candidates.length ? { sourceCandidates: candidates } : null;
}

function resolveXiaohongshuVideo(element, baseUrl) {
  if (!isXiaohongshuPage(baseUrl)) return null;
  const candidates = [];
  let altText = '';
  for (const script of element.ownerDocument?.querySelectorAll?.(
    'script[type="application/ld+json"]',
  ) || []) {
    let data;
    try {
      data = JSON.parse(script.textContent || '');
    } catch {
      continue;
    }
    for (const item of Array.isArray(data) ? data : [data]) {
      if (item?.['@type'] !== 'VideoObject') continue;
      const url = normalizeXiaohongshuVideoUrl(item.contentUrl, baseUrl);
      if (url) candidates.push(url);
      if (!altText) altText = cleanText(item.name || item.description);
    }
  }
  return candidates.length ? { sourceCandidates: uniqueUrls(candidates), altText } : null;
}

function xiaohongshuStreamTarget(stream, baseUrl, note) {
  if (!stream || typeof stream !== 'object') return null;
  const entries = [];
  for (const key of XIAOHONGSHU_STREAM_TIERS) {
    const tier = Array.isArray(stream[key]) ? [...stream[key]].reverse() : [];
    for (const item of tier) {
      if (isH265Stream(item)) continue;
      const url = normalizeXiaohongshuVideoUrl(item?.masterUrl, baseUrl);
      if (url) entries.push(url);
    }
  }
  const sourceCandidates = uniqueUrls(entries);
  return sourceCandidates.length
    ? {
        mediaType: 'video',
        sourceUrl: sourceCandidates[0],
        sourceCandidates,
        posterUrl: null,
        altText: cleanText(note?.title || note?.desc),
      }
    : null;
}

function xiaohongshuNoteUrl(element, baseUrl) {
  const values = [
    element?.closest?.('a[href*="/explore/"]')?.href,
    element?.closest?.('a[href*="/discovery/item/"]')?.href,
    baseUrl,
  ];
  for (const value of values) {
    try {
      const url = new URL(String(value || ''), baseUrl);
      if (!isXiaohongshuHost(url.hostname)) continue;
      const match = url.pathname.match(/\/(?:explore|discovery\/item)\/([a-z0-9]{24})(?:\/|$)/i);
      if (match) return Object.assign(url, { noteId: match[1] });
    } catch {
      // Try the next candidate URL.
    }
  }
  return null;
}

function extractJsonObjectAfter(text, marker) {
  const startMarker = String(text || '').indexOf(marker);
  if (startMarker < 0) return null;
  const start = text.indexOf('{', startMarker + marker.length);
  if (start < 0) return null;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = start; index < text.length; index += 1) {
    const character = text[index];
    if (inString) {
      if (escaped) escaped = false;
      else if (character === '\\') escaped = true;
      else if (character === '"') inString = false;
      continue;
    }
    if (character === '"') inString = true;
    else if (character === '{') depth += 1;
    else if (character === '}' && --depth === 0) {
      try {
        return JSON.parse(text.slice(start, index + 1));
      } catch {
        return null;
      }
    }
  }
  return null;
}

function mergeVideoTargets(preferred, fallback) {
  const sourceCandidates = uniqueUrls([
    ...(preferred.sourceCandidates || []),
    ...(fallback.sourceCandidates || []),
  ]).slice(0, MAX_SOURCE_CANDIDATES);
  return {
    ...fallback,
    ...preferred,
    sourceUrl: sourceCandidates[0],
    sourceCandidates,
    posterUrl: preferred.posterUrl || fallback.posterUrl || null,
    altText: preferred.altText || fallback.altText || '',
  };
}

function emptyVideoTarget(element, baseUrl) {
  return {
    mediaType: 'video',
    sourceUrl: null,
    sourceCandidates: [],
    posterUrl: resolveCaptureUrl(element?.poster || element?.getAttribute?.('poster'), baseUrl),
    altText: '',
  };
}

function directVideoCandidates(element, baseUrl) {
  const values = [element.currentSrc, element.src || element.getAttribute?.('src')];
  for (const source of element.querySelectorAll?.('source') || []) {
    const type = String(source.type || source.getAttribute?.('type') || '').toLowerCase();
    if (type && type !== 'video/mp4') continue;
    values.push(source.src || source.getAttribute?.('src'));
  }
  return uniqueUrls(values.map((value) => resolveCaptureUrl(value, baseUrl)));
}

function normalizeObservedXVideo(value, expectedMediaId) {
  const normalized = normalizeXVideoUrl(value);
  if (!normalized) return null;
  const url = new URL(normalized);
  return url.pathname.includes(`/${expectedMediaId}/`) ? url.href : null;
}

function normalizeXVideoUrl(value) {
  try {
    const url = new URL(String(value || ''));
    return url.protocol === 'https:' &&
      url.hostname === X_VIDEO_HOST &&
      /\.mp4$/i.test(url.pathname)
      ? url.href
      : null;
  } catch {
    return null;
  }
}

function normalizeXiaohongshuVideoUrl(value, baseUrl) {
  const resolved = resolveCaptureUrl(value, baseUrl);
  if (!resolved) return null;
  try {
    const url = new URL(resolved);
    return url.protocol === 'https:' && isXiaohongshuCdn(url.hostname) ? url.href : null;
  } catch {
    return null;
  }
}

function xTweetId(element, page) {
  const link = element?.closest?.('article')?.querySelector?.('a[href*="/status/"]');
  const match = String(link?.href || page.href).match(/\/status\/(\d+)/);
  return match?.[1] || null;
}

function xMediaIndex(element) {
  const article = element?.closest?.('article');
  const media =
    article?.querySelectorAll?.('[data-testid="tweetPhoto"], [data-testid="videoComponent"]') || [];
  for (let index = 0; index < media.length; index += 1) {
    if (media[index] === element || media[index]?.contains?.(element)) return index;
  }
  return 0;
}

function xMediaIdFromPoster(value) {
  const match = String(value || '').match(
    /\/(?:amplify_video|ext_tw_video|tweet_video)_thumb\/(\d+)\//i,
  );
  return match?.[1] || null;
}

function videoQuality(value) {
  const match = String(value).match(/\/(\d+)x(\d+)\//i);
  return match ? Number(match[1]) * Number(match[2]) : 0;
}

function isH265Stream(item) {
  return /(?:h265|hevc|hev1)/i.test(
    [item?.videoCodec, item?.codec, item?.format, item?.qualityType].filter(Boolean).join(' '),
  );
}

function isXHost(hostname) {
  return hostname === 'x.com' || hostname.endsWith('.x.com') || hostname === 'twitter.com';
}

function isXiaohongshuPage(value) {
  try {
    return isXiaohongshuHost(new URL(value).hostname);
  } catch {
    return false;
  }
}

function isXiaohongshuHost(hostname) {
  return hostname === 'xiaohongshu.com' || hostname.endsWith('.xiaohongshu.com');
}

function isXiaohongshuCdn(hostname) {
  return hostname === 'xhscdn.com' || hostname.endsWith('.xhscdn.com');
}

function cleanText(value) {
  return String(value || '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 1_000);
}

function uniqueUrls(values) {
  return [...new Set(values.filter(Boolean))];
}
