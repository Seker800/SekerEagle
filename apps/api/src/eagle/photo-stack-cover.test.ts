import assert from 'node:assert/strict';
import test from 'node:test';
import { selectPhotoStackCover } from './photo-stack-cover';

const member = (
  assetId: string,
  overrides: Partial<{
    createdAt: Date;
    inherited: boolean;
    lifecycleStatus: string;
    mimeType: string;
  }> = {},
) => ({
  assetId,
  asset: {
    createdAt: overrides.createdAt ?? new Date(1_000),
    lifecycleStatus: overrides.lifecycleStatus ?? 'READY',
    mimeType: overrides.mimeType ?? 'image/jpeg',
    photoMetadata: overrides.inherited ? { captureMetadataInherited: true } : null,
  },
});

test('uses the JPEG sibling instead of a stored RAW cover', () => {
  const members = [
    member('raw', { mimeType: 'image/x-adobe-dng', createdAt: new Date(2_000) }),
    member('jpeg', { createdAt: new Date(1_000) }),
  ];
  assert.equal(selectPhotoStackCover(members, 'raw', false)?.assetId, 'jpeg');
});

test('keeps the stored RAW cover while the JPEG sibling is still processing', () => {
  const members = [
    member('raw', { mimeType: 'image/x-adobe-dng' }),
    member('jpeg', { lifecycleStatus: 'PROCESSING' }),
  ];
  assert.equal(selectPhotoStackCover(members, 'raw', false)?.assetId, 'raw');
});

test('never replaces a cover the user selected by hand', () => {
  const members = [member('raw', { mimeType: 'image/x-adobe-dng' }), member('jpeg')];
  assert.equal(selectPhotoStackCover(members, 'raw', true)?.assetId, 'raw');
});

test('keeps a stored READY non-RAW cover', () => {
  const members = [member('best'), member('other', { inherited: true })];
  assert.equal(selectPhotoStackCover(members, 'best', false)?.assetId, 'best');
});

test('falls back to the newest inherited non-RAW member when the stored cover is filtered out', () => {
  const members = [
    member('plain', { createdAt: new Date(2_000) }),
    member('edited', { createdAt: new Date(3_000), inherited: true }),
  ];
  assert.equal(selectPhotoStackCover(members, 'missing', false)?.assetId, 'edited');
});

test('keeps the stored RAW cover when every ready member is RAW', () => {
  const members = [
    member('first-raw', { mimeType: 'image/x-adobe-dng', createdAt: new Date(2_000) }),
    member('second-raw', { mimeType: 'image/x-nikon-nef', createdAt: new Date(1_000) }),
  ];
  assert.equal(selectPhotoStackCover(members, 'first-raw', false)?.assetId, 'first-raw');
});
