export type MediaResource = 'NAS' | 'EMBEDDING' | 'REMOTE_MEDIA';

/** Independent bounded execution slots over the existing durable, lease-fenced job queue. */
export class MediaResourcePool {
  private readonly occupied: Record<MediaResource, number> = {
    NAS: 0,
    EMBEDDING: 0,
    REMOTE_MEDIA: 0,
  };
  private readonly claiming: Record<MediaResource, number> = {
    NAS: 0,
    EMBEDDING: 0,
    REMOTE_MEDIA: 0,
  };
  private readonly pendingWake: Record<MediaResource, boolean> = {
    NAS: false,
    EMBEDDING: false,
    REMOTE_MEDIA: false,
  };
  private remoteMediaConcurrency = 0;
  constructor(
    private readonly nasConcurrency: number,
    private readonly wake: () => void,
    private readonly reportError: (error: unknown) => void,
    private embeddingConcurrency = 1,
  ) {}
  setRemoteMediaLimit(limit: number) {
    if (!Number.isSafeInteger(limit) || limit < 0 || limit > 16)
      throw new Error('INVALID_REMOTE_MEDIA_CAPACITY');
    const grew = limit > this.remoteMediaConcurrency;
    this.remoteMediaConcurrency = limit;
    if (grew) this.wake();
  }
  setEmbeddingLimit(limit: number) {
    if (!Number.isSafeInteger(limit) || limit < 0 || limit > 32)
      throw new Error('INVALID_EMBEDDING_CAPACITY');
    const grew = limit > this.embeddingConcurrency;
    this.embeddingConcurrency = limit;
    if (grew) this.wake();
  }
  get activeCount() {
    return this.occupied.NAS + this.occupied.EMBEDDING + this.occupied.REMOTE_MEDIA;
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
        : resource === 'REMOTE_MEDIA'
          ? this.remoteMediaConcurrency
          : Math.min(32, Math.max(0, this.embeddingConcurrency));
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
