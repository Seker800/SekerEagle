import { errorFromResponse } from './api-error';
const REFRESH_PATH = '/api/auth/refresh';
const NON_REFRESHABLE_PATHS = new Set(['/api/auth/login', REFRESH_PATH]);
let refreshInFlight: Promise<void> | undefined;
let authEpoch = 0;
let sessionController = new AbortController();
export const getBrowserSessionSignal = () => sessionController.signal;
function advanceSession() {
  authEpoch++;
  sessionController.abort();
  sessionController = new AbortController();
}
let loggingOut = false;
function sessionEnded(): never {
  throw new DOMException('Session ended', 'AbortError');
}
async function refreshBrowserSession(): Promise<void> {
  const desktop = (
    globalThis as {
      sekerDesktop?: { refreshSession?: () => Promise<{ status: number; code: string | null }> };
    }
  ).sekerDesktop;
  refreshInFlight ??= (
    desktop?.refreshSession
      ? desktop.refreshSession().then(
          ({ status, code }) =>
            new Response(status === 204 ? null : JSON.stringify({ code }), {
              status,
              headers: { 'content-type': 'application/json' },
            }),
        )
      : fetch(REFRESH_PATH, {
          method: 'POST',
          credentials: 'include',
          signal: AbortSignal.timeout(30_000),
        })
  )
    .then(async (response) => {
      if (!response.ok) throw await errorFromResponse(response, '刷新登录状态失败（{{value1}}）');
    })
    .finally(() => {
      refreshInFlight = undefined;
    });
  return refreshInFlight;
}
export async function fetchWithBrowserSession(
  path: string,
  init?: RequestInit,
  timeoutMs = 30_000,
): Promise<Response> {
  if (path === '/api/auth/login') {
    advanceSession();
    loggingOut = false;
  }
  if (path === '/api/auth/logout') {
    advanceSession();
    loggingOut = true;
    await refreshInFlight?.catch(() => undefined);
    return fetch(path, { ...init, credentials: 'include', signal: AbortSignal.timeout(30_000) });
  }
  init?.signal?.throwIfAborted();
  const epoch = authEpoch;
  const requestInit: RequestInit = {
    ...init,
    credentials: 'include',
    signal: init?.signal
      ? AbortSignal.any([init.signal, AbortSignal.timeout(timeoutMs)])
      : AbortSignal.timeout(timeoutMs),
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
export async function request<T>(path: string, init?: RequestInit, timeoutMs?: number): Promise<T> {
  const response = await fetchWithBrowserSession(
    path,
    {
      ...init,
      headers: init?.body ? { 'content-type': 'application/json', ...init.headers } : init?.headers,
    },
    timeoutMs,
  );
  if (!response.ok) {
    throw await errorFromResponse(response, '请求失败（{{value1}}）');
  }
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}
