import type { EagleMediaJobKind, EagleProcessingLane } from '@prisma/client';
import { Client, type Notification } from 'pg';

export const WORKER_WAKEUP_CHANNEL = 'sekereagle_worker_wakeup';
const SHANGHAI_UTC_OFFSET_HOURS = 8;
const MAX_TIMER_DELAY_MS = 2_147_000_000;

export interface PendingWakeCandidate {
  availableAt: Date;
  lane: EagleProcessingLane;
  kind: EagleMediaJobKind;
}

export interface ProcessingWakeSettings {
  mode: 'ALWAYS' | 'NIGHT' | 'MANUAL';
  nightStart: string;
  nightEnd: string;
  aiTagManualEnabled: boolean;
  aiTagScheduleEnabled: boolean;
  aiTagScheduleStart: string;
  aiTagScheduleEnd: string;
}

export function nextEligibleWakeAt(
  candidate: PendingWakeCandidate,
  settings: ProcessingWakeSettings,
  now = new Date(),
): Date | null {
  const dueAt = new Date(Math.max(candidate.availableAt.getTime(), now.getTime()));
  if (candidate.lane !== 'BACKGROUND') return dueAt;
  if (candidate.kind === 'GENERATE_AI_TAGS') {
    if (settings.aiTagManualEnabled) return dueAt;
    if (!settings.aiTagScheduleEnabled) return null;
    return nextTimeInsideShanghaiWindow(
      dueAt,
      settings.aiTagScheduleStart,
      settings.aiTagScheduleEnd,
    );
  }
  if (settings.mode === 'ALWAYS') return dueAt;
  if (settings.mode === 'MANUAL') return null;
  return nextTimeInsideShanghaiWindow(dueAt, settings.nightStart, settings.nightEnd);
}

export class JobWakeScheduler {
  private timer: NodeJS.Timeout | null = null;
  private running = false;
  private rerunRequested = false;
  private stopped = false;

  constructor(
    private readonly run: () => Promise<void>,
    private readonly reportError: (error: unknown) => void,
    private readonly now: () => number = Date.now,
  ) {}

  wakeNow(): void {
    if (this.stopped) return;
    this.clearTimer();
    if (this.running) {
      this.rerunRequested = true;
      return;
    }
    this.running = true;
    void this.run()
      .catch(this.reportError)
      .finally(() => {
        this.running = false;
        if (this.rerunRequested && !this.stopped) {
          this.rerunRequested = false;
          this.wakeNow();
        }
      });
  }

  scheduleAt(date: Date | null): void {
    if (this.stopped) return;
    this.clearTimer();
    if (!date) return;
    const delay = Math.max(0, Math.min(MAX_TIMER_DELAY_MS, date.getTime() - this.now()));
    this.timer = setTimeout(() => {
      this.timer = null;
      this.wakeNow();
    }, delay);
    this.timer.unref();
  }

  stop(): void {
    this.stopped = true;
    this.rerunRequested = false;
    this.clearTimer();
  }

  private clearTimer(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }
}

export class PostgresWakeListener {
  private client: Client | null = null;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private stopped = true;
  private reconnectAttempt = 0;

  constructor(
    private readonly databaseUrl: string,
    private readonly onWake: () => void,
    private readonly reportError: (error: unknown) => void,
  ) {}

  async start(): Promise<void> {
    this.stopped = false;
    await this.connect();
  }

  async stop(): Promise<void> {
    this.stopped = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    const client = this.client;
    this.client = null;
    if (client) await client.end().catch(() => undefined);
  }

  private async connect(): Promise<void> {
    if (this.stopped || this.client) return;
    const client = new Client({ connectionString: postgresConnectionString(this.databaseUrl) });
    this.client = client;
    const reconnect = (error?: unknown) => {
      if (error) this.reportError(error);
      if (this.client !== client) return;
      this.client = null;
      if (!this.stopped) this.scheduleReconnect();
    };
    client.on('error', reconnect);
    client.on('end', () => reconnect());
    client.on('notification', (message: Notification) => {
      if (message.channel === WORKER_WAKEUP_CHANNEL) this.onWake();
    });
    try {
      await client.connect();
      await client.query(`LISTEN ${WORKER_WAKEUP_CHANNEL}`);
      this.reconnectAttempt = 0;
      this.onWake();
    } catch (error) {
      reconnect(error);
      await client.end().catch(() => undefined);
    }
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer || this.stopped) return;
    const delay = Math.min(30_000, 1_000 * 2 ** Math.min(this.reconnectAttempt, 5));
    this.reconnectAttempt += 1;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      void this.connect();
    }, delay);
    this.reconnectTimer.unref();
  }
}

function nextTimeInsideShanghaiWindow(reference: Date, startValue: string, endValue: string): Date {
  const start = minuteOfDay(startValue, 23 * 60);
  const end = minuteOfDay(endValue, 6 * 60);
  if (start === end) return reference;
  const parts = shanghaiParts(reference);
  const current = parts.hour * 60 + parts.minute;
  const inside =
    start < end ? current >= start && current < end : current >= start || current < end;
  if (inside) return reference;
  const dayOffset = current < start ? 0 : 1;
  return shanghaiDate(parts, start, dayOffset);
}

function minuteOfDay(value: string, fallback: number): number {
  const match = /^(\d{2}):(\d{2})$/.exec(value);
  if (!match) return fallback;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  return hour <= 23 && minute <= 59 ? hour * 60 + minute : fallback;
}

function shanghaiParts(date: Date): {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
} {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);
  const value = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((part) => part.type === type)?.value ?? 0);
  return {
    year: value('year'),
    month: value('month'),
    day: value('day'),
    hour: value('hour'),
    minute: value('minute'),
  };
}

function shanghaiDate(
  parts: { year: number; month: number; day: number },
  minute: number,
  dayOffset: number,
): Date {
  const hour = Math.floor(minute / 60);
  const minutes = minute % 60;
  return new Date(
    Date.UTC(
      parts.year,
      parts.month - 1,
      parts.day + dayOffset,
      hour - SHANGHAI_UTC_OFFSET_HOURS,
      minutes,
    ),
  );
}

function postgresConnectionString(value: string): string {
  const parsed = new URL(value);
  parsed.searchParams.delete('schema');
  return parsed.toString();
}
