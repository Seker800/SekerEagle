import '@testing-library/jest-dom/vitest';
import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BackupPanel } from './BackupPanel';

describe('BackupPanel', () => {
  afterEach(() => vi.unstubAllGlobals());
  it('shows the last success independently of a newer failed attempt', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            configured: true,
            target: 'SekerDesign',
            status: 'failed',
            lastSuccessAt: '2026-10-01T17:00:00Z',
            lastAttemptAt: '2026-10-16T17:00:00Z',
            nextScheduledAt: '2026-10-23T17:00:00Z',
            overdue: true,
          }),
          { headers: { 'content-type': 'application/json' } },
        ),
      ),
    );
    render(<BackupPanel />);
    expect(await screen.findByText('最近一次备份失败')).toBeVisible();
    expect(screen.getByText('SekerDesign')).toBeVisible();
    expect(screen.getByText(/备份已超期/)).toBeVisible();
    expect(screen.getByText('最后成功备份').nextElementSibling?.textContent).toContain('2026');
  });
  it('does not pretend an unreadable status means a successful backup', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('', { status: 503 })));
    render(<BackupPanel />);
    expect(await screen.findByRole('alert')).toHaveTextContent('暂时无法读取备份状态');
    expect(screen.queryByText('备份成功')).not.toBeInTheDocument();
  });
});
