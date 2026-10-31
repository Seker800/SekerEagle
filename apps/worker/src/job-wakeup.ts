import type { EagleMediaJobKind, EagleProcessingLane } from '@prisma/client';
import { nextBackgroundTime } from '@sekereagle/library-core';
import { Client, type Notification } from 'pg';

export const WORKER_WAKEUP_CHANNEL = 'sekereagle_worker_wakeup';
export const OBJECT_DELETION_WAKEUP_CHANNEL = 'sekereagle_object_deletion_wakeup';
const FALLBACK_POLL_MS = 30_000;

export interface PendingWakeCandidate {
  availableAt: Date;
  lane: EagleProcessingLane;
  kind: EagleMediaJobKind;
}

export interface ProcessingWakeSettings {
  mode: 'ALWAYS' | 'NIGHT' | 'MANUAL';
  nightStart: string;
  nightEnd: string;
}

export function nextEligibleWakeAt(
  candidate: PendingWakeCandidate,
  settings: ProcessingWakeSettings,
  now = new Date(),
): Date | null {
  const dueAt = new Date(Math.max(candidate.availableAt.getTime(), now.getTime()));
  if (candidate.kind === 'GENERATE_AI_TAGS') return null;
  if (candidate.lane !== 'BACKGROUND') return dueAt;
  return nextBackgroundTime(settings, dueAt);
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
        } else if (!this.stopped && !this.timer) {
          this.scheduleAt(null);
        }
      });
  }

  scheduleAt(date: Date | null): void {
    if (this.stopped) return;
    this.clearTimer();
    const delay = date
      ? Math.max(0, Math.min(FALLBACK_POLL_MS, date.getTime() - this.now()))
      : FALLBACK_POLL_MS;
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
    private readonly onWake: (payload?: string) => void,
    private readonly reportError: (error: unknown) => void,
    private readonly onObjectDeletion?: () => void,
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
      if (message.channel === WORKER_WAKEUP_CHANNEL) this.onWake(message.payload);
      else if (message.channel === OBJECT_DELETION_WAKEUP_CHANNEL) this.onObjectDeletion?.();
    });
    try {
      await client.connect();
      await client.query(`LISTEN ${WORKER_WAKEUP_CHANNEL}`);
      if (this.onObjectDeletion) await client.query(`LISTEN ${OBJECT_DELETION_WAKEUP_CHANNEL}`);
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

function postgresConnectionString(value: string): string {
  const parsed = new URL(value);
  parsed.searchParams.delete('schema');
  return parsed.toString();
}
