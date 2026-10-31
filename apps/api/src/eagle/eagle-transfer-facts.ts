import { EAGLE_EMBEDDING_MODEL } from '@sekereagle/vector-core';
import {
  Prisma,
  type LibraryMode,
  type EaglePhotoMetadata,
  type EaglePhotoLocation,
  type EagleManualTag,
} from '@prisma/client';
import { matchSmartFoldersForEmbedding } from '@sekereagle/library-persistence';
import { COLOR_THUMBNAIL_PROCESSOR_VERSION } from './media-job-plan';

export const transferFactIncludes = {
  imagePyramids: true,
  annotation: true,
  renditions: true,
  photoMetadata: true,
  photoLocation: true,
  editRecipe: true,
  transferFacts: true,
  manualTagLinks: {
    include: { tag: { include: { group: true, groupMemberships: { include: { group: true } } } } },
  },
  aiTagLinks: { include: { aiTag: true, analysisRun: true } },
  colorAnalyses: { where: { status: 'COMPLETED', isCurrent: true }, include: { swatches: true } },
} satisfies Prisma.EagleAssetInclude;
type Source = Prisma.EagleAssetGetPayload<{ include: typeof transferFactIncludes }>;
const metadataKeys = [
  'processorVersion',
  'capturedAt',
  'capturedLocal',
  'captureTimeZoneKnown',
  'captureMetadataInherited',
  'cameraMake',
  'cameraModel',
  'lensModel',
  'focalLength',
  'aperture',
  'exposureSeconds',
  'iso',
  'latitude',
  'longitude',
  'altitude',
  'sharpnessScore',
  'perceptualHash',
] as const;
const locationKeys = [
  'cityId',
  'name',
  'country',
  'region',
  'latitude',
  'longitude',
  'source',
  'precision',
  'accuracyMeters',
  'suggestionId',
] as const;
function pick<T, K extends keyof T>(value: T, keys: readonly K[]): Pick<T, K> {
  return Object.fromEntries(keys.map((k) => [k, value[k]])) as Pick<T, K>;
}
const json = (value: unknown): Prisma.InputJsonValue =>
  JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
type Metadata = Pick<EaglePhotoMetadata, (typeof metadataKeys)[number]>;
type Location = Pick<EaglePhotoLocation, (typeof locationKeys)[number]>;

async function copyTags(
  tx: Prisma.TransactionClient,
  ownerId: string,
  targetMode: LibraryMode,
  targetId: string,
  source: Source,
) {
  const tagIds = new Map<string, string>();
  let hasPrivateTag = false;
  for (const link of source.manualTagLinks ?? []) {
    const tag = link.tag;
    let target: EagleManualTag | undefined;
    for (let attempt = 0; attempt < 100; attempt++) {
      const name =
        attempt === 0
          ? tag.name
          : `${tag.name.slice(0, 180)} · ${source.libraryMode.toLowerCase()} ${tag.id.slice(0, 8)}${attempt === 1 ? '' : ` ${attempt}`}`;
      const normalizedName =
        attempt === 0 ? tag.normalizedName : name.normalize('NFKC').trim().toLowerCase();
      const existing = await tx.eagleManualTag.findUnique({
        where: {
          ownerId_libraryMode_normalizedName: { ownerId, libraryMode: targetMode, normalizedName },
        },
      });
      if (existing && existing.marksAssetsPrivate !== tag.marksAssetsPrivate) continue;
      if (existing) {
        target = existing;
        break;
      }
      const groups = [
        ...new Map(
          [...(tag.group ? [tag.group] : []), ...tag.groupMemberships.map((m) => m.group)].map(
            (g) => [g.id, g],
          ),
        ).values(),
      ];
      const mapped = new Map<string, string>();
      for (const group of groups) {
        const saved = await tx.eagleManualTagGroup.upsert({
          where: {
            ownerId_libraryMode_normalizedName: {
              ownerId,
              libraryMode: targetMode,
              normalizedName: group.normalizedName,
            },
          },
          update: {},
          create: {
            ownerId,
            libraryMode: targetMode,
            name: group.name,
            normalizedName: group.normalizedName,
            color: group.color,
            description: group.description,
          },
        });
        mapped.set(group.id, saved.id);
      }
      target = await tx.eagleManualTag.upsert({
        where: {
          ownerId_libraryMode_normalizedName: { ownerId, libraryMode: targetMode, normalizedName },
        },
        update: {},
        create: {
          ownerId,
          libraryMode: targetMode,
          name,
          normalizedName,
          color: tag.color,
          isStarred: tag.isStarred,
          marksAssetsPrivate: tag.marksAssetsPrivate,
          groupId: tag.groupId ? mapped.get(tag.groupId) : undefined,
        },
      });
      if (target.marksAssetsPrivate !== tag.marksAssetsPrivate) continue;
      if (mapped.size)
        await tx.eagleManualTagGroupMembership.createMany({
          data: [...mapped.values()].map((groupId) => ({
            ownerId,
            libraryMode: targetMode,
            tagId: target!.id,
            groupId,
          })),
          skipDuplicates: true,
        });
      break;
    }
    if (!target || target.marksAssetsPrivate !== tag.marksAssetsPrivate)
      throw new Error('无法映射目标库标签。');
    tagIds.set(tag.id, target.id);
    hasPrivateTag ||= target.marksAssetsPrivate;
    await tx.eagleAssetManualTag.createMany({
      data: [
        {
          ownerId,
          libraryMode: targetMode,
          assetId: targetId,
          tagId: target.id,
          assignedByUser: link.assignedByUser,
          assignmentProvenance: link.assignmentProvenance,
        },
      ],
      skipDuplicates: true,
    });
  }
  // Retired AI tags are existing results, not new model executions or new approval decisions.
  const runs = new Map<string, string>();
  for (const link of source.aiTagLinks ?? []) {
    if (link.analysisRun.assetRevision !== source.mediaRevision) continue;
    let runId = runs.get(link.analysisRunId);
    if (!runId) {
      const run = link.analysisRun;
      const created = await tx.eagleAiAnalysisRun.create({
        data: {
          ownerId,
          libraryMode: targetMode,
          assetId: targetId,
          assetRevision: 1,
          provider: run.provider,
          model: run.model,
          modelVersion: run.modelVersion,
          promptVersion: run.promptVersion,
          processorVersion: run.processorVersion,
          status: run.status,
          errorCode: run.errorCode,
          startedAt: run.startedAt,
          completedAt: run.completedAt,
          createdAt: run.createdAt,
        },
      });
      runId = created.id;
      runs.set(link.analysisRunId, runId);
    }
    const tag = await tx.eagleAiTag.upsert({
      where: {
        ownerId_libraryMode_normalizedName: {
          ownerId,
          libraryMode: targetMode,
          normalizedName: link.aiTag.normalizedName,
        },
      },
      update: {},
      create: {
        ownerId,
        libraryMode: targetMode,
        name: link.aiTag.name,
        normalizedName: link.aiTag.normalizedName,
      },
    });
    await tx.eagleAssetAiTag.create({
      data: {
        ownerId,
        libraryMode: targetMode,
        assetId: targetId,
        aiTagId: tag.id,
        analysisRunId: runId,
        confidence: link.confidence,
        status: link.status,
        promotedManualTagId: link.promotedManualTagId
          ? tagIds.get(link.promotedManualTagId)
          : undefined,
      },
    });
  }
  return hasPrivateTag;
}

/** Copy intrinsic results in the publication transaction, never source ownership or live task history. */
export async function copyTransferFacts(
  tx: Prisma.TransactionClient,
  ownerId: string,
  targetMode: LibraryMode,
  targetId: string,
  source: Source,
  sourceDetailsReady: boolean,
) {
  const hasPrivateTag = await copyTags(tx, ownerId, targetMode, targetId, source);
  const archive =
    source.transferFacts?.assetRevision === source.mediaRevision &&
    source.transferFacts.schemaVersion === 1
      ? source.transferFacts
      : null;
  const metadata =
    source.photoMetadata?.assetRevision === source.mediaRevision
      ? pick(source.photoMetadata, metadataKeys)
      : (archive?.photoMetadata as Metadata | null);
  const location =
    source.photoLocation?.assetRevision === source.mediaRevision
      ? pick(source.photoLocation, locationKeys)
      : (archive?.photoLocation as Location | null);
  const recipe =
    source.editRecipe?.assetRevision === source.mediaRevision
      ? { recipe: source.editRecipe.recipe, baseMediaRevision: source.editRecipe.baseMediaRevision }
      : archive?.editRecipe;
  // An existing edit rendition is not proof that photography metadata exists.
  const detailsReady = sourceDetailsReady && (targetMode !== 'PHOTO' || Boolean(metadata));
  await tx.eagleAssetTransferFacts.create({
    data: {
      ownerId,
      libraryMode: targetMode,
      assetId: targetId,
      assetRevision: 1,
      detailsReady,
      ...(metadata ? { photoMetadata: json(metadata) } : {}),
      ...(location ? { photoLocation: json(location) } : {}),
      ...(recipe ? { editRecipe: json(recipe) } : {}),
    },
  });
  if (targetMode === 'PHOTO') {
    if (metadata)
      await tx.eaglePhotoMetadata.create({
        data: {
          ...metadata,
          capturedAt: metadata.capturedAt ? new Date(String(metadata.capturedAt)) : null,
          ownerId,
          libraryMode: 'PHOTO',
          assetId: targetId,
          assetRevision: 1,
        },
      });
    if (location)
      await tx.eaglePhotoLocation.create({
        data: { ...location, ownerId, libraryMode: 'PHOTO', assetId: targetId, assetRevision: 1 },
      });
  }
  let paletteReady = false;
  for (const analysis of source.colorAnalyses ?? []) {
    if (
      analysis.assetRevision !== source.mediaRevision ||
      analysis.processorVersion !== COLOR_THUMBNAIL_PROCESSOR_VERSION
    )
      continue;
    const targetAnalysis = await tx.eagleAssetColorAnalysis.create({
      data: {
        ownerId,
        libraryMode: targetMode,
        assetId: targetId,
        assetRevision: 1,
        processorVersion: analysis.processorVersion,
        status: 'COMPLETED',
        isCurrent: true,
        startedAt: analysis.startedAt,
        completedAt: analysis.completedAt,
      },
    });
    await tx.eagleAssetColorSwatch.createMany({
      data: analysis.swatches.map((s) => ({
        ownerId,
        libraryMode: targetMode,
        analysisId: targetAnalysis.id,
        rank: s.rank,
        hex: s.hex,
        weight: s.weight,
        labL: s.labL,
        labA: s.labA,
        labB: s.labB,
      })),
    });
    paletteReady = true;
  }
  const copied = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
    INSERT INTO "EagleAssetEmbedding" (id,"ownerId","libraryMode","assetId","assetRevision","spaceId",status,"isCurrent",embedding,"l2Norm","startedAt","completedAt","updatedAt")
    SELECT gen_random_uuid()::text,${ownerId},${targetMode}::"LibraryMode",${targetId},1,e."spaceId",'READY',true,e.embedding,e."l2Norm",e."startedAt",e."completedAt",now()
    FROM "EagleAssetEmbedding" e JOIN "EagleEmbeddingSpace" s ON s.id=e."spaceId"
    WHERE e."ownerId"=${ownerId} AND e."libraryMode"=${source.libraryMode}::"LibraryMode" AND e."assetId"=${source.id}
      AND e."assetRevision"=${source.mediaRevision} AND e.status='READY' AND e."isCurrent" AND e.embedding IS NOT NULL
      AND s."isCurrent" AND s.normalized AND s.dimensions=1024 AND s.model=${EAGLE_EMBEDDING_MODEL}
      AND s."instructionVersion"='image-retrieval-v1' AND s."preprocessingVersion"='preview-webp-v1'  AND e."l2Norm" BETWEEN 0.99 AND 1.01
    RETURNING id
  `);
  for (const row of copied)
    await matchSmartFoldersForEmbedding(tx, { ownerId, libraryMode: targetMode }, row.id);
  return {
    hasPrivateTag,
    embeddingReady: copied.length > 0,
    paletteReady,
    detailsReady,
  };
}
