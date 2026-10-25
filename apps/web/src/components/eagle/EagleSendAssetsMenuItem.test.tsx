import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { EagleSendAssetsMenuItem } from './EagleSendAssetsMenuItem';
const { enqueue, legacySend } = vi.hoisted(() => ({ enqueue: vi.fn(), legacySend: vi.fn() }));
vi.mock('../../lib/library-workspace', () => ({
  useLibraryWorkspace: () => ({
    ownerId: 'owner',
    libraryMode: 'MATERIAL',
    api: { sendEagleAssets: legacySend },
  }),
}));
vi.mock('../../lib/asset-operations-api', () => ({
  createAssetOperationsApi: () => ({ enqueue }),
}));
const receipt = {
  id: 'operation',
  kind: 'SEND',
  libraryMode: 'MATERIAL',
  total: 2,
  queued: 2,
  running: 0,
  completed: 0,
  failed: 0,
  cancelled: 0,
  state: 'QUEUED',
  errors: [],
};
beforeEach(() => {
  enqueue.mockReset().mockResolvedValue(receipt);
  legacySend.mockReset();
});
function mount() {
  const client = new QueryClient();
  const accepted = vi.fn();
  const view = render(
    <QueryClientProvider client={client}>
      <EagleSendAssetsMenuItem
        assetIds={['one', 'two']}
        label="发送到照片"
        disabled={false}
        onQueued={accepted}
      />
    </QueryClientProvider>,
  );
  return { ...view, client, accepted };
}
it('releases the menu while the accepted transfer is still running', async () => {
  legacySend.mockImplementation(() => new Promise(() => undefined));
  const { accepted } = mount();
  fireEvent.click(screen.getByRole('menuitem'));
  await waitFor(() => expect(accepted).toHaveBeenCalledWith(receipt));
  expect(enqueue).toHaveBeenCalledWith({
    assetIds: ['one', 'two'],
    kind: 'SEND',
    operationId: expect.any(String),
  });
  expect(legacySend).not.toHaveBeenCalled();
});
it('reuses the submission identity after an acknowledgement failure without claiming completion', async () => {
  enqueue.mockRejectedValueOnce(new Error('network unavailable'));
  const { accepted } = mount();
  fireEvent.click(screen.getByRole('menuitem'));
  await screen.findByRole('alert');
  expect(accepted).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('menuitem'));
  await waitFor(() => expect(accepted).toHaveBeenCalledOnce());
  expect(enqueue.mock.calls[0][0].operationId).toBe(enqueue.mock.calls[1][0].operationId);
});
it('updates queue status but never invokes an old page callback after navigation', async () => {
  let finish!: (value: unknown) => void;
  enqueue.mockReturnValueOnce(
    new Promise((resolve) => {
      finish = resolve;
    }),
  );
  const view = mount();
  const invalidate = vi.spyOn(view.client, 'invalidateQueries');
  fireEvent.click(screen.getByRole('menuitem'));
  view.unmount();
  finish(receipt);
  await waitFor(() =>
    expect(invalidate).toHaveBeenCalledWith({
      queryKey: ['eagle', 'owner', 'MATERIAL', 'operations'],
    }),
  );
  expect(view.accepted).not.toHaveBeenCalled();
});
