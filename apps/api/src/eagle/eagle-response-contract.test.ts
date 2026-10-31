import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const document = JSON.parse(
  readFileSync(resolve(__dirname, '../../../..', 'packages/contracts/openapi.json'), 'utf8'),
);

test('both libraries publish typed list, detail and terminal operation responses', () => {
  for (const prefix of ['eagle', 'photos']) {
    for (const [path, schema] of [
      ['assets', 'EagleAssetPageResponseDto'],
      ['trash', 'EagleAssetPageResponseDto'],
      ['assets/{assetId}', 'EagleAssetResponseDto'],
      ['trash/{assetId}', 'EagleAssetResponseDto'],
      ['operations/{operationId}/results', 'EagleOperationResultsResponseDto'],
    ]) {
      const response = document.paths[`/api/${prefix}/${path}`]?.get.responses['200'];
      assert.deepEqual(response?.content?.['application/json']?.schema, {
        $ref: `#/components/schemas/${schema}`,
      }, `${prefix}/${path} needs its real response contract`);
    }
  }
});

test('public asset schemas preserve nullable fields and exclude storage and owner secrets', () => {
  const schemas = document.components.schemas;
  const list = schemas.EagleAssetListResponseDto;
  assert.ok(list, 'asset cards must have a shared response schema');
  for (const field of ['id', 'byteSize', 'renditions', 'manualTags', 'libraryAddedAt'])
    assert.ok(list.required.includes(field), field);
  for (const field of ['width', 'height', 'durationMs', 'rating', 'deletedAt'])
    assert.equal(list.properties[field].nullable, true, field);
  for (const field of ['ownerId', 'originalObjectKey', 'storageTransferredOut', 'photoFaces'])
    assert.equal(field in list.properties, false, field);
  assert.equal(schemas.EagleOperationResultsResponseDto.properties.nextCursor.nullable, true);
});
