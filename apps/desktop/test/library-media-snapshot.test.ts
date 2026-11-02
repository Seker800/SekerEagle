import { describe, expect, it, vi } from 'vitest';
import { LibraryMediaSnapshot } from '../src/main/library-media-snapshot';
import { isLibraryReadPath } from '../src/shared/library-read';

const identity = { ownerId: 'owner', deploymentId: 'd'.repeat(64) };
const assetId = '00000000-0000-4000-8000-000000000001';
const renditionId = '00000000-0000-4000-8000-000000000002';
const media = { kind: 'RENDITION' as const, renditionKind: 'THUMBNAIL' as const, assetId, renditionId, libraryMode: 'PHOTO' as const };
const entry = { logicalBytes: 5, contentType: 'image/webp' };
const asset = (extra = {}) => ({ id: assetId, libraryMode: 'PHOTO', isPrivate: false, deletedAt: null, mediaRevision: 2, renditions: [{ id: renditionId, kind: 'THUMBNAIL', revision: 2, mimeType: 'image/webp', byteSize: 5 }], ...extra });
const changes = (revision = '1') => ({ epoch: 'epoch', scopes: Object.fromEntries(['MATERIAL','PHOTO'].map(mode => [mode, { ASSETS: revision, LABELS: '1', PEOPLE: '1' }])) });
function setup(body: unknown = { items: [asset()] }, maxEntries = 100) {
  const fetch = vi.fn(async () => Response.json(body));
  const snapshot = new LibraryMediaSnapshot({ fetch, authenticatedOwner: async () => identity, maxEntries });
  return { snapshot, fetch };
}

describe('server list authority for desktop media', () => {
  it('uses one server list request to authorize exact current public renditions in one mode', async () => {
    const { snapshot, fetch } = setup();
    expect(snapshot.allows(media, identity, entry)).toBe(false);
    const result = await snapshot.read('/api/photos/assets?limit=100');
    expect(JSON.parse(result.body).items).toHaveLength(1);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(snapshot.allows(media, identity, entry)).toBe(true);
    expect(snapshot.allows({ ...media, libraryMode: 'MATERIAL' }, identity, entry)).toBe(false);
    expect(snapshot.allows(media, { ...identity, ownerId: 'other' }, entry)).toBe(false);
    expect(snapshot.allows(media, { ...identity, deploymentId: 'e'.repeat(64) }, entry)).toBe(false);
    expect(snapshot.allows(media, identity, { ...entry, logicalBytes: 6 })).toBe(false);
    expect(snapshot.allows({ ...media, renditionKind: 'PREVIEW' }, identity, entry)).toBe(false);
  });
  it.each([{ isPrivate: true }, { isPrivate: undefined }, { deletedAt: '2026-11-02' }, { libraryMode: 'MATERIAL' }, { mediaRevision: 3 }, { renditions: [] }])('does not grant ineligible server projection %j', async extra => {
    const { snapshot } = setup({ items: [asset(extra)] });
    await snapshot.read('/api/photos/assets');
    expect(snapshot.allows(media, identity, entry)).toBe(false);
  });
  it('replaces an asset projection so a new private or empty version revokes previous renditions', async () => {
    const { snapshot, fetch } = setup();
    await snapshot.read('/api/photos/assets');
    fetch.mockResolvedValueOnce(Response.json({ items: [asset({ isPrivate: true })] }));
    await snapshot.read('/api/photos/assets');
    expect(snapshot.allows(media, identity, entry)).toBe(false);
  });
  it('retains other pages but invalidates all old evidence before passing changed server revisions to the page', async () => {
    const { snapshot, fetch } = setup();
    fetch.mockResolvedValueOnce(Response.json(changes()));
    await snapshot.read('/api/library/changes');
    await snapshot.read('/api/photos/assets');
    fetch.mockResolvedValueOnce(Response.json(changes()));
    await snapshot.read('/api/library/changes');
    expect(snapshot.allows(media, identity, entry)).toBe(true);
    fetch.mockResolvedValueOnce(Response.json(changes('2')));
    await snapshot.read('/api/library/changes');
    expect(snapshot.allows(media, identity, entry)).toBe(false);
  });
  it('rejects late list responses after reset and propagates cancellation without granting', async () => {
    const { snapshot, fetch } = setup();
    let release!: (response: Response) => void;
    fetch.mockImplementationOnce(() => new Promise(resolve => { release = resolve; }));
    const pending = snapshot.read('/api/photos/assets');
    await vi.waitFor(() => expect(release).toBeTypeOf('function'));
    snapshot.reset();
    release(Response.json({ items: [asset()] }));
    await expect(pending).rejects.toThrow(/changed/i);
    expect(snapshot.allows(media, identity, entry)).toBe(false);
    const controller = new AbortController(); controller.abort();
    await expect(snapshot.read('/api/photos/assets', controller.signal)).rejects.toThrow();
  });
  it('fails closed on failed changes checks, auth failures and malformed JSON', async () => {
    const { snapshot, fetch } = setup(); await snapshot.read('/api/photos/assets');
    fetch.mockResolvedValueOnce(new Response(null, { status: 503 }));
    await snapshot.read('/api/library/changes');
    expect(snapshot.allows(media, identity, entry)).toBe(false);
    await snapshot.read('/api/photos/assets');
    fetch.mockResolvedValueOnce(new Response('invalid', { headers: { 'content-type': 'application/json' } }));
    await expect(snapshot.read('/api/photos/assets')).rejects.toThrow();
    expect(snapshot.allows(media, identity, entry)).toBe(false);
  });
  it('revokes evidence when a later detail returns 404', async () => {
    const { snapshot, fetch } = setup(); await snapshot.read('/api/photos/assets');
    fetch.mockResolvedValueOnce(new Response(null, { status: 404 }));
    await snapshot.read(`/api/photos/assets/${assetId}`);
    expect(snapshot.allows(media, identity, entry)).toBe(false);
  });
  it('never lets an older page replace a later private projection', async () => {
    const { snapshot, fetch } = setup();
    let release!: (r: Response) => void;
    fetch.mockImplementationOnce(() => new Promise(resolve => { release = resolve; }));
    const older = snapshot.read('/api/photos/assets');
    await vi.waitFor(() => expect(release).toBeTypeOf('function'));
    fetch.mockResolvedValueOnce(Response.json({ items: [asset({ isPrivate: true })] }));
    await snapshot.read('/api/photos/assets');
    release(Response.json({ items: [asset()] })); await older;
    expect(snapshot.allows(media, identity, entry)).toBe(false);
  });

  it('bounds ephemeral proof memory by eviction and falls back without limiting library size', async () => {
    const { snapshot } = setup({ items: [asset(), asset({ id: '00000000-0000-4000-8000-000000000003' })] }, 1);
    await snapshot.read('/api/photos/assets');
    expect(snapshot.allows(media, identity, entry)).toBe(false);
  });
  it('allows only exact relative read routes and refuses originals, arbitrary URLs and encoded traversal', async () => {
    const { snapshot, fetch } = setup();
    for (const path of ['https://evil.invalid/api/photos/assets','//evil/api/photos/assets','/api/photos/assets/../assets','/api/photos/assets/%2e%2e','/api/photos/assets?x=1#fragment',`/api/photos/assets/${assetId}/original`]) {
      expect(isLibraryReadPath(path)).toBe(false);
      await expect(snapshot.read(path)).rejects.toThrow();
    }
    expect(fetch).not.toHaveBeenCalled();
  });
});
