import { afterEach, describe, expect, it, vi } from 'vitest';
import { request } from './api-client';

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('browser session recovery', () => {
  afterEach(() => {
    vi.restoreAllMocks();
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
});
