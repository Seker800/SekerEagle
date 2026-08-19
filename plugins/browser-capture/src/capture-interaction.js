const RIGHT_BUTTON = 2;

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

export function resolveCaptureTarget({ path = [], elementsAtPoint = [], baseUrl, getStyle }) {
  const candidates = [...new Set([...path, ...elementsAtPoint])];
  for (const element of candidates) {
    const image = imageElementTarget(element, baseUrl);
    if (image) return image;
    const background = backgroundImageTarget(element, baseUrl, getStyle);
    if (background) return background;
  }
  return null;
}

function imageElementTarget(element, baseUrl) {
  if (String(element?.tagName || '').toUpperCase() === 'PICTURE') {
    return imageElementTarget(element.querySelector?.('img'), baseUrl);
  }
  if (String(element?.tagName || '').toUpperCase() !== 'IMG') return null;
  const sourceUrl = absoluteUrl(
    element.currentSrc || element.src || element.getAttribute?.('src'),
    baseUrl,
  );
  if (!sourceUrl) return null;
  return { sourceUrl, altText: cleanText(element.alt) };
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
  return { sourceUrl, altText };
}

function absoluteUrl(value, baseUrl) {
  try {
    const url = new URL(String(value || '').trim(), baseUrl);
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

function distance(start, event) {
  return Math.hypot(start.x - Number(event.clientX), start.y - Number(event.clientY));
}
