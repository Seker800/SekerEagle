'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const {
  ConnectionSupervisor,
  NightlySyncScheduler,
  formatLocalDate,
  nextNightlyWindow,
  parseTime,
} = require('../js/automation');

test('reconnects with bounded exponential backoff and returns to the healthy interval', async () => {
  const delays = [];
  const outcomes = [new Error('offline'), new Error('offline'), null, null];
  const supervisor = new ConnectionSupervisor({
    connect: async () => {
      const outcome = outcomes.shift();
      if (outcome) throw outcome;
    },
    onStateChange: () => {},
    schedule: (callback, delay) => {
      delays.push(delay);
      return { callback };
    },
    cancelSchedule: () => {},
    retryDelaysMs: [5_000, 15_000, 60_000],
    healthyIntervalMs: 120_000,
  });

  await supervisor.start();
  await supervisor.checkNow();
  await supervisor.checkNow();
  await supervisor.checkNow();

  assert.deepEqual(delays, [5_000, 15_000, 120_000, 120_000]);
  assert.equal(supervisor.connected, true);
});

test('coalesces concurrent reconnect checks into one request', async () => {
  let calls = 0;
  let release;
  const pending = new Promise((resolve) => { release = resolve; });
  const supervisor = new ConnectionSupervisor({
    connect: async () => { calls += 1; await pending; },
    onStateChange: () => {},
    schedule: () => null,
    cancelSchedule: () => {},
  });

  const first = supervisor.start();
  const second = supervisor.checkNow();
  release();
  await Promise.all([first, second]);

  assert.equal(calls, 1);
});

test('stops reconnect monitoring and cancels its pending check', async () => {
  const cancelled = [];
  const timer = { id: 'health-check' };
  const supervisor = new ConnectionSupervisor({
    connect: async () => {},
    schedule: () => timer,
    cancelSchedule: (value) => cancelled.push(value),
  });

  await supervisor.start();
  supervisor.stop();

  assert.deepEqual(cancelled, [timer]);
});

test('executes the scheduled reconnect check', async () => {
  let scheduledCallback;
  let calls = 0;
  let resolveSecondCall;
  const secondCall = new Promise((resolve) => { resolveSecondCall = resolve; });
  const supervisor = new ConnectionSupervisor({
    connect: async () => {
      calls += 1;
      if (calls === 2) resolveSecondCall();
    },
    schedule: (callback) => { scheduledCallback = callback; return callback; },
    cancelSchedule: () => {},
  });

  await supervisor.start();
  scheduledCallback();
  await secondCall;

  assert.equal(calls, 2);
  supervisor.stop();
});

test('calculates the nightly grace window in local time', () => {
  const inside = nextNightlyWindow(new Date(2026, 7, 15, 3, 10), '03:00', 180);
  assert.equal(inside.dueDate, '2026-08-15');
  assert.equal(inside.isOpen, true);

  const missed = nextNightlyWindow(new Date(2026, 7, 15, 9, 0), '03:00', 180);
  assert.equal(missed.isOpen, false);
  assert.equal(missed.nextStart.getDate(), 16);
  assert.equal(missed.nextStart.getHours(), 3);
});

test('runs nightly sync once per local date and never overlaps', async () => {
  const state = { lastAutoSyncDate: '', lastAutoSyncAttemptAt: '' };
  const scheduled = [];
  let calls = 0;
  let release;
  const pending = new Promise((resolve) => { release = resolve; });
  const scheduler = new NightlySyncScheduler({
    getConfig: () => ({ enabled: true, time: '03:00' }),
    getState: () => state,
    saveState: async (patch) => Object.assign(state, patch),
    run: async () => { calls += 1; await pending; },
    now: () => new Date(2026, 7, 15, 3, 5),
    schedule: (callback, delay) => { scheduled.push({ callback, delay }); return callback; },
    cancelSchedule: () => {},
  });

  const first = scheduler.start();
  const second = scheduler.checkNow();
  release();
  await Promise.all([first, second]);
  await scheduler.checkNow();

  assert.equal(calls, 1);
  assert.equal(state.lastAutoSyncDate, '2026-08-15');
  assert.ok(state.lastAutoSyncAttemptAt);
  assert.ok(scheduled.length >= 1);
});

test('retries a failed nightly sync at a bounded interval inside the window', async () => {
  const state = { lastAutoSyncDate: '', lastAutoSyncAttemptAt: '' };
  const scheduled = [];
  const results = [];
  const scheduler = new NightlySyncScheduler({
    getConfig: () => ({ enabled: true, time: '03:00' }),
    getState: () => state,
    saveState: async (patch) => Object.assign(state, patch),
    run: async () => { throw new Error('network unavailable'); },
    onResult: (result) => results.push(result),
    now: () => new Date(2026, 7, 15, 3, 5),
    schedule: (callback, delay) => { scheduled.push({ callback, delay }); return callback; },
    cancelSchedule: () => {},
    retryDelayMs: 15 * 60_000,
  });

  await scheduler.start();

  assert.equal(state.lastAutoSyncStatus, 'FAILED');
  assert.equal(state.lastAutoSyncDate, '');
  assert.equal(results.length, 1);
  assert.equal(results[0].ok, false);
  assert.equal(scheduled.at(-1).delay, 15 * 60_000);
});

test('defers a user-paused nightly sync until the next scheduled day', async () => {
  const state = { lastAutoSyncDate: '', lastAutoSyncPausedDate: '', lastAutoSyncAttemptAt: '' };
  const scheduled = [];
  const results = [];
  const scheduler = new NightlySyncScheduler({
    getConfig: () => ({ enabled: true, time: '03:00' }),
    getState: () => state,
    saveState: async (patch) => Object.assign(state, patch),
    run: async () => { throw Object.assign(new Error('用户暂停了同步。'), { code: 'IMPORT_PAUSED' }); },
    onResult: (result) => results.push(result),
    now: () => new Date(2026, 7, 15, 3, 5),
    schedule: (callback, delay) => { scheduled.push({ callback, delay }); return callback; },
    cancelSchedule: () => {},
  });

  await scheduler.start();

  assert.equal(state.lastAutoSyncDate, '');
  assert.equal(state.lastAutoSyncPausedDate, '2026-08-15');
  assert.equal(state.lastAutoSyncStatus, 'PAUSED');
  assert.equal(results[0].paused, true);
  assert.equal(scheduled.at(-1).delay, 23 * 60 * 60_000 + 55 * 60_000);
});

test('keeps a disabled nightly scheduler idle and supports explicit rescheduling', async () => {
  let enabled = false;
  const scheduleUpdates = [];
  const scheduler = new NightlySyncScheduler({
    getConfig: () => ({ enabled, time: '03:00' }),
    getState: () => ({}),
    saveState: async () => {},
    run: async () => {},
    onSchedule: (date) => scheduleUpdates.push(date),
    now: () => new Date(2026, 7, 15, 1, 0),
    schedule: () => ({ id: 'nightly' }),
    cancelSchedule: () => {},
  });

  await scheduler.start();
  enabled = true;
  await scheduler.reschedule();
  scheduler.stop();

  assert.equal(scheduleUpdates[0], null);
  assert.equal(scheduleUpdates[1].getHours(), 3);
  assert.equal(scheduleUpdates.at(-1), null);
});

test('waits for the retry interval after a recent nightly attempt', async () => {
  let runs = 0;
  const scheduled = [];
  const scheduler = new NightlySyncScheduler({
    getConfig: () => ({ enabled: true, time: '03:00' }),
    getState: () => ({ lastAutoSyncDate: '', lastAutoSyncAttemptAt: new Date(2026, 7, 15, 3, 0).toISOString() }),
    saveState: async () => {},
    run: async () => { runs += 1; },
    now: () => new Date(2026, 7, 15, 3, 5),
    schedule: (callback, delay) => { scheduled.push({ callback, delay }); return callback; },
    cancelSchedule: () => {},
    retryDelayMs: 15 * 60_000,
  });

  await scheduler.start();

  assert.equal(runs, 0);
  assert.equal(scheduled[0].delay, 10 * 60_000);
  scheduler.stop();
});

test('normalizes invalid nightly times and formats local dates', () => {
  assert.deepEqual(parseTime('25:90'), [3, 0]);
  assert.deepEqual(parseTime('not-a-time'), [3, 0]);
  assert.deepEqual(parseTime('23:45'), [23, 45]);
  assert.equal(formatLocalDate(new Date(2026, 0, 2, 12, 0)), '2026-01-02');
});

