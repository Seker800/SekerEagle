import { Prisma, type PrismaClient } from '@prisma/client';

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

/** Cache initialization only. Every publication independently locks and checks the live identity. */
export function createEmbeddingSpaceInitializer(
  client: Pick<PrismaClient, '$transaction'>,
  identity: EmbeddingSpaceIdentity,
): () => Promise<void> {
  let initialized: Promise<void> | undefined;
  return () => {
    if (!initialized) {
      initialized = client
        .$transaction((tx) => ensureCompatibleEmbeddingSpace(tx, identity))
        .catch((error: unknown) => {
          initialized = undefined;
          throw error;
        });
    }
    return initialized;
  };
}

/** Text-folder publication has its own protocol, so retain its per-request compatibility check. */
export function createCompatibleTextEmbedding<T>(
  client: Pick<PrismaClient, '$transaction'>,
  identity: EmbeddingSpaceIdentity,
  request: (text: string) => Promise<T>,
): (text: string) => Promise<T> {
  return async (text) => {
    await client.$transaction((tx) => ensureCompatibleEmbeddingSpace(tx, identity));
    return request(text);
  };
}
