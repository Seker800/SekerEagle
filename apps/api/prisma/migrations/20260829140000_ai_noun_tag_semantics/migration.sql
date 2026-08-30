ALTER TYPE "EagleMediaJobKind" ADD VALUE IF NOT EXISTS 'GENERATE_AI_TAGS';

ALTER TABLE "EagleAiTag"
  ADD COLUMN "embeddingSpaceId" TEXT,
  ADD COLUMN "embedding" vector(1024);

ALTER TABLE "EagleAiTag"
  ADD CONSTRAINT "EagleAiTag_embeddingSpaceId_fkey"
  FOREIGN KEY ("embeddingSpaceId") REFERENCES "EagleEmbeddingSpace"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE INDEX "EagleAiTag_ownerId_embeddingSpaceId_idx"
  ON "EagleAiTag"("ownerId", "embeddingSpaceId");

CREATE INDEX "EagleAiTag_embedding_hnsw_idx"
  ON "EagleAiTag" USING hnsw ("embedding" vector_cosine_ops)
  WHERE "embedding" IS NOT NULL;
