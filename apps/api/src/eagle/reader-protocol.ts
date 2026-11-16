import { z } from 'zod';

export const memorySearchPositions = z.array(
  z
    .object({
      assetId: z.string().min(1),
      tier: z.union([z.literal(0), z.literal(1)]),
      similarity: z.number().finite(),
      libraryAddedAt: z.string().datetime(),
    })
    .strict(),
);
export const memorySemanticOptions = z
  .object({
    folderIds: z.array(z.string().min(1)).min(1),
    limit: z.number().int().positive().safe(),
    ordinaryMembersPossible: z.boolean(),
    includePrivate: z.boolean(),
    trash: z.boolean(),
    after: memorySearchPositions.element.optional(),
  })
  .strict();
export const memoryPhotoFacets = z
  .object({ cameras: z.array(z.string()), lenses: z.array(z.string()) })
  .strict();
const usage = z.object({ key: z.string(), count: z.number().int().nonnegative() });
export const memoryPersonCounts = z.array(
  z.object({ id: z.string(), photos: z.number().int().nonnegative() }).strict(),
);
export const memoryStatisticsSummary = z
  .object({
    total: z.number().int().nonnegative(),
    unknownDate: z.number().int().nonnegative(),
    first: z.string().nullable(),
    last: z.string().nullable(),
    cameras: z.array(usage),
    lenses: z.array(usage),
    cameraOptions: z.array(z.string()),
    lensOptions: z.array(z.string()),
    points: z.array(
      z.object({
        period: z.string(),
        key: z.string().nullable(),
        count: z.number().int().nonnegative(),
      }),
    ),
  })
  .strict();

/** JSON transport preserves file sizes beyond Number.MAX_SAFE_INTEGER. */
export const encodeMemoryQuery = (value: unknown) =>
  JSON.stringify(value, (_key: string, item: unknown) =>
    typeof item === 'bigint' ? { $bigint: String(item) } : item,
  );
export const decodeMemoryQuery = (text: string): unknown =>
  JSON.parse(text, (_key: string, item: unknown): unknown => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return item;
    const record = item as Record<string, unknown>;
    return Object.keys(record).length === 1 && typeof record.$bigint === 'string'
      ? BigInt(record.$bigint)
      : item;
  });

export const memoryStatisticsQuery = z
  .object({
    grain: z.enum(['day', 'week', 'month', 'year']).optional(),
    groupBy: z.enum(['total', 'camera', 'lens']).optional(),
    start: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .optional(),
    end: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .optional(),
    cameras: z.array(z.string()).optional(),
    lenses: z.array(z.string()).optional(),
    lensKeys: z.array(z.string()).optional(),
  })
  .strict();

export const memoryColorPosition = z
  .object({
    id: z.string().min(1),
    score: z.number().finite().nonnegative(),
    time: z.string().datetime(),
    mediaRevision: z.number().int().nonnegative(),
  })
  .strict();
export const memoryColorOptions = z
  .object({
    color: z.string().regex(/^#[0-9a-f]{6}$/i),
    date: z.enum(['chronologicalAt', 'libraryAddedAt']),
    limit: z.number().int().positive().safe(),
    offset: z.number().int().nonnegative().safe(),
    after: memoryColorPosition
      .omit({ mediaRevision: true })
      .extend({ newer: z.literal(true).optional() })
      .optional(),
  })
  .strict();
