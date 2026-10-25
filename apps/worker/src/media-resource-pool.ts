export type MediaResource = 'NAS' | 'EMBEDDING';

/** Independent bounded execution slots over the existing durable, lease-fenced job queue. */
export class MediaResourcePool {
  private readonly occupied: Record<MediaResource, number> = { NAS: 0, EMBEDDING: 0 };
  private readonly claiming: Record<MediaResource, number> = { NAS: 0, EMBEDDING: 0 };
  private readonly pendingWake: Record<MediaResource, boolean> = { NAS: false, EMBEDDING: false };
  constructor(
    private readonly nasConcurrency: number,
    private readonly wake: () => void,
    private readonly reportError: (error: unknown) => void,
    private readonly embeddingConcurrency = 1,
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
    const limit =
      resource === 'NAS'
        ? this.nasConcurrency
        : Math.min(2, Math.max(1, this.embeddingConcurrency));
    const slots = limit - this.occupied[resource];
    if (slots <= 0 && this.claiming[resource] > 0) this.pendingWake[resource] = true;
    for (let i = 0; i < slots; i++) {
      if (this.occupied[resource] >= limit) return;
      this.occupied[resource]++;
      this.claiming[resource]++;
      let job: T | null;
      try {
        job = await claim();
      } catch (error) {
        this.releaseEmptyClaim(resource);
        throw error;
      }
      if (job === null) {
        this.releaseEmptyClaim(resource);
        return;
      }
      this.claiming[resource]--;
      this.pendingWake[resource] = false;
      void Promise.resolve()
        .then(() => run(job))
        .catch(this.reportError)
        .finally(() => {
          this.occupied[resource]--;
          this.wake();
        });
    }
  }
  private releaseEmptyClaim(resource: MediaResource) {
    this.claiming[resource]--;
    this.occupied[resource]--;
    if (this.pendingWake[resource]) {
      this.pendingWake[resource] = false;
      this.wake();
    }
  }
}
