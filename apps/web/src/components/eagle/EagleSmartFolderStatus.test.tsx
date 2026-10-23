import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { EagleSmartFolderStatus } from './EagleSmartFolderStatus';

describe('EagleSmartFolderStatus', () => {
  it('keeps previous results visible during rebuild and offers the date/relevance choice', () => {
    const onOrderChange = vi.fn();
    render(
      <EagleSmartFolderStatus
        state={{
          id: 'snapshot',
          status: 'BUILDING',
          hasResults: true,
          completedAt: null,
          updatedAt: '',
        }}
        order="DATE"
        pending={false}
        onRetry={vi.fn()}
        onOrderChange={onOrderChange}
      />,
    );
    expect(screen.getByRole('status')).toHaveTextContent('仍可浏览上一版');
    fireEvent.change(screen.getByRole('combobox', { name: '智能文件夹排序' }), {
      target: { value: 'RELEVANCE' },
    });
    expect(onOrderChange).toHaveBeenCalledWith('RELEVANCE');
  });
  it('makes a failed first build retryable without pretending results exist', () => {
    const onRetry = vi.fn();
    render(
      <EagleSmartFolderStatus
        state={{
          id: 'snapshot',
          status: 'FAILED',
          hasResults: false,
          completedAt: null,
          updatedAt: '',
        }}
        order="DATE"
        pending={false}
        onRetry={onRetry}
        onOrderChange={vi.fn()}
      />,
    );
    expect(screen.getByRole('status')).toHaveTextContent('匹配生成失败');
    fireEvent.click(screen.getByRole('button', { name: '重新生成匹配结果' }));
    expect(onRetry).toHaveBeenCalledOnce();
  });
});
