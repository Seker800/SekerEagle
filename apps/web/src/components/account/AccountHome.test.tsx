import '@testing-library/jest-dom/vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AccountHome } from './AccountHome';

const user = { id: 'owner-1', email: 'owner@example.com', role: 'USER' as const };

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

describe('AccountHome', () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    vi.stubGlobal(
      'confirm',
      vi.fn(() => true),
    );
    delete (globalThis as { sekerDesktop?: unknown }).sekerDesktop;
  });

  it('toggles private visibility directly with a default three-hour duration and no dialog', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path =
        typeof input === 'string' ? input : input instanceof URL ? input.pathname : input.url;
      if (path === '/api/auth/privacy-visibility' && !init?.method) {
        return jsonResponse({ enabled: false, durationHours: 3, expiresAt: null });
      }
      if (path === '/api/tokens' && !init?.method) return jsonResponse([]);
      if (path === '/api/auth/privacy-visibility' && init?.method === 'PUT') {
        expect(typeof init.body).toBe('string');
        expect(JSON.parse(init.body as string)).toEqual({ enabled: true, durationHours: 3 });
        return jsonResponse({
          enabled: true,
          durationHours: 3,
          expiresAt: '2026-08-19T15:00:00.000Z',
        });
      }
      throw new Error(`Unexpected request: ${path}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<AccountHome user={user} onPasswordChanged={vi.fn()} onLogout={vi.fn()} />);

    const toggle = await screen.findByRole('switch', { name: '显示隐私内容' });
    expect(toggle).not.toBeChecked();
    expect(screen.getByLabelText('自动关闭时间')).toHaveValue('3');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

    fireEvent.click(toggle);

    await waitFor(() => expect(toggle).toBeChecked());
    expect(screen.getByText(/将于/)).toBeInTheDocument();
  });

  it('loads, creates and revokes external connection tokens', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path =
        typeof input === 'string' ? input : input instanceof URL ? input.pathname : input.url;
      if (path === '/api/auth/privacy-visibility' && !init?.method) {
        return jsonResponse({ enabled: false, durationHours: 3, expiresAt: null });
      }
      if (path === '/api/tokens' && !init?.method) {
        return jsonResponse([
          {
            id: 'token-1',
            name: '工作室 Mac',
            scopes: ['import:read', 'import:write', 'asset:write'],
            createdAt: '2026-08-01T00:00:00.000Z',
            expiresAt: null,
            revokedAt: null,
            lastUsedAt: null,
          },
        ]);
      }
      if (path === '/api/tokens' && init?.method === 'POST') {
        if (typeof init.body !== 'string') throw new Error('expected a JSON request body');
        expect(JSON.parse(init.body)).toEqual({
          name: 'SekerEagle 浏览器插件',
          scopes: ['capture:write'],
        });
        return jsonResponse({
          id: 'token-2',
          name: 'SekerEagle 浏览器插件',
          scopes: ['capture:write'],
          createdAt: '2026-08-17T00:00:00.000Z',
          expiresAt: null,
          revokedAt: null,
          lastUsedAt: null,
          token: 'seg_pat_secret',
        });
      }
      if (path === '/api/tokens/token-1' && init?.method === 'DELETE') {
        return jsonResponse({ ok: true });
      }
      throw new Error(`Unexpected request: ${path}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<AccountHome user={user} onPasswordChanged={vi.fn()} onLogout={vi.fn()} />);

    expect(await screen.findByText('工作室 Mac')).toBeInTheDocument();
    expect(screen.getByText('永久有效')).toBeInTheDocument();
    expect(screen.queryByLabelText('有效期')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '创建令牌' }));
    const createdToken = await screen.findByRole('textbox', { name: '新创建的令牌' });
    expect(createdToken).toHaveValue('seg_pat_secret');
    expect(createdToken).toHaveAttribute('readonly');
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    expect(screen.getByText('SekerEagle 浏览器插件')).toBeInTheDocument();

    const selectSpy = vi.spyOn(HTMLInputElement.prototype, 'select');
    vi.stubGlobal('navigator', {
      clipboard: { writeText: vi.fn().mockRejectedValue(new Error('clipboard denied')) },
    });
    fireEvent.click(screen.getByRole('button', { name: '复制' }));
    expect(
      await screen.findByText('无法自动复制，已选中完整令牌，请手动复制。'),
    ).toBeInTheDocument();
    expect(selectSpy).toHaveBeenCalledOnce();

    fireEvent.click(screen.getByRole('button', { name: '撤销令牌 工作室 Mac' }));
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/tokens/token-1',
        expect.objectContaining({ method: 'DELETE' }),
      );
    });
    expect(screen.getByText('已撤销')).toBeInTheDocument();
  });

  it('validates password confirmation before sending a request', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const path =
        typeof input === 'string' ? input : input instanceof URL ? input.pathname : input.url;
      return path === '/api/auth/privacy-visibility'
        ? jsonResponse({ enabled: false, durationHours: 3, expiresAt: null })
        : jsonResponse([]);
    });
    vi.stubGlobal('fetch', fetchMock);
    render(<AccountHome user={user} onPasswordChanged={vi.fn()} onLogout={vi.fn()} />);

    fireEvent.change(screen.getByLabelText('当前密码'), { target: { value: 'current-password' } });
    fireEvent.change(screen.getByLabelText('新密码'), { target: { value: 'new-password-123' } });
    fireEvent.change(screen.getByLabelText('确认新密码'), { target: { value: 'different-pass' } });
    fireEvent.click(screen.getByRole('button', { name: '更新密码' }));

    expect(await screen.findByText('两次输入的新密码不一致。')).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('shows and manages the owner-scoped cache only inside the desktop client', async () => {
    const getCacheStatus = vi.fn().mockResolvedValue({
      limitBytes: 10 * 1024 ** 3,
      allocatedBytes: 2 * 1024 ** 3,
      logicalBytes: 1_500_000_000,
      entryCount: 12_345,
      hitCount: 80,
      missCount: 20,
      savedBytes: 5 * 1024 ** 3,
    });
    const setCacheLimitGiB = vi.fn().mockResolvedValue(undefined);
    const clearCache = vi.fn().mockResolvedValue({ deleted: 12_345, deferred: 0 });
    (globalThis as { sekerDesktop?: unknown }).sekerDesktop = {
      version: 1,
      createMediaUrl: vi.fn(),
      getCacheStatus,
      setCacheLimitGiB,
      clearCache,
      invalidateAsset: vi.fn(),
    };
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse([])));

    render(
      <AccountHome
        user={user}
        onPasswordChanged={vi.fn()}
        onLogout={vi.fn()}
        privacyVisibility={{ enabled: false, durationHours: 3, expiresAt: null }}
      />,
    );

    expect(await screen.findByRole('heading', { name: '本地媒体缓存' })).toBeInTheDocument();
    expect(screen.getByText('80%')).toBeInTheDocument();
    expect(screen.getByText('12,345 个文件')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('缓存容量上限'), { target: { value: '25' } });
    fireEvent.click(screen.getByRole('button', { name: '保存缓存设置' }));
    await waitFor(() => expect(setCacheLimitGiB).toHaveBeenCalledWith(25));

    fireEvent.click(screen.getByRole('button', { name: '清空本地缓存' }));
    await waitFor(() => expect(clearCache).toHaveBeenCalledOnce());
  });
});
