import '@testing-library/jest-dom/vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DesktopConnectionButton } from './DesktopConnectionButton';

describe('DesktopConnectionButton', () => {
  afterEach(() => {
    delete (globalThis as { sekerDesktop?: unknown }).sekerDesktop;
  });

  it('stays absent in a browser and exposes the active desktop connection in Electron', async () => {
    const openConnectionManager = vi.fn().mockResolvedValue(undefined);
    const reloadPage = vi.fn();
    const { rerender } = render(<DesktopConnectionButton reloadPage={reloadPage} />);
    expect(screen.queryByRole('button', { name: /桌面连接/u })).not.toBeInTheDocument();

    (globalThis as { sekerDesktop?: unknown }).sekerDesktop = {
      version: 1,
      createMediaUrl: vi.fn(),
      getConnectionStatus: vi.fn().mockResolvedValue({
        mode: 'AUTO',
        activeSlot: 'LOCAL',
        activeUrl: 'http://localhost:8180',
        latencyMs: 12,
      }),
      openConnectionManager,
    };
    rerender(<DesktopConnectionButton reloadPage={reloadPage} />);

    const refreshButton = await screen.findByRole('button', { name: '刷新当前页面，本地连接' });
    expect(refreshButton).toHaveTextContent('本地');
    expect(refreshButton).not.toHaveTextContent('12ms');
    fireEvent.click(refreshButton);
    expect(reloadPage).toHaveBeenCalledOnce();

    fireEvent.click(screen.getByRole('button', { name: '管理桌面连接' }));
    await waitFor(() => expect(openConnectionManager).toHaveBeenCalledOnce());
  });
});
