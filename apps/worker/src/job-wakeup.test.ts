import assert from 'node:assert/strict';
import test from 'node:test';
import { JobWakeScheduler, nextEligibleWakeAt, type PendingWakeCandidate } from './job-wakeup';

const defaultSettings = {
  mode: 'NIGHT' as const,
  nightStart: '23:00',
  nightEnd: '06:00',
};

function candidate(overrides: Partial<PendingWakeCandidate> = {}): PendingWakeCandidate {
  return {
    availableAt: new Date('2026-09-16T04:00:00.000Z'),
    lane: 'INTERACTIVE',
    kind: 'GENERATE_PREVIEW',
    ...overrides,
  };
}

test('interactive work wakes immediately when due and uses one timer when delayed', () => {
  const now = new Date('2026-09-16T05:00:00.000Z');
  assert.equal(
    nextEligibleWakeAt(candidate(), defaultSettings, now)?.toISOString(),
    now.toISOString(),
  );
  assert.equal(
    nextEligibleWakeAt(
      candidate({ availableAt: new Date('2026-09-16T05:05:00.000Z') }),
      defaultSettings,
      now,
    )?.toISOString(),
    '2026-09-16T05:05:00.000Z',
  );
});

test('night work sleeps until the processing window instead of polling', () => {
  const daytime = new Date('2026-09-16T04:00:00.000Z'); // 12:00 Asia/Shanghai
  assert.equal(
    nextEligibleWakeAt(
      candidate({ lane: 'BACKGROUND', kind: 'GENERATE_EMBEDDING' }),
      defaultSettings,
      daytime,
    )?.toISOString(),
    '2026-09-16T15:00:00.000Z',
  );

  const insideWindow = new Date('2026-09-16T16:30:00.000Z'); // 00:30 Asia/Shanghai
  assert.equal(
    nextEligibleWakeAt(
      candidate({ lane: 'BACKGROUND', kind: 'GENERATE_EMBEDDING' }),
      defaultSettings,
      insideWindow,
    )?.toISOString(),
    insideWindow.toISOString(),
  );
});

test('manual and disabled AI work stay asleep until settings change', () => {
  const now = new Date('2026-09-16T16:30:00.000Z');
  assert.equal(
    nextEligibleWakeAt(
      candidate({ lane: 'BACKGROUND', kind: 'GENERATE_EMBEDDING' }),
      { ...defaultSettings, mode: 'MANUAL' },
      now,
    ),
    null,
  );
  assert.equal(
    nextEligibleWakeAt(
      candidate({ lane: 'BACKGROUND', kind: 'GENERATE_AI_TAGS' }),
      defaultSettings,
      now,
    ),
    null,
  );
});

test('scheduler coalesces wakeups received while work is running', async () => {
  let finishRun: (() => void) | undefined;
  let runs = 0;
  const scheduler = new JobWakeScheduler(
    () => {
      runs += 1;
      return new Promise<void>((resolve) => {
        finishRun = resolve;
      });
    },
    (error) => assert.fail(String(error)),
  );

  scheduler.wakeNow();
  scheduler.wakeNow();
  scheduler.wakeNow();
  assert.equal(runs, 1);
  finishRun?.();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(runs, 2);
  scheduler.stop();
  finishRun?.();
});

test('scheduler reports a failed run and remains available for later work', async () => {
  const errors: unknown[] = [];
  let runs = 0;
  const scheduler = new JobWakeScheduler(
    async () => {
      runs += 1;
      if (runs === 1) throw new Error('temporary failure');
    },
    (error) => errors.push(error),
  );

  scheduler.wakeNow();
  await new Promise((resolve) => setImmediate(resolve));
  scheduler.wakeNow();
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(runs, 2);
  assert.equal(errors.length, 1);
  assert.match(String(errors[0]), /temporary failure/);
  scheduler.stop();
});

test('idle and failed drains retry without another notification', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let runs = 0;
  const scheduler = new JobWakeScheduler(
    async () => {
      runs++;
      if (runs === 1) throw new Error('temporary');
    },
    () => {},
  );
  scheduler.wakeNow();
  await new Promise((resolve) => setImmediate(resolve));
  t.mock.timers.tick(30_000);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(runs, 2);
  scheduler.stop();
});

test('a drain with an unfinished media task still arms the notification-free due-work fallback', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let time = 0;
  let dueWorkClaimed = false;
  const activeLongTask = true;
  let runs = 0;
  const scheduler = new JobWakeScheduler(
    async () => {
      runs++;
      if (time >= 5000) dueWorkClaimed = true;
      // Matches drainAndScheduleWork: active media omits nextQueueWakeAt.
      // The scheduler itself must arm a fallback after the drain returns.
      if (activeLongTask) return;
      scheduler.scheduleAt(new Date(5000));
    },
    (error) => assert.fail(String(error)),
    () => time,
  );
  scheduler.wakeNow();
  await new Promise((resolve) => setImmediate(resolve));
  time = 30000;
  t.mock.timers.tick(30000);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(runs, 2);
  assert.equal(dueWorkClaimed, true);
  scheduler.stop();
});
