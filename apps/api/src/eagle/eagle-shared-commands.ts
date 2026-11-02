import { prepareQueuedMetadata, applyQueuedMetadata } from './eagle-queued-metadata';
import type { Prisma } from '@prisma/client';
import { libraryCommandPayload } from './eagle-library-command';
import type { LibraryCommandRegistry } from './eagle-library-command';
import type { EagleService } from './eagle.service';
import type { EaglePrivacyService, EaglePrivacySettings } from './eagle-privacy.service';
import type { EagleVectorService } from './eagle-vector.service';
import type { EagleProcessingService } from './eagle-processing.service';
import type { BatchUpdateEagleAssetsDto, UpdateManualTagDto } from './eagle.dto';

const strings = (value: Prisma.InputJsonValue | null | undefined) => value as string[];
const chunks = <T>(items: T[], size = 100): T[][] => {
  const parts: T[][] = [];
  for (let offset = 0; offset < items.length; offset += size)
    parts.push(items.slice(offset, offset + size));
  return parts;
};
const assetPartitions = (payload: Prisma.InputJsonObject, assetIds: string[]) =>
  chunks(assetIds).map((ids) => ({ payload, assetIds: ids }));

/** Domain rules only. The operation engine owns admission, leases and publication. */
export function registerSharedLibraryCommands(
  registry: LibraryCommandRegistry,
  {
    eagle,
    privacy,
    vectors,
    processing,
  }: {
    eagle: EagleService;
    privacy: EaglePrivacyService;
    vectors: EagleVectorService;
    processing: EagleProcessingService;
  },
) {
  registry.register('ASSET_TAGS', {
    protocol: 'METADATA',
    partition: assetPartitions,
    admit: (context, payload) =>
      eagle.assertCommandTags(context.ownerId, [
        ...strings(payload.addTagIds),
        ...strings(payload.removeTagIds),
      ]),
    apply: async (tx, context, payload, assetIds) => {
      await eagle.batchChangeManualTags(
        context.ownerId,
        {
          assetIds,
          addTagIds: strings(payload.addTagIds),
          removeTagIds: strings(payload.removeTagIds),
          clearAll: payload.clearAll as boolean | undefined,
        },
        context.includePrivate,
        tx,
      );
    },
  });
  registry.register('ASSET_TAGS_REPLACE', {
    protocol: 'METADATA',
    partition: assetPartitions,
    admit: (context, payload) => eagle.assertCommandTags(context.ownerId, strings(payload.tagIds)),
    apply: async (tx, context, payload, assetIds) => {
      for (const assetId of assetIds)
        await eagle.replaceAssetTags(
          context.ownerId,
          assetId,
          strings(payload.tagIds),
          context.includePrivate,
          tx,
        );
    },
  });
  registry.register('ASSET_UPDATE', {
    protocol: 'METADATA',
    prepare: (context, payload, ids, tx) => prepareQueuedMetadata(tx, context, payload, ids),
    partition: (payload, assetIds) => {
      const input = payload as unknown as BatchUpdateEagleAssetsDto;
      const versions = new Map(input.assets.map((asset) => [asset.assetId, asset]));
      const bases = new Map(
        (payload.queueBase as unknown as Array<{ assetId: string }> | undefined)?.map((base) => [
          base.assetId,
          base,
        ]),
      );
      return chunks(assetIds).map((ids) => ({
        assetIds: ids,
        payload: libraryCommandPayload({
          ...input,
          assets: ids.map((id) => versions.get(id)),
          ...('queueBase' in payload
            ? {
                queueBase: ids.map((id) => bases.get(id)),
              }
            : {}),
        }),
      }));
    },
    apply: (tx, context, payload) => applyQueuedMetadata(eagle, tx, context, payload),
  });
  registry.register('TAG_UPDATE', {
    protocol: 'METADATA',
    admit: (context, payload) =>
      eagle.assertCommandTags(
        context.ownerId,
        [payload.tagId as string],
        (payload.input as unknown as UpdateManualTagDto).groupId,
      ),
    apply: async (tx, context, payload) => {
      await eagle.updateManualTag(
        context.ownerId,
        payload.tagId as string,
        payload.input as unknown as UpdateManualTagDto,
        context.includePrivate,
        tx,
      );
    },
  });
  registry.register('TAG_DELETE', {
    protocol: 'METADATA',
    admit: (context, payload) =>
      eagle.assertCommandTags(context.ownerId, [payload.tagId as string]),
    apply: async (tx, context, payload) => {
      await eagle.deleteManualTag(context.ownerId, payload.tagId as string, tx);
    },
  });
  registry.register('TAG_GROUP_DELETE', {
    protocol: 'METADATA',
    admit: (context, payload) =>
      eagle.assertCommandTags(context.ownerId, [], payload.groupId as string),
    apply: async (tx, context, payload) => {
      await eagle.deleteManualTagGroup(context.ownerId, payload.groupId as string, tx);
    },
  });
  registry.register('PRIVACY_SETTINGS', {
    protocol: 'METADATA',
    admit: (context, payload) => eagle.assertCommandTags(context.ownerId, strings(payload.tagIds)),
    apply: async (tx, context, payload) => {
      await privacy.updateSettings(
        context.ownerId,
        payload as unknown as EaglePrivacySettings & { expectedTagIds: string[] },
        tx,
      );
    },
  });
  registry.register('VECTOR_REVIEW', {
    protocol: 'METADATA',
    admit: (context, payload) =>
      vectors.assertCommandSuggestions(
        context.ownerId,
        strings(payload.suggestionIds),
        context.includePrivate,
      ),
    partition: (payload) =>
      chunks(strings(payload.suggestionIds)).map((suggestionIds) => ({
        payload: { ...payload, suggestionIds },
        assetIds: [],
      })),
    apply: async (tx, context, payload) => {
      await vectors.reviewSuggestions(
        context.ownerId,
        strings(payload.suggestionIds),
        payload.action as 'ACCEPT' | 'REJECT',
        context.includePrivate,
        tx,
      );
    },
  });
  registry.register('PROCESSING_RECONCILE', {
    protocol: 'BACKGROUND',
    execute: async (context) => {
      await processing.reconcile(context.ownerId, context.includePrivate, context.beforePublish);
    },
  });
  registry.register('PROCESSING_RETRY_FAILED', {
    protocol: 'BACKGROUND',
    execute: async (context) => {
      await processing.retryFailed(context.ownerId, context.includePrivate, context.beforePublish);
    },
  });
  registry.register('VECTOR_SCAN_MISSING', {
    protocol: 'BACKGROUND',
    execute: async (context) => {
      await vectors.scanMissingEmbeddings(
        context.ownerId,
        context.includePrivate,
        context.beforePublish,
      );
    },
  });
  registry.register('VECTOR_SCAN_UNCLASSIFIED', {
    protocol: 'BACKGROUND',
    execute: async (context) => {
      await vectors.scanUnclassifiedSuggestions(
        context.ownerId,
        context.includePrivate,
        context.beforePublish,
      );
    },
  });
  registry.register('VECTOR_RETRY_FAILED', {
    protocol: 'BACKGROUND',
    execute: async (context) => {
      await vectors.retryFailedEmbeddings(
        context.ownerId,
        context.includePrivate,
        context.beforePublish,
      );
    },
  });
}
