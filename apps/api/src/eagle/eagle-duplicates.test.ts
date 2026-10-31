import 'reflect-metadata';
import assert from 'node:assert/strict';
import test from 'node:test';
import { ValidationPipe } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { DuplicateActionDto, DuplicateListDto } from './eagle-duplicates.dto';
import { fingerprintPreview } from './eagle-duplicate-fingerprint';
import sharp from 'sharp';
const pipe = new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true });
test('duplicate actions reject injected ownership, empty keeper and malformed review signatures', async () => {
  const body = {
    operationId: randomUUID(),
    groups: [{ signature: 'a'.repeat(64), keepIds: [randomUUID()] }],
  };
  await pipe.transform(body, { type: 'body', metatype: DuplicateActionDto });
  for (const patch of [
    { ownerId: 'foreign' },
    { groups: [{ signature: 'bad', keepIds: [] }] },
    { allExact: true, groups: body.groups },
  ])
    await assert.rejects(
      pipe.transform({ ...body, ...patch }, { type: 'body', metatype: DuplicateActionDto }),
    );
  await assert.rejects(
    pipe.transform({ cursor: '-1' }, { type: 'query', metatype: DuplicateListDto }),
  );
});
test('preview fingerprints survive image encoding changes and do not consume originals', async () => {
  const pixels = Buffer.alloc(96 * 64 * 3);
  for (let y = 0; y < 64; y++)
    for (let x = 0; x < 96; x++) {
      const at = (y * 96 + x) * 3;
      pixels[at] = (x * 7 + y * 3) % 256;
      pixels[at + 1] = (x * 3 + y * 7) % 256;
      pixels[at + 2] = x * 2;
    }
  const source = sharp(pixels, { raw: { width: 96, height: 64, channels: 3 } });
  const png = await source.clone().png().toBuffer(),
    jpeg = await source.clone().jpeg({ quality: 90 }).toBuffer();
  const a = await fingerprintPreview(png),
    b = await fingerprintPreview(jpeg);
  assert.equal(a.hash.length, 16);
  assert.equal(a.colors.length, 48);
  assert.ok(a.contrast > 8);
  assert.ok(a.colors.every((v, i) => Math.abs(v - b.colors[i]!) < 10));
  await assert.rejects(fingerprintPreview(Buffer.from('invalid')));
});

import { EagleDuplicateService } from './eagle-duplicates.service';
import type { PrismaService } from '../prisma/prisma.service';
import type { ObjectStorageService } from '../storage/object-storage.service';
test('duplicate reads use scoped SQL projections without rebuilding visual matches in HTTP', async () => {
  const calls: Array<{ sql: string; values: unknown[] }> = [];
  const tx = {
    $queryRaw: async (strings: TemplateStringsArray, ...values: unknown[]) => {
      calls.push({ sql: strings.join('?'), values });
      return [];
    },
    eagleAsset: { findMany: async () => [] },
    eagleDuplicateDismissal: { findMany: async () => [] },
  };
  const prisma = { $transaction: async (fn: (client: typeof tx) => unknown) => fn(tx) };
  const service = new EagleDuplicateService(
    prisma as unknown as PrismaService,
    {} as ObjectStorageService,
    'PHOTO',
  );
  const result = await service.list('owner', false, {});
  assert.equal(result.totalGroups, 0);
  assert.equal(calls.length, 3);
  for (const query of calls) {
    assert.ok(query.values.includes('owner'));
    assert.ok(query.values.includes('PHOTO'));
    assert.ok(query.sql.includes('deletedAt'));
  }
  assert.ok(
    calls[0]!.values.some(
      (value) =>
        typeof value === 'object' &&
        value !== null &&
        'sql' in value &&
        String(value.sql).includes('"isPrivate"=false'),
    ),
  );
  assert.ok(calls[1]!.sql.includes('NOT EXISTS'));
});
