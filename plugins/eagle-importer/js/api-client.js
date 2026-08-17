'use strict';

const { delay, normalizeApiBase } = require('./utils');

class ApiError extends Error {
  constructor(status, message, payload) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.payload = payload;
  }
}

class ApiClient {
  constructor({
    baseUrl,
    accessToken = '',
    refreshToken = '',
    onTokens,
    minimumImportIntervalMs = 550,
    now = () => Date.now(),
    sleep = delay,
    fetchImpl = (...args) => fetch(...args),
  }) {
    this.baseUrl = normalizeApiBase(baseUrl);
    this.accessToken = accessToken;
    this.refreshToken = refreshToken;
    this.onTokens = onTokens;
    this.sleep = sleep;
    this.fetchImpl = fetchImpl;
    this.refreshPromise = null;
    this.uploadContexts = new Map();
    this.importPacer = new RequestPacer({ minimumIntervalMs: minimumImportIntervalMs, now, sleep });
  }

  async login(email, password) {
    const session = await this.request('/auth/token/login', {
      method: 'POST',
      body: { email, password },
      anonymous: true,
    });
    await this.setTokens(session);
    return session;
  }

  async setTokens(session) {
    this.accessToken = session.accessToken || '';
    this.refreshToken = session.refreshToken || this.refreshToken;
    if (this.onTokens)
      await this.onTokens({ accessToken: this.accessToken, refreshToken: this.refreshToken });
  }

  async refresh() {
    if (this.refreshPromise) return this.refreshPromise;
    this.refreshPromise = this.performRefresh().finally(() => {
      this.refreshPromise = null;
    });
    return this.refreshPromise;
  }

  async performRefresh() {
    if (!this.refreshToken) throw new ApiError(401, '登录已失效，请重新登录。', null);
    const session = await this.request('/auth/token/refresh', {
      method: 'POST',
      body: { refreshToken: this.refreshToken },
      anonymous: true,
      allowRefresh: false,
    });
    await this.setTokens(session);
  }

  async request(pathname, options = {}) {
    const {
      method = 'GET',
      body,
      rawBody,
      anonymous = false,
      allowRefresh = true,
      retries = 0,
    } = options;
    const headers = { Accept: 'application/json' };
    const requestAccessToken = this.accessToken;
    if (!anonymous && requestAccessToken) headers.Authorization = `Bearer ${requestAccessToken}`;
    let requestBody;
    if (rawBody !== undefined) {
      headers['Content-Type'] = 'application/octet-stream';
      requestBody = rawBody;
    } else if (body !== undefined) {
      headers['Content-Type'] = 'application/json';
      requestBody = JSON.stringify(body);
    }

    if (pathname.startsWith('/eagle/imports')) await this.importPacer.wait();
    let response;
    try {
      response = await this.fetchImpl(`${this.baseUrl}${pathname}`, {
        method,
        headers,
        body: requestBody,
      });
    } catch (error) {
      if (retries > 0) {
        await this.sleep(1200);
        return this.request(pathname, { ...options, retries: retries - 1 });
      }
      throw new Error(`无法连接服务器：${error.message}`);
    }

    if (response.status === 401 && !anonymous && allowRefresh && this.refreshToken) {
      if (!requestAccessToken || requestAccessToken === this.accessToken) await this.refresh();
      return this.request(pathname, { ...options, allowRefresh: false });
    }
    if ((response.status === 429 || response.status >= 500) && retries > 0) {
      await this.sleep(response.status === 429 ? retryAfterMilliseconds(response) : 1500);
      return this.request(pathname, { ...options, retries: retries - 1 });
    }

    const text = await response.text();
    let payload = null;
    if (text) {
      try {
        payload = JSON.parse(text);
      } catch {
        payload = text;
      }
    }
    if (!response.ok) {
      const message =
        payload?.message || payload?.error?.message || `请求失败（HTTP ${response.status}）`;
      throw new ApiError(
        response.status,
        Array.isArray(message) ? message.join('；') : String(message),
        payload,
      );
    }
    return payload;
  }

  listLibraries() {
    return this.request('/eagle/imports/libraries');
  }
  createRun(body) {
    return this.request('/eagle/imports', { method: 'POST', body, retries: 2 });
  }
  stageChunk(runId, body) {
    return this.request(`/eagle/imports/${runId}/manifest/chunks`, {
      method: 'POST',
      body,
      retries: 2,
    });
  }
  preflight(runId) {
    return this.request(`/eagle/imports/${runId}/preflight`, { method: 'POST', retries: 1 });
  }
  getRun(runId) {
    return this.request(`/eagle/imports/${runId}`);
  }
  cancelRun(runId) {
    return this.request(`/eagle/imports/${runId}/cancel`, { method: 'POST' });
  }
  retryItem(runId, itemId) {
    return this.request(`/eagle/imports/${runId}/items/${itemId}/retry`, { method: 'POST' });
  }
  async initiateUpload(runId, itemId, body) {
    const session = await this.request(`/eagle/imports/${runId}/items/${itemId}/upload`, {
      method: 'POST',
      body,
      retries: 2,
    });
    if (session?.id) this.uploadContexts.set(session.id, { runId, itemId });
    return session;
  }
  getUploadedParts(sessionId) {
    return this.request(`/eagle/uploads/${sessionId}/parts`, { retries: 2 });
  }
  async uploadPart(sessionId, partNumber, bytes) {
    const signed = await this.request(`/eagle/uploads/${sessionId}/parts/${partNumber}`, {
      method: 'POST',
      body: {},
      retries: 3,
    });
    const response = await this.fetchImpl(signed.uploadUrl, { method: 'PUT', body: bytes });
    const etag = response.headers?.get?.('etag');
    if (!response.ok || !etag)
      throw new ApiError(response.status, `上传分片 ${partNumber} 失败。`, null);
    return { partNumber, etag, size: bytes.length };
  }
  async completeUpload(sessionId, parts) {
    const completed = await this.request(`/eagle/uploads/${sessionId}/complete`, {
      method: 'POST',
      body: { parts },
      retries: 2,
    });
    const context = this.uploadContexts.get(sessionId);
    if (context && completed?.assetId) {
      await this.request(`/eagle/imports/${context.runId}/items/${context.itemId}/finish`, {
        method: 'POST',
        body: { assetId: completed.assetId },
        retries: 2,
      });
      this.uploadContexts.delete(sessionId);
    }
    return completed;
  }

  async listAllItems(runId, status) {
    const items = [];
    for await (const item of this.iterateItems(runId, status)) items.push(item);
    return items;
  }

  async *iterateItems(runId, status) {
    let cursor = '';
    do {
      const query = new URLSearchParams({ limit: '100' });
      if (status) query.set('status', status);
      if (cursor) query.set('cursor', cursor);
      const page = await this.request(`/eagle/imports/${runId}/items?${query}`);
      for (const item of page.items) yield item;
      cursor = page.nextCursor || '';
    } while (cursor);
  }
}

class RequestPacer {
  constructor({ minimumIntervalMs, now, sleep }) {
    this.minimumIntervalMs = Math.max(0, Number(minimumIntervalMs) || 0);
    this.now = now;
    this.sleep = sleep;
    this.nextRequestAt = 0;
    this.tail = Promise.resolve();
  }

  wait() {
    const operation = this.tail.then(async () => {
      const waitMs = Math.max(0, this.nextRequestAt - this.now());
      if (waitMs > 0) await this.sleep(waitMs);
      this.nextRequestAt = this.now() + this.minimumIntervalMs;
    });
    this.tail = operation.catch(() => undefined);
    return operation;
  }
}

function retryAfterMilliseconds(response) {
  const raw = response.headers?.get?.('retry-after');
  const seconds = Number(raw);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.max(1_000, Math.ceil(seconds * 1_000));
  if (raw) {
    const date = Date.parse(raw);
    if (Number.isFinite(date)) return Math.max(1_000, date - Date.now());
  }
  return 60_000;
}

module.exports = { ApiClient, ApiError, RequestPacer, retryAfterMilliseconds };
