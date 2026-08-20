import { describe, expect, it } from 'vitest';
import {
  buildCacheIdentity,
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

  it('isolates cache keys by normalized server and authenticated owner', () => {
    const media = parseDesktopMediaUrl(
      `sekereagle-media://rendition/thumbnail/${assetId}/${renditionId}`,
    );
    const first = buildCacheIdentity('https://EXAMPLE.com:443/', 'owner-a', deploymentId, media);
    const equivalent = buildCacheIdentity('https://example.com', 'owner-a', deploymentId, media);
    const otherOwner = buildCacheIdentity('https://example.com', 'owner-b', deploymentId, media);
    const otherDeployment = buildCacheIdentity(
      'https://example.com',
      'owner-a',
      'e'.repeat(64),
      media,
    );

    expect(first).toBe(equivalent);
    expect(first).not.toBe(otherOwner);
    expect(first).not.toBe(otherDeployment);
    expect(hashCacheIdentity(first)).toHaveLength(32);
  });

  it('rejects server URLs with credentials, query, fragments, or non-http protocols', () => {
    for (const server of [
      'file:///tmp/server',
      'https://user:pass@example.com',
      'https://example.com/?tenant=a',
      'https://example.com/#fragment',
    ]) {
      expect(() =>
        buildCacheIdentity(
          server,
          'owner-a',
          deploymentId,
          parseDesktopMediaUrl(`sekereagle-media://rendition/thumbnail/${assetId}/${renditionId}`),
        ),
      ).toThrow();
    }
  });
});
