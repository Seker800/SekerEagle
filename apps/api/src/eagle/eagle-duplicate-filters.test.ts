import 'reflect-metadata';
import assert from 'node:assert/strict';
import test from 'node:test';
import { ValidationPipe } from '@nestjs/common';
import { DuplicateActionDto, DuplicateListDto } from './eagle-duplicates.dto';
import { matchesDuplicateFilters, type DuplicateFilterMember } from './eagle-duplicate-filters';
const member = (patch: Partial<DuplicateFilterMember> = {}): DuplicateFilterMember => ({
  id: 'one',
  originalName: 'IMG_001.jpg',
  byteSize: 1000n,
  width: 1200,
  height: 800,
  format: 'jpeg',
  capturedAt: new Date('2020-01-01T00:00:00Z'),
  capturedLocal: null,
  edited: false,
  ...patch,
});
test('duplicate filters compare every member; unknown metadata is not equal evidence', () => {
  const rows = [member(), member({ id: 'two' })];
  assert.equal(
    matchesDuplicateFilters(rows, {
      sameName: 'true',
      sameCapturedAt: 'true',
      sameDimensions: 'true',
      sameFormat: 'true',
      sameBytes: 'true',
      maxBytes: '1001',
    }),
    true,
  );
  for (const [field, patch] of [
    ['sameName', { originalName: 'different.jpg' }],
    ['sameCapturedAt', { capturedAt: null }],
    ['sameDimensions', { width: null }],
    ['sameFormat', { format: 'png' }],
    ['sameBytes', { byteSize: 1001n }],
  ] as const)
    assert.equal(matchesDuplicateFilters([rows[0]!, member(patch)], { [field]: 'true' }), false);
  assert.equal(
    matchesDuplicateFilters([member({ capturedAt: null }), member({ capturedAt: null })], {
      sameCapturedAt: 'true',
    }),
    false,
  );
  assert.equal(
    matchesDuplicateFilters([member(), member({ byteSize: 2000n })], { maxBytes: '2000' }),
    false,
  );
  assert.equal(
    matchesDuplicateFilters([member(), member({ edited: true })], { protectEdits: 'true' }),
    false,
  );
  assert.equal(matchesDuplicateFilters([member(), member({ edited: true })], {}), true);
  assert.equal(
    matchesDuplicateFilters([member(), member({ format: 'jpg' })], { sameFormat: 'true' }),
    true,
  );
});
test('duplicate filter DTOs reject owner injection, arbitrary predicates and invalid byte ranges', async () => {
  const pipe = new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true });
  await pipe.transform(
    { sameName: 'true', maxBytes: '10485760', protectEdits: 'true' },
    { type: 'query', metatype: DuplicateListDto },
  );
  for (const patch of [
    { ownerId: 'foreign' },
    { sameName: 'yes' },
    { maxBytes: '-1' },
    { maxBytes: 'NaN' },
    { maxBytes: '0' },
  ])
    await assert.rejects(pipe.transform(patch, { type: 'query', metatype: DuplicateListDto }));
  await assert.rejects(
    pipe.transform(
      {
        operationId: '00000000-0000-4000-8000-000000000001',
        allVerified: true,
        revision: 'a'.repeat(64),
        filters: { ownerId: 'foreign' },
      },
      { type: 'body', metatype: DuplicateActionDto },
    ),
  );
});

test('bulk overrides can retain all members without dropping unseen photos, and reject ambiguous rules', async () => {
  const pipe = new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true });
  const base = {
    operationId: '00000000-0000-4000-8000-000000000001',
    allVerified: true,
    revision: 'a'.repeat(64),
  };
  await pipe.transform(
    { ...base, keepOverrides: [{ signature: 'b'.repeat(64), removeIds: [] }] },
    { type: 'body', metatype: DuplicateActionDto },
  );
  for (const choice of [
    { signature: 'b'.repeat(64) },
    { signature: 'b'.repeat(64), keepIds: ['00000000-0000-4000-8000-000000000002'], removeIds: [] },
    { signature: 'b'.repeat(64), removeIds: ['invalid'] },
  ])
    await assert.rejects(
      pipe.transform(
        { ...base, keepOverrides: [choice] },
        { type: 'body', metatype: DuplicateActionDto },
      ),
    );
});
