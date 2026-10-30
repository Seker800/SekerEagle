import { lazy } from 'react';
import { render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { AsyncContent } from './AsyncContent';

it('keeps surrounding navigation and offers a page reload after a rejected chunk', async () => {
  const error = vi.spyOn(console, 'error').mockImplementation(() => {});
  const Broken = lazy(async () => {
    throw new Error('synthetic chunk download failure');
  });
  try {
    render(
      <>
        <nav>Navigation</nav>
        <AsyncContent fallback={<span>Loading</span>}>
          <Broken />
        </AsyncContent>
      </>,
    );
    expect(await screen.findByRole('alert')).toHaveTextContent('界面加载失败，请重新加载。');
    expect(screen.getByRole('button', { name: '重新加载' })).toBeVisible();
    expect(screen.getByRole('navigation')).toHaveTextContent('Navigation');
    expect(screen.queryByText('Loading')).not.toBeInTheDocument();
  } finally {
    error.mockRestore();
  }
});

it('replaces its local loading state with the resolved view', async () => {
  let resolve!: (module: { default: () => React.ReactNode }) => void;
  const View = lazy(
    () =>
      new Promise<{ default: () => React.ReactNode }>((done) => {
        resolve = done;
      }),
  );
  render(
    <AsyncContent fallback={<span>Loading</span>}>
      <View />
    </AsyncContent>,
  );
  expect(screen.getByText('Loading')).toBeVisible();
  resolve({ default: () => <span>Loaded</span> });
  expect(await screen.findByText('Loaded')).toBeVisible();
});
