import type { IpcMain, IpcMainInvokeEvent, IpcMainEvent } from 'electron';
import type { LibraryMediaSnapshot } from './library-media-snapshot';

export function registerLibraryReadIpc(options: {
  ipcMain: Pick<IpcMain, 'handle' | 'on'>;
  assertTrustedIpcSender: (event: IpcMainInvokeEvent | IpcMainEvent) => void;
  snapshot: () => LibraryMediaSnapshot | null;
}): void {
  const { ipcMain, assertTrustedIpcSender } = options;
  const pending = new Map<string, AbortController>();
  const validRequestId = (value: unknown): value is string =>
    typeof value === 'string' && /^[a-zA-Z0-9-]{1,64}$/u.test(value);
  ipcMain.handle('desktop:read-library', async (event, path: unknown, requestId: unknown) => {
    assertTrustedIpcSender(event);
    if (typeof path !== 'string' || !validRequestId(requestId) || pending.has(requestId))
      throw new Error('Invalid library read');
    const snapshot = options.snapshot();
    if (!snapshot) throw new Error('Library is unavailable');
    const controller = new AbortController();
    pending.set(requestId, controller);
    try {
      return await snapshot.read(
        path,
        AbortSignal.any([controller.signal, AbortSignal.timeout(30_000)]),
      );
    } finally {
      pending.delete(requestId);
    }
  });
  ipcMain.on('desktop:cancel-library-read', (event, requestId: unknown) => {
    try {
      assertTrustedIpcSender(event);
    } catch {
      return;
    }
    if (validRequestId(requestId)) pending.get(requestId)?.abort();
  });
  ipcMain.handle('desktop:reset-media-snapshot', (event) => {
    assertTrustedIpcSender(event);
    options.snapshot()?.reset();
  });
}
