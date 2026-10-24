import type { LibraryMode } from '@prisma/client';
import { LIBRARY_MODE } from './library-mode';
import { Injectable, Optional, Inject } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { EagleEmbeddingClient } from './eagle-embedding-client';

export const AI_TAG_EMBEDDING_SPACE_ID =
  process.env.MLX_EMBEDDING_SPACE_ID ?? 'qwen3-vl-embedding-2b-1024-v1';

export interface EagleAiTagSearchMatch {
  id: string;
  name: string;
  match: 'EXACT' | 'SEMANTIC';
  similarity: number;
}

@Injectable()
export class EagleAiTagService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly embeddings: EagleEmbeddingClient,
    @Optional() @Inject(LIBRARY_MODE) private readonly libraryMode: LibraryMode = 'MATERIAL',
  ) {}

  async resolveSearchTags(ownerId: string, query: string): Promise<EagleAiTagSearchMatch[]> {
    const normalizedName = query.normalize('NFKC').trim().toLocaleLowerCase('zh-CN');
    if (!normalizedName) return [];
    const exact = await this.prisma.eagleAiTag.findFirst({
      where: { ownerId, normalizedName, libraryMode: this.libraryMode },
      select: { id: true, name: true },
    });
    let semantic: Array<{ id: string; name: string; similarity: number }> = [];
    try {
      const { embedding } = await this.embeddings.embedText(
        `图片中的具体物体、场所或内容类型：${normalizedName}`,
      );
      const vector = `[${embedding.join(',')}]`;
      const threshold = boundedSimilarity(process.env.EAGLE_AI_TAG_SEARCH_MINIMUM_SIMILARITY, 0.78);
      semantic = await this.prisma.$queryRaw(Prisma.sql`
        SELECT id, name, (1 - (embedding <=> ${vector}::vector))::double precision AS similarity
        FROM "EagleAiTag"
        WHERE "ownerId" = ${ownerId} AND "libraryMode" = ${this.libraryMode}::"LibraryMode"
          AND "embeddingSpaceId" = ${AI_TAG_EMBEDDING_SPACE_ID}
          AND embedding IS NOT NULL
          ${exact ? Prisma.sql`AND id <> ${exact.id}` : Prisma.empty}
          AND 1 - (embedding <=> ${vector}::vector) >= ${threshold}
        ORDER BY embedding <=> ${vector}::vector, id
        LIMIT 7
      `);
    } catch {
      // Exact matching remains available while the local embedding host is offline.
    }
    return [
      ...(exact ? [{ ...exact, match: 'EXACT' as const, similarity: 1 }] : []),
      ...semantic.map((tag) => ({ ...tag, match: 'SEMANTIC' as const })),
    ];
  }
}

function boundedSimilarity(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.min(0.99, Math.max(0.5, parsed)) : fallback;
}
