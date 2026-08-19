import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import type { CompleteEagleUploadDto } from './eagle-upload.dto';
import type { InitiateEagleBrowserCaptureDto } from './eagle-browser-capture.dto';
import { EagleUploadService } from './eagle-upload.service';
import { normalizeEagleUploadOriginalName } from './eagle-upload-policy';

@Injectable()
export class EagleBrowserCaptureService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly uploads: EagleUploadService,
  ) {}

  async initiate(ownerId: string, input: InitiateEagleBrowserCaptureDto) {
    const declaration = normalizeDeclaration(input);
    const existing = await this.find(ownerId, input.clientCaptureId);
    if (existing) return this.replay(existing, declaration, input);

    const session = await this.uploads.initiate(ownerId, {
      originalName: input.originalName,
      mimeType: input.mimeType,
      size: input.size,
      contentSha256: input.contentSha256,
    });
    try {
      const capture = await this.prisma.eagleBrowserCapture.create({
        data: {
          ownerId,
          clientCaptureId: input.clientCaptureId,
          uploadSessionId: session.id,
          ...declaration,
        },
        include: {
          uploadSession: {
            include: { eagleState: true },
          },
        },
      });
      return serializeCapture(capture, session.partSize, false);
    } catch (error) {
      await this.uploads.abort(ownerId, session.id).catch(() => undefined);
      if (isUniqueConflict(error)) {
        const replayed = await this.find(ownerId, input.clientCaptureId);
        if (replayed) return this.replay(replayed, declaration, input);
      }
      throw error;
    }
  }

  async get(ownerId: string, clientCaptureId: string) {
    const capture = await this.require(ownerId, clientCaptureId);
    return serializeCapture(
      capture,
      this.uploads.partSizeFor(Number(capture.uploadSession.size)),
      true,
    );
  }

  async presignPart(ownerId: string, clientCaptureId: string, partNumber: number) {
    const capture = await this.require(ownerId, clientCaptureId);
    return this.uploads.presignPart(ownerId, capture.uploadSessionId, partNumber);
  }

  async listParts(ownerId: string, clientCaptureId: string) {
    const capture = await this.require(ownerId, clientCaptureId);
    return this.uploads.listParts(ownerId, capture.uploadSessionId);
  }

  async complete(ownerId: string, clientCaptureId: string, input: CompleteEagleUploadDto) {
    const capture = await this.require(ownerId, clientCaptureId);
    const completed = await this.uploads.complete(ownerId, capture.uploadSessionId, input);
    return { clientCaptureId, ...completed };
  }

  async abort(ownerId: string, clientCaptureId: string) {
    const capture = await this.require(ownerId, clientCaptureId);
    const aborted = await this.uploads.abort(ownerId, capture.uploadSessionId);
    return { clientCaptureId, ...aborted };
  }

  private replay(
    capture: NonNullable<Awaited<ReturnType<EagleBrowserCaptureService['find']>>>,
    declaration: ReturnType<typeof normalizeDeclaration>,
    input: InitiateEagleBrowserCaptureDto,
  ) {
    assertReplayMatches(capture, declaration, input);
    return serializeCapture(
      capture,
      this.uploads.partSizeFor(Number(capture.uploadSession.size)),
      true,
    );
  }

  private find(ownerId: string, clientCaptureId: string) {
    return this.prisma.eagleBrowserCapture.findFirst({
      where: { ownerId, clientCaptureId },
      include: { uploadSession: { include: { eagleState: true } } },
    });
  }

  private async require(ownerId: string, clientCaptureId: string) {
    const capture = await this.find(ownerId, clientCaptureId);
    if (!capture) throw new NotFoundException('浏览器采集任务不存在。');
    return capture;
  }
}

function normalizeDeclaration(input: InitiateEagleBrowserCaptureDto) {
  return {
    displayName: normalizeText(input.displayName, 255, '未命名图片'),
    pageTitle: normalizeText(input.pageTitle, 1000, ''),
    pageUrl: normalizeUrl(input.pageUrl, false),
    imageUrl: input.imageUrl ? normalizeUrl(input.imageUrl, true) : null,
    altText: input.altText ? normalizeText(input.altText, 1000, '') || null : null,
    capturedAt: new Date(input.capturedAt),
    extensionVersion: input.extensionVersion.trim(),
  };
}

function normalizeText(value: string, maxLength: number, fallback: string): string {
  return value.normalize('NFKC').trim().slice(0, maxLength) || fallback;
}

function normalizeUrl(value: string, stripQuery: boolean): string {
  const url = new URL(value);
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new ConflictException('浏览器采集只接受 HTTP(S) 来源。');
  }
  url.username = '';
  url.password = '';
  url.hash = '';
  if (stripQuery) url.search = '';
  return url.toString();
}

function assertReplayMatches(
  capture: NonNullable<Awaited<ReturnType<EagleBrowserCaptureService['find']>>>,
  declaration: ReturnType<typeof normalizeDeclaration>,
  input: InitiateEagleBrowserCaptureDto,
) {
  const same =
    capture.displayName === declaration.displayName &&
    capture.pageTitle === declaration.pageTitle &&
    capture.pageUrl === declaration.pageUrl &&
    capture.imageUrl === declaration.imageUrl &&
    capture.altText === declaration.altText &&
    capture.capturedAt.getTime() === declaration.capturedAt.getTime() &&
    capture.extensionVersion === declaration.extensionVersion &&
    capture.uploadSession.originalName === normalizeEagleUploadOriginalName(input.originalName) &&
    capture.uploadSession.mimeType === input.mimeType.trim().toLowerCase() &&
    Number(capture.uploadSession.size) === input.size &&
    (capture.uploadSession.eagleState?.expectedContentSha256 ?? null) ===
      (input.contentSha256?.toLowerCase() ?? null);
  if (!same) throw new ConflictException('采集幂等键已用于不同的图片声明。');
}

function serializeCapture(
  capture: NonNullable<Awaited<ReturnType<EagleBrowserCaptureService['find']>>>,
  partSize: number,
  replayed: boolean,
) {
  return {
    id: capture.id,
    clientCaptureId: capture.clientCaptureId,
    uploadSessionId: capture.uploadSessionId,
    assetId: capture.assetId ?? capture.uploadSession.eagleAssetId,
    status: capture.uploadSession.status,
    originalName: capture.uploadSession.originalName,
    mimeType: capture.uploadSession.mimeType,
    size: Number(capture.uploadSession.size),
    partSize,
    lastError: capture.uploadSession.lastError,
    replayed,
    completedAt: capture.completedAt,
  };
}

function isUniqueConflict(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
}
