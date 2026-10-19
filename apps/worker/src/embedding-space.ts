import { Prisma } from '@prisma/client';

export interface EmbeddingSpaceIdentity {
  id: string;
  model: string;
  revision: string;
  dimensions: number;
  instructionVersion: string;
  preprocessingVersion: string;
  normalized: boolean;
}

// A model/config change needs an explicit rebuild and activation, never an in-place rename.
export async function ensureCompatibleEmbeddingSpace(
  client: Pick<Prisma.TransactionClient, '$executeRaw' | 'eagleEmbeddingSpace'>,
  identity: EmbeddingSpaceIdentity,
) {
  await client.$executeRaw(Prisma.sql`SELECT pg_advisory_xact_lock(7012843)`);
  const spaces = await client.eagleEmbeddingSpace.findMany({
    where: { OR: [{ id: identity.id }, { isCurrent: true }] },
  });
  const existing = spaces.find((space) => space.id === identity.id);
  if (
    spaces.some((space) => space.isCurrent && space.id !== identity.id) ||
    (existing &&
      Object.entries(identity).some(
        ([key, value]) => existing[key as keyof typeof existing] !== value,
      ))
  ) {
    throw new Error(
      'EMBEDDING_SPACE_INCOMPATIBLE: rebuild and activate a new space explicitly before changing the worker model',
    );
  }
  if (!existing)
    await client.eagleEmbeddingSpace.create({ data: { ...identity, isCurrent: true } });
  else if (!existing.isCurrent) throw new Error('EMBEDDING_SPACE_NOT_ACTIVE');
}
