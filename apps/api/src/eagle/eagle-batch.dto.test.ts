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

test('sending requires an idempotency key and rejects client-supplied owner or destination', async () => {
  const { SendEagleAssetsDto } = await import('./eagle.dto');
  const dto = Object.assign(new SendEagleAssetsDto(), {
    assetIds: createAssetIds(1),
    operationId: createAssetIds(1)[0],
  });
  assert.equal((await validate(dto, { whitelist: true, forbidNonWhitelisted: true })).length, 0);
  const invalid = Object.assign(new SendEagleAssetsDto(), {
    assetIds: createAssetIds(1),
    ownerId: 'foreign',
    targetMode: 'PHOTO',
  });
  const errors = await validate(invalid, { whitelist: true, forbidNonWhitelisted: true });
  assert.ok(errors.some((error) => error.property === 'operationId'));
  assert.ok(errors.some((error) => error.property === 'ownerId'));
  assert.ok(errors.some((error) => error.property === 'targetMode'));
});

test('date sorting accepts only declared values and cannot smuggle an owner', async () => {
  const { ListEagleAssetsDto } = await import('./eagle.dto');
  for (const sort of ['CAPTURED_AT', 'ADDED_AT', undefined]) {
    assert.deepEqual(await validate(Object.assign(new ListEagleAssetsDto(), { sort })), []);
  }
  for (const sort of ['chronologicalAt DESC', 'createdAt', '', ['ADDED_AT'], 1]) {
    const errors = await validate(Object.assign(new ListEagleAssetsDto(), { sort }));
    assert.ok(errors.some(({ property }) => property === 'sort'));
  }
  const errors = await validate(
    Object.assign(new ListEagleAssetsDto(), { sort: 'ADDED_AT', ownerId: 'victim' }),
    { whitelist: true, forbidNonWhitelisted: true },
  );
  assert.ok(errors.some(({ property }) => property === 'ownerId'));
});

test('date navigation validates boundaries and bounds expensive offsets', async () => {
  const { ListEagleAssetsDto } = await import('./eagle.dto');
  for (const offset of [-1, 1.5, 10000001, 'NaN']) {
    assert.ok(
      (await validate(Object.assign(new ListEagleAssetsDto(), { offset }))).some(
        (e) => e.property === 'offset',
      ),
    );
  }
  assert.ok(
    (
      await validate(Object.assign(new ListEagleAssetsDto(), { before: '2026-02-30T00:00:00Z' }))
    ).some((e) => e.property === 'before'),
  );
  assert.deepEqual(
    await validate(
      Object.assign(new ListEagleAssetsDto(), { offset: 99, before: '2026-10-21T16:00:00Z' }),
    ),
    [],
  );
});
