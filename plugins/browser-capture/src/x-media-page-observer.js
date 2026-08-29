(() => {
  const INSTALL_KEY = '__sekereagleXMediaObserverInstalled';
  const MESSAGE_TYPE = 'sekereagle:x-media';
  const MAX_VISITED_OBJECTS = 5_000;
  if (window[INSTALL_KEY]) return;
  window[INSTALL_KEY] = true;

  const originalFetch = window.fetch;
  if (typeof originalFetch !== 'function') return;

  window.fetch = function (...args) {
    const request = originalFetch.apply(this, args);
    void request.then((response) => inspectResponse(response)).catch(() => {});
    return request;
  };

  function inspectResponse(response) {
    if (!isTwitterApiUrl(response?.url)) return;
    const contentType = response.headers?.get?.('content-type') || '';
    if (!contentType.toLowerCase().includes('json')) return;
    void response
      .clone()
      .json()
      .then(publishTweetMedia)
      .catch(() => {});
  }

  function publishTweetMedia(root) {
    const visited = new WeakSet();
    const stack = [root];
    let visitedCount = 0;
    while (stack.length && visitedCount < MAX_VISITED_OBJECTS) {
      const value = stack.pop();
      if (!value || typeof value !== 'object' || visited.has(value)) continue;
      visited.add(value);
      visitedCount += 1;

      const tweetId = tweetIdFrom(value);
      const media = value?.legacy?.extended_entities?.media || value?.extended_entities?.media;
      if (tweetId && Array.isArray(media)) {
        const mediaGroups = media.map((item) => videoVariants(item));
        if (mediaGroups.some((group) => group.length)) {
          window.postMessage({ type: MESSAGE_TYPE, tweetId, mediaGroups }, location.origin);
        }
      }

      for (const child of Array.isArray(value) ? value : Object.values(value)) {
        if (child && typeof child === 'object') stack.push(child);
      }
    }
  }

  function videoVariants(media) {
    return (media?.video_info?.variants || [])
      .filter((variant) => variant?.content_type === 'video/mp4' && Number(variant?.bitrate) > 0)
      .sort((left, right) => Number(right.bitrate) - Number(left.bitrate))
      .map((variant) => ({ url: variant.url, bitrate: Number(variant.bitrate) }));
  }

  function tweetIdFrom(value) {
    const candidate = value?.rest_id || value?.id_str;
    return /^\d+$/.test(String(candidate || '')) ? String(candidate) : null;
  }

  function isTwitterApiUrl(value) {
    try {
      const url = new URL(String(value || ''), location.href);
      return (
        url.origin === location.origin &&
        (url.pathname.includes('/i/api/') || url.pathname.includes('/graphql/'))
      );
    } catch {
      return false;
    }
  }
})();
