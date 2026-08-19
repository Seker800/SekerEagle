const TOAST_ID = 'sekereagle-capture-toast';

window.addEventListener(
  'contextmenu',
  (event) => {
    if (!event.isTrusted || !event.altKey) return;
    const image = event.composedPath().find((node) => node instanceof HTMLImageElement);
    if (!image) return;
    const sourceUrl = image.currentSrc || image.src;
    if (!sourceUrl) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    chrome.runtime.sendMessage(
      {
        type: 'capture:enqueue',
        payload: {
          sourceUrl,
          pageUrl: location.href,
          pageTitle: document.title,
          altText: image.alt || '',
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
  },
  { capture: true },
);

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
  window.setTimeout(() => toast.remove(), 2400);
}
