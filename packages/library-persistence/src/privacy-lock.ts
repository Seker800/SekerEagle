import { Prisma, type LibraryMode } from '@prisma/client';

export async function lockOwnerPrivacyProjection(
  transaction: Prisma.TransactionClient,
  ownerId: string,
  libraryMode: LibraryMode = 'MATERIAL',
): Promise<void> {
  await transaction.$queryRaw(Prisma.sql`
    SELECT pg_advisory_xact_lock(
      hashtextextended(${`sekereagle:privacy:${ownerId}:${libraryMode}`}, 0)
    )::text AS "lockResult"
  `);
}
