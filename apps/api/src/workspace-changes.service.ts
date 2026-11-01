import {
  Inject,
  Injectable,
  Logger,
  Optional,
  type OnModuleInit,
  type OnModuleDestroy,
} from '@nestjs/common';
import { Client, type Notification } from 'pg';
import {
  WORKSPACE_CHANGE_CHANNEL,
  parseWorkspaceChange,
  taskModelReadiness,
  type WorkspaceChanges,
} from '@sekereagle/library-core';
import { WorkspaceChangeState } from './workspace-change-state';

export const WORKSPACE_CHANGE_CLIENT_FACTORY = Symbol('WORKSPACE_CHANGE_CLIENT_FACTORY');
@Injectable()
export class WorkspaceChangesService implements OnModuleInit, OnModuleDestroy {
  private readonly state = new WorkspaceChangeState();
  private readonly logger = new Logger(WorkspaceChangesService.name);
  private client?: Client;
  private retry?: NodeJS.Timeout;
  private closing = false;
  private delay = 1000;
  constructor(
    @Optional()
    @Inject(WORKSPACE_CHANGE_CLIENT_FACTORY)
    private readonly createClient: () => Client = () =>
      new Client({
        connectionString: process.env.DATABASE_URL,
        application_name: 'sekereagle-workspace-changes',
        connectionTimeoutMillis: 3000,
        keepAlive: true,
      }),
  ) {}
  onModuleInit() {
    return this.connect();
  }
  async snapshot(ownerId: string, includePrivate: boolean): Promise<WorkspaceChanges> {
    this.state.snapshot(ownerId, includePrivate);
    const client = this.client;
    if (!client) throw new Error('WORKSPACE_CHANGE_LISTENER_UNAVAILABLE');
    // One bounded indexed observation, shared by both modes. Heartbeats remain
    // canonical; idle health never requires a new write counter or model probe.
    const worker = await client.query<{ capabilities: unknown }>(`
      SELECT capabilities FROM "EagleProcessingWorkerHeartbeat"
      WHERE "heartbeatAt" BETWEEN now()-interval '45 seconds' AND now()
      ORDER BY "heartbeatAt" DESC LIMIT 1
    `);
    return {
      ...this.state.snapshot(ownerId, includePrivate),
      health: {
        worker: worker.rows.length ? ('ONLINE' as const) : ('OFFLINE' as const),
        embedding: taskModelReadiness(
          worker.rows.map((row) => row.capabilities),
          'EMBEDDING',
          'GENERATE_EMBEDDING',
        ),
      },
    };
  }
  private async connect() {
    if (this.closing) return;
    const client = this.createClient();
    this.client = client;
    const recover = () => {
      if (this.closing || this.client !== client) return;
      this.client = undefined;
      this.state.disconnected();
      void client.end().catch(() => undefined);
      if (!this.retry) {
        this.retry = setTimeout(() => {
          this.retry = undefined;
          void this.connect();
        }, this.delay);
        this.retry.unref();
        this.delay = Math.min(30_000, this.delay * 2);
      }
    };
    client.on('error', recover);
    client.on('end', recover);
    client.on('notification', (message: Notification) => {
      if (this.closing || this.client !== client || message.channel !== WORKSPACE_CHANGE_CHANNEL)
        return;
      const change = parseWorkspaceChange(message.payload ?? '');
      if (change) this.state.record(change);
    });
    try {
      await client.connect();
      await client.query(`LISTEN ${WORKSPACE_CHANGE_CHANNEL}`);
      if (this.closing || this.client !== client) {
        await client.end().catch(() => undefined);
        return;
      }
      // LISTEN is committed before the new epoch. Earlier commits are covered by
      // epoch invalidation; later commits are delivered by this connection.
      this.state.connected();
      this.delay = 1000;
    } catch {
      this.logger.warn('WORKSPACE_CHANGE_LISTENER_UNAVAILABLE');
      recover();
    }
  }
  async onModuleDestroy() {
    this.closing = true;
    this.state.disconnected();
    if (this.retry) clearTimeout(this.retry);
    const client = this.client;
    this.client = undefined;
    await client?.end().catch(() => undefined);
  }
}
