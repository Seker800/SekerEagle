import type { Prisma } from '@prisma/client';

/** Append within the business transaction. Asset IDs are snapshots, never cascading relations. */
export async function appendPhotoAgentEvent(
  tx: Prisma.TransactionClient,
  ownerId: string,
  taskId: string,
  action: string,
  actor: 'AGENT' | 'HUMAN' | 'SYSTEM',
  details: unknown,
  suggestion?: { id: string; assetId: string },
) {
  await tx.eaglePhotoAgentEvent.create({
    data: {
      ownerId,
      libraryMode: 'PHOTO',
      taskId,
      action,
      actor,
      suggestionId: suggestion?.id,
      assetId: suggestion?.assetId,
      details: JSON.parse(JSON.stringify(details)) as Prisma.InputJsonValue,
    },
  });
}
