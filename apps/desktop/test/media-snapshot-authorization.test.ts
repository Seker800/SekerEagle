import { describe, expect, it, vi } from 'vitest';
import { MediaSnapshotAuthorization } from '../src/main/media-snapshot-authorization';
import { isLibraryReadPath } from '../src/shared/library-read';

const identity = { ownerId: 'owner', deploymentId: 'd'.repeat(64) };
const assetId = '00000000-0000-4000-8000-000000000001';
const renditionId = '00000000-0000-4000-8000-000000000002';
const media = {
  kind: 'RENDITION' as const,
  renditionKind: 'THUMBNAIL' as const,
  assetId,
  renditionId,
  libraryMode: 'PHOTO' as const,
};
const entry = { logicalBytes: 5, contentType: 'image/webp' };
const pyramidId = '00000000-0000-4000-8000-00000000000a';
const otherPyramidId = '00000000-0000-4000-8000-00000000000b';
const tileMedia = {
  kind: 'TILE' as const,
  assetId,
  pyramidId,
  level: 0,
  x: 0,
  y: 0,
  libraryMode: 'PHOTO' as const,
};
const tileEntry = { logicalBytes: 12, contentType: 'image/webp' };
const pyramid = {
  id: pyramidId,
  revision: 2,
  width: 512,
  height: 512,
  tileSize: 256,
  overlap: 0,
  format: 'webp',
  maxLevel: 1,
  tileUrlTemplate: `/api/photos/assets/${assetId}/pyramids/${pyramidId}/tiles/{level}/{x}/{y}`,
};
const asset = (extra = {}) => ({
  id: assetId,
  libraryMode: 'PHOTO',
  isPrivate: false,
  deletedAt: null,
  mediaRevision: 2,
  renditions: [
    { id: renditionId, kind: 'THUMBNAIL', revision: 2, mimeType: 'image/webp', byteSize: 5 },
  ],
  ...extra,
});
const changes = (revision = '1') => ({
  epoch: 'epoch',
  scopes: Object.fromEntries(
    ['MATERIAL', 'PHOTO'].map((mode) => [mode, { ASSETS: revision, LABELS: '1', PEOPLE: '1' }]),
  ),
});
function setup(body: unknown = { items: [asset()] }, maxEntries = 100) {
  const fetch = vi.fn(async (_path: string, _init: RequestInit) => Response.json(body));
  const snapshot = new MediaSnapshotAuthorization({
    fetch,
    authenticatedOwner: async () => identity,
    maxEntries,
  });
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
    expect(snapshot.allows(media, { ...identity, deploymentId: 'e'.repeat(64) }, entry)).toBe(
      false,
    );
    expect(snapshot.allows(media, identity, { ...entry, logicalBytes: 6 })).toBe(false);
    expect(snapshot.allows({ ...media, renditionKind: 'PREVIEW' }, identity, entry)).toBe(false);
  });
  it.each([
    { isPrivate: true },
    { isPrivate: undefined },
    { deletedAt: '2026-11-02' },
    { libraryMode: 'MATERIAL' },
    { mediaRevision: 3 },
    { renditions: [] },
  ])('does not grant ineligible server projection %j', async (extra) => {
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
    fetch.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );
    const pending = snapshot.read('/api/photos/assets');
    await vi.waitFor(() => expect(release).toBeTypeOf('function'));
    snapshot.reset();
    release(Response.json({ items: [asset()] }));
    await expect(pending).rejects.toThrow(/changed/i);
    expect(snapshot.allows(media, identity, entry)).toBe(false);
    const controller = new AbortController();
    controller.abort();
    await expect(snapshot.read('/api/photos/assets', controller.signal)).rejects.toThrow();
  });
  it('fails closed on failed changes checks, auth failures and malformed JSON', async () => {
    const { snapshot, fetch } = setup();
    await snapshot.read('/api/photos/assets');
    fetch.mockResolvedValueOnce(new Response(null, { status: 503 }));
    await snapshot.read('/api/library/changes');
    expect(snapshot.allows(media, identity, entry)).toBe(false);
    await snapshot.read('/api/photos/assets');
    fetch.mockResolvedValueOnce(
      new Response('invalid', { headers: { 'content-type': 'application/json' } }),
    );
    await expect(snapshot.read('/api/photos/assets')).rejects.toThrow();
    expect(snapshot.allows(media, identity, entry)).toBe(false);
  });
  it('revokes evidence when a later detail returns 404', async () => {
    const { snapshot, fetch } = setup();
    await snapshot.read('/api/photos/assets');
    fetch.mockResolvedValueOnce(new Response(null, { status: 404 }));
    await snapshot.read(`/api/photos/assets/${assetId}`);
    expect(snapshot.allows(media, identity, entry)).toBe(false);
  });
  it('never lets an older page replace a later private projection', async () => {
    const { snapshot, fetch } = setup();
    let release!: (r: Response) => void;
    fetch.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );
    const older = snapshot.read('/api/photos/assets');
    await vi.waitFor(() => expect(release).toBeTypeOf('function'));
    fetch.mockResolvedValueOnce(Response.json({ items: [asset({ isPrivate: true })] }));
    await snapshot.read('/api/photos/assets');
    release(Response.json({ items: [asset()] }));
    await older;
    expect(snapshot.allows(media, identity, entry)).toBe(false);
  });

  it('distinguishes a known denial from missing evidence', async () => {
    const { snapshot, fetch } = setup({}, 100);
    expect(snapshot.denies(media, identity, entry)).toBe(false);
    expect(snapshot.denies(tileMedia, identity, tileEntry)).toBe(false);
    fetch.mockResolvedValueOnce(Response.json({ items: [asset({ isPrivate: true })] }));
    await snapshot.read('/api/photos/assets');
    expect(snapshot.allows(media, identity, entry)).toBe(false);
    expect(snapshot.denies(media, identity, entry)).toBe(true);
    expect(snapshot.denies(tileMedia, identity, tileEntry)).toBe(true);
    fetch.mockResolvedValueOnce(Response.json({ items: [asset()] }));
    await snapshot.read('/api/photos/assets');
    expect(snapshot.denies(media, identity, entry)).toBe(false);
  });

  it('drops old evidence when a changes check is cancelled or times out', async () => {
    const { snapshot, fetch } = setup();
    await snapshot.read('/api/photos/assets');
    fetch.mockImplementationOnce(
      (_path, init) =>
        new Promise((_resolve, reject) => {
          init.signal?.addEventListener('abort', () => reject(new Error('check aborted')), {
            once: true,
          });
        }),
    );
    const controller = new AbortController();
    const pending = snapshot.read('/api/library/changes', controller.signal);
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
    controller.abort();
    await expect(pending).rejects.toThrow();
    expect(snapshot.allows(media, identity, entry)).toBe(false);
  });

  it('bounds ephemeral proof memory by eviction and falls back without limiting library size', async () => {
    const { snapshot } = setup(
      { items: [asset(), asset({ id: '00000000-0000-4000-8000-000000000003' })] },
      1,
    );
    await snapshot.read('/api/photos/assets');
    expect(snapshot.allows(media, identity, entry)).toBe(false);
  });
  it('authorizes tiles only after a real pyramid descriptor read for the same asset, mode and revision', async () => {
    const { snapshot, fetch } = setup({}, 100);
    expect(isLibraryReadPath(`/api/photos/assets/${assetId}/pyramid`)).toBe(true);
    expect(snapshot.allows(tileMedia, identity, tileEntry)).toBe(false);
    fetch.mockResolvedValueOnce(Response.json(pyramid));
    await snapshot.read(`/api/photos/assets/${assetId}/pyramid`);
    expect(snapshot.allows(tileMedia, identity, tileEntry)).toBe(true);
    expect(snapshot.allows({ ...tileMedia, pyramidId: otherPyramidId }, identity, tileEntry)).toBe(
      false,
    );
    expect(snapshot.allows({ ...tileMedia, libraryMode: 'MATERIAL' }, identity, tileEntry)).toBe(
      false,
    );
    expect(snapshot.allows(tileMedia, { ...identity, ownerId: 'other' }, tileEntry)).toBe(false);
    expect(snapshot.allows(tileMedia, identity, { ...tileEntry, contentType: 'image/png' })).toBe(
      false,
    );
    expect(snapshot.allows(tileMedia, identity, { ...tileEntry, logicalBytes: 0 })).toBe(false);
  });
  it.each([{ mediaRevision: 3 }, { isPrivate: true }, { deletedAt: '2026-11-02' }])(
    'drops tile authority when a later list changes the asset projection %j',
    async (extra) => {
      const { snapshot, fetch } = setup({}, 100);
      fetch.mockResolvedValueOnce(Response.json(pyramid));
      await snapshot.read(`/api/photos/assets/${assetId}/pyramid`);
      expect(snapshot.allows(tileMedia, identity, tileEntry)).toBe(true);
      fetch.mockResolvedValueOnce(Response.json({ items: [asset(extra)] }));
      await snapshot.read('/api/photos/assets');
      expect(snapshot.allows(tileMedia, identity, tileEntry)).toBe(false);
    },
  );
  it('clears tile authority when the server change revision advances', async () => {
    const { snapshot, fetch } = setup({}, 100);
    fetch.mockResolvedValueOnce(Response.json(changes()));
    await snapshot.read('/api/library/changes');
    fetch.mockResolvedValueOnce(Response.json(pyramid));
    await snapshot.read(`/api/photos/assets/${assetId}/pyramid`);
    expect(snapshot.allows(tileMedia, identity, tileEntry)).toBe(true);
    fetch.mockResolvedValueOnce(Response.json(changes('2')));
    await snapshot.read('/api/library/changes');
    expect(snapshot.allows(tileMedia, identity, tileEntry)).toBe(false);
  });
  it.each([
    { id: 'not-a-uuid', revision: 2 },
    { id: pyramidId, revision: '2' },
    { id: pyramidId, revision: -1 },
    { revision: 2 },
    {},
  ])('fails closed on malformed pyramid descriptor %j', async (body) => {
    const { snapshot, fetch } = setup({}, 100);
    fetch.mockResolvedValueOnce(Response.json(body));
    await snapshot.read(`/api/photos/assets/${assetId}/pyramid`);
    expect(snapshot.allows(tileMedia, identity, tileEntry)).toBe(false);
  });
  it('fails closed when the pyramid descriptor read is rejected', async () => {
    const { snapshot, fetch } = setup({}, 100);
    fetch.mockResolvedValueOnce(new Response(null, { status: 404 }));
    await snapshot.read(`/api/photos/assets/${assetId}/pyramid`);
    expect(snapshot.allows(tileMedia, identity, tileEntry)).toBe(false);
  });
  it('never lets an older list response revoke a newer pyramid descriptor', async () => {
    const { snapshot, fetch } = setup({}, 100);
    let releaseList!: (response: Response) => void;
    fetch.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          releaseList = resolve;
        }),
    );
    const olderList = snapshot.read('/api/photos/assets');
    await vi.waitFor(() => expect(releaseList).toBeTypeOf('function'));
    fetch.mockResolvedValueOnce(Response.json(pyramid));
    await snapshot.read(`/api/photos/assets/${assetId}/pyramid`);
    expect(snapshot.allows(tileMedia, identity, tileEntry)).toBe(true);
    releaseList(Response.json({ items: [asset({ mediaRevision: 3 })] }));
    await olderList;
    expect(snapshot.allows(tileMedia, identity, tileEntry)).toBe(true);
  });
  it('allows only exact relative read routes and refuses originals, arbitrary URLs and encoded traversal', async () => {
    const { snapshot, fetch } = setup();
    for (const path of [
      'https://evil.invalid/api/photos/assets',
      '//evil/api/photos/assets',
      '/api/photos/assets/../assets',
      '/api/photos/assets/%2e%2e',
      '/api/photos/assets?x=1#fragment',
      `/api/photos/assets/${assetId}/original`,
      `/api/photos/assets/${assetId}/pyramid/original`,
      `/api/photos/assets/${assetId}/pyramid/../${assetId}`,
    ]) {
      expect(isLibraryReadPath(path)).toBe(false);
      await expect(snapshot.read(path)).rejects.toThrow();
    }
    expect(fetch).not.toHaveBeenCalled();
  });
});
