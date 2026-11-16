import assert from 'node:assert/strict';
import test from 'node:test';
import { BadRequestException } from '@nestjs/common';
import {
  listWatermarkPresets,
  saveWatermarkPreset,
  SaveWatermarkPresetDto,
} from './eagle-watermark-presets';
import { validateSync } from 'class-validator';
import { plainToInstance } from 'class-transformer';

for (const mode of ['MATERIAL', 'PHOTO'] as const) {
  test(`watermark presets are owner and mode scoped (${mode})`, async () => {
    let where: unknown;
    const db = {
      eagleWatermarkPreset: {
        findMany: async (args: { where: unknown }) => {
          where = args.where;
          return [
            {
              templateId: 'photo-strip',
              settings: { watermarkTheme: 'black', watermarkShowWebsite: false },
            },
          ];
        },
      },
    };
    const result = await listWatermarkPresets(db as never, 'owner', mode);
    assert.deepEqual(where, { ownerId: 'owner', libraryMode: mode });
    const stored = result.presets['photo-strip'];
    assert.ok(stored);
    assert.equal(stored.watermarkTheme, 'black');
    assert.equal(stored.watermarkShowWebsite, false);
  });

  test(`watermark preset writes validate the template and strip photo text (${mode})`, async () => {
    type Write = {
      where: unknown;
      create: { settings: unknown };
      update: { settings: unknown };
    };
    let write: Write | null = null;
    const db = {
      eagleWatermarkPreset: {
        upsert: async (args: Write) => {
          write = args;
        },
      },
    };
    await assert.rejects(
      () => saveWatermarkPreset(db as never, 'owner', mode, 'not-a-template', {}),
      BadRequestException,
    );
    await assert.rejects(() =>
      saveWatermarkPreset(db as never, 'owner', mode, 'photo-strip', {
        watermarkTheme: 'neon',
      }),
    );
    const result = await saveWatermarkPreset(db as never, 'owner', mode, 'photo-strip', {
      watermarkTheme: 'black',
      watermarkCamera: 'NIKON Z5',
      watermarkParameters: '50mm f/1.8',
      watermarkCapturedAt: '2026.11.16',
      watermarkWebsite: 'example.com',
      watermarkShowWebsite: false,
    });
    const captured = write as Write | null;
    assert.ok(captured);
    assert.deepEqual(captured.where, {
      ownerId_libraryMode_templateId: {
        ownerId: 'owner',
        libraryMode: mode,
        templateId: 'photo-strip',
      },
    });
    const settings = (captured.create.settings ?? {}) as Record<string, unknown>;
    assert.equal(settings.watermarkTheme, 'black');
    assert.equal(settings.watermarkCamera, null);
    assert.equal(settings.watermarkParameters, null);
    assert.equal(settings.watermarkCapturedAt, null);
    assert.equal(settings.watermarkWebsite, 'example.com');
    assert.equal(settings.watermarkShowWebsite, false);
    assert.deepEqual(captured.update.settings, settings);
    assert.equal(result.saved, true);
    assert.equal(result.templateId, 'photo-strip');
  });
}

test('watermark preset DTO only accepts an object payload', () => {
  assert.equal(validateSync(plainToInstance(SaveWatermarkPresetDto, { settings: {} })).length, 0);
  assert.ok(
    validateSync(plainToInstance(SaveWatermarkPresetDto, { settings: 'not-an-object' })).length > 0,
  );
});
