import type { MessageId } from '../i18n';
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
interface DesktopLibraryReader {
  canReadLibrary?(path: string): boolean;
  readLibrary?(path: string, requestId: string): Promise<{ status: number; body: string; contentType: string }>;
  cancelLibraryRead?(requestId: string): void;
  resetMediaSnapshot?(): Promise<void>;
}
const libraryReader = () => (globalThis as { sekerDesktop?: DesktopLibraryReader }).sekerDesktop;
async function fetchSessionResource(path: string, init: RequestInit): Promise<Response> {
  const desktop = libraryReader();
  if ((init.method ?? 'GET').toUpperCase() !== 'GET' || !desktop?.canReadLibrary?.(path) || !desktop.readLibrary)
    return fetch(path, init);
  const requestId = crypto.randomUUID();
  const signal = init.signal;
  signal?.throwIfAborted();
  let abort!: () => void;
  const cancelled = new Promise<never>((_resolve, reject) => {
    abort = () => { desktop.cancelLibraryRead?.(requestId); reject(signal?.reason ?? new DOMException('Aborted', 'AbortError')); };
    signal?.addEventListener('abort', abort, { once: true });
  });
  try {
    const result = await Promise.race([desktop.readLibrary(path, requestId), cancelled]);
    signal?.throwIfAborted();
    return new Response(result.status === 204 || result.status === 304 ? null : result.body, {
      status: result.status, headers: { 'content-type': result.contentType },
    });
  } finally { signal?.removeEventListener('abort', abort); }
}

export async function fetchWithBrowserSession(
  path: string,
  init?: RequestInit,
  timeoutMs = 30_000,
): Promise<Response> {
  init?.signal?.throwIfAborted();
  if ((init?.method ?? 'GET').toUpperCase() !== 'GET') await libraryReader()?.resetMediaSnapshot?.();
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
  const response = await fetchSessionResource(path, requestInit);
  if (epoch !== authEpoch) sessionEnded();
  if (response.status !== 401 || loggingOut || NON_REFRESHABLE_PATHS.has(path)) return response;
  await refreshBrowserSession();
  if (epoch !== authEpoch || loggingOut) sessionEnded();
  const retry = await fetchSessionResource(path, requestInit);
  if (epoch !== authEpoch || loggingOut) sessionEnded();
  return retry;
}
export async function request<T>(
  path: string,
  init?: RequestInit,
  timeoutMs?: number,
  fallback?: MessageId,
): Promise<T> {
  const response = await fetchWithBrowserSession(
    path,
    {
      ...init,
      headers: init?.body ? { 'content-type': 'application/json', ...init.headers } : init?.headers,
    },
    timeoutMs,
  );
  if (!response.ok) {
    throw await (fallback
      ? errorFromResponse(response, fallback)
      : errorFromResponse(response, '请求失败（{{value1}}）'));
  }
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}
