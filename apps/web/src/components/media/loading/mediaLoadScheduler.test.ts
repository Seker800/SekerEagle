import { afterEach, describe, expect, it, vi } from 'vitest';
import { MediaLoadScheduler } from './mediaLoadScheduler';

afterEach(() => {
  vi.useRealTimers();
});

describe('MediaLoadScheduler', () => {
  it('limits the initial burst and then refills start capacity at the configured rate', async () => {
    vi.useFakeTimers();
    const started: string[] = [];
    const scheduler = new MediaLoadScheduler({
      maxConcurrent: 10,
      startsPerSecond: 2,
      burst: 2,
    });

    for (let index = 0; index < 4; index += 1) {
      scheduler.enqueue({
        id: String(index),
        priority: 'visible',
        order: index,
        run: () => {
          started.push(String(index));
          return new Promise(() => undefined);
        },
      });
    }
    await Promise.resolve();

    expect(started).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(499);
    expect(started).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(1);
    expect(started).toHaveLength(3);
    await vi.advanceTimersByTimeAsync(500);
    expect(started).toHaveLength(4);
  });

  it('cancels queued work without spending a start token', async () => {
    vi.useFakeTimers();
    const started: string[] = [];
    const scheduler = new MediaLoadScheduler({
      maxConcurrent: 10,
      startsPerSecond: 1,
      burst: 1,
    });
    const enqueue = (id: string) =>
      scheduler.enqueue({
        id,
        priority: 'visible',
        order: 0,
        run: () => {
          started.push(id);
          return new Promise(() => undefined);
        },
      });

    enqueue('active');
    const cancelQueued = enqueue('cancelled');
    enqueue('next');
    cancelQueued();
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(1_000);

    expect(started).toEqual(['active', 'next']);
  });

  it('applies a shared cooldown without discarding queued work', async () => {
    vi.useFakeTimers();
    const started: string[] = [];
    const scheduler = new MediaLoadScheduler({ maxConcurrent: 2, burst: 2 });
    scheduler.coolDown(2_000);
    scheduler.enqueue({
      id: 'after-cooldown',
      priority: 'immediate',
      order: 0,
      run: async () => {
        started.push('after-cooldown');
      },
    });
    await Promise.resolve();

    expect(started).toEqual([]);
    await vi.advanceTimersByTimeAsync(1_999);
    expect(started).toEqual([]);
    await vi.advanceTimersByTimeAsync(1);
    expect(started).toEqual(['after-cooldown']);
  });

  it('reprioritizes queued work without restarting active work', async () => {
    const started: string[] = [];
    let releaseActive!: () => void;
    const scheduler = new MediaLoadScheduler({ maxConcurrent: 1 });
    scheduler.enqueue({
      id: 'active',
      priority: 'immediate',
      order: 0,
      run: () =>
        new Promise<void>((resolve) => {
          started.push('active');
          releaseActive = resolve;
        }),
    });
    scheduler.enqueue({
      id: 'first-queued',
      priority: 'visible',
      order: 1,
      run: async () => {
        started.push('first-queued');
      },
    });
    scheduler.enqueue({
      id: 'reprioritized',
      priority: 'visible',
      order: 0,
      run: async () => {
        started.push('reprioritized');
      },
    });
    await Promise.resolve();

    scheduler.reprioritize('reprioritized', { priority: 'visible', order: 2 });
    releaseActive();
    await vi.waitFor(() => expect(started).toContain('reprioritized'));

    expect(started.slice(0, 2)).toEqual(['active', 'reprioritized']);
  });
});
