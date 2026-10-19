import { invalidateMediaRevision } from './invalidate-media-revision';
import { Prisma } from '@prisma/client';
import { isCameraVideoMime } from '@sekereagle/library-core';
import type { LibraryMode } from '@prisma/client';
import {
  LIBRARY_MODE,
  LIBRARY_REVISION_OBSERVER,
  type LibraryRevisionObserver,
  inLibrary,
} from './library-mode';
import { randomUUID } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  Optional,
  Inject,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { createAssetObjectKey } from '../storage/object-key';
import { ObjectStorageService } from '../storage/object-storage.service';
import type { CompleteEagleUploadDto, InitiateEagleUploadDto } from './eagle-upload.dto';
import { EagleMediaCapabilityService } from './eagle-media-capability.service';
import { EagleUploadInspectionService } from './eagle-upload-inspection.service';
import { normalizeEagleUploadOriginalName } from './eagle-upload-policy';
import { buildImageProcessingJobs } from './media-job-plan';

@Injectable()
export class EagleUploadService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: ObjectStorageService,
    private readonly mediaCapabilities: EagleMediaCapabilityService,
    private readonly inspection: EagleUploadInspectionService,
    @Optional() @Inject(LIBRARY_MODE) private readonly libraryMode: LibraryMode = 'MATERIAL',
    @Optional()
    @Inject(LIBRARY_REVISION_OBSERVER)
    private readonly revisionObserver?: LibraryRevisionObserver,
  ) {}

  partSizeFor(size: number): number {
    return choosePartSize(size);
  }

  async initiate(ownerId: string, input: InitiateEagleUploadDto) {
    const originalName = normalizeEagleUploadOriginalName(input.originalName);
    const { mimeType } = this.mediaCapabilities.assertUploadAllowed({
      fileName: originalName,
      mimeType: input.mimeType,
      size: input.size,
    });
    const objectKey = createAssetObjectKey(ownerId, originalName);
    const multipartUploadId = await this.storage.createMultipartUpload(objectKey, mimeType);
    try {
      const session = await this.prisma.uploadSession.create({
        data: {
          uploaderId: ownerId,
          originalName,
          mimeType,
          size: BigInt(input.size),
          objectKey,
          multipartUploadId,
          eagleState: {
            create: {
              owner: { connect: { id: ownerId } },
              expectedContentSha256: input.contentSha256?.toLowerCase(),
              duplicatePolicy: input.duplicatePolicy ?? 'SKIP',
            },
          },
          libraryMode: this.libraryMode,
        },
        select: {
          id: true,
          status: true,
          originalName: true,
          mimeType: true,
          size: true,
          createdAt: true,
        },
      });
      return { ...session, size: Number(session.size), partSize: choosePartSize(input.size) };
    } catch (error) {
      await this.storage.abortMultipartUpload(objectKey, multipartUploadId).catch(() => undefined);
      throw error;
    }
  }

  async getSession(ownerId: string, uploadSessionId: string) {
    const session = await this.prisma.uploadSession.findFirst({
      where: { id: uploadSessionId, uploaderId: ownerId, libraryMode: this.libraryMode },
      select: {
        id: true,
        status: true,
        originalName: true,
        mimeType: true,
        size: true,
        eagleAssetId: true,
        lastError: true,
        createdAt: true,
        completedAt: true,
      },
    });
    if (!session) throw new NotFoundException('上传会话不存在。');
    return { ...session, size: Number(session.size) };
  }

  async presignPart(ownerId: string, uploadSessionId: string, partNumber: number) {
    if (!Number.isInteger(partNumber) || partNumber < 1 || partNumber > 10000) {
      throw new BadRequestException('分片编号无效。');
    }
    const session = await this.requireInitiated(ownerId, uploadSessionId);
    return {
      partNumber,
      uploadUrl: await this.storage.presignUploadPart(
        session.objectKey,
        session.multipartUploadId,
        partNumber,
      ),
      expiresInSeconds: 900,
    };
  }

  async listParts(ownerId: string, uploadSessionId: string) {
    const session = await this.requirePartListable(ownerId, uploadSessionId);
    if (session.status !== 'INITIATED') {
      return {
        uploadSessionId: session.id,
        parts: normalizeStoredParts(session.completionParts).map(({ PartNumber, ETag }) => ({
          partNumber: PartNumber,
          etag: ETag,
        })),
      };
    }
    return {
      uploadSessionId: session.id,
      parts: await this.storage.listMultipartUploadParts(
        session.objectKey,
        session.multipartUploadId,
      ),
    };
  }

  async complete(ownerId: string, uploadSessionId: string, input: CompleteEagleUploadDto) {
    const requestedParts = normalizeParts(input.parts);
    const session = await this.requireCompletable(ownerId, uploadSessionId);
    if (session.status === 'COMPLETED' && session.eagleAssetId) {
      return {
        uploadSessionId: session.id,
        assetId: session.eagleAssetId,
        status: session.objectCleanupPending ? 'READY' : 'PROCESSING',
        duplicate: session.objectCleanupPending,
      };
    }
    const parts =
      session.status === 'INITIATED'
        ? requestedParts
        : normalizeStoredParts(session.completionParts);
    if (session.status === 'INITIATED') {
      await this.prisma.uploadSession.updateMany({
        where: {
          id: session.id,
          uploaderId: ownerId,
          status: 'INITIATED',
          libraryMode: this.libraryMode,
        },
        data: { completionParts: parts },
      });
      try {
        await this.storage.completeMultipartUpload(
          session.objectKey,
          session.multipartUploadId,
          parts,
        );
      } catch (error) {
        await this.storage.headObject(session.objectKey).catch(() => {
          throw error;
        });
      }
      await this.prisma.uploadSession.updateMany({
        where: {
          id: session.id,
          uploaderId: ownerId,
          status: 'INITIATED',
          libraryMode: this.libraryMode,
        },
        data: { status: 'ASSEMBLED', assembledAt: new Date(), lastError: null },
      });
    }
    return this.finalizeAssembled({ ...session, status: 'ASSEMBLED' }, parts);
  }

  async recoverUploadSession(uploadSessionId: string) {
    const session = await this.prisma.uploadSession.findFirst({
      where: {
        id: uploadSessionId,
        status: { in: ['INITIATED', 'ASSEMBLED', 'FAILED'] },
        finalizationAttempts: { lt: 10 },
        libraryMode: this.libraryMode,
      },
      include: { eagleState: true },
    });
    if (!session || !session.completionParts) return null;
    const parts = normalizeStoredParts(session.completionParts);
    if (session.status === 'INITIATED') {
      try {
        await this.storage.completeMultipartUpload(
          session.objectKey,
          session.multipartUploadId,
          parts,
        );
      } catch (error) {
        await this.storage.headObject(session.objectKey).catch(() => {
          throw error;
        });
      }
      await this.prisma.uploadSession.updateMany({
        where: { id: session.id, status: 'INITIATED', libraryMode: this.libraryMode },
        data: { status: 'ASSEMBLED', assembledAt: new Date(), lastError: null },
      });
    }
    return this.finalizeAssembled({ ...session, status: 'ASSEMBLED' }, parts);
  }

  private async finalizeAssembled(
    session: Awaited<ReturnType<EagleUploadService['requireCompletable']>>,
    parts: ReturnType<typeof normalizeParts>,
  ) {
    const head = await this.storage.headObject(session.objectKey);
    if (head.ContentLength === undefined || BigInt(head.ContentLength) !== session.size) {
      await this.prisma.uploadSession.update({
        where: { id: session.id, libraryMode: this.libraryMode },
        data: {
          status: 'FAILED',
          finalizationAttempts: 10,
          lastError: 'OBJECT_SIZE_MISMATCH',
          objectCleanupPending: true,
        },
      });
      throw new BadRequestException('上传后的对象大小与声明不一致。');
    }
    const now = new Date();
    const assetId = randomUUID();
    const displayName = displayNameFromOriginal(session.originalName);
    let inspection;
    try {
      inspection = await this.inspection.inspect(
        session.objectKey,
        session.mimeType,
        session.uploaderId,
      );
      if (
        session.eagleState?.expectedContentSha256 &&
        session.eagleState.expectedContentSha256 !== inspection.sha256
      ) {
        throw new BadRequestException({
          code: 'CONTENT_HASH_MISMATCH',
          message: '上传文件内容与 Eagle manifest 的 SHA-256 不一致。',
        });
      }
    } catch (error) {
      const permanent = error instanceof BadRequestException;
      await this.prisma.uploadSession.updateMany({
        where: {
          id: session.id,
          uploaderId: session.uploaderId,
          status: { in: ['ASSEMBLED', 'FAILED'] },
          libraryMode: this.libraryMode,
        },
        data: {
          status: 'FAILED',
          finalizationAttempts: permanent ? 10 : { increment: 1 },
          lastError:
            error instanceof Error ? error.message.slice(0, 2000) : 'MEDIA_INSPECTION_FAILED',
          objectCleanupPending: permanent,
        },
      });
      throw error;
    }
    try {
      const finalized = await this.prisma.$transaction(async (transaction) => {
        const claimed = await transaction.uploadSession.updateMany({
          where: {
            id: session.id,
            uploaderId: session.uploaderId,
            status: { in: ['ASSEMBLED', 'FAILED'] },
            finalizationAttempts: { lt: 10 },
            libraryMode: this.libraryMode,
          },
          data: {
            status: 'FINALIZING',
            assembledAt: now,
            finalizationStartedAt: now,
            finalizationAttempts: { increment: 1 },
          },
        });
        if (claimed.count !== 1) throw new ConflictException('上传会话状态已改变。');
        const browserCapture = await transaction.eagleBrowserCapture.findUnique({
          where: { uploadSessionId: session.id, libraryMode: this.libraryMode },
          select: { id: true, displayName: true, pageUrl: true },
        });
        let finalizedAssetId: string = assetId;
        let assetRevision = 1;
        let duplicate = false;
        let cleanupObject = false;
        let retiredObjectKeys: string[] = [];
        if (session.eagleState?.replacementAssetId) {
          await transaction.$queryRaw(
            Prisma.sql`SELECT id FROM "EagleAsset" WHERE id=${session.eagleState.replacementAssetId} AND "ownerId"=${session.uploaderId} AND "libraryMode"=${this.libraryMode}::"LibraryMode" FOR UPDATE`,
          );
          const current = await transaction.eagleAsset.findFirst({
            where: {
              id: session.eagleState.replacementAssetId,
              ownerId: session.uploaderId,
              deletedAt: null,
              libraryMode: this.libraryMode,
            },
            include: {
              renditions: {
                select: { storageKey: true, revision: true },
              },
            },
          });
          if (!current) throw new NotFoundException('待替换的素材不存在。');
          const currentRenditions = current.renditions.filter(
            (rendition) => rendition.revision === current.mediaRevision,
          );
          assetRevision = current.mediaRevision + 1;
          finalizedAssetId = current.id;
          retiredObjectKeys = [
            current.originalObjectKey,
            ...currentRenditions.map(({ storageKey }) => storageKey),
          ];
          await transaction.eagleAsset.update({
            where: { id: current.id, libraryMode: this.libraryMode },
            data: {
              originalName: session.originalName,
              mimeType: session.mimeType,
              format: inspection.format,
              byteSize: session.size,
              sha256: inspection.sha256,
              width: inspection.width,
              height: inspection.height,
              durationMs: inspection.durationMs,
              originalObjectKey: session.objectKey,
              lifecycleStatus: 'PROCESSING',
              mediaErrorCode: null,
              mediaRevision: assetRevision,
              livePhotoIdentifier: null,
              livePhotoRole: null,
              rowVersion: { increment: 1 },
            },
          });
          await invalidateMediaRevision(
            transaction,
            { ownerId: session.uploaderId, libraryMode: this.libraryMode, assetId: current.id },
            assetRevision,
          );
          await this.revisionObserver?.onOriginalReplaced(
            transaction,
            { ownerId: session.uploaderId, libraryMode: this.libraryMode },
            current.id,
          );
          if (currentRenditions.length) {
            await transaction.eagleAssetRendition.deleteMany({
              where: {
                assetId: current.id,
                revision: current.mediaRevision,
                libraryMode: this.libraryMode,
              },
            });
          }
        } else {
          await transaction.$executeRaw`
            SELECT pg_advisory_xact_lock(hashtext(${`${session.uploaderId}:${this.libraryMode}`}), hashtext(${inspection.sha256}))
          `;
          const existing =
            session.eagleState?.duplicatePolicy === 'CREATE_COPY'
              ? null
              : await transaction.eagleAsset.findFirst({
                  where: {
                    ownerId: session.uploaderId,
                    sha256: inspection.sha256,
                    deletedAt: null,
                    libraryMode: this.libraryMode,
                  },
                  select: { id: true },
                });
          if (existing) {
            finalizedAssetId = existing.id;
            duplicate = true;
            cleanupObject = true;
          } else {
            const assetDisplayName = browserCapture?.displayName ?? displayName;
            await transaction.eagleAsset.create({
              data: {
                id: assetId,
                ownerId: session.uploaderId,
                originalName: session.originalName,
                displayName: assetDisplayName,
                normalizedDisplayName: normalizeKey(assetDisplayName),
                mimeType: session.mimeType,
                format: inspection.format,
                byteSize: session.size,
                originalObjectKey: session.objectKey,
                sha256: inspection.sha256,
                width: inspection.width,
                height: inspection.height,
                durationMs: inspection.durationMs,
                mediaRevision: assetRevision,
                libraryMode: this.libraryMode,
              },
            });
            if (browserCapture) {
              await transaction.eagleAssetAnnotation.create({
                data: {
                  ownerId: session.uploaderId,
                  assetId,
                  sourceUrl: browserCapture.pageUrl,
                  libraryMode: this.libraryMode,
                },
              });
            }
          }
        }
        const jobs = isCameraVideoMime(session.mimeType)
          ? [
              {
                ownerId: session.uploaderId,
                assetId: finalizedAssetId,
                kind: 'GENERATE_THUMBNAIL' as const,
                lane: 'INTERACTIVE' as const,
                assetRevision,
                processorVersion: 'camera-video-preview-v2',
              },
            ]
          : buildImageProcessingJobs({
              ownerId: session.uploaderId,
              assetId: finalizedAssetId,
              assetRevision,
              width: inspection.width,
              height: inspection.height,
            });
        if (!duplicate) {
          await transaction.eagleAssetProcessingJob.createMany({
            data: jobs.map((row) => inLibrary(this.libraryMode, row)),
          });
        }
        if (browserCapture) {
          await transaction.eagleBrowserCapture.update({
            where: { id: browserCapture.id, libraryMode: this.libraryMode },
            data: { assetId: finalizedAssetId, completedAt: now },
          });
        }
        await transaction.eagleUploadSessionState.update({
          where: { uploadSessionId: session.id, libraryMode: this.libraryMode },
          data: { assetId: finalizedAssetId, retiredObjectKeys },
        });
        await transaction.uploadSession.update({
          where: { id: session.id, libraryMode: this.libraryMode },
          data: {
            status: 'COMPLETED',
            eagleAssetId: finalizedAssetId,
            completedAt: now,
            completionParts: parts,
            objectCleanupPending: cleanupObject,
          },
        });
        return { assetId: finalizedAssetId, duplicate };
      });
      return {
        uploadSessionId: session.id,
        assetId: finalized.assetId,
        status: finalized.duplicate ? 'READY' : 'PROCESSING',
        duplicate: finalized.duplicate,
      };
    } catch (error) {
      await this.prisma.uploadSession.updateMany({
        where: {
          id: session.id,
          uploaderId: session.uploaderId,
          status: { in: ['ASSEMBLED', 'FINALIZING', 'FAILED'] },
          libraryMode: this.libraryMode,
        },
        data: {
          status: 'FAILED',
          finalizationAttempts: { increment: 1 },
          lastError: error instanceof Error ? error.message.slice(0, 2000) : 'FINALIZATION_FAILED',
          objectCleanupPending: false,
        },
      });
      throw error;
    }
  }

  async abort(ownerId: string, uploadSessionId: string) {
    const session = await this.requireInitiated(ownerId, uploadSessionId);
    await this.storage.abortMultipartUpload(session.objectKey, session.multipartUploadId);
    const result = await this.prisma.uploadSession.updateMany({
      where: {
        id: session.id,
        uploaderId: ownerId,
        status: 'INITIATED',
        libraryMode: this.libraryMode,
      },
      data: { status: 'ABORTED', abortedAt: new Date() },
    });
    if (result.count !== 1) throw new ConflictException('上传会话状态已改变。');
    return { uploadSessionId: session.id, status: 'ABORTED' };
  }

  private async requireInitiated(ownerId: string, uploadSessionId: string) {
    const session = await this.prisma.uploadSession.findFirst({
      where: {
        id: uploadSessionId,
        uploaderId: ownerId,
        status: 'INITIATED',
        libraryMode: this.libraryMode,
      },
      include: { eagleState: true },
    });
    if (!session) {
      const exists = await this.prisma.uploadSession.count({
        where: { id: uploadSessionId, uploaderId: ownerId, libraryMode: this.libraryMode },
      });
      if (!exists) throw new NotFoundException('上传会话不存在。');
      throw new ConflictException('上传会话不再可修改。');
    }
    return session;
  }

  private async requireCompletable(ownerId: string, uploadSessionId: string) {
    const session = await this.prisma.uploadSession.findFirst({
      where: {
        id: uploadSessionId,
        uploaderId: ownerId,
        status: { in: ['INITIATED', 'ASSEMBLED', 'FAILED', 'COMPLETED'] },
        libraryMode: this.libraryMode,
      },
      include: { eagleState: true },
    });
    if (!session) {
      const exists = await this.prisma.uploadSession.count({
        where: { id: uploadSessionId, uploaderId: ownerId, libraryMode: this.libraryMode },
      });
      if (!exists) throw new NotFoundException('上传会话不存在。');
      throw new ConflictException('上传会话不再可完成。');
    }
    return session;
  }

  private async requirePartListable(ownerId: string, uploadSessionId: string) {
    const session = await this.prisma.uploadSession.findFirst({
      where: {
        id: uploadSessionId,
        uploaderId: ownerId,
        status: { in: ['INITIATED', 'ASSEMBLED', 'FINALIZING', 'FAILED', 'COMPLETED'] },
        libraryMode: this.libraryMode,
      },
      include: { eagleState: true },
    });
    if (!session) {
      const exists = await this.prisma.uploadSession.count({
        where: { id: uploadSessionId, uploaderId: ownerId, libraryMode: this.libraryMode },
      });
      if (!exists) throw new NotFoundException('上传会话不存在。');
      throw new ConflictException('上传会话不再可读取分片。');
    }
    return session;
  }
}

function choosePartSize(size: number): number {
  return Math.max(5 * 1024 * 1024, Math.ceil(size / 10000));
}

function normalizeParts(parts: CompleteEagleUploadDto['parts']) {
  const sorted = parts
    .map((part) => ({ PartNumber: part.partNumber, ETag: part.etag.trim() }))
    .sort((a, b) => a.PartNumber - b.PartNumber);
  if (
    new Set(sorted.map((part) => part.PartNumber)).size !== sorted.length ||
    sorted.some((part) => !part.ETag)
  ) {
    throw new BadRequestException('上传分片清单无效。');
  }
  return sorted;
}

function normalizeStoredParts(value: unknown): ReturnType<typeof normalizeParts> {
  if (!Array.isArray(value)) throw new BadRequestException('上传分片清单无效。');
  return normalizeParts(
    value.map((part) => {
      if (!part || typeof part !== 'object') return { partNumber: 0, etag: '' };
      const record = part as Record<string, unknown>;
      const etag = record.etag ?? record.ETag;
      return {
        partNumber: Number(record.partNumber ?? record.PartNumber),
        etag: typeof etag === 'string' ? etag : '',
      };
    }),
  );
}

function displayNameFromOriginal(originalName: string): string {
  const dot = originalName.lastIndexOf('.');
  return (dot > 0 ? originalName.slice(0, dot) : originalName).slice(0, 255);
}

function normalizeKey(value: string): string {
  return value.normalize('NFKC').trim().toLocaleLowerCase('zh-CN');
}
