import '@testing-library/jest-dom/vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DesktopConnectionButton } from './DesktopConnectionButton';
import type { DesktopConnectionStatus } from '../../lib/media-resolver';

const PUBLIC_STATUS: DesktopConnectionStatus = {
  mode: 'AUTO',
  activeSlot: 'PUBLIC',
  activeUrl: 'https://example.invalid',
  latencyMs: 20,
};
const DISCONNECTED_STATUS: DesktopConnectionStatus = {
  mode: 'AUTO',
  activeSlot: null,
  activeUrl: null,
  latencyMs: null,
};

describe('DesktopConnectionButton', () => {
  afterEach(() => {
    delete (globalThis as { sekerDesktop?: unknown }).sekerDesktop;
  });

  it('stays absent in a browser and exposes the active desktop connection in Electron', async () => {
    const openConnectionManager = vi.fn().mockResolvedValue(undefined);
    const reloadPage = vi.fn();
    const { rerender } = render(
      <DesktopConnectionButton pageConnection="online" reloadPage={reloadPage} />,
    );
    expect(screen.queryByRole('button', { name: /桌面连接/u })).not.toBeInTheDocument();

    installBridge({
      getConnectionStatus: vi.fn().mockResolvedValue({
        mode: 'AUTO',
        activeSlot: 'LOCAL',
        activeUrl: 'http://localhost:8180',
        latencyMs: 12,
      }),
      openConnectionManager,
    });
    rerender(<DesktopConnectionButton pageConnection="online" reloadPage={reloadPage} />);

    const refreshButton = await screen.findByRole('button', { name: '刷新当前页面 · 本地' });
    expect(refreshButton).toHaveTextContent('本地');
    expect(refreshButton).not.toHaveTextContent('12ms');
    fireEvent.click(refreshButton);
    expect(reloadPage).toHaveBeenCalledOnce();

    fireEvent.click(screen.getByRole('button', { name: '管理桌面连接' }));
    await waitFor(() => expect(openConnectionManager).toHaveBeenCalledOnce());
  });

  it('shows a checking state instead of claiming the client is disconnected', async () => {
    let resolveStatus: (status: DesktopConnectionStatus) => void = () => undefined;
    const pending = new Promise<DesktopConnectionStatus>((resolve) => {
      resolveStatus = resolve;
    });
    installBridge({ getConnectionStatus: vi.fn(() => pending) });

    render(<DesktopConnectionButton pageConnection="checking" />);

    expect(screen.getByRole('button', { name: '刷新当前页面 · 正在检测连接…' })).toHaveTextContent(
      '正在检测连接…',
    );

    await act(async () => {
      resolveStatus(PUBLIC_STATUS);
      await pending;
    });
    expect(await screen.findByRole('button', { name: '刷新当前页面 · 外网' })).toHaveTextContent(
      '外网',
    );
  });

  it('shows the usable page connection and refreshes it when the window regains focus', async () => {
    const getConnectionStatus = vi
      .fn()
      .mockResolvedValueOnce(DISCONNECTED_STATUS)
      .mockResolvedValue(PUBLIC_STATUS);
    installBridge({ getConnectionStatus });

    render(<DesktopConnectionButton pageConnection="online" />);
    expect(await screen.findByRole('button', { name: '刷新当前页面 · 已连接' })).toHaveTextContent(
      '已连接',
    );

    fireEvent(window, new Event('focus'));

    await waitFor(() =>
      expect(screen.getByRole('button', { name: '刷新当前页面 · 外网' })).toHaveTextContent('外网'),
    );
    expect(getConnectionStatus).toHaveBeenCalledTimes(2);
  });

  it('reports disconnected only when the page itself is offline', async () => {
    installBridge({ getConnectionStatus: vi.fn().mockResolvedValue(DISCONNECTED_STATUS) });

    render(<DesktopConnectionButton pageConnection="offline" />);

    expect(await screen.findByRole('button', { name: '刷新当前页面 · 未连接' })).toHaveTextContent(
      '未连接',
    );
  });

  it('reports the page connection instead of disconnected when the desktop status is unavailable', async () => {
    installBridge({ getConnectionStatus: vi.fn().mockRejectedValue(new Error('denied')) });

    render(<DesktopConnectionButton pageConnection="online" />);

    expect(await screen.findByRole('button', { name: '刷新当前页面 · 已连接' })).toHaveTextContent(
      '已连接',
    );
  });

  it('reports an unknown status instead of disconnected while the page is still checking', async () => {
    installBridge({ getConnectionStatus: vi.fn().mockRejectedValue(new Error('denied')) });

    render(<DesktopConnectionButton pageConnection="checking" />);

    expect(
      await screen.findByRole('button', { name: '刷新当前页面 · 连接状态未知' }),
    ).toHaveTextContent('连接状态未知');
  });
});

it('displays the full installed desktop version independently of the web version', async () => {
  installBridge({
    getAppInfo: vi.fn().mockResolvedValue({ version: '0.1.8', platform: 'win32' }),
    getConnectionStatus: vi.fn().mockResolvedValue(PUBLIC_STATUS),
  });
  const view = render(<DesktopConnectionButton pageConnection="online" />);
  expect(await screen.findByText('客户端 0.1.8')).toBeInTheDocument();
  view.unmount();
  delete (globalThis as { sekerDesktop?: unknown }).sekerDesktop;
});

function installBridge(
  overrides: {
    getAppInfo?: () => Promise<{ version: string; platform: string }>;
    getConnectionStatus?: () => Promise<DesktopConnectionStatus>;
    openConnectionManager?: (locale?: 'zh-CN' | 'en-US') => Promise<void>;
  } = {},
) {
  (globalThis as { sekerDesktop?: unknown }).sekerDesktop = {
    version: 1,
    createMediaUrl: vi.fn(),
    getConnectionStatus: overrides.getConnectionStatus ?? vi.fn().mockResolvedValue(PUBLIC_STATUS),
    openConnectionManager: overrides.openConnectionManager ?? vi.fn().mockResolvedValue(undefined),
    ...(overrides.getAppInfo ? { getAppInfo: overrides.getAppInfo } : {}),
  };
}
