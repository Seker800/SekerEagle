import { BadRequestException, ConflictException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import type { LibraryCommandRegistry } from '../eagle/eagle-library-command';
import type { PhotoManagementService } from './photo-management.service';
import type { PhotoPersonReviewService } from './photo-person-review.service';
import type { PhotoAgentService } from './photo-agent.service';
import type { PersonReviewDto, MergeSelectedPeopleDto } from './photo-management.controller';
import type {
  ManualPhotoActionDto,
  ReviewPhotoRequestDto,
  ReviewPhotoSuggestionDto,
} from './photo-agent.dto';

/** The shared operation engine owns acceptance, authority, lease, transaction and receipts. */
export function registerPhotoLibraryCommands(
  registry: LibraryCommandRegistry,
  services: {
    photos: PhotoManagementService;
    review: PhotoPersonReviewService;
    agent: PhotoAgentService;
  },
) {
  const { photos, review, agent } = services;
  const photoOnly = (mode: string) => {
    if (mode !== 'PHOTO') throw new BadRequestException('此操作仅用于照片图库。');
  };
  type Context = {
    ownerId: string;
    includePrivate: boolean;
    libraryMode: string;
    beforePublish: (tx: Prisma.TransactionClient) => Promise<void>;
  };
  function metadata<T extends object>(
    type: string,
    apply: (tx: Prisma.TransactionClient, c: Context, p: T) => Promise<unknown>,
  ) {
    registry.register(type, {
      protocol: 'METADATA',
      async admit(c, payload) {
        photoOnly(c.libraryMode);
        await photos.admitCommand(c.ownerId, c.includePrivate, type, payload);
      },
      async apply(tx, c, payload) {
        photoOnly(c.libraryMode);
        await apply(tx, c, payload as unknown as T);
      },
    });
  }
  function background<T extends object>(
    type: string,
    execute: (c: Context, p: T) => Promise<unknown>,
  ) {
    registry.register(type, {
      protocol: 'BACKGROUND',
      async admit(c, payload) {
        photoOnly(c.libraryMode);
        if (type.startsWith('PHOTO_AGENT_'))
          await agent.admitCommand(c.ownerId, c.includePrivate, payload);
      },
      async execute(c, payload) {
        photoOnly(c.libraryMode);
        await execute(c, payload as unknown as T);
      },
    });
  }
  metadata<{ id: string; name: string }>('PHOTO_PERSON_RENAME', (tx, c, p) =>
    photos.renamePerson(c.ownerId, p.id, p.name, c.includePrivate, tx),
  );
  metadata<{ id: string; marksAssetsPrivate: boolean; rowVersion: number }>(
    'PHOTO_PERSON_PRIVACY',
    (tx, c, p) =>
      photos.setPersonPrivacy(
        c.ownerId,
        p.id,
        p.marksAssetsPrivate,
        p.rowVersion,
        c.includePrivate,
        tx,
      ),
  );
  metadata<{ id: string; targetId: string }>('PHOTO_PEOPLE_MERGE', (tx, c, p) =>
    photos.mergePeople(c.ownerId, p.id, p.targetId, c.includePrivate, undefined, tx),
  );
  metadata<MergeSelectedPeopleDto>('PHOTO_PEOPLE_MERGE_SELECTED', (tx, c, p) =>
    photos.mergeSelection(c.ownerId, c.includePrivate, p.targetId, p.people, tx),
  );
  metadata<{ id: string; personId: string | null }>('PHOTO_FACE_REASSIGN', (tx, c, p) =>
    photos.reassignFace(c.ownerId, p.id, p.personId, c.includePrivate, tx),
  );
  metadata<PersonReviewDto>('PHOTO_PEOPLE_REVIEW', (tx, c, p) =>
    review.decide(c.ownerId, c.includePrivate, p, tx),
  );
  background('PHOTO_PEOPLE_SCAN', (c) =>
    photos.scanFaces(c.ownerId, c.includePrivate, c.beforePublish),
  );
  background('PHOTO_GROUPS_SCAN', (c) =>
    photos.scanGroups(c.ownerId, c.includePrivate, c.beforePublish),
  );
  metadata<{ assetIds: string[] }>('PHOTO_GROUP_CREATE', (tx, c, p) =>
    photos.createGroup(c.ownerId, p.assetIds, c.includePrivate, tx),
  );
  metadata<{ id: string; assetIds: string[] }>('PHOTO_GROUP_REMOVE_MEMBERS', (tx, c, p) =>
    photos.removeGroupMembers(c.ownerId, p.id, p.assetIds, c.includePrivate, tx),
  );
  metadata<{ id: string; targetId: string }>('PHOTO_GROUP_MERGE', (tx, c, p) =>
    photos.mergeGroups(c.ownerId, p.id, p.targetId, c.includePrivate, tx),
  );
  metadata<{ id: string; dismissed?: boolean; bestAssetId?: string }>(
    'PHOTO_GROUP_UPDATE',
    (tx, c, p) => photos.updateGroup(c.ownerId, p.id, p, c.includePrivate, tx),
  );
  background<ReviewPhotoRequestDto & { taskId: string }>(
    'PHOTO_AGENT_REVIEW_BATCH',
    async (c, p) => {
      const result = await agent.reviewBatch(
        c.ownerId,
        p.taskId,
        p,
        c.includePrivate,
        c.beforePublish,
      );
      if (result.failed)
        throw new ConflictException(
          `整理审批已完成 ${result.succeeded} 项，${result.failed} 项失败；请查看申请记录。`,
        );
    },
  );
  background<ReviewPhotoSuggestionDto & { taskId: string; suggestionId: string }>(
    'PHOTO_AGENT_REVIEW',
    (c, p) =>
      agent.review(c.ownerId, p.taskId, p.suggestionId, p, c.includePrivate, c.beforePublish),
  );
  background<{ taskId: string; suggestionId: string }>('PHOTO_AGENT_UNDO', (c, p) =>
    agent.undo(c.ownerId, p.taskId, p.suggestionId, c.includePrivate, c.beforePublish),
  );
  background<ManualPhotoActionDto & { taskId: string }>('PHOTO_AGENT_MANUAL', (c, p) =>
    agent.manualAction(c.ownerId, p.taskId, p, c.includePrivate, c.beforePublish),
  );
}
