import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  resolveEagleMediaPath,
  resolveEagleRenditionUrl,
  type SekerDesktopBridge,
} from './media-resolver';

const assetId = '00000000-0000-4000-8000-000000000001';
const renditionId = '00000000-0000-4000-8000-000000000002';
const pyramidId = '00000000-0000-4000-8000-000000000003';

afterEach(() => {
  delete (globalThis as { sekerDesktop?: SekerDesktopBridge }).sekerDesktop;
});

describe('media resolver', () => {
  it('keeps ordinary web URLs unchanged when no desktop capability exists', () => {
    expect(resolveEagleRenditionUrl(assetId, renditionId, 'THUMBNAIL')).toBe(
      `/api/eagle/assets/${assetId}/renditions/${renditionId}`,
    );
  });

  it('uses the narrow desktop bridge for immutable renditions and tiles', () => {
    const createMediaUrl = vi.fn((media) =>
      media.kind === 'RENDITION'
        ? `sekereagle-media://rendition/${media.renditionKind.toLowerCase()}/${media.assetId}/${media.renditionId}`
        : `sekereagle-media://tile/${media.assetId}/${media.pyramidId}/${media.level}/${media.x}/${media.y}`,
    );
    (globalThis as { sekerDesktop?: SekerDesktopBridge }).sekerDesktop = {
      version: 1,
      createMediaUrl,
    };

    expect(resolveEagleRenditionUrl(assetId, renditionId, 'THUMBNAIL')).toBe(
      `sekereagle-media://rendition/thumbnail/${assetId}/${renditionId}`,
    );
    expect(
      resolveEagleMediaPath(`/api/eagle/assets/${assetId}/pyramids/${pyramidId}/tiles/13/4/2`),
    ).toBe(`sekereagle-media://tile/${assetId}/${pyramidId}/13/4/2`);
    expect(createMediaUrl).toHaveBeenCalledTimes(2);
  });

  it('never transports originals, arbitrary URLs, or malformed media identities through desktop', () => {
    const createMediaUrl = vi.fn(() => 'sekereagle-media://unexpected');
    (globalThis as { sekerDesktop?: SekerDesktopBridge }).sekerDesktop = {
      version: 1,
      createMediaUrl,
    };

    expect(resolveEagleMediaPath(`/api/eagle/assets/${assetId}/original`)).toBe(
      `/api/eagle/assets/${assetId}/original`,
    );
    expect(resolveEagleMediaPath('https://attacker.example/image.webp')).toBe(
      'https://attacker.example/image.webp',
    );
    expect(createMediaUrl).not.toHaveBeenCalled();
  });

  it('fails closed when a compromised bridge returns a non-media URL', () => {
    (globalThis as { sekerDesktop?: SekerDesktopBridge }).sekerDesktop = {
      version: 1,
      createMediaUrl: () => 'https://attacker.example/image.webp',
    };

    expect(() => resolveEagleRenditionUrl(assetId, renditionId, 'THUMBNAIL')).toThrow(
      /桌面媒体地址/,
    );
  });
});
