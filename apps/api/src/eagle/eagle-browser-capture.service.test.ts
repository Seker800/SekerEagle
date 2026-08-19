import assert from 'node:assert/strict';
import test from 'node:test';
import { ConflictException, NotFoundException } from '@nestjs/common';
import { EagleBrowserCaptureService } from './eagle-browser-capture.service';

const ownerId = '5a1fd7d1-fd57-4e42-83f7-55425ca8704a';
const clientCaptureId = '13e84291-8ad7-4c44-aa76-29a45ce058b2';

const input = {
  clientCaptureId,
  originalName: 'photo.jpg',
  mimeType: 'image/jpeg',
  size: 5,
  displayName: '  Sunset Inspiration  ',
  pageTitle: '  Gallery  ',
  pageUrl: 'https://user:secret@example.com/gallery?id=7#private',
  imageUrl: 'https://cdn.example.com/photo.jpg?X-Amz-Signature=secret#fragment',
  altText: '  Photo  ',
  capturedAt: '2026-08-19T00:00:00.000Z',
  extensionVersion: '0.1.0',
};

test('initiates an owner-scoped upload and stores sanitized immutable provenance', async () => {
  const writes: Array<Record<string, unknown>> = [];
  const service = new EagleBrowserCaptureService(
    {
      eagleBrowserCapture: {
        findFirst: async () => null,
        create: async ({ data }: { data: Record<string, unknown> }) => {
          writes.push(data);
          return {
            id: 'capture-db-id',
            ...data,
            uploadSession: { id: 'upload-1', status: 'INITIATED', size: 5n },
          };
        },
      },
    } as never,
    {
      initiate: async () => ({ id: 'upload-1', status: 'INITIATED', size: 5, partSize: 8 }),
      abort: async () => undefined,
    } as never,
  );

  const result = await service.initiate(ownerId, input);

  assert.equal(result.uploadSessionId, 'upload-1');
  assert.equal(result.partSize, 8);
  assert.equal(writes[0]?.ownerId, ownerId);
  assert.equal(writes[0]?.pageUrl, 'https://example.com/gallery?id=7');
  assert.equal(writes[0]?.imageUrl, 'https://cdn.example.com/photo.jpg');
  assert.equal(writes[0]?.displayName, 'Sunset Inspiration');
  assert.equal('ownerId' in input, false);
});

test('idempotent replay returns the existing upload without allocating another object', async () => {
  let initiated = false;
  const existing = {
    id: 'capture-db-id',
    ownerId,
    clientCaptureId,
    uploadSessionId: 'upload-existing',
    displayName: 'Sunset Inspiration',
    pageTitle: 'Gallery',
    pageUrl: 'https://example.com/gallery?id=7',
    imageUrl: 'https://cdn.example.com/photo.jpg',
    altText: 'Photo',
    capturedAt: new Date('2026-08-19T00:00:00.000Z'),
    extensionVersion: '0.1.0',
    assetId: null,
    completedAt: null,
    uploadSession: {
      id: 'upload-existing',
      status: 'INITIATED',
      originalName: 'photo.jpg',
      mimeType: 'image/jpeg',
      size: 5n,
      eagleAssetId: null,
      lastError: null,
    },
  };
  const service = new EagleBrowserCaptureService(
    { eagleBrowserCapture: { findFirst: async () => existing } } as never,
    {
      initiate: async () => {
        initiated = true;
      },
      partSizeFor: () => 8,
    } as never,
  );

  const result = await service.initiate(ownerId, input);

  assert.equal(result.uploadSessionId, 'upload-existing');
  assert.equal(result.replayed, true);
  assert.equal(initiated, false);
});

test('idempotent replay compares the same normalized filename used by upload initiation', async () => {
  const existing = {
    ownerId,
    clientCaptureId,
    displayName: 'Sunset Inspiration',
    pageTitle: 'Gallery',
    pageUrl: 'https://example.com/gallery?id=7',
    imageUrl: 'https://cdn.example.com/photo.jpg',
    altText: 'Photo',
    capturedAt: new Date('2026-08-19T00:00:00.000Z'),
    extensionVersion: '0.1.0',
    assetId: null,
    completedAt: null,
    uploadSession: {
      id: 'upload-existing',
      status: 'INITIATED',
      originalName: 'photo.jpg',
      mimeType: 'image/jpeg',
      size: 5n,
      eagleAssetId: null,
      lastError: null,
    },
  };
  const service = new EagleBrowserCaptureService(
    { eagleBrowserCapture: { findFirst: async () => existing } } as never,
    { partSizeFor: () => 8 } as never,
  );

  const result = await service.initiate(ownerId, {
    ...input,
    originalName: 'folder\\photo.jpg',
  });

  assert.equal(result.replayed, true);
});

test('idempotency keys reject changed immutable capture declarations', async () => {
  const existing = {
    ownerId,
    clientCaptureId,
    displayName: 'Different',
    pageTitle: 'Gallery',
    pageUrl: 'https://example.com/gallery?id=7',
    imageUrl: 'https://cdn.example.com/photo.jpg',
    altText: 'Photo',
    capturedAt: new Date('2026-08-19T00:00:00.000Z'),
    extensionVersion: '0.1.0',
    uploadSession: {
      id: 'upload-existing',
      status: 'INITIATED',
      originalName: 'photo.jpg',
      mimeType: 'image/jpeg',
      size: 5n,
    },
  };
  const service = new EagleBrowserCaptureService(
    { eagleBrowserCapture: { findFirst: async () => existing } } as never,
    {} as never,
  );

  await assert.rejects(service.initiate(ownerId, input), ConflictException);
});

test('capture lookup returns 404 for another owner without revealing existence', async () => {
  const service = new EagleBrowserCaptureService(
    { eagleBrowserCapture: { findFirst: async () => null } } as never,
    {} as never,
  );

  await assert.rejects(service.get(ownerId, clientCaptureId), NotFoundException);
});
