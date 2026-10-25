export type MediaResource = 'NAS' | 'EMBEDDING';

/** Independent bounded execution slots over the existing durable, lease-fenced job queue. */
export class MediaResourcePool {
  private readonly occupied: Record<MediaResource, number> = { NAS: 0, EMBEDDING: 0 };
  constructor(
    private readonly nasConcurrency: number,
    private readonly wake: () => void,
    private readonly reportError: (error: unknown) => void,
  ) {}
  get activeCount() {
    return this.occupied.NAS + this.occupied.EMBEDDING;
  }
  active(resource: MediaResource) {
    return this.occupied[resource];
  }

  async fill<T>(
    resource: MediaResource,
    claim: () => Promise<T | null>,
    run: (job: T) => Promise<void>,
  ): Promise<void> {
    // Reserve before awaiting the claim; concurrent wake-ups cannot overfill either resource.
    const limit = resource === 'NAS' ? this.nasConcurrency : 1;
    const slots = limit - this.occupied[resource];
    for (let i = 0; i < slots; i++) {
      if (this.occupied[resource] >= limit) return;
      this.occupied[resource]++;
      let job: T | null;
      try {
        job = await claim();
      } catch (error) {
        this.occupied[resource]--;
        throw error;
      }
      if (job === null) {
        this.occupied[resource]--;
        return;
      }
      void Promise.resolve()
        .then(() => run(job))
        .catch(this.reportError)
        .finally(() => {
          this.occupied[resource]--;
          this.wake();
        });
    }
  }
}
