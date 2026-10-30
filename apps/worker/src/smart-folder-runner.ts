import { JobWakeScheduler } from './job-wakeup';

/** One bounded step per grant; waiting or exhausted work returns to the idle clock. */
export class SmartFolderBuildRunner {
  private readonly scheduler: JobWakeScheduler;
  constructor(
    acquire: (run: (allowModelRequest: boolean) => Promise<void>) => Promise<void>,
    step: (allowModelRequest: boolean) => Promise<boolean | undefined>,
    reportError: (error: unknown) => void,
  ) {
    this.scheduler = new JobWakeScheduler(async () => {
      let continueImmediately = false;
      await acquire(async (allowModelRequest) => {
        continueImmediately = (await step(allowModelRequest)) === true;
      });
      this.scheduler.scheduleAt(new Date(Date.now() + (continueImmediately ? 100 : 5000)));
    }, reportError);
  }
  wake() {
    this.scheduler.wakeNow();
  }
  stop() {
    this.scheduler.stop();
  }
}
