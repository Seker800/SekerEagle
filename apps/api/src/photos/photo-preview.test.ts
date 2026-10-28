import assert from 'node:assert/strict';
import test from 'node:test';
import { previewSelect, serializePreview } from './photo-preview';

test('photo preview projection preserves derivative variants without exposing storage or owner fields', () => {
  assert.deepEqual(Object.keys(previewSelect.renditions.select).sort(), [
    'byteSize',
    'height',
    'id',
    'kind',
    'mimeType',
    'revision',
    'variant',
    'width',
  ]);
  assert.equal('ownerId' in previewSelect, false);
  assert.equal('originalObjectKey' in previewSelect, false);
  const asset = {
    byteSize: 123n,
    renditions: [{ id: 'edit', variant: 'edit', byteSize: 10n }],
  } as unknown as Parameters<typeof serializePreview>[0];
  const result = serializePreview(asset);
  const rendition = result.renditions[0];
  assert.ok(rendition);
  assert.equal(rendition.variant, 'edit');
  assert.equal(rendition.byteSize, 10);
});
