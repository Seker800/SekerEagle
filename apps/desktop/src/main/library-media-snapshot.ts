import type { AuthenticatedIdentity } from './authenticated-owner';
import type { DesktopMediaIdentity } from '../shared/media-identity';
import { isLibraryReadPath, type LibraryReadResponse } from '../shared/library-read';

type Rendition = { kind: string; bytes: number; contentType: string };
type Projection = { sequence: number; renditions: Map<string, Rendition> };
type CachedFile = { logicalBytes: number; contentType: string };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const record = (value: unknown): Record<string, unknown> | null =>
  value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown> : null;

/** Transient evidence from real authenticated server reads, never renderer-provided DTOs.
 * Same freshness as the list, no per-file timer or persisted authorization lease. */
export class LibraryMediaSnapshot {
  private generation = 0;
  private sequence = 0;
  private changes: string | null = null;
  private readonly assets = new Map<string, Projection>();
  private readonly maxEntries: number;
  constructor(private readonly options: {
    fetch: (path: string, init: RequestInit) => Promise<Response>;
    authenticatedOwner: () => Promise<AuthenticatedIdentity | null>;
    maxEntries?: number;
  }) {
    const budget = options.maxEntries ?? 12_000;
    if (!Number.isSafeInteger(budget) || budget < 1) throw new Error('Invalid media snapshot budget');
    this.maxEntries = budget;
  }

  reset(): void {
    this.generation++;
    this.assets.clear();
    this.changes = null;
  }

  invalidateAsset(assetId: string): void {
    // Fence all in-flight reads; otherwise an older list could re-grant the asset.
    this.generation++;
    for (const key of this.assets.keys()) if (key.endsWith(`\n${assetId}`)) this.assets.delete(key);
  }

  allows(media: DesktopMediaIdentity, identity: AuthenticatedIdentity, file: CachedFile): boolean {
    if (media.kind !== 'RENDITION') return false;
    const key = this.key(identity, media.libraryMode ?? 'MATERIAL', media.assetId);
    const projection = this.assets.get(key);
    const rendition = projection?.renditions.get(media.renditionId);
    if (!rendition || rendition.kind !== media.renditionKind || rendition.bytes !== file.logicalBytes || rendition.contentType !== file.contentType) return false;
    this.assets.delete(key);
    this.assets.set(key, projection!);
    return true;
  }

  async read(path: string, signal?: AbortSignal): Promise<LibraryReadResponse> {
    if (!isLibraryReadPath(path)) throw new Error('Unsupported library read');
    signal?.throwIfAborted();
    const generation = this.generation;
    const sequence = ++this.sequence;
    try {
      const identity = await this.options.authenticatedOwner();
      if (!identity) { this.reset(); return { status: 401, body: '', contentType: 'application/json' }; }
      const response = await this.options.fetch(path, { signal, credentials: 'include', redirect: 'error', headers: { accept: 'application/json', 'cache-control': 'no-store' } });
      const body = await response.text();
      signal?.throwIfAborted();
      if (generation !== this.generation) throw new Error('Library snapshot changed during read');
      const contentType = response.headers.get('content-type') ?? 'application/json';
      if (response.ok) {
        const value: unknown = JSON.parse(body);
        if (path.split('?', 1)[0] === '/api/library/changes') this.observeChanges(value);
        else this.observeAssets(path, value, identity, sequence);
      } else this.reset();
      return { status: response.status, body, contentType };
    } catch (error) {
      if (!signal?.aborted && generation === this.generation) this.reset();
      throw error;
    }
  }

  private observeChanges(value: unknown): void {
    const body = record(value), scopes = record(body?.scopes);
    const revisions: unknown[] = [body?.epoch];
    if (typeof body?.epoch !== 'string') { this.reset(); return; }
    for (const mode of ['MATERIAL', 'PHOTO']) {
      const scope = record(scopes?.[mode]);
      for (const kind of ['ASSETS', 'LABELS', 'PEOPLE']) {
        if (typeof scope?.[kind] !== 'string') { this.reset(); return; }
        revisions.push(scope[kind]);
      }
    }
    const next = JSON.stringify(revisions);
    if (next !== this.changes) { this.generation++; this.assets.clear(); }
    this.changes = next;
  }

  private observeAssets(path: string, value: unknown, identity: AuthenticatedIdentity, sequence: number): void {
    const mode = path.startsWith('/api/photos/') ? 'PHOTO' : 'MATERIAL';
    const body = record(value);
    if (!body) { this.reset(); return; }
    const items = Array.isArray(body.items) ? body.items : [body];
    const covers = Array.isArray(body.photoStacks) ? body.photoStacks.map(stack => record(stack)?.cover) : [];
    for (const value of [...items, ...covers]) {
      const asset = record(value);
      if (typeof asset?.id !== 'string' || !UUID.test(asset.id)) continue;
      const key = this.key(identity, mode, asset.id);
      if ((this.assets.get(key)?.sequence ?? 0) > sequence) continue;
      const renditions = new Map<string, Rendition>();
      if (asset.isPrivate === false && asset.deletedAt === null && asset.libraryMode === mode && Number.isSafeInteger(asset.mediaRevision) && Array.isArray(asset.renditions)) {
        for (const value of asset.renditions) {
          const r = record(value);
          if (typeof r?.id === 'string' && UUID.test(r.id) && ['THUMBNAIL', 'PREVIEW', 'POSTER'].includes(String(r.kind)) && r.revision === asset.mediaRevision && r.mimeType === 'image/webp' && Number.isSafeInteger(r.byteSize) && Number(r.byteSize) > 0)
            renditions.set(r.id, { kind: String(r.kind), bytes: Number(r.byteSize), contentType: 'image/webp' });
        }
      }
      this.assets.delete(key);
      this.assets.set(key, { sequence, renditions });
      while (this.assets.size > this.maxEntries) this.assets.delete(this.assets.keys().next().value!);
    }
  }
  private key(identity: AuthenticatedIdentity, mode: string, assetId: string): string {
    return `${identity.deploymentId}\n${identity.ownerId}\n${mode}\n${assetId}`;
  }
}
