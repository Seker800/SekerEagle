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

  async complete(ownerId: string, uploadSessionId: string, input: CompleteEagleUploadDto) {
    const session = await this.requireInitiated(ownerId, uploadSessionId);
    const parts = normalizeParts(input.parts);
    await this.storage.completeMultipartUpload(session.objectKey, session.multipartUploadId, parts);
    const head = await this.storage.headObject(session.objectKey);
    if (head.ContentLength === undefined || BigInt(head.ContentLength) !== session.size) {
      await this.prisma.uploadSession.update({
        where: { id: session.id },
        data: { status: 'FAILED', lastError: 'OBJECT_SIZE_MISMATCH', objectCleanupPending: true },
      });
      throw new BadRequestException('上传后的对象大小与声明不一致。');
    }
    const now = new Date();
    const assetId = randomUUID();
    const displayName = displayNameFromOriginal(session.originalName);
    try {
      await this.prisma.$transaction(async (transaction) => {
        const claimed = await transaction.uploadSession.updateMany({
          where: { id: session.id, uploaderId: ownerId, status: 'INITIATED' },
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
            ownerId,
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
        await transaction.eagleAssetProcessingJob.create({
          data: { ownerId, assetId, kind: 'GENERATE_RENDITIONS', assetRevision: 0 },
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
        where: { id: session.id, uploaderId: ownerId, status: { in: ['INITIATED', 'FINALIZING'] } },
        data: { status: 'FAILED', lastError: 'FINALIZATION_FAILED', objectCleanupPending: true },
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
