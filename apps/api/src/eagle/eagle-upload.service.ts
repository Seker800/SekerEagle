import { randomUUID } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { createAssetObjectKey } from '../storage/object-key';
import { ObjectStorageService } from '../storage/object-storage.service';
import type { CompleteEagleUploadDto, InitiateEagleUploadDto } from './eagle-upload.dto';
import { EagleMediaCapabilityService } from './eagle-media-capability.service';

@Injectable()
export class EagleUploadService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: ObjectStorageService,
    private readonly mediaCapabilities: EagleMediaCapabilityService,
  ) {}

  async initiate(ownerId: string, input: InitiateEagleUploadDto) {
    const originalName = normalizeOriginalName(input.originalName);
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
            },
          },
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
      where: { id: uploadSessionId, uploaderId: ownerId },
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
    const session = await this.requireInitiated(ownerId, uploadSessionId);
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
      return { uploadSessionId: session.id, assetId: session.eagleAssetId, status: 'PROCESSING' };
    }
    const parts =
      session.status === 'INITIATED'
        ? requestedParts
        : normalizeStoredParts(session.completionParts);
    if (session.status === 'INITIATED') {
      await this.prisma.uploadSession.updateMany({
        where: { id: session.id, uploaderId: ownerId, status: 'INITIATED' },
        data: { completionParts: parts },
      });
      try {
        await this.storage.completeMultipartUpload(session.objectKey, session.multipartUploadId, parts);
      } catch (error) {
        await this.storage.headObject(session.objectKey).catch(() => {
          throw error;
        });
      }
      await this.prisma.uploadSession.updateMany({
        where: { id: session.id, uploaderId: ownerId, status: 'INITIATED' },
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
      },
      include: { eagleState: true },
    });
    if (!session || !session.completionParts) return null;
    const parts = normalizeStoredParts(session.completionParts);
    if (session.status === 'INITIATED') {
      try {
        await this.storage.completeMultipartUpload(session.objectKey, session.multipartUploadId, parts);
      } catch (error) {
        await this.storage.headObject(session.objectKey).catch(() => {
          throw error;
        });
      }
      await this.prisma.uploadSession.updateMany({
        where: { id: session.id, status: 'INITIATED' },
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
        where: { id: session.id },
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
    try {
      await this.prisma.$transaction(async (transaction) => {
        const claimed = await transaction.uploadSession.updateMany({
          where: {
            id: session.id,
            uploaderId: session.uploaderId,
            status: { in: ['ASSEMBLED', 'FAILED'] },
            finalizationAttempts: { lt: 10 },
          },
          data: {
            status: 'FINALIZING',
            assembledAt: now,
            finalizationStartedAt: now,
            finalizationAttempts: { increment: 1 },
          },
        });
        if (claimed.count !== 1) throw new ConflictException('上传会话状态已改变。');
        await transaction.eagleAsset.create({
          data: {
            id: assetId,
            ownerId: session.uploaderId,
            originalName: session.originalName,
            displayName,
            normalizedDisplayName: normalizeKey(displayName),
            mimeType: session.mimeType,
            format: inferFormat(session.originalName, session.mimeType),
            byteSize: session.size,
            originalObjectKey: session.objectKey,
            sha256: null,
          },
        });
        const jobs =
          session.mimeType === 'video/mp4'
            ? [{ kind: 'GENERATE_THUMBNAIL' as const, lane: 'INTERACTIVE' as const }]
            : [
                { kind: 'GENERATE_RENDITIONS' as const, lane: 'INTERACTIVE' as const },
                { kind: 'EXTRACT_COLOR_PALETTE' as const, lane: 'BACKGROUND' as const },
              ];
        await transaction.eagleAssetProcessingJob.createMany({
          data: jobs.map(({ kind, lane }) => ({
            ownerId: session.uploaderId,
            assetId,
            kind,
            lane,
            assetRevision: 0,
            processorVersion: kind === 'EXTRACT_COLOR_PALETTE' ? 'color-v2' : 'v1',
          })),
        });
        await transaction.eagleUploadSessionState.update({
          where: { uploadSessionId: session.id },
          data: { assetId },
        });
        await transaction.uploadSession.update({
          where: { id: session.id },
          data: {
            status: 'COMPLETED',
            eagleAssetId: assetId,
            completedAt: now,
            completionParts: parts,
          },
        });
      });
    } catch (error) {
      await this.prisma.uploadSession.updateMany({
        where: {
          id: session.id,
          uploaderId: session.uploaderId,
          status: { in: ['ASSEMBLED', 'FINALIZING', 'FAILED'] },
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
    return { uploadSessionId: session.id, assetId, status: 'PROCESSING' };
  }

  async abort(ownerId: string, uploadSessionId: string) {
    const session = await this.requireInitiated(ownerId, uploadSessionId);
    await this.storage.abortMultipartUpload(session.objectKey, session.multipartUploadId);
    const result = await this.prisma.uploadSession.updateMany({
      where: { id: session.id, uploaderId: ownerId, status: 'INITIATED' },
      data: { status: 'ABORTED', abortedAt: new Date() },
    });
    if (result.count !== 1) throw new ConflictException('上传会话状态已改变。');
    return { uploadSessionId: session.id, status: 'ABORTED' };
  }

  private async requireInitiated(ownerId: string, uploadSessionId: string) {
    const session = await this.prisma.uploadSession.findFirst({
      where: { id: uploadSessionId, uploaderId: ownerId, status: 'INITIATED' },
      include: { eagleState: true },
    });
    if (!session) {
      const exists = await this.prisma.uploadSession.count({
        where: { id: uploadSessionId, uploaderId: ownerId },
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
      },
      include: { eagleState: true },
    });
    if (!session) {
      const exists = await this.prisma.uploadSession.count({
        where: { id: uploadSessionId, uploaderId: ownerId },
      });
      if (!exists) throw new NotFoundException('上传会话不存在。');
      throw new ConflictException('上传会话不再可完成。');
    }
    return session;
  }
}

function normalizeOriginalName(value: string): string {
  const name = value.normalize('NFKC').split(/[\\/]/).at(-1)?.trim() ?? '';
  if (!name || name.length > 255 || [...name].some((character) => isControlCharacter(character))) {
    throw new BadRequestException('文件名无效。');
  }
  return name;
}

function isControlCharacter(character: string): boolean {
  const codePoint = character.codePointAt(0) ?? 0;
  return codePoint <= 31 || codePoint === 127;
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

function inferFormat(originalName: string, mimeType: string): string {
  const extension = originalName.split('.').at(-1)?.toLowerCase();
  if (extension && extension !== originalName.toLowerCase() && /^[a-z0-9]{1,16}$/.test(extension))
    return extension;
  return mimeType.split('/').at(-1)?.split('+').at(0) ?? 'unknown';
}

function normalizeKey(value: string): string {
  return value.normalize('NFKC').trim().toLocaleLowerCase('zh-CN');
}
