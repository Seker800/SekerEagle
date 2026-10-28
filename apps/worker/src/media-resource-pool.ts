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
  private maintaining = false;
  private maintenanceUsesEmbedding = false;
  private memoryUsedMiB = 0;
  private readonly memoryWaits = new Map<MediaResource, { cost: number; readyAt: number }>();
  private readonly deferredUntil: Record<MediaResource, number> = {
    NAS: 0,
    EMBEDDING: 0,
    REMOTE_MEDIA: 0,
  };
  private readonly deferTimers: Partial<Record<MediaResource, NodeJS.Timeout>> = {};
  defer(resource: MediaResource, delayMs: number, preserveMemoryWait = false) {
    if (!preserveMemoryWait && this.memoryWaits.delete(resource)) this.wake();
    const delay = Number.isFinite(delayMs) ? Math.min(30000, Math.max(1, delayMs)) : 1000;
    this.deferredUntil[resource] = Math.max(this.deferredUntil[resource], Date.now() + delay);
    clearTimeout(this.deferTimers[resource]);
    const timer = setTimeout(() => this.wake(), this.deferredUntil[resource] - Date.now());
    timer.unref();
    this.deferTimers[resource] = timer;
  }
  constructor(
    private readonly nasConcurrency: number,
    private readonly wake: () => void,
    private readonly reportError: (error: unknown) => void,
    private embeddingConcurrency = 1,
    private readonly memoryLimitMiB = Infinity,
  ) {}
  setRemoteMediaLimit(limit: number) {
    if (!Number.isSafeInteger(limit) || limit < 0 || limit > 16)
      throw new Error('INVALID_REMOTE_MEDIA_CAPACITY');
    const grew = limit > this.remoteMediaConcurrency;
    this.remoteMediaConcurrency = limit;
    if (limit === 0 && this.memoryWaits.delete('REMOTE_MEDIA')) this.wake();
    if (grew) this.wake();
  }
  setEmbeddingLimit(limit: number) {
    if (!Number.isSafeInteger(limit) || limit < 0 || limit > 32)
      throw new Error('INVALID_EMBEDDING_CAPACITY');
    const grew = limit > this.embeddingConcurrency;
    this.embeddingConcurrency = limit;
    if (limit === 0 && this.memoryWaits.delete('EMBEDDING')) this.wake();
    if (grew) this.wake();
  }
  get activeCount() {
    return (
      this.occupied.NAS +
      this.occupied.EMBEDDING +
      this.occupied.REMOTE_MEDIA +
      Number(this.maintaining && !this.maintenanceUsesEmbedding)
    );
  }
  active(resource: MediaResource) {
    return this.occupied[resource];
  }

  /** Cached-vector maintenance remains available when every model is drained. */
  async maintenance(run: (allowModelRequest: boolean) => Promise<void>) {
    const cost = 128;
    if (
      this.maintaining ||
      this.memoryWaits.size ||
      this.memoryUsedMiB + cost > this.memoryLimitMiB
    )
      return;
    const modelSlot =
      Date.now() >= this.deferredUntil.EMBEDDING &&
      this.occupied.EMBEDDING < this.embeddingConcurrency;
    this.maintaining = true;
    this.maintenanceUsesEmbedding = modelSlot;
    if (modelSlot) this.occupied.EMBEDDING++;
    this.memoryUsedMiB += cost;
    try {
      await run(modelSlot);
    } finally {
      if (modelSlot) this.occupied.EMBEDDING--;
      this.maintenanceUsesEmbedding = false;
      this.maintaining = false;
      this.memoryUsedMiB -= cost;
      this.wake();
    }
  }

  async fill<T>(
    resource: MediaResource,
    claim: () => Promise<T | null>,
    run: (job: T) => Promise<void>,
    budget?: { memoryMiB: (job: T) => number; onMemoryWait: (job: T) => Promise<void> },
  ): Promise<void> {
    if (Date.now() < this.deferredUntil[resource] || this.memoryUsedMiB >= this.memoryLimitMiB)
      return;
    const waiting = this.memoryWaits.entries().next().value;
    if (
      waiting &&
      (waiting[0] !== resource ||
        Date.now() < waiting[1].readyAt ||
        waiting[1].cost > this.memoryLimitMiB - this.memoryUsedMiB)
    )
      return;
    // Reserve before awaiting the claim; concurrent wake-ups cannot overfill either resource.
    const limit =
      resource === 'NAS'
        ? this.nasConcurrency
        : resource === 'REMOTE_MEDIA'
          ? this.remoteMediaConcurrency
          : Math.min(32, Math.max(0, this.embeddingConcurrency));
    const slots = limit - this.occupied[resource];
    if (slots <= 0 && this.claiming[resource] > 0) this.pendingWake[resource] = true;
    const claimOne = async (): Promise<boolean> => {
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
        if (this.memoryWaits.delete(resource)) this.wake();
        this.releaseEmptyClaim(resource);
        return false;
      }
      const memory = budget?.memoryMiB(job) ?? 0;
      if (!Number.isFinite(memory) || memory < 0) {
        this.releaseEmptyClaim(resource);
        throw new Error('INVALID_MEMORY_RESERVATION');
      }
      if (memory > this.memoryLimitMiB - this.memoryUsedMiB) {
        this.memoryWaits.set(resource, { cost: memory, readyAt: Date.now() + 1000 });
        try {
          await budget?.onMemoryWait(job);
        } finally {
          this.releaseEmptyClaim(resource);
          this.defer(resource, 1000, true);
        }
        return false;
      }
      this.memoryWaits.delete(resource);
      this.memoryUsedMiB += memory;
      this.claiming[resource]--;
      this.pendingWake[resource] = false;
      void Promise.resolve()
        .then(() => run(job))
        .catch(this.reportError)
        .finally(() => {
          this.memoryUsedMiB -= memory;
          this.occupied[resource]--;
          this.wake();
        });
      return true;
    };
    if (resource === 'REMOTE_MEDIA') {
      // Each slot is reserved synchronously before awaiting its database claim.
      // Ready siblings may compute while another claim is waiting on IO.
      await Promise.all(
        Array.from({ length: slots }, () =>
          this.occupied[resource] < limit ? claimOne() : Promise.resolve(false),
        ),
      );
      return;
    }
    for (let i = 0; i < slots; i++) {
      if (this.occupied[resource] >= limit || !(await claimOne())) return;
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
