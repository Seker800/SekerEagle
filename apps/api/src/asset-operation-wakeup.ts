import { operationSetting } from './eagle/eagle-operation-settings';
import { Client, type Notification } from 'pg';
import type { EagleAssetOperationService } from './eagle/eagle-asset-operations.service';

/** Only the independent executor listens. Polling remains the recovery path. */
export class AssetOperationWakeup {
  private client?: Client;
  private retry?: NodeJS.Timeout;
  private closing = false;
  private delay = 1000;
  constructor(
    private readonly databaseUrl: string,
    private readonly executors: readonly EagleAssetOperationService[],
  ) {}
  async start() {
    if (this.closing) return;
    const client = new Client({
      connectionString: this.databaseUrl,
      application_name: 'sekereagle-operation-wakeup',
      connectionTimeoutMillis: operationSetting('EAGLE_OPERATION_WAKEUP_CONNECT_TIMEOUT_MS', 3000),
      keepAlive: true,
    });
    this.client = client;
    const recover = () => {
      if (this.client !== client || this.closing) return;
      this.client = undefined;
      void client.end().catch(() => undefined);
      if (!this.retry) {
        this.retry = setTimeout(() => {
          this.retry = undefined;
          void this.start();
        }, this.delay);
        this.retry.unref();
        this.delay = Math.min(
          this.delay * 2,
          operationSetting('EAGLE_OPERATION_WAKEUP_RETRY_MAX_MS', 30000),
        );
      }
    };
    client.on('error', recover);
    client.on('end', recover);
    client.on('notification', (message: Notification) => {
      if (message.channel !== 'eagle_asset_operations' || this.closing) return;
      const executor = this.executors.find((value) => value.mode === message.payload);
      if (executor) void executor.tick().catch(() => console.warn('ASSET_OPERATION_WAKE_FAILED'));
    });
    try {
      await client.connect();
      await client.query('LISTEN eagle_asset_operations');
      if (this.closing || this.client !== client) {
        await client.end().catch(() => undefined);
        return;
      }
      this.delay = 1000;
      for (const executor of this.executors)
        void executor.tick().catch(() => console.warn('ASSET_OPERATION_WAKE_FAILED'));
    } catch {
      if (!this.closing) console.warn('ASSET_OPERATION_WAKEUP_UNAVAILABLE_POLLING_REMAINS_ACTIVE');
      recover();
    }
  }
  async close() {
    this.closing = true;
    if (this.retry) clearTimeout(this.retry);
    const client = this.client;
    this.client = undefined;
    await client?.end().catch(() => undefined);
  }
}
