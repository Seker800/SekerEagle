import { Injectable, Inject, Optional } from '@nestjs/common';
import { Prisma, type LibraryMode } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { EagleEmbeddingClient } from './eagle-embedding-client';
import type { EagleAssetSort } from './eagle-asset-order';
import { LIBRARY_MODE } from './library-mode';
import { EAGLE_EMBEDDING_DIMENSIONS, EAGLE_EMBEDDING_MODEL } from './eagle-vector-semantics';

export type ImageSearchContext =
  { status: 'READY'; spaceId: string; vector: string } | { status: 'UNAVAILABLE'; spaceId: string };
export interface ImageSearchPosition {
  assetId: string;
  tier: number;
  similarity: number;
  libraryAddedAt: string;
}
const DEFAULT_REVISION = '9f2f7e710d6d81056aa5c0a4f04764fec6bb7bda';
const CACHE_TTL = 5 * 60 * 1000,
  CACHE_LIMIT = 128;

@Injectable()
export class EagleImageSearchService {
  private readonly cache = new Map<
    string,
    { expires: number; value: Promise<ImageSearchContext> }
  >();
  constructor(
    private readonly prisma: PrismaService,
    private readonly embeddings: EagleEmbeddingClient,
    @Optional() @Inject(LIBRARY_MODE) private readonly libraryMode: LibraryMode = 'MATERIAL',
  ) {}
  prepare(ownerId: string, query: string): Promise<ImageSearchContext> {
    const spaceId = process.env.MLX_EMBEDDING_SPACE_ID ?? 'qwen3-vl-embedding-2b-1024-v1';
    const revision = process.env.MLX_EMBEDDING_REVISION ?? DEFAULT_REVISION;
    const text = query.normalize('NFKC').trim();
    const key = JSON.stringify([ownerId, this.libraryMode, spaceId, revision, text]);
    const cached = this.cache.get(key);
    if (cached && cached.expires > Date.now()) return cached.value;
    if (cached) this.cache.delete(key);
    const value = this.prepareVector(text, spaceId, revision);
    if (this.cache.size >= CACHE_LIMIT) this.cache.delete(this.cache.keys().next().value!);
    this.cache.set(key, { expires: Date.now() + CACHE_TTL, value });
    void value.then(
      (result) => {
        if (result.status === 'UNAVAILABLE' && this.cache.get(key)?.value === value)
          this.cache.delete(key);
      },
      () => {
        if (this.cache.get(key)?.value === value) this.cache.delete(key);
      },
    );
    return value;
  }
  private async prepareVector(
    text: string,
    spaceId: string,
    revision: string,
  ): Promise<ImageSearchContext> {
    const unavailable: ImageSearchContext = { status: 'UNAVAILABLE', spaceId };
    const space = await this.prisma.eagleEmbeddingSpace.findUnique({ where: { id: spaceId } });
    if (
      !text ||
      !space ||
      !space.isCurrent ||
      space.model !== EAGLE_EMBEDDING_MODEL ||
      space.revision !== revision ||
      space.dimensions !== EAGLE_EMBEDDING_DIMENSIONS ||
      !space.normalized ||
      space.instructionVersion !== 'image-retrieval-v1' ||
      space.preprocessingVersion !== 'preview-webp-v1'
    )
      return unavailable;
    try {
      const result = await this.embeddings.embedText(text);
      if (result.revision !== space.revision) return unavailable;
      return { status: 'READY', spaceId, vector: `[${result.embedding.join(',')}]` };
    } catch {
      return unavailable;
    }
  }
  async rankPage(
    ownerId: string,
    search: string,
    context: ImageSearchContext,
    after: ImageSearchPosition | undefined,
    limit: number,
    includePrivate: boolean,
    trash: boolean,
    allowedAssetIds?: readonly string[],
    sort?: EagleAssetSort,
  ): Promise<ImageSearchPosition[]> {
    if (allowedAssetIds?.length === 0 || limit === 0) return [];
    const normalized = search.normalize('NFKC').trim().toLocaleLowerCase('zh-CN');
    const eligibility = allowedAssetIds
      ? Prisma.sql`AND asset.id = ANY(${[...allowedAssetIds]}::text[])`
      : Prisma.empty;
    const visible = Prisma.sql`asset."ownerId"=${ownerId} AND asset."libraryMode"=${this.libraryMode}::"LibraryMode"
      ${trash ? Prisma.sql`AND asset."deletedAt" IS NOT NULL AND asset."purgeAfter" IS NULL` : Prisma.sql`AND asset."deletedAt" IS NULL`}
      ${includePrivate ? Prisma.empty : Prisma.sql`AND asset."isPrivate"=false`} ${eligibility}`;
    const configured = Number(process.env.EAGLE_IMAGE_SEARCH_MINIMUM_SIMILARITY ?? '0.25');
    const threshold =
      Number.isFinite(configured) && configured >= 0 && configured <= 1 ? configured : 0.25;
    const semantic =
      context.status === 'READY'
        ? Prisma.sql`
      UNION ALL
      SELECT asset.id, 1::integer, (1-(embedding.embedding <=> ${context.vector}::vector))::double precision
      FROM "EagleAssetEmbedding" AS embedding
      JOIN "EagleAsset" AS asset ON asset.id=embedding."assetId" AND asset."ownerId"=embedding."ownerId" AND asset."libraryMode"=embedding."libraryMode"
      WHERE ${visible} AND embedding."ownerId"=${ownerId} AND embedding."libraryMode"=${this.libraryMode}::"LibraryMode"
        AND embedding."spaceId"=${context.spaceId} AND embedding.status='READY' AND embedding."isCurrent"=true
        AND embedding."assetRevision"=asset."mediaRevision" AND embedding.embedding IS NOT NULL
        AND 1-(embedding.embedding <=> ${context.vector}::vector)>=${threshold}
    `
        : Prisma.empty;
    // Columns are selected from fixed literals, never interpolated from user input.
    const dateColumn =
      sort === 'CAPTURED_AT'
        ? Prisma.sql`asset."chronologicalAt"`
        : Prisma.sql`asset."libraryAddedAt"`;
    const order = sort
      ? Prisma.sql`${dateColumn} DESC,ranked."assetId" DESC`
      : Prisma.sql`ranked.tier DESC,ranked.similarity DESC,asset."libraryAddedAt" DESC,ranked."assetId" DESC`;
    const continuation =
      sort && after
        ? Prisma.sql`WHERE (${dateColumn}, ranked."assetId") < (${new Date(after.libraryAddedAt)}, ${after.assetId})`
        : after
          ? Prisma.sql`WHERE (ranked.tier, ranked.similarity, asset."libraryAddedAt", ranked."assetId") < (${after.tier}, ${after.similarity}, ${new Date(after.libraryAddedAt)}, ${after.assetId})`
          : Prisma.empty;
    const rows = await this.prisma.$queryRaw<
      Array<{ assetId: string; tier: number; similarity: number; libraryAddedAt: Date }>
    >(Prisma.sql`
      WITH candidates("assetId",tier,similarity) AS (
        SELECT asset.id, 3::integer, 1::double precision FROM "EagleAsset" AS asset
        WHERE ${visible} AND (strpos(asset."normalizedDisplayName",${normalized})>0 OR strpos(lower(asset."originalName"),${normalized})>0)
        UNION ALL
        SELECT asset.id, CASE WHEN tag."normalizedName"=${normalized} THEN 5 ELSE 4 END, 1::double precision
        FROM "EagleAssetManualTag" AS link
        JOIN "EagleManualTag" AS tag ON tag.id=link."tagId" AND tag."ownerId"=link."ownerId" AND tag."libraryMode"=link."libraryMode"
        JOIN "EagleAsset" AS asset ON asset.id=link."assetId" AND asset."ownerId"=link."ownerId" AND asset."libraryMode"=link."libraryMode"
        WHERE ${visible} AND strpos(tag."normalizedName",${normalized})>0
        ${semantic}
      ), ranked AS (SELECT "assetId",max(tier) AS tier,max(similarity) AS similarity FROM candidates GROUP BY "assetId")
      SELECT ranked."assetId", ranked.tier, ranked.similarity, ${dateColumn} AS "libraryAddedAt" FROM ranked JOIN "EagleAsset" AS asset ON asset.id=ranked."assetId"
      ${continuation}
      ORDER BY ${order}
      LIMIT ${limit}
    `);
    return rows.map((row) => ({ ...row, libraryAddedAt: row.libraryAddedAt.toISOString() }));
  }
}
