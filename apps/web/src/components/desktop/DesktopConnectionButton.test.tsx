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
    const { rerender } = render(<DesktopConnectionButton />);
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
    rerender(<DesktopConnectionButton />);

    const button = await screen.findByRole('button', { name: '桌面连接：本地，12 毫秒' });
    expect(button).toHaveTextContent('本地');
    fireEvent.click(button);
    await waitFor(() => expect(openConnectionManager).toHaveBeenCalledOnce());
  });
});
