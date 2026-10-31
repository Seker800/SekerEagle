import { randomUUID } from 'node:crypto';
import type { EagleAsset, Prisma, PrismaClient } from '@prisma/client';
import { assertDeletionKey } from './asset-purge';

type Asset = Pick<EagleAsset, 'id' | 'ownerId' | 'libraryMode' | 'mediaRevision'>;

/** An attempt owns unpublished bytes; only its publication transaction can adopt them. */
export class MediaOutputAttempt {
  readonly prefix: string;
  private receipt?: PromiseLike<{ id: string }>;
  private readonly retentionMs: number;
  constructor(
    private readonly prisma: Pick<PrismaClient, 'eagleObjectDeletion'>,
    private readonly asset: Asset,
    kind: 'renditions' | 'pyramids',
  ) {
    if (!Number.isSafeInteger(asset.mediaRevision) || asset.mediaRevision < 0)
      throw new Error('INVALID_MEDIA_OUTPUT_REVISION');
    this.prefix = `users/${asset.ownerId}/assets/${asset.id}/${kind}/${asset.mediaRevision}/attempts/${randomUUID()}/`;
    assertDeletionKey(asset.ownerId, this.prefix);
    this.retentionMs = Number(process.env.EAGLE_MEDIA_OUTPUT_RETENTION_MS ?? 86400000);
    if (
      !Number.isSafeInteger(this.retentionMs) ||
      this.retentionMs <= 0 ||
      !Number.isFinite(new Date(Date.now() + this.retentionMs).getTime())
    )
      throw new Error('EAGLE_MEDIA_OUTPUT_RETENTION_MS must be a positive duration');
  }
  key(relative: string) {
    if (
      !/^[a-zA-Z0-9_./-]+$/.test(relative) ||
      relative.split('/').some((part) => !part || part === '.' || part === '..')
    )
      throw new Error('INVALID_MEDIA_OUTPUT_KEY');
    return this.prefix + relative;
  }
  async prepare() {
    this.receipt ??= this.prisma.eagleObjectDeletion.create({
      data: {
        ownerId: this.asset.ownerId,
        libraryMode: this.asset.libraryMode,
        objectKeys: [],
        prefixes: [this.prefix],
        availableAt: new Date(Date.now() + this.retentionMs),
      },
    });
    await this.receipt;
  }
  async publish(tx: Prisma.TransactionClient) {
    if (!this.receipt) return;
    const { id } = await this.receipt;
    const retained = await tx.eagleObjectDeletion.deleteMany({
      where: {
        id,
        ownerId: this.asset.ownerId,
        libraryMode: this.asset.libraryMode,
        status: 'PENDING',
      },
    });
    if (retained.count !== 1) throw new Error('MEDIA_OUTPUT_PUBLICATION_EXPIRED');
  }
  async finish(published: boolean) {
    if (published || !this.receipt) return;
    let receipt: { id: string };
    try {
      receipt = await this.receipt;
    } catch {
      return;
    }
    // Never recreate a vanished intent: an ambiguous DB response may already have published it.
    await this.prisma.eagleObjectDeletion.updateMany({
      where: {
        id: receipt.id,
        ownerId: this.asset.ownerId,
        libraryMode: this.asset.libraryMode,
        status: 'PENDING',
      },
      data: { availableAt: new Date() },
    });
  }
}
