import { randomUUID } from 'node:crypto';
/** Pre-upgrade persisted copy plans remain covered separately from new ownership handoffs. */
export async function seedLegacyTransfer(
  db,
  ownerId,
  sourceMode,
  input,
  componentIds = input.assetIds,
) {
  const sources = await db.eagleAsset.findMany({
    where: { ownerId, libraryMode: sourceMode, id: { in: componentIds } },
    orderBy: { id: 'asc' },
  });
  const plan = sources.map((source) => {
    const targetId = randomUUID();
    return {
      sourceId: source.id,
      targetId,
      revision: source.mediaRevision,
      rowVersion: source.rowVersion,
      sourceKey: source.originalObjectKey,
      targetKey: `users/${ownerId}/assets/${targetId}/original.${source.format}`,
      size: String(source.byteSize),
    };
  });
  return db.eagleLibraryTransfer.create({
    data: {
      id: input.operationId,
      ownerId,
      sourceMode,
      targetMode: sourceMode === 'PHOTO' ? 'MATERIAL' : 'PHOTO',
      sourceIds: [...input.assetIds].sort(),
      plan,
    },
  });
}
