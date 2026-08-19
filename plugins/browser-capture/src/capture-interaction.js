const RIGHT_BUTTON = 2;
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
];
const DIRECT_IMAGE_PATH = /\.(?:gif|heic|heif|jpe?g|png|webp)(?:$|[?#])/i;

export function createAltRightClickTracker({ maxDelayMs = 1_000, maxMovement = 8 } = {}) {
  let rightDown = null;

  return {
    remember(event, now = Date.now()) {
      if (!event?.isTrusted || event.button !== RIGHT_BUTTON) return;
      rightDown = {
        altKey: event.altKey === true,
        x: Number(event.clientX),
        y: Number(event.clientY),
        at: now,
      };
    },
    matches(event, now = Date.now()) {
      if (!event?.isTrusted) return false;
      if (event.type !== 'contextmenu' && event.button !== RIGHT_BUTTON) return false;
      if (event.altKey === true) return true;
      if (!rightDown?.altKey || now - rightDown.at > maxDelayMs) return false;
      return distance(rightDown, event) <= maxMovement;
    },
    clear() {
      rightDown = null;
    },
  };
}

export function resolveCaptureTarget({
  path = [],
  elementsAtPoint = [],
  baseUrl,
  getStyle,
  matchesMedia = () => true,
}) {
  const candidates = [...new Set([...path, ...elementsAtPoint])];
  for (const element of candidates) {
    const image = imageElementTarget(element, baseUrl, matchesMedia);
    if (image) return image;
    const background = backgroundImageTarget(element, baseUrl, getStyle);
    if (background) return background;
  }
  return null;
}

function imageElementTarget(element, baseUrl, matchesMedia, picture = null) {
  if (String(element?.tagName || '').toUpperCase() === 'PICTURE') {
    return imageElementTarget(element.querySelector?.('img'), baseUrl, matchesMedia, element);
  }
  if (String(element?.tagName || '').toUpperCase() !== 'IMG') return null;
  const containingPicture = picture || closestPicture(element);
  const responsive = responsiveImageCandidates(element, containingPicture, baseUrl, matchesMedia);
  const directLink = directImageLinkCandidate(element, baseUrl);
  const declaredHighResolution = HIGH_RESOLUTION_ATTRIBUTES.map((attribute) =>
    absoluteUrl(element.getAttribute?.(attribute), baseUrl),
  );
  const rendered = [
    absoluteUrl(element.currentSrc, baseUrl),
    absoluteUrl(element.src || element.getAttribute?.('src'), baseUrl),
  ];
  const highResolutionCandidates = uniqueUrls([
    ...responsive,
    directLink,
    ...declaredHighResolution,
  ]);
  const renderedFallbacks = uniqueUrls(rendered);
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

function responsiveImageCandidates(image, picture, baseUrl, matchesMedia) {
  const baseWidth = Math.max(
    positiveNumber(image?.naturalWidth),
    positiveNumber(image?.width),
    positiveNumber(image?.clientWidth),
    1_000,
  );
  const candidates = [];
  addSrcsetCandidates(candidates, image?.srcset || image?.getAttribute?.('srcset'), baseUrl, baseWidth);
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
    const url = absoluteUrl(parsed.url, baseUrl);
    if (!url) continue;
    const quality =
      parsed.unit === 'w'
        ? parsed.value
        : parsed.unit === 'x'
          ? parsed.value * baseWidth
          : 0;
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
  const candidate = absoluteUrl(anchor.getAttribute?.('href') || anchor.href, baseUrl);
  if (!candidate) return null;
  const type = String(anchor.type || anchor.getAttribute?.('type') || '').toLowerCase();
  const isDownload = anchor.hasAttribute?.('download') === true;
  return DIRECT_IMAGE_PATH.test(candidate) || type.startsWith('image/') || isDownload
    ? candidate
    : null;
}

function backgroundImageTarget(element, baseUrl, getStyle) {
  if (!element?.tagName || typeof getStyle !== 'function') return null;
  let style;
  try {
    style = getStyle(element);
  } catch {
    return null;
  }
  const backgroundImage = String(style?.backgroundImage || '');
  const backgroundRepeat = String(style?.backgroundRepeat || '');
  if (
    !backgroundImage.includes('url(') ||
    backgroundImage.includes('gradient') ||
    ['repeat', 'repeat-x', 'repeat-y'].includes(backgroundRepeat)
  ) {
    return null;
  }
  const match = backgroundImage.match(/url\(\s*["']?(.+?)["']?\s*\)/i);
  const sourceUrl = absoluteUrl(match?.[1], baseUrl);
  if (!sourceUrl) return null;
  const altText = cleanText(element.getAttribute?.('aria-label') || element.textContent);
  return { sourceUrl, sourceCandidates: [sourceUrl], altText };
}

function absoluteUrl(value, baseUrl) {
  const candidate = String(value || '').trim();
  if (!candidate) return null;
  try {
    const url = new URL(candidate, baseUrl);
    return ['http:', 'https:', 'data:', 'blob:'].includes(url.protocol) ? url.href : null;
  } catch {
    return null;
  }
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

function distance(start, event) {
  return Math.hypot(start.x - Number(event.clientX), start.y - Number(event.clientY));
}
