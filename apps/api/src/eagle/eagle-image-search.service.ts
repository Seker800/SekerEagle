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
    if (sort) {
      // Traverse the existing chronological index and stop when the page is full.
      // Per-asset probes preserve exact matching; there is no global top-K cutoff.
      const date =
        sort === 'CAPTURED_AT'
          ? Prisma.sql`asset."chronologicalAt"`
          : Prisma.sql`asset."libraryAddedAt"`;
      const nameMatch = Prisma.sql`(strpos(asset."normalizedDisplayName",${normalized})>0 OR strpos(lower(asset."originalName"),${normalized})>0)`;
      const semanticProbe =
        context.status === 'READY'
          ? Prisma.sql`
        SELECT max(1-(embedding.embedding <=> ${context.vector}::vector))::double precision AS similarity
        FROM "EagleAssetEmbedding" embedding
        WHERE embedding."ownerId"=asset."ownerId" AND embedding."libraryMode"=asset."libraryMode"
          AND embedding."assetId"=asset.id AND embedding."spaceId"=${context.spaceId}
          AND embedding.status='READY' AND embedding."isCurrent"=true
          AND embedding."assetRevision"=asset."mediaRevision" AND embedding.embedding IS NOT NULL
      `
          : Prisma.sql`SELECT NULL::double precision AS similarity`;
      const page: ImageSearchPosition[] = [];
      const windowSize = Math.max(64, Math.min(1000, limit * 4));
      let position = after;
      for (;;) {
        const rows = await this.prisma.$queryRaw<
          Array<{
            assetId: string;
            tier: number;
            similarity: number;
            libraryAddedAt: Date;
            matches: boolean;
          }>
        >(Prisma.sql`
        WITH ordered AS MATERIALIZED (
          SELECT asset.id,asset."ownerId",asset."libraryMode",asset."mediaRevision",asset."normalizedDisplayName",asset."originalName",${date} AS "orderDate" FROM "EagleAsset" asset
          WHERE ${visible}
          ${position ? Prisma.sql`AND (${date},asset.id)<(${new Date(position.libraryAddedAt)},${position.assetId})` : Prisma.empty}
          ORDER BY ${date} DESC,asset.id DESC LIMIT ${windowSize}
        )
        SELECT asset.id AS "assetId",
          GREATEST(CASE WHEN ${nameMatch} THEN 3 ELSE 0 END,COALESCE(manual.tier,0),CASE WHEN semantic.similarity>=${threshold} THEN 1 ELSE 0 END)::integer AS tier,
          GREATEST(CASE WHEN ${nameMatch} OR manual.tier IS NOT NULL THEN 1::double precision ELSE 0::double precision END,COALESCE(semantic.similarity,0)) AS similarity,
          asset."orderDate" AS "libraryAddedAt",
          (${nameMatch} OR manual.tier IS NOT NULL OR COALESCE(semantic.similarity>=${threshold},false)) AS matches
        FROM ordered asset
        LEFT JOIN LATERAL (
          SELECT max(CASE WHEN tag."normalizedName"=${normalized} THEN 5 ELSE 4 END)::integer AS tier
          FROM "EagleAssetManualTag" link JOIN "EagleManualTag" tag
            ON tag.id=link."tagId" AND tag."ownerId"=link."ownerId" AND tag."libraryMode"=link."libraryMode"
          WHERE link."ownerId"=asset."ownerId" AND link."libraryMode"=asset."libraryMode" AND link."assetId"=asset.id
            AND strpos(tag."normalizedName",${normalized})>0
        ) manual ON true
        LEFT JOIN LATERAL (${semanticProbe}) semantic ON true
        ORDER BY asset."orderDate" DESC,asset.id DESC
      `);
        for (const row of rows) {
          if (!row.matches) continue;
          page.push({
            assetId: row.assetId,
            tier: row.tier,
            similarity: row.similarity,
            libraryAddedAt: row.libraryAddedAt.toISOString(),
          });
          if (page.length >= limit) return page;
        }
        if (rows.length < windowSize) return page;
        const last = rows.at(-1)!;
        position = { ...last, libraryAddedAt: last.libraryAddedAt.toISOString() };
      }
    }

    // Materialize only scalar scores, never vectors: filtering and ranking share
    // one distance evaluation and one TOAST read per eligible embedding.
    const semanticCte =
      context.status === 'READY'
        ? Prisma.sql`
      semantic_scored AS MATERIALIZED (
        SELECT asset.id AS "assetId",(1-(embedding.embedding <=> ${context.vector}::vector))::double precision AS similarity
        FROM "EagleAssetEmbedding" embedding
        JOIN "EagleAsset" asset ON asset.id=embedding."assetId" AND asset."ownerId"=embedding."ownerId" AND asset."libraryMode"=embedding."libraryMode"
        WHERE ${visible} AND embedding."ownerId"=${ownerId} AND embedding."libraryMode"=${this.libraryMode}::"LibraryMode"
          AND embedding."spaceId"=${context.spaceId} AND embedding.status='READY' AND embedding."isCurrent"=true
          AND embedding."assetRevision"=asset."mediaRevision" AND embedding.embedding IS NOT NULL
      ),
    `
        : Prisma.empty;
    const semantic =
      context.status === 'READY'
        ? Prisma.sql`
      UNION ALL SELECT "assetId",1::integer,similarity FROM semantic_scored WHERE similarity>=${threshold}
    `
        : Prisma.empty;
    const dateColumn = Prisma.sql`asset."libraryAddedAt"`;
    const order = Prisma.sql`ranked.tier DESC,ranked.similarity DESC,asset."libraryAddedAt" DESC,ranked."assetId" DESC`;
    const continuation = after
      ? Prisma.sql`WHERE (ranked.tier, ranked.similarity, asset."libraryAddedAt", ranked."assetId") < (${after.tier}, ${after.similarity}, ${new Date(after.libraryAddedAt)}, ${after.assetId})`
      : Prisma.empty;
    const rows = await this.prisma.$queryRaw<
      Array<{ assetId: string; tier: number; similarity: number; libraryAddedAt: Date }>
    >(Prisma.sql`
      WITH ${semanticCte} candidates("assetId",tier,similarity) AS (
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
