import 'reflect-metadata';
import assert from 'node:assert/strict';
import test from 'node:test';
import { NestFactory } from '@nestjs/core';
import type { INestApplicationContext } from '@nestjs/common';
import * as assembly from './eagle.module';
import { libraryProviders } from './library-capabilities';
import { EagleImageSearchService } from './eagle-image-search.service';
import { EagleEmbeddingClient } from './eagle-embedding-client';
import { PrismaService } from '../prisma/prisma.service';

test('a shared service cannot silently start as MATERIAL when its mode binding is missing', async () => {
  let context: INestApplicationContext | undefined;
  try {
    await assert.rejects(async () => {
      context = await NestFactory.createApplicationContext(
        {
          module: class IncompleteLibrary {},
          providers: [
            { provide: PrismaService, useValue: {} },
            { provide: EagleEmbeddingClient, useValue: {} },
            EagleImageSearchService,
          ],
        },
        { logger: false, abortOnError: false },
      );
    }, /SEKEREAGLE_LIBRARY_MODE/u);
  } finally {
    await context?.close();
  }
});

test('runtime DI metadata keeps shared service dependencies as class tokens', async () => {
  const { EagleAssetOperationService } = await import('./eagle-asset-operations.service');
  const { LibraryOperationQueryService } = await import('./library-operation-query.service');
  const { LibraryOperationAdmissionService } =
    await import('./library-operation-admission.service');
  const { LibraryCommandRegistry } = await import('./eagle-library-command');
  const { EagleService } = await import('./eagle.service');
  const { LibraryManualTagService } = await import('./library-manual-tag.service');
  const { LibrarySmartFolderService } = await import('./library-smart-folder.service');
  const paramTypes = (type: object) => Reflect.getMetadata('design:paramtypes', type) as unknown[];
  const operations = paramTypes(EagleAssetOperationService);
  assert.equal(operations[5], LibraryCommandRegistry);
  assert.equal(operations[6], LibraryOperationQueryService);
  assert.equal(operations[7], LibraryOperationAdmissionService);
  const admission = paramTypes(LibraryOperationAdmissionService);
  assert.equal(admission[3], LibraryCommandRegistry);
  const eagle = paramTypes(EagleService);
  assert.equal(eagle[3], LibraryManualTagService);
  assert.equal(eagle[4], LibrarySmartFolderService);
});

test('every shared provider has exactly one capability owner and explicit mode eligibility', () => {
  const { EAGLE_LIBRARY_CAPABILITIES: capabilities } = assembly as unknown as {
    EAGLE_LIBRARY_CAPABILITIES: ReadonlyArray<{
      id: string;
      modes: readonly string[];
      providers: readonly unknown[];
      tables: readonly string[];
    }>;
  };
  assert.equal(
    Array.isArray(capabilities),
    true,
    'shared assembly must declare capability ownership',
  );
  const providers = capabilities.flatMap((entry) => entry.providers);
  assert.equal(new Set(capabilities.map((entry) => entry.id)).size, capabilities.length);
  assert.equal(new Set(providers).size, providers.length, 'no provider may have two owners');
  assert.deepEqual(new Set(providers), new Set(libraryProviders('MATERIAL')));
  const tables = capabilities.flatMap((entry) => entry.tables);
  assert.equal(new Set(tables).size, tables.length, 'each durable table has one capability owner');
  for (const entry of capabilities) {
    assert.ok(entry.modes.length);
    assert.ok(entry.modes.every((mode: string) => mode === 'MATERIAL' || mode === 'PHOTO'));
    assert.ok(entry.providers.length);
  }
});
