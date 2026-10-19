import { errorFromResponse } from './api-error';
const REFRESH_PATH = '/api/auth/refresh';
const NON_REFRESHABLE_PATHS = new Set(['/api/auth/login', REFRESH_PATH]);
let refreshInFlight: Promise<void> | undefined;
let authEpoch = 0;
let loggingOut = false;
function sessionEnded(): never {
  throw new DOMException('Session ended', 'AbortError');
}
async function refreshBrowserSession(): Promise<void> {
  refreshInFlight ??= fetch(REFRESH_PATH, {
    method: 'POST',
    credentials: 'include',
    signal: AbortSignal.timeout(30_000),
  })
    .then(async (response) => {
      if (!response.ok) throw await errorFromResponse(response, '刷新登录状态失败（{{value1}}）');
    })
    .finally(() => {
      refreshInFlight = undefined;
    });
  return refreshInFlight;
}
export async function fetchWithBrowserSession(path: string, init?: RequestInit): Promise<Response> {
  if (path === '/api/auth/login') {
    authEpoch++;
    loggingOut = false;
  }
  if (path === '/api/auth/logout') {
    authEpoch++;
    loggingOut = true;
    await refreshInFlight?.catch(() => undefined);
    return fetch(path, { ...init, credentials: 'include', signal: AbortSignal.timeout(30_000) });
  }
  const epoch = authEpoch;
  const requestInit: RequestInit = {
    ...init,
    credentials: 'include',
    signal: init?.signal
      ? AbortSignal.any([init.signal, AbortSignal.timeout(30_000)])
      : AbortSignal.timeout(30_000),
  };
  const response = await fetch(path, requestInit);
  if (epoch !== authEpoch) sessionEnded();
  if (response.status !== 401 || loggingOut || NON_REFRESHABLE_PATHS.has(path)) return response;
  await refreshBrowserSession();
  if (epoch !== authEpoch || loggingOut) sessionEnded();
  const retry = await fetch(path, requestInit);
  if (epoch !== authEpoch || loggingOut) sessionEnded();
  return retry;
}
export async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetchWithBrowserSession(path, {
    ...init,
    headers: init?.body ? { 'content-type': 'application/json', ...init.headers } : init?.headers,
  });
  if (!response.ok) {
    throw await errorFromResponse(response, '请求失败（{{value1}}）');
  }
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}
