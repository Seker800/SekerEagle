import { act, fireEvent, render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { EagleLocateAssetButton } from './EagleLocateAssetButton';
it('locates only once while pending, exposes retry on failure, and resets for another image', async () => {
  let reject!: (reason: Error) => void;
  const onLocate = vi.fn(
    () =>
      new Promise<void>((_, fail) => {
        reject = fail;
      }),
  );
  const view = render(<EagleLocateAssetButton assetId="one" onLocate={onLocate} />);
  fireEvent.click(screen.getByRole('button', { name: '定位到时间线' }));
  expect(screen.getByRole('button')).toBeDisabled();
  fireEvent.click(screen.getByRole('button'));
  expect(onLocate).toHaveBeenCalledOnce();
  expect(onLocate).toHaveBeenCalledWith('one');
  await act(async () => reject(new Error('unavailable')));
  expect(screen.getByRole('alert')).toHaveTextContent('无法定位这张图片');
  onLocate.mockResolvedValueOnce();
  fireEvent.click(screen.getByRole('button'));
  await act(async () => {});
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  view.rerender(<EagleLocateAssetButton assetId="two" onLocate={onLocate} />);
  expect(screen.getByRole('button')).toBeEnabled();
});
