const MAX_SOURCE_CANDIDATES = 12;
const HIGH_RESOLUTION_ATTRIBUTES = [
  'data-original',
  'data-original-src',
  'data-full',
  'data-full-src',
  'data-highres',
  'data-high-res',
  'data-high-res-src',
  'data-large',
  'data-large-src',
  'data-zoom-image',
  'data-zoom-src',
  'data-src',
  'data-lazy-src',
  'data-url',
];
const HIGH_RESOLUTION_SRCSET_ATTRIBUTES = ['data-srcset', 'data-lazy-srcset'];
const DIRECT_IMAGE_PATH = /\.(?:avif|gif|heic|heif|jpe?g|png|webp)(?:$|[?#])/i;

export function resolveImageSourceTarget(
  element,
  baseUrl,
  matchesMedia = () => true,
  picture = null,
) {
  const tagName = String(element?.tagName || '').toUpperCase();
  if (tagName === 'VIDEO') {
    const poster = resolveCaptureUrl(element.poster || element.getAttribute?.('poster'), baseUrl);
    return poster ? captureTarget([poster], element.getAttribute?.('aria-label')) : null;
  }
  if (tagName === 'IMAGE') {
    const href = resolveCaptureUrl(
      element.href?.baseVal || element.getAttribute?.('href') || element.getAttribute?.('xlink:href'),
      baseUrl,
    );
    return href ? captureTarget([href], element.getAttribute?.('aria-label')) : null;
  }
  if (tagName === 'PICTURE') {
    return resolveImageSourceTarget(element.querySelector?.('img'), baseUrl, matchesMedia, element);
  }
  if (String(element?.tagName || '').toUpperCase() !== 'IMG') return null;
  const containingPicture = picture || closestPicture(element);
  const responsive = responsiveImageCandidates(element, containingPicture, baseUrl, matchesMedia);
  const lazyResponsive = HIGH_RESOLUTION_SRCSET_ATTRIBUTES.flatMap((attribute) => {
    const candidates = [];
    addSrcsetCandidates(candidates, element.getAttribute?.(attribute), baseUrl, 1_000);
    return candidates.sort((left, right) => right.quality - left.quality).map(({ url }) => url);
  });
  const directLink = directImageLinkCandidate(element, baseUrl);
  const declaredHighResolution = HIGH_RESOLUTION_ATTRIBUTES.map((attribute) =>
    resolveCaptureUrl(element.getAttribute?.(attribute), baseUrl),
  );
  const renderedFallbacks = uniqueUrls([
    resolveCaptureUrl(element.currentSrc, baseUrl),
    resolveCaptureUrl(element.src || element.getAttribute?.('src'), baseUrl),
  ]);
  const highResolutionCandidates = uniqueUrls([
    ...responsive,
    ...lazyResponsive,
    directLink,
    ...declaredHighResolution,
  ]);
  const sourceCandidates = uniqueUrls([
    ...highResolutionCandidates.slice(0, MAX_SOURCE_CANDIDATES - renderedFallbacks.length),
    ...renderedFallbacks,
  ]).slice(0, MAX_SOURCE_CANDIDATES);
  if (!sourceCandidates.length) return null;
  return {
    sourceUrl: sourceCandidates[0],
    sourceCandidates,
    altText: cleanText(element.alt),
  };
}

function captureTarget(sourceCandidates, altText) {
  return {
    sourceUrl: sourceCandidates[0],
    sourceCandidates,
    altText: cleanText(altText),
  };
}

export function resolveCaptureUrl(value, baseUrl) {
  const candidate = String(value || '').trim();
  if (!candidate) return null;
  try {
    const url = new URL(candidate, baseUrl);
    return ['http:', 'https:', 'data:', 'blob:'].includes(url.protocol) ? url.href : null;
  } catch {
    return null;
  }
}

function responsiveImageCandidates(image, picture, baseUrl, matchesMedia) {
  const baseWidth = Math.max(
    positiveNumber(image?.naturalWidth),
    positiveNumber(image?.width),
    positiveNumber(image?.clientWidth),
    1_000,
  );
  const candidates = [];
  addSrcsetCandidates(
    candidates,
    image?.srcset || image?.getAttribute?.('srcset'),
    baseUrl,
    baseWidth,
  );
  for (const source of picture?.querySelectorAll?.('source') || []) {
    const media = String(source.media || source.getAttribute?.('media') || '').trim();
    if (media && !safeMatchesMedia(matchesMedia, media)) continue;
    addSrcsetCandidates(
      candidates,
      source.srcset || source.getAttribute?.('srcset'),
      baseUrl,
      baseWidth,
    );
  }
  return candidates
    .sort((left, right) => right.quality - left.quality || left.order - right.order)
    .map(({ url }) => url);
}

function addSrcsetCandidates(target, srcset, baseUrl, baseWidth) {
  for (const parsed of parseSrcset(srcset)) {
    const url = resolveCaptureUrl(parsed.url, baseUrl);
    if (!url) continue;
    const quality =
      parsed.unit === 'w' ? parsed.value : parsed.unit === 'x' ? parsed.value * baseWidth : 0;
    target.push({ url, quality, order: target.length });
  }
}

function parseSrcset(value) {
  const input = String(value || '');
  const candidates = [];
  let position = 0;
  while (position < input.length) {
    while (position < input.length && (isSpace(input[position]) || input[position] === ',')) {
      position += 1;
    }
    const urlStart = position;
    while (position < input.length && !isSpace(input[position])) position += 1;
    let url = input.slice(urlStart, position);
    if (!url) break;
    if (url.endsWith(',')) {
      url = url.replace(/,+$/, '');
      if (url) candidates.push({ url, value: 0, unit: null });
      continue;
    }

    while (position < input.length && isSpace(input[position])) position += 1;
    const descriptorStart = position;
    let parentheses = 0;
    while (position < input.length) {
      const character = input[position];
      if (character === '(') parentheses += 1;
      if (character === ')') parentheses = Math.max(0, parentheses - 1);
      if (character === ',' && parentheses === 0) break;
      position += 1;
    }
    const descriptor = input.slice(descriptorStart, position).trim();
    if (input[position] === ',') position += 1;
    const match = descriptor.match(/^([0-9]*\.?[0-9]+)(w|x)$/i);
    candidates.push({
      url,
      value: match ? Number(match[1]) : 0,
      unit: match?.[2]?.toLowerCase() || null,
    });
  }
  return candidates.filter(({ value, unit }) => !unit || (Number.isFinite(value) && value > 0));
}

function closestPicture(element) {
  const picture = element.closest?.('picture');
  return String(picture?.tagName || '').toUpperCase() === 'PICTURE' ? picture : null;
}

function directImageLinkCandidate(element, baseUrl) {
  const anchor = element.closest?.('a[href]');
  if (!anchor) return null;
  const candidate = resolveCaptureUrl(anchor.getAttribute?.('href') || anchor.href, baseUrl);
  if (!candidate) return null;
  const type = String(anchor.type || anchor.getAttribute?.('type') || '').toLowerCase();
  const isDownload = anchor.hasAttribute?.('download') === true;
  return DIRECT_IMAGE_PATH.test(candidate) || type.startsWith('image/') || isDownload
    ? candidate
    : null;
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

function positiveNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : 0;
}

function safeMatchesMedia(matchesMedia, query) {
  try {
    return matchesMedia(query) !== false;
  } catch {
    return false;
  }
}

function isSpace(value) {
  return /\s/.test(value);
}
