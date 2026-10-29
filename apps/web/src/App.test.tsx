import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { App } from './App';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ApiError } from './lib/api-error';

const requestMock = vi.hoisted(() => vi.fn());
vi.mock('./lib/api-client', () => ({ request: requestMock }));
vi.mock('./components/eagle/SekerEaglePage', () => ({
  SekerEaglePage: ({
    accountView,
    modeSwitcher,
  }: {
    accountView: React.ReactNode;
    modeSwitcher: React.ReactNode;
  }) => (
    <div>
      素材图库{modeSwitcher}
      {accountView}
    </div>
  ),
}));
vi.mock('./components/account/AccountHome', () => ({
  AccountHome: ({ onLogout }: { onLogout: () => void }) => (
    <button onClick={onLogout}>退出账号</button>
  ),
}));
vi.mock('./components/desktop/DesktopConnectionButton', () => ({
  DesktopConnectionButton: () => <div>连接设置入口</div>,
}));

function userResponse() {
  return { user: { id: 'owner-1', email: 'owner@example.com', role: 'USER' } };
}

afterEach(() => requestMock.mockReset());

describe('startup session recovery', () => {
  it('shows connection recovery instead of login after a network failure, then resumes automatically', async () => {
    requestMock.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    requestMock.mockResolvedValueOnce(userResponse());
    requestMock.mockResolvedValue({ enabled: false, expiresAt: null });

    render(
      <QueryClientProvider
        client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
      >
        <App />
      </QueryClientProvider>,
    );
    expect(await screen.findByRole('heading', { name: '无法连接素材库' })).toBeVisible();
    expect(screen.queryByRole('heading', { name: '登录素材库' })).not.toBeInTheDocument();

    fireEvent(window, new Event('online'));
    expect(await screen.findByText('素材图库')).toBeVisible();
    expect(requestMock.mock.calls.filter(([path]) => path === '/api/auth/me')).toHaveLength(2);
  });

  it.each([401, 403])(
    'shows login after the server rejects the refresh session (%i)',
    async (status) => {
      requestMock.mockRejectedValueOnce(new ApiError('登录已过期', status, null));
      render(
        <QueryClientProvider
          client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
        >
          <App />
        </QueryClientProvider>,
      );
      expect(await screen.findByRole('heading', { name: '登录素材库' })).toBeVisible();
      expect(screen.queryByRole('heading', { name: '无法连接素材库' })).not.toBeInTheDocument();
    },
  );

  it('keeps connection recovery visible for an untrusted origin', async () => {
    requestMock.mockRejectedValueOnce(new ApiError('来源不受信任', 403, 'ORIGIN_REJECTED'));
    render(
      <QueryClientProvider
        client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
      >
        <App />
      </QueryClientProvider>,
    );
    expect(await screen.findByRole('heading', { name: '无法连接素材库' })).toBeVisible();
  });

  it('keeps the account through a running-app disconnection', async () => {
    requestMock.mockResolvedValueOnce(userResponse());
    requestMock.mockResolvedValueOnce({ enabled: false, expiresAt: null });
    requestMock.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    requestMock.mockResolvedValueOnce(userResponse());
    requestMock.mockResolvedValue({ enabled: false, expiresAt: null });

    render(
      <QueryClientProvider
        client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
      >
        <App />
      </QueryClientProvider>,
    );
    expect(await screen.findByText('素材图库')).toBeVisible();
    fireEvent(window, new Event('offline'));
    expect(await screen.findByRole('heading', { name: '无法连接素材库' })).toBeVisible();
    fireEvent(window, new Event('online'));
    await screen.findByRole('heading', { name: '无法连接素材库' });
    fireEvent.click(screen.getByRole('button', { name: '立即重试' }));
    expect(await screen.findByText('素材图库')).toBeVisible();
    expect(screen.queryByRole('heading', { name: '登录素材库' })).not.toBeInTheDocument();
  });
});

it.each(['late-success', 'aborted-request'])(
  'does not restore the session or show a network error after logout during a session check (%s)',
  async (outcome) => {
    let resolveCheck!: (value: unknown) => void;
    let rejectCheck!: (reason: unknown) => void;
    let checks = 0;
    requestMock.mockImplementation((path: string) => {
      if (path === '/api/auth/me') {
        if (checks++ === 0) return Promise.resolve(userResponse());
        return new Promise((resolve, reject) => {
          resolveCheck = resolve;
          rejectCheck = reject;
        });
      }
      return Promise.resolve({ enabled: false, expiresAt: null });
    });
    render(
      <QueryClientProvider client={new QueryClient()}>
        <App />
      </QueryClientProvider>,
    );
    await screen.findByText('素材图库');
    fireEvent(window, new Event('online'));
    fireEvent.click(screen.getByRole('button', { name: '退出账号' }));
    await screen.findByRole('heading', { name: '登录素材库' });
    await act(async () => {
      if (outcome === 'late-success') resolveCheck(userResponse());
      else rejectCheck(new DOMException('Session ended', 'AbortError'));
    });
    expect(screen.getByRole('heading', { name: '登录素材库' })).toBeVisible();
    expect(screen.queryByText('素材图库')).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: '无法连接素材库' })).not.toBeInTheDocument();
  },
);

it('removes both workspace caches when a running session expires', async () => {
  requestMock.mockResolvedValueOnce(userResponse());
  requestMock.mockResolvedValue({ enabled: false, expiresAt: null });
  const client = new QueryClient();
  render(
    <QueryClientProvider client={client}>
      <App />
    </QueryClientProvider>,
  );
  await screen.findByText('素材图库');
  client.setQueryData(['eagle', 'owner-1', 'MATERIAL', 'assets'], ['material']);
  client.setQueryData(['eagle', 'owner-1', 'PHOTO', 'assets'], ['photo']);
  requestMock.mockRejectedValueOnce(new ApiError('登录已过期', 401, null));
  fireEvent(window, new Event('online'));
  await screen.findByRole('heading', { name: '登录素材库' });
  expect(client.getQueryCache().findAll({ queryKey: ['eagle', 'owner-1'] })).toHaveLength(0);
});

it('checks the session when a visible window regains focus', async () => {
  requestMock.mockResolvedValueOnce(userResponse());
  requestMock.mockResolvedValue({ enabled: false, expiresAt: null });
  render(
    <QueryClientProvider client={new QueryClient()}>
      <App />
    </QueryClientProvider>,
  );
  await screen.findByText('素材图库');
  requestMock.mockResolvedValueOnce(userResponse());
  fireEvent(window, new Event('focus'));
  await screen.findByText('素材图库');
  expect(requestMock.mock.calls.filter(([path]) => path === '/api/auth/me')).toHaveLength(2);
});
