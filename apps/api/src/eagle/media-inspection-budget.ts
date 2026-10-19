import { ServiceUnavailableException } from '@nestjs/common';

// Shared by both library-mode providers: at most one inspection process-wide.
export class MediaInspectionBudget {
  private active = false;
  private readonly queue: Array<() => void> = [];
  private readonly owners = new Map<string, number>();
  async run<T>(owner: string, work: () => Promise<T>): Promise<T> {
    if (this.queue.length >= 32 || (this.owners.get(owner) ?? 0) >= 4)
      throw new ServiceUnavailableException('媒体检查繁忙，请稍后重试。');
    this.owners.set(owner, (this.owners.get(owner) ?? 0) + 1);
    if (this.active) await new Promise<void>((resolve) => this.queue.push(resolve));
    this.active = true;
    try {
      return await work();
    } finally {
      const count = this.owners.get(owner)! - 1;
      if (count) this.owners.set(owner, count);
      else this.owners.delete(owner);
      const next = this.queue.shift();
      if (next) next();
      else this.active = false;
    }
  }
}
export const mediaInspectionBudget = new MediaInspectionBudget();
