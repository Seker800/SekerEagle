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
  it('reports bounded preparation progress for the active gesture', async () => {
    const preparation = createDeferred<{ token: string }>();
    let reportProgress: ((progress: { completed: number; total: number }) => void) | undefined;
    const statuses: unknown[] = [];
    const bridge = {
      prepareAssetDrag: vi.fn(() => preparation.promise),
      startPreparedAssetDrag: vi.fn(),
      onAssetDragPreparationProgress: vi.fn((listener) => {
        reportProgress = listener;
        return vi.fn();
      }),
    };
    const session = new DesktopAssetDragSession(bridge, vi.fn(), (status) => statuses.push(status));

    session.begin(['asset-1', 'asset-2']);
    reportProgress?.({ completed: 1, total: 2 });

    expect(statuses).toEqual([
      { phase: 'preparing', completed: 0, total: 2 },
      { phase: 'preparing', completed: 1, total: 2 },
    ]);
    preparation.resolve({ token: 'drag-token' });
    await session.whenSettled();
    expect(statuses.at(-1)).toBeNull();
  });

  it('starts the first outbound gesture after its preparation finishes', async () => {
    const preparation = createDeferred<{ token: string }>();
    const bridge = {
      prepareAssetDrag: vi.fn(() => preparation.promise),
      startPreparedAssetDrag: vi.fn(),
      cancelAssetDragPreparation: vi.fn(),
      discardPreparedAssetDrag: vi.fn(),
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
      cancelAssetDragPreparation: vi.fn(),
      discardPreparedAssetDrag: vi.fn(),
    };
    const session = new DesktopAssetDragSession(bridge);

    session.begin(['asset-1']);
    session.end();
    preparation.resolve({ token: 'drag-token' });
    await session.whenSettled();

    expect(bridge.startPreparedAssetDrag).not.toHaveBeenCalled();
    expect(session.isOutboundDrag()).toBe(false);
    expect(bridge.cancelAssetDragPreparation).toHaveBeenCalledOnce();
    expect(bridge.discardPreparedAssetDrag).toHaveBeenCalledWith('drag-token');
  });

  it('serializes preparation and keeps only the latest requested selection', async () => {
    const first = createDeferred<{ token: string }>();
    const bridge = {
      prepareAssetDrag: vi
        .fn()
        .mockImplementationOnce(() => first.promise)
        .mockResolvedValueOnce({ token: 'second-token' }),
      startPreparedAssetDrag: vi.fn(),
      cancelAssetDragPreparation: vi.fn(),
      discardPreparedAssetDrag: vi.fn(),
    };
    const session = new DesktopAssetDragSession(bridge);

    void session.prime(['asset-1']);
    void session.prime(['asset-2', 'asset-3']);
    expect(bridge.prepareAssetDrag).toHaveBeenCalledTimes(1);
    expect(bridge.cancelAssetDragPreparation).toHaveBeenCalledOnce();

    first.resolve({ token: 'first-token' });
    await session.whenSettled();
    session.begin(['asset-2', 'asset-3']);

    expect(bridge.prepareAssetDrag).toHaveBeenNthCalledWith(2, ['asset-2', 'asset-3']);
    expect(bridge.startPreparedAssetDrag).toHaveBeenCalledWith('second-token');
  });

  it('makes an early pointer release visible and retryable', () => {
    const statuses: unknown[] = [];
    const bridge = {
      prepareAssetDrag: vi.fn(() => new Promise<{ token: string }>(() => undefined)),
      startPreparedAssetDrag: vi.fn(),
      cancelAssetDragPreparation: vi.fn(),
    };
    const session = new DesktopAssetDragSession(bridge, vi.fn(), (status) => statuses.push(status));

    session.begin(['asset-1']);
    session.end('cancelled');

    expect(bridge.cancelAssetDragPreparation).toHaveBeenCalledOnce();
    expect(statuses.at(-1)).toEqual({ phase: 'cancelled', total: 1 });
  });

  it('reports a retryable error when preparation exceeds the safety timeout', async () => {
    vi.useFakeTimers();
    const onError = vi.fn();
    const bridge = {
      prepareAssetDrag: vi.fn(() => new Promise<{ token: string }>(() => undefined)),
      startPreparedAssetDrag: vi.fn(),
      cancelAssetDragPreparation: vi.fn(),
    };
    const session = new DesktopAssetDragSession(bridge, onError);

    session.begin(['asset-1']);
    await vi.advanceTimersByTimeAsync(30_000);

    expect(bridge.cancelAssetDragPreparation).toHaveBeenCalledOnce();
    expect(onError).toHaveBeenCalledWith(
      expect.objectContaining({ message: '原文件准备超时，请重新拖动。' }),
    );
    vi.useRealTimers();
  });
});
