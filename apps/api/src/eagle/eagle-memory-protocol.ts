import { z } from 'zod';

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
