const OWNER_LEASE_MS = 60_000;

export class AuthenticatedOwner {
  private readonly fetchMe: () => Promise<Response>;
  private readonly now: () => number;
  private cached: { ownerId: string; validUntil: number } | null = null;
  private inFlight: Promise<string | null> | null = null;

  constructor(fetchMe: () => Promise<Response>, now: () => number = Date.now) {
    this.fetchMe = fetchMe;
    this.now = now;
  }

  async get(): Promise<string | null> {
    const now = this.now();
    if (this.cached && this.cached.validUntil >= now) return this.cached.ownerId;
    if (this.inFlight) return this.inFlight;
    this.inFlight = this.refresh();
    try {
      return await this.inFlight;
    } finally {
      this.inFlight = null;
    }
  }

  invalidate(): void {
    this.cached = null;
  }

  private async refresh(): Promise<string | null> {
    try {
      const response = await this.fetchMe();
      if (!response.ok) {
        this.cached = null;
        return null;
      }
      const body = await response.json();
      const ownerId = readOwnerId(body);
      if (!ownerId) {
        this.cached = null;
        return null;
      }
      this.cached = { ownerId, validUntil: this.now() + OWNER_LEASE_MS };
      return ownerId;
    } catch {
      this.cached = null;
      return null;
    }
  }
}

function readOwnerId(value: unknown): string | null {
  if (!value || typeof value !== 'object') return null;
  const user = (value as { user?: unknown }).user;
  if (!user || typeof user !== 'object') return null;
  const id = (user as { id?: unknown }).id;
  return typeof id === 'string' && id.length > 0 && id.length <= 256 ? id : null;
}
