import 'reflect-metadata';
import assert from 'node:assert/strict';
import test from 'node:test';
import { Test } from '@nestjs/testing';
import { PrismaService } from '../prisma/prisma.service';
import { EagleService } from './eagle.service';
import { EagleImageSearchService } from './eagle-image-search.service';
import { libraryProviders } from './library-capabilities';
import { LIBRARY_MODE } from './library-mode';

for (const mode of ['MATERIAL', 'PHOTO'] as const) {
  test(`${mode} resolves vector search through Nest and exposes semantic availability`, async () => {
    const calls: unknown[] = [];
    const search = {
      prepare: async (ownerId: string, query: string) => {
        calls.push([ownerId, query]);
        return { status: 'READY', spaceId: 'space', vector: '[1,0]' };
      },
      rankPage: async () => [],
    };
    assert.ok(libraryProviders(mode).includes(EagleImageSearchService));
    const module = await Test.createTestingModule({
      providers: [
        EagleService,
        { provide: PrismaService, useValue: { eagleAsset: { findMany: async () => [] } } },
        { provide: EagleImageSearchService, useValue: search },
        { provide: LIBRARY_MODE, useValue: mode },
      ],
    }).compile();
    try {
      const result = await module.get(EagleService).listAssets('owner', { search: '飞机', limit: 30 });
      assert.deepEqual(calls, [['owner', '飞机']]);
      assert.ok('imageSearch' in result);
      assert.deepEqual(result.imageSearch, { status: 'READY', spaceId: 'space' });
    } finally {
      await module.close();
    }
  });

  test(`${mode} refuses to start when its required search provider is missing`, async () => {
    await assert.rejects(
      Test.createTestingModule({
        providers: [
          EagleService,
          { provide: PrismaService, useValue: {} },
          { provide: LIBRARY_MODE, useValue: mode },
        ],
      }).compile(),
      /EagleImageSearchService/,
    );
  });
}
