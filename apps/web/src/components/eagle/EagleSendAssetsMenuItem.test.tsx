import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { EagleSendAssetsMenuItem } from './EagleSendAssetsMenuItem';
const { send } = vi.hoisted(() => ({ send: vi.fn() }));
vi.mock('../../lib/library-workspace', () => ({
  useLibraryWorkspace: () => ({ api: { sendEagleAssets: send } }),
}));
it('sends the entire selection, keeps one operation ID across retries and reports success only after completion', async () => {
  send
    .mockRejectedValueOnce(new Error('storage unavailable'))
    .mockResolvedValueOnce({ movedCount: 2, componentCount: 2, targetMode: 'PHOTO', assets: [] });
  const onSent = vi.fn(async () => {});
  render(
    <QueryClientProvider client={new QueryClient()}>
      <EagleSendAssetsMenuItem
        ownerId="owner"
        assetIds={['one', 'two']}
        label="发送到照片"
        disabled={false}
        onSent={onSent}
      />
    </QueryClientProvider>,
  );
  fireEvent.click(screen.getByRole('menuitem'));
  expect(await screen.findByRole('alert')).toHaveTextContent('storage unavailable');
  expect(onSent).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('menuitem'));
  await waitFor(() => expect(onSent).toHaveBeenCalledOnce());
  expect(send.mock.calls[0][1].assetIds).toEqual(['one', 'two']);
  expect(send.mock.calls[1][1].operationId).toBe(send.mock.calls[0][1].operationId);
});

it('refreshes both mode caches even when the user leaves while sending', async () => {
  let finish!: (value: unknown) => void;
  send.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const client = new QueryClient();
  const invalidate = vi.spyOn(client, 'invalidateQueries');
  const onSent = vi.fn(async () => {});
  const view = render(
    <QueryClientProvider client={client}>
      <EagleSendAssetsMenuItem
        ownerId="owner"
        assetIds={['one']}
        label="发送到照片"
        disabled={false}
        onSent={onSent}
      />
    </QueryClientProvider>,
  );
  fireEvent.click(screen.getByRole('menuitem'));
  view.unmount();
  finish({ movedCount: 1, componentCount: 1, targetMode: 'PHOTO', assets: [] });
  await waitFor(() => expect(invalidate).toHaveBeenCalledWith({ queryKey: ['eagle', 'owner'] }));
  expect(onSent).not.toHaveBeenCalled();
});

it('releases the menu while the accepted transfer is still running', async () => {
  send.mockImplementationOnce(() => new Promise(() => undefined));
  const accepted = vi.fn();
  render(
    <QueryClientProvider client={new QueryClient()}>
      <EagleSendAssetsMenuItem
        ownerId="owner"
        assetIds={['one', 'two']}
        label="发送到照片"
        disabled={false}
        onSent={accepted}
      />
    </QueryClientProvider>,
  );
  fireEvent.click(screen.getByRole('menuitem'));
  await waitFor(() => expect(accepted).toHaveBeenCalledOnce());
});
