import { BadRequestException } from '@nestjs/common';
import { ApiProperty } from '@nestjs/swagger';
import { IsObject } from 'class-validator';
import type { LibraryMode } from '@prisma/client';
import { readWatermarkVariant, type WatermarkVariant } from '@sekereagle/library-core';
import { findWatermark } from '@sekereagle/photo-render-core/photo-watermark-model';
import type { PrismaService } from '../prisma/prisma.service';

export class SaveWatermarkPresetDto {
  @ApiProperty({ type: Object, additionalProperties: true }) @IsObject() settings!: object;
}

export interface WatermarkPresetsResponse {
  presets: Record<string, WatermarkVariant>;
}

/** Photo-specific text is never stored in a cross-photo preset. */
function portableVariant(variant: WatermarkVariant): WatermarkVariant {
  return {
    ...variant,
    watermarkCamera: null,
    watermarkParameters: null,
    watermarkCapturedAt: null,
  };
}

export async function listWatermarkPresets(
  db: PrismaService,
  ownerId: string,
  libraryMode: LibraryMode,
): Promise<WatermarkPresetsResponse> {
  const rows = await db.eagleWatermarkPreset.findMany({
    where: { ownerId, libraryMode },
    orderBy: { templateId: 'asc' },
  });
  return {
    presets: Object.fromEntries(
      rows.map((row) => [row.templateId, readWatermarkVariant(row.settings)]),
    ),
  };
}

export async function saveWatermarkPreset(
  db: PrismaService,
  ownerId: string,
  libraryMode: LibraryMode,
  templateId: string,
  settings: unknown,
) {
  const template = findWatermark(templateId);
  if (!template) throw new BadRequestException('水印模板不存在。');
  const portable = portableVariant(readWatermarkVariant(settings));
  await db.eagleWatermarkPreset.upsert({
    where: {
      ownerId_libraryMode_templateId: { ownerId, libraryMode, templateId: template.id },
    },
    create: {
      ownerId,
      libraryMode,
      templateId: template.id,
      settings: portable,
    },
    update: { settings: portable },
  });
  return { saved: true, templateId: template.id, settings: portable };
}
