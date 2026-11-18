import { describe, expect, it } from 'vitest';
import {
  buildCacheIdentity,
  buildNamespaceId,
  createDesktopMediaUrl,
  hashCacheIdentity,
  parseDesktopMediaUrl,
} from '../src/shared/media-identity';

const assetId = '00000000-0000-4000-8000-000000000001';
const renditionId = '00000000-0000-4000-8000-000000000002';
const pyramidId = '00000000-0000-4000-8000-000000000003';
const deploymentId = 'd'.repeat(64);

describe('desktop media identity', () => {
  it('accepts only immutable rendition and bounded tile identities', () => {
    expect(
      parseDesktopMediaUrl(`sekereagle-media://rendition/thumbnail/${assetId}/${renditionId}`),
    ).toEqual({ kind: 'RENDITION', renditionKind: 'THUMBNAIL', assetId, renditionId });
    expect(parseDesktopMediaUrl(`sekereagle-media://tile/${assetId}/${pyramidId}/13/4/2`)).toEqual({
      kind: 'TILE',
      assetId,
      pyramidId,
      level: 13,
      x: 4,
      y: 2,
    });
  });

  it('creates only canonical custom-scheme URLs for the preload bridge', () => {
    expect(
      createDesktopMediaUrl({ kind: 'RENDITION', renditionKind: 'PREVIEW', assetId, renditionId }),
    ).toBe(`sekereagle-media://rendition/preview/${assetId}/${renditionId}`);
    expect(createDesktopMediaUrl({ kind: 'TILE', assetId, pyramidId, level: 13, x: 4, y: 2 })).toBe(
      `sekereagle-media://tile/${assetId}/${pyramidId}/13/4/2`,
    );
  });

  it.each([
    `sekereagle-media://original/${assetId}`,
    `sekereagle-media://rendition/unknown/${assetId}/${renditionId}`,
    'sekereagle-media://rendition/not-a-uuid/not-a-uuid',
    `sekereagle-media://tile/${assetId}/${pyramidId}/-1/0/0`,
    `sekereagle-media://tile/${assetId}/${pyramidId}/1/0/0/extra`,
    'https://attacker.example/image.webp',
    'sekereagle-media://rendition/../../etc/passwd',
  ])('rejects an untrusted media target: %s', (url) => {
    expect(() => parseDesktopMediaUrl(url)).toThrow();
  });

  it('locks the v3 cache scope so long-lived caches survive ordinary upgrades', () => {
    // Changing these values invalidates every existing cache; add a migration path first.
    expect(buildNamespaceId('owner-a', deploymentId, 'MATERIAL')).toBe(
      'ffb862c83b19e04768800e2fbc4d21234537847d32265f8f5fa8a8b585b85956',
    );
    expect(buildNamespaceId('owner-a', deploymentId, 'PHOTO')).toBe(
      '4d52a5d2c79b02350d67f137cff8015212ca2c7bab08605d71c019fe9aaa9cb2',
    );
    const media = parseDesktopMediaUrl(
      `sekereagle-media://rendition/thumbnail/${assetId}/${renditionId}`,
    );
    expect(
      hashCacheIdentity(buildCacheIdentity('owner-a', deploymentId, media)).toString('hex'),
    ).toBe('e36f311caf37a59dd197a1dba09f52c5566e4eb0c1d7cd2a6e55743cf98bb29d');
  });

  it('keys cache identity by library, owner and media without the connection origin', () => {
    const media = parseDesktopMediaUrl(
      `sekereagle-media://rendition/thumbnail/${assetId}/${renditionId}`,
    );
    const first = buildCacheIdentity('owner-a', deploymentId, media);
    const otherOwner = buildCacheIdentity('owner-b', deploymentId, media);
    const otherDeployment = buildCacheIdentity('owner-a', 'e'.repeat(64), media);

    expect(first).not.toBe(otherOwner);
    expect(first).not.toBe(otherDeployment);
    expect(hashCacheIdentity(first)).toHaveLength(32);
    expect(buildCacheIdentity('owner-a', deploymentId, media)).toBe(first);
  });
});
