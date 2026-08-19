const TOAST_ID = 'sekereagle-capture-toast';

void import(chrome.runtime.getURL('src/capture-interaction.js'))
  .then(({ createAltRightClickTracker, resolveCaptureTarget }) => {
    installCaptureInteraction({ createAltRightClickTracker, resolveCaptureTarget });
  })
  .catch(() => showToast('SekerEagle 插件加载失败，请重新加载扩展', true));

function installCaptureInteraction({ createAltRightClickTracker, resolveCaptureTarget }) {
  const tracker = createAltRightClickTracker();
  let lastHandled = null;

  window.addEventListener('mousedown', (event) => tracker.remember(event), { capture: true });
  window.addEventListener('contextmenu', handleCaptureGesture, { capture: true });
  window.addEventListener('mouseup', handleCaptureGesture, { capture: true });

  function handleCaptureGesture(event) {
    if (!tracker.matches(event)) return;
    event.preventDefault();
    event.stopImmediatePropagation();

    const point = { x: Number(event.clientX), y: Number(event.clientY) };
    if (isDuplicateGesture(lastHandled, point)) return;
    lastHandled = { ...point, at: Date.now() };
    tracker.clear();

    const target = resolveCaptureTarget({
      path: event.composedPath?.() || [event.target],
      elementsAtPoint: collectElementsAtPoint(point.x, point.y),
      baseUrl: location.href,
      getStyle: (element) => window.getComputedStyle(element),
      matchesMedia: (query) => window.matchMedia(query).matches,
    });
    if (!target) {
      showToast('这里没有检测到可采集的图片', true);
      return;
    }

    showToast('正在加入 SekerEagle 队列…');
    chrome.runtime.sendMessage(
      {
        type: 'capture:enqueue',
        payload: {
          ...target,
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
            : response?.error || '图片加入队列失败',
          !response?.ok,
        );
      },
    );
  }
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

function showToast(message, error = false) {
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
  window.setTimeout(() => toast.remove(), 2_400);
}
