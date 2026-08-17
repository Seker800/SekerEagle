'use strict';

const DEFAULT_RETRY_DELAYS_MS = Object.freeze([5_000, 15_000, 60_000, 300_000]);
const DEFAULT_HEALTHY_INTERVAL_MS = 120_000;
const DEFAULT_SYNC_RETRY_DELAY_MS = 15 * 60_000;
const DEFAULT_GRACE_MINUTES = 180;

class ConnectionSupervisor {
  constructor({
    connect,
    onStateChange = () => {},
    schedule = (callback, delay) => setTimeout(callback, delay),
    cancelSchedule = (timer) => clearTimeout(timer),
    retryDelaysMs = DEFAULT_RETRY_DELAYS_MS,
    healthyIntervalMs = DEFAULT_HEALTHY_INTERVAL_MS,
  }) {
    this.connect = connect;
    this.onStateChange = onStateChange;
    this.schedule = schedule;
    this.cancelSchedule = cancelSchedule;
    this.retryDelaysMs = retryDelaysMs.length > 0 ? retryDelaysMs : DEFAULT_RETRY_DELAYS_MS;
    this.healthyIntervalMs = healthyIntervalMs;
    this.connected = false;
    this.failureCount = 0;
    this.timer = null;
    this.inFlight = null;
    this.stopped = true;
  }

  start() {
    this.stopped = false;
    return this.checkNow();
  }

  stop() {
    this.stopped = true;
    this.clearTimer();
  }

  clearTimer() {
    if (this.timer !== null) this.cancelSchedule(this.timer);
    this.timer = null;
  }

  scheduleNext(delay) {
    this.clearTimer();
    this.timer = this.schedule(() => {
      this.timer = null;
      void this.checkNow();
    }, delay);
  }

  checkNow() {
    if (this.inFlight) return this.inFlight;
    this.clearTimer();
    this.inFlight = this.runCheck().finally(() => {
      this.inFlight = null;
    });
    return this.inFlight;
  }

  async runCheck() {
    try {
      await this.connect();
      this.connected = true;
      this.failureCount = 0;
      await this.onStateChange({ connected: true, error: null });
      if (!this.stopped) this.scheduleNext(this.healthyIntervalMs);
      return true;
    } catch (error) {
      this.connected = false;
      const delayIndex = Math.min(this.failureCount, this.retryDelaysMs.length - 1);
      const delay = this.retryDelaysMs[delayIndex];
      this.failureCount += 1;
      await this.onStateChange({ connected: false, error });
      if (!this.stopped) this.scheduleNext(delay);
      return false;
    }
  }
}

class NightlySyncScheduler {
  constructor({
    getConfig,
    getState,
    saveState,
    run,
    onSchedule = () => {},
    onResult = () => {},
    now = () => new Date(),
    schedule = (callback, delay) => setTimeout(callback, delay),
    cancelSchedule = (timer) => clearTimeout(timer),
    retryDelayMs = DEFAULT_SYNC_RETRY_DELAY_MS,
    graceMinutes = DEFAULT_GRACE_MINUTES,
  }) {
    this.getConfig = getConfig;
    this.getState = getState;
    this.saveState = saveState;
    this.run = run;
    this.onSchedule = onSchedule;
    this.onResult = onResult;
    this.now = now;
    this.schedule = schedule;
    this.cancelSchedule = cancelSchedule;
    this.retryDelayMs = retryDelayMs;
    this.graceMinutes = graceMinutes;
    this.timer = null;
    this.inFlight = null;
    this.stopped = true;
  }

  start() {
    this.stopped = false;
    return this.checkNow();
  }

  stop() {
    this.stopped = true;
    this.clearTimer();
    this.onSchedule(null);
  }

  reschedule() {
    this.clearTimer();
    return this.checkNow();
  }

  clearTimer() {
    if (this.timer !== null) this.cancelSchedule(this.timer);
    this.timer = null;
  }

  scheduleAt(date) {
    if (this.stopped) return;
    const delay = Math.max(250, date.getTime() - this.now().getTime());
    this.clearTimer();
    this.onSchedule(date);
    this.timer = this.schedule(() => {
      this.timer = null;
      void this.checkNow();
    }, delay);
  }

  checkNow() {
    if (this.inFlight) return this.inFlight;
    this.inFlight = this.runCheck().finally(() => {
      this.inFlight = null;
    });
    return this.inFlight;
  }

  async runCheck() {
    const config = this.getConfig();
    if (!config.enabled) {
      this.clearTimer();
      this.onSchedule(null);
      return false;
    }

    const current = this.now();
    const window = nextNightlyWindow(current, config.time, this.graceMinutes);
    const state = this.getState();
    if (
      !window.isOpen ||
      state.lastAutoSyncDate === window.dueDate ||
      state.lastAutoSyncPausedDate === window.dueDate
    ) {
      this.scheduleAt(window.nextStart);
      return false;
    }

    const lastAttempt = parseDate(state.lastAutoSyncAttemptAt);
    if (lastAttempt && formatLocalDate(lastAttempt) === window.dueDate) {
      const retryAt = new Date(lastAttempt.getTime() + this.retryDelayMs);
      if (retryAt > current && retryAt < window.end) {
        this.scheduleAt(retryAt);
        return false;
      }
    }

    await this.saveState({
      lastAutoSyncAttemptAt: current.toISOString(),
      lastAutoSyncStatus: 'RUNNING',
      lastAutoSyncError: '',
    });
    try {
      await this.run();
      await this.saveState({
        lastAutoSyncDate: window.dueDate,
        lastAutoSyncStatus: 'SUCCESS',
        lastAutoSyncError: '',
      });
      await this.onResult({ ok: true, error: null });
      this.scheduleAt(
        nextNightlyWindow(new Date(window.end.getTime() + 1), config.time, this.graceMinutes)
          .nextStart,
      );
      return true;
    } catch (error) {
      if (error?.code === 'IMPORT_PAUSED') {
        await this.saveState({
          lastAutoSyncPausedDate: window.dueDate,
          lastAutoSyncStatus: 'PAUSED',
          lastAutoSyncError: '',
        });
        await this.onResult({ ok: false, paused: true, error: null });
        this.scheduleAt(window.nextStart);
        return false;
      }
      await this.saveState({
        lastAutoSyncStatus: 'FAILED',
        lastAutoSyncError: error?.message || String(error),
      });
      await this.onResult({ ok: false, error });
      const retryAt = new Date(this.now().getTime() + this.retryDelayMs);
      this.scheduleAt(retryAt < window.end ? retryAt : window.nextStart);
      return false;
    }
  }
}

function nextNightlyWindow(now, time, graceMinutes = DEFAULT_GRACE_MINUTES) {
  const [hour, minute] = parseTime(time);
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate(), hour, minute, 0, 0);
  const end = new Date(start.getTime() + Math.max(1, graceMinutes) * 60_000);
  const isOpen = now >= start && now < end;
  const tomorrow = new Date(start);
  tomorrow.setDate(tomorrow.getDate() + 1);
  return {
    start,
    end,
    isOpen,
    dueDate: formatLocalDate(start),
    nextStart: now < start ? start : tomorrow,
  };
}

function parseTime(value) {
  const match = /^(\d{2}):(\d{2})$/.exec(String(value || ''));
  if (!match) return [3, 0];
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour > 23 || minute > 59) return [3, 0];
  return [hour, minute];
}

function formatLocalDate(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function parseDate(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

module.exports = {
  ConnectionSupervisor,
  NightlySyncScheduler,
  nextNightlyWindow,
  parseTime,
  formatLocalDate,
};
