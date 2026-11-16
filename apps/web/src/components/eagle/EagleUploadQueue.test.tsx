import { fireEvent, render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { EagleUploadQueue } from './EagleUploadQueue';
import type { EagleUploadItem, EagleUploadSummary } from './useEagleUploadController';

const item = (
  id: number,
  state: EagleUploadItem['state'],
  name = `photo-${id}.jpg`,
): EagleUploadItem => ({
  id,
  scope: 'scope',
  name,
  size: 10 * 1024 * 1024,
  percent: state === 'completed' ? 100 : 40,
  state,
});

const summary = (overrides: Partial<EagleUploadSummary> = {}): EagleUploadSummary => ({
  total: 2,
  uploaded: 1,
  completed: 1,
  duplicate: 0,
  failed: 1,
  waiting: 1,
  percent: 50,
  bytesPerSecond: 2 * 1024 * 1024,
  remainingSeconds: 30,
  paused: false,
  ...overrides,
});

it('shows overall progress, speed, categories and batch actions', () => {
  const onRetryAll = vi.fn(async () => undefined);
  render(
    <EagleUploadQueue
      items={[item(1, 'completed'), item(2, 'failed', 'broken.jpg')]}
      summary={summary()}
      onPause={vi.fn()}
      onResume={vi.fn()}
      onRetryAll={onRetryAll}
      onRetry={vi.fn()}
      onDismiss={vi.fn()}
    />,
  );
  expect(screen.getByText('50%')).toBeInTheDocument();
  expect(screen.getByText(/2\.0 MB\/s/)).toBeInTheDocument();
  expect(screen.getByText('成功 1')).toBeInTheDocument();
  expect(screen.getByText('失败 1')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: '重试全部失败' }));
  expect(onRetryAll).toHaveBeenCalledOnce();
});

it('pauses and resumes the batch with clear feedback', () => {
  const onPause = vi.fn();
  const onResume = vi.fn();
  const { rerender } = render(
    <EagleUploadQueue
      items={[item(1, 'uploading')]}
      summary={summary({ total: 1, uploaded: 0, completed: 0, failed: 0, waiting: 1 })}
      onPause={onPause}
      onResume={onResume}
      onRetryAll={vi.fn(async () => undefined)}
      onRetry={vi.fn()}
      onDismiss={vi.fn()}
    />,
  );
  fireEvent.click(screen.getByRole('button', { name: '暂停全部' }));
  expect(onPause).toHaveBeenCalledOnce();
  rerender(
    <EagleUploadQueue
      items={[item(1, 'uploading')]}
      summary={summary({
        total: 1,
        uploaded: 0,
        completed: 0,
        failed: 0,
        waiting: 1,
        paused: true,
      })}
      onPause={onPause}
      onResume={onResume}
      onRetryAll={vi.fn(async () => undefined)}
      onRetry={vi.fn()}
      onDismiss={vi.fn()}
    />,
  );
  expect(screen.getByText(/已暂停，正在上传的 1 张会先完成/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: '继续全部' }));
  expect(onResume).toHaveBeenCalledOnce();
});

it('collapses the list and labels duplicate skips', () => {
  const onDismiss = vi.fn();
  render(
    <EagleUploadQueue
      items={[item(1, 'duplicate', 'same.jpg')]}
      summary={summary({
        total: 1,
        uploaded: 1,
        completed: 0,
        duplicate: 1,
        failed: 0,
        waiting: 0,
      })}
      onPause={vi.fn()}
      onResume={vi.fn()}
      onRetryAll={vi.fn(async () => undefined)}
      onRetry={vi.fn()}
      onDismiss={onDismiss}
    />,
  );
  expect(screen.getByText('重复跳过')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: '清除已结束' }));
  expect(onDismiss).toHaveBeenCalledOnce();
  fireEvent.click(screen.getByRole('button', { name: '收起列表' }));
  expect(screen.queryByText('same.jpg')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: '展开列表' }));
  expect(screen.getByText('same.jpg')).toBeInTheDocument();
});
