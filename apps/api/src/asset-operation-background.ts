import { Logger } from '@nestjs/common';
import type { EagleUploadRecoveryService } from './eagle/eagle-upload-recovery.service';

const RECOVERY_INTERVAL_MS = 60_000;
const UPLOAD_FINALIZATION_INTERVAL_MS = 5_000;
const MAINTENANCE_INTERVAL_MS = 10 * 60_000;

/** Discovery belongs only to the operations process. Domain services retain durable/CAS recovery. */
export class AssetOperationBackground {
  private readonly logger = new Logger(AssetOperationBackground.name);
  private readonly timers: Array<ReturnType<typeof setInterval>> = [];
  private readonly running = new Set<Promise<void>>();
  private started = false;
  private closing = false;

  constructor(
    private readonly recoveries: readonly Pick<
      EagleUploadRecoveryService,
      'recoverPendingFinalizations'
    >[],
    private readonly maintenance: { runMaintenance(): Promise<unknown> },
    readonly finalizations: { tick(): Promise<void>; stop?(): void },
    private readonly recoveryEnabled: boolean,
  ) {}

  start(): void {
    if (this.started || this.closing) return;
    this.started = true;
    if (this.recoveryEnabled)
      for (const recovery of this.recoveries)
        this.schedule(() => recovery.recoverPendingFinalizations(), RECOVERY_INTERVAL_MS);
    this.schedule(() => this.finalizations.tick(), UPLOAD_FINALIZATION_INTERVAL_MS);
    this.schedule(async () => {
      await this.maintenance.runMaintenance();
    }, MAINTENANCE_INTERVAL_MS);
  }

  async close(): Promise<void> {
    this.closing = true;
    this.finalizations.stop?.();
    for (const timer of this.timers) clearInterval(timer);
    this.timers.length = 0;
    await Promise.all(this.running);
  }

  private schedule(work: () => Promise<void>, intervalMs: number): void {
    let active: Promise<void> | undefined;
    const discover = () => {
      if (this.closing || active) return;
      // Invoke immediately so startup discovers durable backlog before its first interval.
      const pending = work().catch(() => {
        this.logger.warn('operations_background_discovery_failed');
      });
      active = pending;
      this.running.add(pending);
      void pending.then(() => {
        this.running.delete(pending);
        active = undefined;
      });
    };
    discover();
    const timer = setInterval(discover, intervalMs);
    timer.unref();
    this.timers.push(timer);
  }
}
