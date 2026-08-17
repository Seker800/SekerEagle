const REFRESH_PATH = '/api/auth/refresh';
const NON_REFRESHABLE_PATHS = new Set(['/api/auth/login', REFRESH_PATH]);

let refreshInFlight: Promise<void> | undefined;

async function errorFrom(response: Response, fallback: string): Promise<Error> {
  const body = (await response.json().catch(() => null)) as {
    message?: string | string[];
  } | null;
  const message = Array.isArray(body?.message) ? body.message.join('；') : body?.message;
  return new Error(message ?? fallback);
}

async function refreshBrowserSession(): Promise<void> {
  refreshInFlight ??= fetch(REFRESH_PATH, {
    method: 'POST',
    credentials: 'include',
  })
    .then(async (response) => {
      if (!response.ok) throw await errorFrom(response, `刷新登录状态失败（${response.status}）`);
    })
    .finally(() => {
      refreshInFlight = undefined;
    });
  return refreshInFlight;
}

export async function fetchWithBrowserSession(path: string, init?: RequestInit): Promise<Response> {
  const requestInit: RequestInit = { ...init, credentials: 'include' };
  const response = await fetch(path, requestInit);
  if (response.status !== 401 || NON_REFRESHABLE_PATHS.has(path)) return response;

  await refreshBrowserSession();
  return fetch(path, requestInit);
}

export async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetchWithBrowserSession(path, {
    ...init,
    headers: init?.body ? { 'content-type': 'application/json', ...init.headers } : init?.headers,
  });
  if (!response.ok) {
    throw await errorFrom(response, `请求失败（${response.status}）`);
  }
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}
