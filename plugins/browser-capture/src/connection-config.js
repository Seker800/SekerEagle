const CONNECTION_MODES = new Set(['auto', 'local', 'public']);

export function normalizeServerUrl(value, { allowRemoteHttp = false } = {}) {
  const url = new URL(String(value || '').trim());
  if (url.username || url.password || url.search || url.hash) {
    throw new Error('服务器地址不能包含凭据、查询参数或片段。');
  }
  const loopback = isLoopbackHostname(url.hostname);
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && (loopback || allowRemoteHttp))) {
    throw new Error('远程 SekerEagle 必须使用 HTTPS；HTTP 仅允许 loopback。');
  }
  return `${url.origin}${url.pathname.replace(/\/+$/, '')}`;
}

export function buildServerCandidates(config) {
  const mode = CONNECTION_MODES.has(config.connectionMode) ? config.connectionMode : 'auto';
  const localValue = String(config.localServerUrl || config.serverUrl || '').trim();
  const publicValue = String(config.publicServerUrl || '').trim();
  const local = localValue ? normalizeServerUrl(localValue) : null;
  const publicUrl = publicValue
    ? normalizePublicServerUrl(publicValue, {
        allowInsecureHttp: config.allowInsecurePublicHttp === true,
      })
    : null;

  if (mode === 'local') {
    if (!local) throw new Error('请配置内网服务器地址。');
    return [local];
  }
  if (mode === 'public') {
    if (!publicUrl) throw new Error('请先配置公网服务器地址。');
    return [publicUrl];
  }
  const candidates = [...new Set([local, publicUrl].filter(Boolean))];
  if (!candidates.length) throw new Error('请至少配置一个 SekerEagle 服务器地址。');
  return candidates;
}

export function rewritePresignedUploadUrl(
  uploadUrl,
  activeServerUrl,
  { allowInsecureHttp = false } = {},
) {
  const upload = new URL(uploadUrl);
  const active = new URL(
    normalizeServerUrl(activeServerUrl, { allowRemoteHttp: allowInsecureHttp }),
  );
  if (
    upload.username ||
    upload.password ||
    !['http:', 'https:'].includes(upload.protocol) ||
    !upload.pathname.startsWith('/sekereagle-assets/') ||
    !upload.searchParams.has('X-Amz-Signature')
  ) {
    throw new Error('服务端返回了无效的对象存储上传地址。');
  }
  if (upload.origin !== active.origin) {
    if (!isLoopbackHostname(upload.hostname)) {
      throw new Error('对象存储上传地址不属于已配置的 SekerEagle。');
    }
    upload.protocol = active.protocol;
    upload.hostname = active.hostname;
    upload.port = active.port;
  }
  return upload.toString();
}

export function normalizePublicServerUrl(value, { allowInsecureHttp = false } = {}) {
  const normalized = normalizeServerUrl(value, { allowRemoteHttp: true });
  const url = new URL(normalized);
  if (isLoopbackHostname(url.hostname)) {
    throw new Error('公网 SekerEagle 地址不能使用 loopback。');
  }
  if (url.protocol === 'http:' && !allowInsecureHttp) {
    throw new Error('公网 HTTP 会明文传输 PAT 和图片；请先显式允许。');
  }
  return normalized;
}

function isLoopbackHostname(hostname) {
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]';
}
