import { Prisma } from '@prisma/client';

/** Prisma 6 exposes raw SQLSTATE directly; Prisma 7 preserves it in the driver cause. */
export function isDatabaseBusy(error: unknown): boolean {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError)) return false;
  if (['P2028', 'P2024', 'P2034'].includes(error.code)) return true;
  if (error.code !== 'P2010') return false;
  if (error.meta?.code === '57014') return true;
  const adapter = error.meta?.driverAdapterError;
  if (!adapter || typeof adapter !== 'object' || !('cause' in adapter)) return false;
  const cause = adapter.cause;
  return Boolean(
    cause &&
    typeof cause === 'object' &&
    (('originalCode' in cause && cause.originalCode === '57014') ||
      ('code' in cause && cause.code === '57014')),
  );
}
