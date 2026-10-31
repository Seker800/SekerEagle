import 'reflect-metadata';
import assert from 'node:assert/strict';
import test from 'node:test';
import { NestFactory } from '@nestjs/core';
import type { INestApplicationContext } from '@nestjs/common';
import * as assembly from './eagle.module';
import { EagleAiTagService } from './eagle-ai-tag.service';
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
            EagleAiTagService,
          ],
        },
        { logger: false, abortOnError: false },
      );
    }, /SEKEREAGLE_LIBRARY_MODE/u);
  } finally {
    await context?.close();
  }
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
  assert.ok(Array.isArray(capabilities), 'shared assembly must declare capability ownership');
  const providers = capabilities.flatMap((entry) => entry.providers);
  assert.equal(new Set(capabilities.map((entry) => entry.id)).size, capabilities.length);
  assert.equal(new Set(providers).size, providers.length, 'no provider may have two owners');
  assert.deepEqual(new Set(providers), new Set(assembly.EAGLE_LIBRARY_PROVIDERS));
  const tables = capabilities.flatMap((entry) => entry.tables);
  assert.equal(new Set(tables).size, tables.length, 'each durable table has one capability owner');
  for (const entry of capabilities) {
    assert.ok(entry.modes.length);
    assert.ok(entry.modes.every((mode: string) => mode === 'MATERIAL' || mode === 'PHOTO'));
    assert.ok(entry.providers.length);
  }
});
