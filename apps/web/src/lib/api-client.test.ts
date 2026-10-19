import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchEagleProcessingSummary } from './eagle-processing-admin-api';
import { request } from './api-client';
import { listEagleAssets } from './eagle-api';

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('browser session recovery', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    delete (globalThis as { sekerDesktop?: unknown }).sekerDesktop;
  });

  it('uses the desktop session coordinator when the access cookie expires', async () => {
    const refreshSession = vi.fn().mockResolvedValue({ status: 200, code: null });
    (globalThis as { sekerDesktop?: unknown }).sekerDesktop = { refreshSession };
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(jsonResponse({ message: 'expired' }, 401))
      .mockResolvedValueOnce(jsonResponse({ user: { id: 'owner-1' } }));

    await expect(request('/api/auth/me')).resolves.toEqual({ user: { id: 'owner-1' } });
    expect(refreshSession).toHaveBeenCalledOnce();
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual(['/api/auth/me', '/api/auth/me']);
  });

  it('preserves an origin rejection returned by desktop refresh', async () => {
    (globalThis as { sekerDesktop?: unknown }).sekerDesktop = {
      refreshSession: vi.fn().mockResolvedValue({ status: 403, code: 'ORIGIN_REJECTED' }),
    };
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(jsonResponse({ message: 'expired' }, 401));

    await expect(request('/api/auth/me')).rejects.toMatchObject({
      status: 403,
      code: 'ORIGIN_REJECTED',
    });
  });

  it('refreshes an expired access cookie and retries the original request once', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(jsonResponse({ message: '访问令牌无效或已过期。' }, 401))
      .mockResolvedValueOnce(jsonResponse({ user: { id: 'owner-1' } }))
      .mockResolvedValueOnce(jsonResponse({ user: { id: 'owner-1' } }));

    await expect(request('/api/auth/me')).resolves.toEqual({ user: { id: 'owner-1' } });
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      '/api/auth/me',
      '/api/auth/refresh',
      '/api/auth/me',
    ]);
  });

  it('shares one rotating refresh request between concurrent expired requests', async () => {
    let releaseRefresh!: () => void;
    const refreshPending = new Promise<void>((resolve) => {
      releaseRefresh = resolve;
    });
    let protectedCalls = 0;
    let refreshCalls = 0;
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
      if (url === '/api/auth/refresh') {
        refreshCalls += 1;
        await refreshPending;
        return jsonResponse({ user: { id: 'owner-1' } });
      }
      protectedCalls += 1;
      return protectedCalls <= 2
        ? jsonResponse({ message: '访问令牌无效或已过期。' }, 401)
        : jsonResponse({ ok: true });
    });

    const first = request('/api/eagle/assets');
    const second = request('/api/eagle/tags');
    await vi.waitFor(() => expect(refreshCalls).toBe(1));
    releaseRefresh();

    await expect(Promise.all([first, second])).resolves.toEqual([{ ok: true }, { ok: true }]);
    expect(refreshCalls).toBe(1);
  });

  it('does not refresh a rejected login or loop after a failed refresh', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(jsonResponse({ message: '邮箱或密码错误。' }, 401))
      .mockResolvedValueOnce(jsonResponse({ message: '访问令牌无效或已过期。' }, 401))
      .mockResolvedValueOnce(jsonResponse({ message: '缺少刷新令牌。' }, 401));

    await expect(
      request('/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({ email: 'owner@example.com', password: 'wrong-password' }),
      }),
    ).rejects.toThrow('邮箱或密码错误。');
    await expect(request('/api/auth/me')).rejects.toThrow('缺少刷新令牌。');
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      '/api/auth/login',
      '/api/auth/me',
      '/api/auth/refresh',
    ]);
  });

  it('applies the same recovery path to library and processing API clients', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(jsonResponse({ message: '访问令牌无效或已过期。' }, 401))
      .mockResolvedValueOnce(jsonResponse({ user: { id: 'owner-1' } }))
      .mockResolvedValueOnce(jsonResponse({ items: [], nextCursor: null, colorCoverage: null }))
      .mockResolvedValueOnce(jsonResponse({ message: '访问令牌无效或已过期。' }, 401))
      .mockResolvedValueOnce(jsonResponse({ user: { id: 'owner-1' } }))
      .mockResolvedValueOnce(jsonResponse({ refreshedAt: '2026-08-17T00:00:00.000Z' }));

    await expect(listEagleAssets('', { limit: 1 })).resolves.toMatchObject({ items: [] });
    await expect(fetchEagleProcessingSummary('')).resolves.toMatchObject({
      refreshedAt: '2026-08-17T00:00:00.000Z',
    });
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      '/api/eagle/assets?limit=1',
      '/api/auth/refresh',
      '/api/eagle/assets?limit=1',
      '/api/admin/eagle-processing/summary',
      '/api/auth/refresh',
      '/api/admin/eagle-processing/summary',
    ]);
  });
});

it('logout waits for an in-flight refresh and fences its protected retry', async () => {
  let release!: () => void;
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  const calls: string[] = [];
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
    const path =
      typeof input === 'string' ? input : input instanceof URL ? input.pathname : input.url;
    calls.push(path);
    if (path === '/api/auth/refresh') {
      await pending;
      return jsonResponse({});
    }
    if (path === '/api/auth/logout') return jsonResponse({});
    return jsonResponse({}, 401);
  });
  const protectedResult = request('/api/eagle/assets').catch((error) => error);
  await vi.waitFor(() => expect(calls).toContain('/api/auth/refresh'));
  const logout = request('/api/auth/logout', { method: 'POST', body: '{}' });
  expect(calls).not.toContain('/api/auth/logout');
  release();
  await logout;
  expect(await protectedResult).toMatchObject({ name: 'AbortError' });
  expect(calls).toEqual(['/api/eagle/assets', '/api/auth/refresh', '/api/auth/logout']);
});
