import type { PrismaClient } from '@prisma/client';
import { drainObjectDeletion, nextObjectDeletionWakeAt } from './asset-purge';
import { JobWakeScheduler } from './job-wakeup';

/** The existing deletion outbox owns its wake clock; media polling cannot lose a retry deadline. */
export class ObjectDeletionRunner {
  private running = false;
  private readonly scheduler: JobWakeScheduler;
  constructor(
    prisma: PrismaClient,
    storage: Parameters<typeof drainObjectDeletion>[1],
    reportError: (error: unknown) => void,
  ) {
    this.scheduler = new JobWakeScheduler(async () => {
      this.running = true;
      try {
        const claimed = await drainObjectDeletion(prisma, storage);
        if (claimed) this.scheduler.wakeNow();
        else this.scheduler.scheduleAt(await nextObjectDeletionWakeAt(prisma));
      } finally {
        this.running = false;
      }
    }, reportError);
  }
  get active() {
    return this.running;
  }
  wake() {
    this.scheduler.wakeNow();
  }
  stop() {
    this.scheduler.stop();
  }
}
