import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { OpenAPIObject, SchemaObject } from '@nestjs/swagger';

const document = JSON.parse(
  readFileSync(resolve(__dirname, '../../../..', 'packages/contracts/openapi.json'), 'utf8'),
) as OpenAPIObject;

test('both libraries publish typed list, detail and terminal operation responses', () => {
  for (const prefix of ['eagle', 'photos']) {
    for (const [path, schema] of [
      ['assets', 'EagleAssetPageResponseDto'],
      ['trash', 'EagleAssetPageResponseDto'],
      ['assets/{assetId}', 'EagleAssetResponseDto'],
      ['trash/{assetId}', 'EagleAssetResponseDto'],
      ['operations/{operationId}/results', 'EagleOperationResultsResponseDto'],
    ]) {
      const response = document.paths[`/api/${prefix}/${path}`]?.get?.responses['200'];
      assert.deepEqual(
        response && 'content' in response
          ? response.content?.['application/json']?.schema
          : undefined,
        {
          $ref: `#/components/schemas/${schema}`,
        },
        `${prefix}/${path} needs its real response contract`,
      );
    }
  }
});

test('public asset schemas preserve nullable fields and exclude storage and owner secrets', () => {
  const schemas = document.components!.schemas!;
  const list = schemas.EagleAssetListResponseDto as SchemaObject;
  assert.ok(list, 'asset cards must have a shared response schema');
  for (const field of ['id', 'byteSize', 'renditions', 'manualTags', 'libraryAddedAt'])
    assert.ok(list.required!.includes(field), field);
  for (const field of ['width', 'height', 'durationMs', 'rating', 'deletedAt'])
    assert.equal((list.properties![field] as SchemaObject).nullable, true, field);
  for (const field of ['ownerId', 'originalObjectKey', 'storageTransferredOut', 'photoFaces'])
    assert.equal(field in list.properties!, false, field);
  const results = schemas.EagleOperationResultsResponseDto as SchemaObject;
  assert.equal((results.properties!.nextCursor as SchemaObject).nullable, true);
});
