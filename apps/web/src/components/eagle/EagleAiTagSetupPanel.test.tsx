import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as api from '../../lib/eagle-ai-tag-api';
import { EagleAiTagSetupPanel } from './EagleAiTagSetupPanel';

vi.mock('../../lib/eagle-ai-tag-api', () => ({
  fetchEagleAiTagSummary: vi.fn(),
  retryFailedEagleAiTags: vi.fn(),
  scanMissingEagleAiTags: vi.fn(),
  updateEagleAiTagSettings: vi.fn(),
}));

const summary = {
  eligible: 67276,
  analyzed: 0,
  queued: 0,
  running: 0,
  failed: 0,
  tags: 0,
  ollama: { status: 'ONLINE' as const, model: 'qwen3.8:27b-mlx' },
  settings: {
    manualEnabled: false,
    scheduleEnabled: false,
    scheduleStart: '23:00',
    scheduleEnd: '06:00',
    timeZone: 'Asia/Shanghai' as const,
  },
};

describe('EagleAiTagSetupPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(api.fetchEagleAiTagSummary).mockResolvedValue(summary);
    vi.mocked(api.updateEagleAiTagSettings).mockResolvedValue({
      ...summary.settings,
      manualEnabled: true,
    });
  });

  it('uses a clear primary action instead of a checkbox and acknowledges startup immediately', async () => {
    let resolveUpdate!: (value: typeof summary.settings) => void;
    vi.mocked(api.updateEagleAiTagSettings).mockReturnValueOnce(
      new Promise((resolve) => {
        resolveUpdate = resolve;
      }),
    );
    const { container } = render(<EagleAiTagSetupPanel />);

    const manual = await screen.findByRole('button', { name: '开始处理' });
    const scheduled = screen.getByRole('switch', { name: '每日定时' });
    expect(container.querySelector('input[type="checkbox"]')).toBeNull();
    expect(scheduled).toHaveAttribute('aria-checked', 'false');

    fireEvent.click(manual);
    expect(screen.getByRole('button', { name: '正在启动…' })).toBeDisabled();
    await waitFor(() =>
      expect(api.updateEagleAiTagSettings).toHaveBeenCalledWith({
        manualEnabled: true,
        scheduleEnabled: false,
        scheduleStart: '23:00',
        scheduleEnd: '06:00',
      }),
    );
    resolveUpdate({ ...summary.settings, manualEnabled: true });
    expect(await screen.findByRole('button', { name: '停止处理' })).toBeEnabled();
  });

  it('reveals an independent daily time window without enabling immediate manual work', async () => {
    render(<EagleAiTagSetupPanel />);

    const schedule = await screen.findByRole('switch', { name: '每日定时' });
    fireEvent.click(schedule);
    expect(schedule).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByLabelText('开始时间')).toHaveValue('23:00');
    expect(screen.getByLabelText('结束时间')).toHaveValue('06:00');
    await waitFor(() =>
      expect(api.updateEagleAiTagSettings).toHaveBeenCalledWith({
        manualEnabled: false,
        scheduleEnabled: true,
        scheduleStart: '23:00',
        scheduleEnd: '06:00',
      }),
    );
  });
});
