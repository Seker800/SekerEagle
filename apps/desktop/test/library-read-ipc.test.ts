import { expect, it, vi } from 'vitest';
import { registerLibraryReadIpc } from '../src/main/library-read-ipc';
import type { LibraryMediaSnapshot } from '../src/main/library-media-snapshot';

function setup(available = true) {
  const invoke = new Map<string, (...args: unknown[]) => Promise<unknown>>();
  const send = new Map<string, (...args: unknown[]) => unknown>();
  const trusted = {};
  const read = vi.fn(async (_path: string, _signal: AbortSignal) => ({
    status: 200,
    body: '{}',
    contentType: 'application/json',
  }));
  const reset = vi.fn();
  registerLibraryReadIpc({
    ipcMain: {
      handle: (name, handler) => {
        invoke.set(name, async (...args: unknown[]) =>
          handler(...(args as Parameters<typeof handler>)),
        );
      },
      on: (name, handler) => {
        send.set(name, (...args: unknown[]) => handler(...(args as Parameters<typeof handler>)));
        return {} as never;
      },
    },
    assertTrustedIpcSender: (event) => {
      if (event !== trusted) throw new Error('untrusted');
    },
    snapshot: () => (available ? ({ read, reset } as unknown as LibraryMediaSnapshot) : null),
  });
  return { invoke, send, trusted, read, reset };
}
it('guards every read and reset before accepting renderer arguments', async () => {
  const { invoke, read, reset, trusted } = setup();
  const call = invoke.get('desktop:read-library')!;
  await expect(call({}, '/api/photos/assets', 'one')).rejects.toThrow('untrusted');
  await expect(call(trusted, '/api/photos/assets', 'bad/id')).rejects.toThrow('Invalid');
  expect(read).not.toHaveBeenCalled();
  await expect(invoke.get('desktop:reset-media-snapshot')!({})).rejects.toThrow('untrusted');
  expect(reset).not.toHaveBeenCalled();
  await invoke.get('desktop:reset-media-snapshot')!(trusted);
  expect(reset).toHaveBeenCalledOnce();
  await expect(call(trusted, '/api/photos/assets', 'one')).resolves.toMatchObject({ status: 200 });
});
it('cancels only a trusted pending read, rejects duplicate IDs and releases finished IDs', async () => {
  const { invoke, send, trusted, read } = setup();
  read.mockImplementationOnce(
    (_path, signal) =>
      new Promise((_resolve, reject) =>
        signal.addEventListener('abort', () => reject(new Error('cancelled')), { once: true }),
      ),
  );
  const call = invoke.get('desktop:read-library')!;
  const pending = call(trusted, '/api/photos/assets', 'one');
  await expect(call(trusted, '/api/photos/assets', 'one')).rejects.toThrow('Invalid');
  send.get('desktop:cancel-library-read')!({}, 'one');
  expect(read.mock.calls[0]![1].aborted).toBe(false);
  send.get('desktop:cancel-library-read')!(trusted, 'one');
  await expect(pending).rejects.toThrow('cancelled');
  await expect(call(trusted, '/api/photos/assets', 'one')).resolves.toMatchObject({ status: 200 });
});
it('rejects reads while the active connection is unavailable', async () => {
  const { invoke, trusted } = setup(false);
  await expect(
    invoke.get('desktop:read-library')!(trusted, '/api/photos/assets', 'one'),
  ).rejects.toThrow('unavailable');
});
