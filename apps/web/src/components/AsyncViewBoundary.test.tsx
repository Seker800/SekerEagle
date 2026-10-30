import { act, fireEvent, render, screen } from '@testing-library/react';
import { lazy } from 'react';
import { expect, it, vi } from 'vitest';
import { AsyncViewBoundary } from './AsyncViewBoundary';
it('contains pending and rejected chunks locally and offers a fresh index reload', async () => {
  let reject!: (error: Error) => void;
  const Chunk = lazy(
    () =>
      new Promise<{ default: () => React.ReactNode }>((_resolve, fail) => {
        reject = fail;
      }),
  );
  const reload = vi.fn();
  const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);
  try {
    render(
      <>
        <nav>图库导航</nav>
        <AsyncViewBoundary onReload={reload}>
          <Chunk />
        </AsyncViewBoundary>
      </>,
    );
    expect(screen.getByRole('status')).toBeVisible();
    expect(screen.getByText('图库导航')).toBeVisible();
    await act(async () => {
      reject(new Error('missing chunk'));
    });
    expect(await screen.findByRole('alert')).toHaveTextContent('界面加载失败');
    fireEvent.click(screen.getByRole('button', { name: '刷新' }));
    expect(reload).toHaveBeenCalledOnce();
    expect(screen.getByText('图库导航')).toBeVisible();
  } finally {
    errors.mockRestore();
  }
});
