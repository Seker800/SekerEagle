import { act, fireEvent, render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { LibraryPrivacyToggle } from './LibraryPrivacyToggle';
const update = vi.hoisted(() => vi.fn());
vi.mock('../../lib/library-workspace', () => ({
  useLibraryWorkspace: () => ({ api: { updatePrivacyVisibility: update } }),
}));
it('waits for the scoped server grant before showing private content and ignores unmounted responses', async () => {
  let finish!: (value: {
    enabled: boolean;
    durationHours: number;
    expiresAt: string | null;
  }) => void;
  update.mockImplementation(
    () =>
      new Promise((done) => {
        finish = done;
      }),
  );
  const changed = vi.fn(),
    open = vi.fn();
  const view = render(
    <LibraryPrivacyToggle
      value={{ enabled: false, durationHours: 3, expiresAt: null }}
      onChange={changed}
      onOpen={open}
    />,
  );
  fireEvent.click(screen.getByRole('button', { name: '显示隐私内容' }));
  expect(update).toHaveBeenLastCalledWith(true, 3);
  expect(changed).not.toHaveBeenCalled();
  expect(screen.getByRole('button', { name: '保存中…' })).toBeDisabled();
  await act(async () => {
    finish({ enabled: true, durationHours: 3, expiresAt: '2099-01-01T00:00:00Z' });
  });
  expect(open).toHaveBeenCalledOnce();
  expect(changed).toHaveBeenCalledOnce();
  fireEvent.click(screen.getByRole('button', { name: '显示隐私内容' }));
  view.unmount();
  await act(async () => {
    finish({ enabled: true, durationHours: 3, expiresAt: '2099-01-01T00:00:00Z' });
  });
  expect(changed).toHaveBeenCalledOnce();
});
