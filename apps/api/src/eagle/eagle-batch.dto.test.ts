import assert from 'node:assert/strict';
import test from 'node:test';
import { validate } from 'class-validator';
import { BatchChangeEagleManualTagsDto } from './eagle.dto';

function createAssetIds(count: number) {
  return Array.from(
    { length: count },
    (_, index) => `00000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
  );
}

function createBatchDto(assetCount: number) {
  return Object.assign(new BatchChangeEagleManualTagsDto(), {
    assetIds: createAssetIds(assetCount),
    addTagIds: [],
    removeTagIds: [],
    clearAll: true,
  });
}

test('batch manual tag changes accept up to 1000 assets', async () => {
  const errors = await validate(createBatchDto(1000));

  assert.equal(
    errors.some(({ property }) => property === 'assetIds'),
    false,
  );
});

test('batch manual tag changes still reject more than 1000 assets', async () => {
  const errors = await validate(createBatchDto(1001));

  assert.equal(
    errors.some(({ property }) => property === 'assetIds'),
    true,
  );
});
