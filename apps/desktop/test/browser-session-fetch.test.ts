import { describe, expect, it, vi } from 'vitest';
import { DesktopBrowserSession } from '../src/main/browser-session';

describe('DesktopBrowserSession', () => {
  it('refreshes an expired browser session once and retries the protected request', async () => {
    const fetcher = vi
      .fn<(url: string, init?: RequestInit) => Promise<Response>>()
      .mockResolvedValueOnce(new Response(null, { status: 401 }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
      .mockResolvedValueOnce(Response.json({ user: { id: 'owner-a' } }));
    const session = new DesktopBrowserSession(fetcher, () => 'http://localhost:8180');

    const response = await session.fetch('/api/auth/me', { headers: { 'cache-control': 'no-store' } });

    expect(response.status).toBe(200);
    expect(fetcher).toHaveBeenNthCalledWith(
      1,
      'http://localhost:8180/api/auth/me',
      expect.objectContaining({ credentials: 'include' }),
    );
    expect(fetcher).toHaveBeenNthCalledWith(
      2,
      'http://localhost:8180/api/auth/refresh',
      expect.objectContaining({ method: 'POST', credentials: 'include' }),
    );
    expect(fetcher).toHaveBeenNthCalledWith(
      3,
      'http://localhost:8180/api/auth/me',
      expect.objectContaining({ credentials: 'include' }),
    );
  });

  it('single-flights session refresh for concurrent media requests', async () => {
    let releaseRefresh!: () => void;
    const refreshGate = new Promise<void>((resolve) => {
      releaseRefresh = resolve;
    });
    let protectedCalls = 0;
    const fetcher = vi.fn(async (url: string) => {
      if (url.endsWith('/api/auth/refresh')) {
        await refreshGate;
        return new Response(null, { status: 204 });
      }
      protectedCalls += 1;
      return new Response(null, { status: protectedCalls <= 2 ? 401 : 200 });
    });
    const session = new DesktopBrowserSession(fetcher, () => 'http://localhost:8180');

    const requests = Promise.all([
      session.fetch('/api/eagle/assets/a/renditions/b'),
      session.fetch('/api/eagle/assets/c/renditions/d'),
    ]);
    await vi.waitFor(() =>
      expect(fetcher.mock.calls.filter(([url]) => url.endsWith('/api/auth/refresh'))).toHaveLength(1),
    );
    releaseRefresh();

    await expect(requests.then((responses) => responses.map(({ status }) => status))).resolves.toEqual([
      200, 200,
    ]);
  });
});
