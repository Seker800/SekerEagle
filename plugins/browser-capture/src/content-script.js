const TOAST_ID = 'sekereagle-capture-toast';
const MAX_BROWSER_COPY_BYTES = 16 * 1024 * 1024;
const BROWSER_COPY_MIME_TYPES = new Set([
  'image/avif',
  'image/gif',
  'image/heic',
  'image/heif',
  'image/jpeg',
  'image/png',
  'image/webp',
  'video/mp4',
]);
let feedbackAudioContext = null;

chrome.runtime.onMessage.addListener((message) => {
  if (message?.type !== 'capture:result') return;
  const succeeded = message.status === 'COMPLETED';
  showToast(message.message, !succeeded, 5_000);
  void playFeedbackSound(succeeded ? 'success' : 'failure').catch(() => {});
});

void import(chrome.runtime.getURL('src/capture-interaction.js'))
  .then(({ createAltRightClickTracker, resolveCaptureTarget, resolveCaptureTargetAsync }) => {
    installCaptureInteraction({
      createAltRightClickTracker,
      resolveCaptureTarget,
      resolveCaptureTargetAsync,
    });
  })
  .catch(() => showToast('SekerEagle 插件加载失败，请重新加载扩展', true));

function installCaptureInteraction({
  createAltRightClickTracker,
  resolveCaptureTarget,
  resolveCaptureTargetAsync,
}) {
  const tracker = createAltRightClickTracker();
  let lastHandled = null;

  window.addEventListener('mousedown', (event) => tracker.remember(event), { capture: true });
  window.addEventListener('contextmenu', handleCaptureGesture, { capture: true });
  window.addEventListener('mouseup', handleCaptureGesture, { capture: true });

  function handleCaptureGesture(event) {
    if (!tracker.matches(event)) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    prepareFeedbackSound();

    const point = { x: Number(event.clientX), y: Number(event.clientY) };
    if (isDuplicateGesture(lastHandled, point)) return;
    lastHandled = { ...point, at: Date.now() };
    tracker.clear();

    const path = event.composedPath?.() || [event.target];
    const elementsAtPoint = collectElementsAtPoint(point.x, point.y);
    const target = resolveCaptureTarget({
      path,
      elementsAtPoint,
      baseUrl: location.href,
      getStyle: (element, pseudo) => window.getComputedStyle(element, pseudo),
      matchesMedia: (query) => window.matchMedia(query).matches,
      observedMediaUrls: readObservedMediaUrls(),
      observedXMediaRecords: readObservedXMediaRecords(),
    });
    const captureElement = selectCaptureElement(path, elementsAtPoint);
    const captureRect = captureRectangle(captureElement, point);
    showToast(
      target?.mediaType === 'video'
        ? '正在读取视频并加入队列…'
        : target
          ? '正在读取图片并加入队列…'
          : '正在截取可见内容并加入队列…',
    );
    void enqueueCapture(target, captureRect, captureElement, resolveCaptureTargetAsync).catch(() =>
      showToast('媒体读取失败，请重新加载扩展后再试', true),
    );
  }
}

async function enqueueCapture(target, captureRect, captureElement, resolveCaptureTargetAsync) {
  const resolvedTarget = await resolveCaptureTargetAsync({
    element: captureElement,
    baseUrl: location.href,
    target,
    fetchImpl: window.fetch.bind(window),
  });
  const browserCopy = await prepareBrowserCopy(resolvedTarget);
  document.getElementById(TOAST_ID)?.remove();
  chrome.runtime.sendMessage(
    {
      type: 'capture:enqueue',
      payload: {
        ...(resolvedTarget || { sourceUrl: null, sourceCandidates: [], altText: '' }),
        browserCopy,
        captureRect,
        viewport: { width: window.innerWidth, height: window.innerHeight },
        pageUrl: location.href,
        pageTitle: document.title,
      },
    },
    (response) => {
      if (chrome.runtime.lastError) {
        showToast('SekerEagle 插件暂时无法响应', true);
        return;
      }
      showToast(
        response?.ok
          ? `已加入 SekerEagle 队列 · ${response.pendingCount}`
          : response?.error || '素材加入队列失败',
        !response?.ok,
      );
    },
  );
}

async function prepareBrowserCopy(target) {
  if (!target) return null;
  for (const sourceUrl of target.sourceCandidates || []) {
    let url;
    try {
      url = new URL(sourceUrl, location.href);
    } catch {
      continue;
    }
    const canReadInPage = url.protocol === 'blob:' || url.origin === location.origin;
    if (!canReadInPage) continue;
    try {
      const response = await fetch(url.href, { credentials: 'include', cache: 'no-store' });
      if (!response.ok) continue;
      const declaredSize = Number(response.headers.get('content-length') || 0);
      if (declaredSize > MAX_BROWSER_COPY_BYTES) continue;
      const blob = await response.blob();
      const mimeType = String(blob.type || '')
        .split(';', 1)[0]
        .toLowerCase();
      if (
        !blob.size ||
        blob.size > MAX_BROWSER_COPY_BYTES ||
        !BROWSER_COPY_MIME_TYPES.has(mimeType)
      ) {
        continue;
      }
      return {
        dataUrl: await blobToDataUrl(blob),
        mimeType,
        size: blob.size,
        originalUrl: url.href,
      };
    } catch {
      // The background downloader and screenshot remain available as fallbacks.
    }
  }
  return null;
}

function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(reader.error || new Error('无法读取媒体内容。'));
    reader.readAsDataURL(blob);
  });
}

function selectCaptureElement(path, elementsAtPoint) {
  const elements = [...new Set([...path, ...elementsAtPoint])];
  return (
    elements.find((element) => element?.tagName === 'VIDEO') ||
    elements.find((element) => ['CANVAS', 'IMG', 'SVG'].includes(element?.tagName)) ||
    elements.find((element) => typeof element?.getBoundingClientRect === 'function') ||
    null
  );
}

function readObservedMediaUrls() {
  const values = window.__sekereagleObservedMediaUrls;
  return Array.isArray(values) ? values.slice(-200) : [];
}

function readObservedXMediaRecords() {
  const values = window.__sekereagleObservedXMediaRecords;
  return Array.isArray(values) ? values.slice(-100) : [];
}

function captureRectangle(element, point) {
  const rectangle = element?.getBoundingClientRect?.();
  if (!rectangle || rectangle.width <= 0 || rectangle.height <= 0) {
    return { x: point.x - 1, y: point.y - 1, width: 2, height: 2 };
  }
  const left = Math.max(0, rectangle.left);
  const top = Math.max(0, rectangle.top);
  const right = Math.min(window.innerWidth, rectangle.right);
  const bottom = Math.min(window.innerHeight, rectangle.bottom);
  return {
    x: left,
    y: top,
    width: Math.max(1, right - left),
    height: Math.max(1, bottom - top),
  };
}

function collectElementsAtPoint(x, y, root = document, visited = new WeakSet()) {
  if (!root || visited.has(root)) return [];
  visited.add(root);
  const elements = root.elementsFromPoint?.(x, y) || [];
  const result = [];
  for (const element of elements) {
    if (element.shadowRoot) {
      result.push(...collectElementsAtPoint(x, y, element.shadowRoot, visited));
    }
    result.push(element);
  }
  return [...new Set(result)];
}

function isDuplicateGesture(previous, point) {
  return (
    previous &&
    Date.now() - previous.at < 500 &&
    Math.hypot(previous.x - point.x, previous.y - point.y) <= 8
  );
}

function showToast(message, error = false, duration = 2_400) {
  document.getElementById(TOAST_ID)?.remove();
  const toast = document.createElement('div');
  toast.id = TOAST_ID;
  toast.textContent = message;
  Object.assign(toast.style, {
    position: 'fixed',
    right: '18px',
    bottom: '18px',
    zIndex: '2147483647',
    maxWidth: '360px',
    padding: '11px 14px',
    borderRadius: '10px',
    color: '#fff',
    background: error ? '#b42318' : '#202126',
    boxShadow: '0 10px 30px rgba(0,0,0,.28)',
    font: '13px/1.4 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif',
  });
  document.documentElement.append(toast);
  window.setTimeout(() => toast.remove(), duration);
}

function prepareFeedbackSound() {
  const AudioContext = window.AudioContext || window.webkitAudioContext;
  if (!AudioContext) return;
  feedbackAudioContext ??= new AudioContext();
  if (feedbackAudioContext.state === 'suspended') {
    void feedbackAudioContext.resume().catch(() => {});
  }
}

async function playFeedbackSound(kind) {
  prepareFeedbackSound();
  const context = feedbackAudioContext;
  if (!context) return;
  if (context.state === 'suspended') await context.resume();

  const notes = kind === 'success' ? [659, 880] : [330, 220];
  const start = context.currentTime;
  notes.forEach((frequency, index) => {
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    const noteStart = start + index * 0.14;
    oscillator.type = kind === 'success' ? 'sine' : 'triangle';
    oscillator.frequency.setValueAtTime(frequency, noteStart);
    gain.gain.setValueAtTime(0.0001, noteStart);
    gain.gain.exponentialRampToValueAtTime(0.16, noteStart + 0.015);
    gain.gain.exponentialRampToValueAtTime(0.0001, noteStart + 0.18);
    oscillator.connect(gain).connect(context.destination);
    oscillator.start(noteStart);
    oscillator.stop(noteStart + 0.2);
  });
}
