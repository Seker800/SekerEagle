import { hashKey } from '@tanstack/react-query';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  LibraryUploadQueue,
  UPLOAD_FILE_CONCURRENCY,
  type UploadStatusPoll,
} from './library-upload-queue';
import type { EagleUploadSessionStatus } from './eagle-api';

const assetsKey = ['owner', 'MATERIAL', 'assets'];

const status = (
  id: string,
  value: Partial<EagleUploadSessionStatus> = {},
): EagleUploadSessionStatus => ({
  id,
  status: 'ASSEMBLED',
  eagleAssetId: null,
  objectCleanupPending: false,
  finalizationAttempts: 0,
  lastError: null,
  ...value,
});

const file = (name: string) => new File(['image'], name, { type: 'image/jpeg' });

const createQueue = (invalidate = vi.fn(async () => undefined)) =>
  new LibraryUploadQueue(invalidate, () => () => undefined);

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('LibraryUploadQueue', () => {
  it('exposes an import-preparation signal that aborts when the queue is cleared', () => {
    const queue = createQueue();
    const signal = queue.signal;
    expect(signal.aborted).toBe(false);
    queue.clear();
    expect(signal.aborted).toBe(true);
  });

  it('runs four files concurrently instead of two', async () => {
    const queue = createQueue();
    let active = 0;
    let peak = 0;
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const run = vi.fn(async () => {
      active += 1;
      peak = Math.max(peak, active);
      await gate;
      active -= 1;
    });
    const done = queue.add(
      Array.from({ length: 8 }, (_, index) => file(`photo-${index}.jpg`)),
      assetsKey,
      run,
    );
    await vi.waitFor(() => expect(peak).toBe(UPLOAD_FILE_CONCURRENCY));
    release();
    await done;
    expect(peak).toBe(UPLOAD_FILE_CONCURRENCY);
    expect(queue.snapshot()).toHaveLength(8);
    expect(queue.snapshot().every((item) => item.state === 'completed')).toBe(true);
    queue.dispose();
  });

  it('releases upload slots before server-side finalization finishes', async () => {
    vi.useFakeTimers();
    const invalidate = vi.fn(async () => undefined);
    const queue = createQueue(invalidate);
    let finalized = false;
    const poll = vi.fn<UploadStatusPoll>(async (ids) =>
      ids.map((id) =>
        finalized
          ? status(id, {
              status: 'COMPLETED',
              eagleAssetId: `asset-${id}`,
              finalizationAttempts: 1,
            })
          : status(id),
      ),
    );
    const started: string[] = [];
    const run = vi.fn(async (input: File) => {
      started.push(input.name);
      return { sessionId: `session-${input.name}` };
    });

    const done = queue.add([file('a.jpg'), file('b.jpg')], assetsKey, run, poll);
    await vi.advanceTimersByTimeAsync(0);

    expect(started).toEqual(['a.jpg', 'b.jpg']);
    expect(queue.snapshot().map((item) => item.state)).toEqual(['uploaded', 'uploaded']);
    expect(poll).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1_500);
    expect(poll).toHaveBeenCalledTimes(1);
    expect(poll).toHaveBeenCalledWith(['session-a.jpg', 'session-b.jpg'], expect.any(AbortSignal));
    expect(queue.snapshot().every((item) => item.state === 'uploaded')).toBe(true);

    finalized = true;
    await vi.advanceTimersByTimeAsync(1_500);
    await done;

    expect(queue.snapshot().every((item) => item.state === 'completed')).toBe(true);
    expect(invalidate).toHaveBeenCalledTimes(1);
    expect(invalidate).toHaveBeenCalledWith(assetsKey);
    queue.dispose();
  });

  it('keeps uploading past a file that is still waiting for finalization', async () => {
    vi.useFakeTimers();
    const queue = createQueue();
    let finalized = false;
    const poll = vi.fn<UploadStatusPoll>(async (ids) =>
      ids.map((id) =>
        finalized ? status(id, { status: 'COMPLETED', eagleAssetId: `asset-${id}` }) : status(id),
      ),
    );
    const run = vi.fn(async (input: File) => ({ sessionId: `session-${input.name}` }));
    const names = Array.from({ length: UPLOAD_FILE_CONCURRENCY + 1 }, (_, index) =>
      file(`photo-${index}.jpg`),
    );

    const done = queue.add(names, assetsKey, run, poll);
    await vi.advanceTimersByTimeAsync(0);

    expect(run).toHaveBeenCalledTimes(UPLOAD_FILE_CONCURRENCY + 1);
    expect(queue.snapshot().every((item) => item.state === 'uploaded')).toBe(true);
    expect(poll).not.toHaveBeenCalled();

    finalized = true;
    await vi.advanceTimersByTimeAsync(1_500);
    await done;
    expect(queue.snapshot().every((item) => item.state === 'completed')).toBe(true);
    queue.dispose();
  });

  it('marks pre-upload duplicates as skipped and keeps the file out of the upload path', async () => {
    const queue = createQueue();
    const run = vi.fn(async () => ({ duplicate: true }));
    await queue.add([file('duplicate.jpg')], assetsKey, run);
    expect(queue.snapshot()[0].state).toBe('duplicate');
    expect(run).toHaveBeenCalledOnce();
    queue.dispose();
  });

  it('clears finished items including duplicate skips', async () => {
    const queue = createQueue();
    const run = vi
      .fn()
      .mockResolvedValueOnce({ duplicate: true })
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error('连接断开'));
    await queue.add([file('duplicate.jpg'), file('done.jpg'), file('failed.jpg')], assetsKey, run);
    expect(queue.snapshot().map((item) => item.state)).toEqual([
      'duplicate',
      'completed',
      'failed',
    ]);
    queue.dismiss(hashKey(assetsKey));
    expect(queue.snapshot()).toHaveLength(0);
    queue.dispose();
  });

  it('shows a server-detected duplicate as skipped after finalization', async () => {
    vi.useFakeTimers();
    const queue = createQueue();
    const poll = vi.fn<UploadStatusPoll>(async (ids) =>
      ids.map((id) =>
        status(id, {
          status: 'COMPLETED',
          eagleAssetId: `asset-${id}`,
          objectCleanupPending: true,
        }),
      ),
    );
    const run = vi.fn(async () => ({ sessionId: 'session-duplicate' }));
    const done = queue.add([file('duplicate.jpg')], assetsKey, run, poll);
    await vi.advanceTimersByTimeAsync(1_500);
    await done;
    expect(queue.snapshot()[0].state).toBe('duplicate');
    queue.dispose();
  });

  it('pauses between files and resumes without restarting the batch', async () => {
    const queue = createQueue();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const started: string[] = [];
    const run = vi.fn(async (input: File) => {
      started.push(input.name);
      await gate;
    });
    const done = queue.add(
      Array.from({ length: UPLOAD_FILE_CONCURRENCY + 2 }, (_, index) => file(`p${index}.jpg`)),
      assetsKey,
      run,
    );
    await vi.waitFor(() => expect(started).toHaveLength(UPLOAD_FILE_CONCURRENCY));
    queue.pauseAll();
    release();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(started).toHaveLength(UPLOAD_FILE_CONCURRENCY);
    expect(queue.paused).toBe(true);
    queue.resumeAll();
    await done;
    expect(started).toHaveLength(UPLOAD_FILE_CONCURRENCY + 2);
    expect(queue.snapshot().every((item) => item.state === 'completed')).toBe(true);
    queue.dispose();
  });

  it('retries every failed file in one action', async () => {
    const queue = createQueue();
    const run = vi
      .fn()
      .mockRejectedValueOnce(new Error('连接断开'))
      .mockRejectedValueOnce(new Error('连接断开'))
      .mockResolvedValue(undefined);
    await queue.add([file('a.jpg'), file('b.jpg')], assetsKey, run);
    expect(queue.snapshot().every((item) => item.state === 'failed')).toBe(true);
    await queue.retryAllFailed();
    expect(run).toHaveBeenCalledTimes(4);
    expect(queue.snapshot().every((item) => item.state === 'completed')).toBe(true);
    queue.dispose();
  });

  it('surfaces a terminal finalization failure without re-uploading', async () => {
    vi.useFakeTimers();
    const queue = createQueue();
    const poll = vi.fn<UploadStatusPoll>(async (ids) =>
      ids.map((id) =>
        status(id, {
          status: 'FAILED',
          finalizationAttempts: 10,
          objectCleanupPending: true,
          lastError: 'IMAGE_FORMAT_MISMATCH',
        }),
      ),
    );
    const run = vi.fn(async () => ({ sessionId: 'session-failed' }));
    const done = queue.add([file('bad.jpg')], assetsKey, run, poll);
    await vi.advanceTimersByTimeAsync(1_500);
    await done;
    expect(queue.snapshot()[0]).toMatchObject({
      state: 'failed',
      error: 'IMAGE_FORMAT_MISMATCH',
    });
    expect(run).toHaveBeenCalledTimes(1);
    queue.dispose();
  });
});
