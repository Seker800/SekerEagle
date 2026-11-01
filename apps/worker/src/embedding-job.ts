import type { PrismaClient } from '@prisma/client';
import { createEmbeddingSpaceInitializer, type EmbeddingSpaceIdentity } from './embedding-space';
import {
  publishEmbedding,
  publishStoredEmbedding,
  type EmbeddingSuggestionPublisher,
  type PublicationJob,
} from './embedding-publication';

interface EmbeddingProcessorOptions {
  client: Pick<PrismaClient, '$transaction' | 'eagleAssetEmbedding'>;
  identity: EmbeddingSpaceIdentity;
  hasCredentials: boolean;
  embedImage: (bytes: Buffer, mimeType: string) => Promise<{ embedding: number[] }>;
  readSource: (source: AsyncIterable<Uint8Array>) => Promise<Buffer>;
  suggest: EmbeddingSuggestionPublisher;
}

/** Domain preparation and publication; the scheduler still owns leases and resource slots. */
export class EmbeddingProcessor {
  readonly initializeSpace: () => Promise<void>;
  private readonly identity: EmbeddingSpaceIdentity;

  constructor(private readonly options: EmbeddingProcessorOptions) {
    this.identity = Object.freeze({ ...options.identity });
    this.initializeSpace = createEmbeddingSpaceInitializer(options.client, this.identity);
  }

  async activateStored(job: PublicationJob): Promise<boolean> {
    await this.initializeSpace();
    return publishStoredEmbedding(this.options.client, job, this.identity, this.options.suggest);
  }

  async infer(
    job: PublicationJob,
    mimeType: string,
    source: AsyncIterable<Uint8Array>,
  ): Promise<void> {
    if (!this.options.hasCredentials) throw new Error('MLX_EMBEDDING_TOKEN_REQUIRED');
    await this.initializeSpace();
    const record = await this.options.client.eagleAssetEmbedding.upsert({
      where: {
        assetId_assetRevision_spaceId: {
          assetId: job.assetId,
          assetRevision: job.assetRevision,
          spaceId: this.identity.id,
        },
      },
      create: {
        ownerId: job.ownerId,
        libraryMode: job.libraryMode,
        assetId: job.assetId,
        assetRevision: job.assetRevision,
        spaceId: this.identity.id,
        status: 'RUNNING',
        startedAt: new Date(),
      },
      update: { status: 'RUNNING', errorCode: null, startedAt: new Date(), completedAt: null },
      select: { id: true },
    });
    const bytes = await this.options.readSource(source);
    const { embedding } = await this.options.embedImage(bytes, mimeType);
    // Immediate publication: there is no batch-fill wait, result buffer or second durability layer.
    await publishEmbedding(
      this.options.client,
      job,
      record.id,
      embedding,
      this.identity,
      this.options.suggest,
    );
  }
}
