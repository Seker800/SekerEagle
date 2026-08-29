import { resolveCaptureUrl, resolveImageSourceTarget } from './image-source-resolver.js';
import {
  resolveVideoSourceTarget,
  resolveVideoSourceTargetAsync,
} from './video-source-resolver.js';

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

export function resolveCaptureTarget({
  path = [],
  elementsAtPoint = [],
  baseUrl,
  getStyle,
  matchesMedia = () => true,
  observedMediaUrls = [],
  observedXMediaRecords = [],
}) {
  const candidates = [...new Set([...path, ...elementsAtPoint])];
  for (const element of candidates) {
    const video = resolveVideoSourceTarget(
      element,
      baseUrl,
      observedMediaUrls,
      observedXMediaRecords,
    );
    if (video) return video;
    const image = resolveImageSourceTarget(element, baseUrl, matchesMedia);
    if (image) return image;
    const background = backgroundImageTarget(element, baseUrl, getStyle);
    if (background) return background;
  }
  return null;
}

export function resolveCaptureTargetAsync({ element, baseUrl, target, fetchImpl }) {
  if (String(element?.tagName || '').toUpperCase() !== 'VIDEO') return Promise.resolve(target);
  return resolveVideoSourceTargetAsync(element, baseUrl, target, fetchImpl);
}

function backgroundImageTarget(element, baseUrl, getStyle) {
  if (!element?.tagName || typeof getStyle !== 'function') return null;
  const sourceCandidates = [];
  for (const pseudo of [null, '::before', '::after']) {
    let style;
    try {
      style = getStyle(element, pseudo);
    } catch {
      continue;
    }
    for (const property of ['backgroundImage', 'maskImage', 'webkitMaskImage', 'content']) {
      sourceCandidates.push(...extractCssUrls(style?.[property], baseUrl));
    }
  }
  const uniqueCandidates = [...new Set(sourceCandidates)];
  if (!uniqueCandidates.length) return null;
  const altText = cleanText(element.getAttribute?.('aria-label') || element.textContent);
  return {
    sourceUrl: uniqueCandidates[0],
    sourceCandidates: uniqueCandidates,
    altText,
  };
}

function extractCssUrls(value, baseUrl) {
  const result = [];
  const expression = /url\(\s*(["']?)(.*?)\1\s*\)/gi;
  for (const match of String(value || '').matchAll(expression)) {
    const resolved = resolveCaptureUrl(match[2], baseUrl);
    if (resolved) result.push(resolved);
  }
  return result;
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
