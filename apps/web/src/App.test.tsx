import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { App } from './App';
import { ApiError } from './lib/api-error';

const requestMock = vi.hoisted(() => vi.fn());
vi.mock('./lib/api-client', () => ({ request: requestMock }));
vi.mock('./components/eagle/SekerEaglePage', () => ({
  SekerEaglePage: () => <div>素材图库</div>,
}));
vi.mock('./components/desktop/DesktopConnectionButton', () => ({
  DesktopConnectionButton: () => <div>连接设置入口</div>,
}));

function userResponse() {
  return { user: { id: 'owner-1', email: 'owner@example.com', role: 'USER' } };
}

describe('startup session recovery', () => {
  afterEach(() => requestMock.mockReset());

  it('shows connection recovery instead of login after a network failure, then resumes automatically', async () => {
    requestMock.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    requestMock.mockResolvedValueOnce(userResponse());
    requestMock.mockResolvedValue({ enabled: false, expiresAt: null });

    render(<App />);
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
      render(<App />);
      expect(await screen.findByRole('heading', { name: '登录素材库' })).toBeVisible();
      expect(screen.queryByRole('heading', { name: '无法连接素材库' })).not.toBeInTheDocument();
    },
  );

  it('keeps connection recovery visible for an untrusted origin', async () => {
    requestMock.mockRejectedValueOnce(new ApiError('来源不受信任', 403, 'ORIGIN_REJECTED'));
    render(<App />);
    expect(await screen.findByRole('heading', { name: '无法连接素材库' })).toBeVisible();
  });

  it('keeps the account through a running-app disconnection', async () => {
    requestMock.mockResolvedValueOnce(userResponse());
    requestMock.mockResolvedValueOnce({ enabled: false, expiresAt: null });
    requestMock.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    requestMock.mockResolvedValueOnce(userResponse());
    requestMock.mockResolvedValue({ enabled: false, expiresAt: null });

    render(<App />);
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
