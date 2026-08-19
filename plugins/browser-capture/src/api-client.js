export class CaptureApiError extends Error {
  constructor(message, { status = 0, kind = 'TRANSIENT' } = {}) {
    super(message);
    this.name = 'CaptureApiError';
    this.status = status;
    this.kind = kind;
  }
}

export function normalizeServerUrl(value) {
  const url = new URL(String(value || '').trim());
  if (url.username || url.password || url.search || url.hash) {
    throw new Error('服务器地址不能包含凭据、查询参数或片段。');
  }
  const loopback =
    url.hostname === 'localhost' || url.hostname === '127.0.0.1' || url.hostname === '[::1]';
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback)) {
    throw new Error('远程 SekerEagle 必须使用 HTTPS；HTTP 仅允许 loopback。');
  }
  return `${url.origin}${url.pathname.replace(/\/+$/, '')}`;
}

export class CaptureApiClient {
  constructor({ serverUrl, pat, fetchImpl = fetch }) {
    this.serverUrl = normalizeServerUrl(serverUrl);
    this.pat = String(pat || '').trim();
    if (!this.pat.startsWith('seg_pat_')) throw new Error('请配置有效的 SekerEagle PAT。');
    this.fetchImpl = fetchImpl;
  }

  initiate(body) {
    return this.request('', { method: 'POST', body });
  }

  get(clientCaptureId) {
    return this.request(`/${encodeURIComponent(clientCaptureId)}`);
  }

  listParts(clientCaptureId) {
    return this.request(`/${encodeURIComponent(clientCaptureId)}/parts`);
  }

  presignPart(clientCaptureId, partNumber) {
    return this.request(`/${encodeURIComponent(clientCaptureId)}/parts/${partNumber}`, {
      method: 'POST',
      body: {},
    });
  }

  complete(clientCaptureId, parts) {
    return this.request(`/${encodeURIComponent(clientCaptureId)}/complete`, {
      method: 'POST',
      body: { parts },
    });
  }

  abort(clientCaptureId) {
    return this.request(`/${encodeURIComponent(clientCaptureId)}`, {
      method: 'DELETE',
      body: {},
    });
  }

  async uploadPart(uploadUrl, bytes) {
    let response;
    try {
      response = await this.fetchImpl(uploadUrl, {
        method: 'PUT',
        body: bytes,
        credentials: 'omit',
      });
    } catch (cause) {
      throw new CaptureApiError(messageFrom(cause, '对象存储连接失败。'));
    }
    if (!response.ok) throw responseError(response.status, '图片分片上传失败。');
    const etag = response.headers.get('etag');
    if (!etag) throw new CaptureApiError('对象存储没有返回 ETag。');
    return { etag };
  }

  async request(path, { method = 'GET', body } = {}) {
    let response;
    try {
      response = await this.fetchImpl(`${this.serverUrl}/api/eagle/browser-captures${path}`, {
        method,
        headers: {
          authorization: `Bearer ${this.pat}`,
          ...(body === undefined ? {} : { 'content-type': 'application/json' }),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
    } catch (cause) {
      throw new CaptureApiError(messageFrom(cause, 'SekerEagle 连接失败。'));
    }
    const payload = await readPayload(response);
    if (!response.ok) {
      throw responseError(response.status, payload?.message || 'SekerEagle 请求失败。');
    }
    return payload;
  }
}

async function readPayload(response) {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    throw new CaptureApiError('SekerEagle 返回了无法解析的响应。');
  }
}

function responseError(status, message) {
  let kind = 'TRANSIENT';
  if (status === 401 || status === 403) kind = 'AUTH';
  else if (status >= 400 && status < 500 && status !== 408 && status !== 409 && status !== 429)
    kind = 'PERMANENT';
  return new CaptureApiError(Array.isArray(message) ? message.join('；') : String(message), {
    status,
    kind,
  });
}

function messageFrom(cause, fallback) {
  return cause instanceof Error && cause.message ? cause.message : fallback;
}
