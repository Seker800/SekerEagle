const OWNER_LEASE_MS = 60_000;

export class AuthenticatedOwner {
  private readonly fetchMe: () => Promise<Response>;
  private readonly now: () => number;
  private cached: { identity: AuthenticatedIdentity; validUntil: number } | null = null;
  private inFlight: Promise<AuthenticatedIdentity | null> | null = null;

  constructor(fetchMe: () => Promise<Response>, now: () => number = Date.now) {
    this.fetchMe = fetchMe;
    this.now = now;
  }

  async get(): Promise<AuthenticatedIdentity | null> {
    const now = this.now();
    if (this.cached && this.cached.validUntil >= now) return this.cached.identity;
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

  private async refresh(): Promise<AuthenticatedIdentity | null> {
    try {
      const response = await this.fetchMe();
      if (!response.ok) {
        this.cached = null;
        return null;
      }
      const body = await response.json();
      const identity = readIdentity(body);
      if (!identity) {
        this.cached = null;
        return null;
      }
      this.cached = { identity, validUntil: this.now() + OWNER_LEASE_MS };
      return identity;
    } catch {
      this.cached = null;
      return null;
    }
  }
}

export interface AuthenticatedIdentity {
  ownerId: string;
  deploymentId: string;
}

function readIdentity(value: unknown): AuthenticatedIdentity | null {
  if (!value || typeof value !== 'object') return null;
  const user = (value as { user?: unknown }).user;
  if (!user || typeof user !== 'object') return null;
  const id = (user as { id?: unknown }).id;
  const desktopCache = (value as { desktopCache?: unknown }).desktopCache;
  const deploymentId =
    desktopCache && typeof desktopCache === 'object'
      ? (desktopCache as { deploymentId?: unknown }).deploymentId
      : null;
  return typeof id === 'string' &&
    id.length > 0 &&
    id.length <= 256 &&
    typeof deploymentId === 'string' &&
    /^[0-9a-f]{64}$/u.test(deploymentId)
    ? { ownerId: id, deploymentId }
    : null;
}
