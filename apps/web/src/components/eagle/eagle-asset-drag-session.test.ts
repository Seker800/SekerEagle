import { describe, expect, it, vi } from 'vitest';
import { DesktopAssetDragSession } from './eagle-asset-drag-session';

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

describe('DesktopAssetDragSession', () => {
  it('starts the first outbound gesture after its preparation finishes', async () => {
    const preparation = createDeferred<{ token: string }>();
    const bridge = {
      prepareAssetDrag: vi.fn(() => preparation.promise),
      startPreparedAssetDrag: vi.fn(),
    };
    const session = new DesktopAssetDragSession(bridge);

    session.begin(['asset-1']);
    preparation.resolve({ token: 'drag-token' });
    await session.whenSettled();

    expect(bridge.startPreparedAssetDrag).toHaveBeenCalledOnce();
    expect(bridge.startPreparedAssetDrag).toHaveBeenCalledWith('drag-token');
    expect(session.isOutboundDrag()).toBe(true);
  });

  it('does not start a delayed native drag after the pointer gesture ended', async () => {
    const preparation = createDeferred<{ token: string }>();
    const bridge = {
      prepareAssetDrag: vi.fn(() => preparation.promise),
      startPreparedAssetDrag: vi.fn(),
    };
    const session = new DesktopAssetDragSession(bridge);

    session.begin(['asset-1']);
    session.end();
    preparation.resolve({ token: 'drag-token' });
    await session.whenSettled();

    expect(bridge.startPreparedAssetDrag).not.toHaveBeenCalled();
    expect(session.isOutboundDrag()).toBe(false);
  });

  it('serializes preparation and keeps only the latest requested selection', async () => {
    const first = createDeferred<{ token: string }>();
    const bridge = {
      prepareAssetDrag: vi
        .fn()
        .mockImplementationOnce(() => first.promise)
        .mockResolvedValueOnce({ token: 'second-token' }),
      startPreparedAssetDrag: vi.fn(),
    };
    const session = new DesktopAssetDragSession(bridge);

    void session.prime(['asset-1']);
    void session.prime(['asset-2', 'asset-3']);
    expect(bridge.prepareAssetDrag).toHaveBeenCalledTimes(1);

    first.resolve({ token: 'first-token' });
    await session.whenSettled();
    session.begin(['asset-2', 'asset-3']);

    expect(bridge.prepareAssetDrag).toHaveBeenNthCalledWith(2, ['asset-2', 'asset-3']);
    expect(bridge.startPreparedAssetDrag).toHaveBeenCalledWith('second-token');
  });
});
