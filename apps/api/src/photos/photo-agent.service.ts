import { readPhotoInstructions, savePhotoInstructions } from './photo-agent-instructions';
import type { UpdatePhotoAgentInstructionsDto } from './photo-agent.dto';
import {
  BadRequestException,
  ConflictException,
  Injectable,
  Optional,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { appendPhotoAgentEvent } from './photo-agent-history';
import { PrismaService } from '../prisma/prisma.service';
import { EagleImageSearchService } from '../eagle/eagle-image-search.service';
import { EagleLibraryTransferService } from '../eagle/eagle-library-transfer.service';
import { setEagleTrash, resolveEagleTrashTargets } from '../eagle/eagle-trash';
import { lockOwnerPrivacyProjection } from '../eagle/eagle-privacy.service';
import { filenameSignals, haversineKm, inferCity, type AgentCity } from './photo-agent-rules';
import type {
  CreatePhotoTaskDto,
  InferPhotoCitiesDto,
  PhotoAgentQueryDto,
  ProposePhotoDto,
  ReviewPhotoSuggestionDto,
  SubmitPhotoRequestDto,
  ReviewPhotoRequestDto,
} from './photo-agent.dto';
type Snapshot = {
  id: string;
  mediaRevision: number;
  rowVersion: number;
  metadataAt?: string | null;
};
type Evidence = Snapshot[];
const metadataAt = (asset: { photoMetadata?: { analyzedAt: Date } | null }) =>
  asset.photoMetadata?.analyzedAt.toISOString() ?? null;
const snapshotOf = (asset: {
  id: string;
  mediaRevision: number;
  rowVersion: number;
  photoMetadata?: { analyzedAt: Date } | null;
}): Snapshot => ({
  id: asset.id,
  mediaRevision: asset.mediaRevision,
  rowVersion: asset.rowVersion,
  metadataAt: metadataAt(asset),
});
const scope = (ownerId: string, includePrivate: boolean) => ({
  ownerId,
  libraryMode: 'PHOTO' as const,
  ...(includePrivate ? {} : { isPrivate: false }),
});
const select = {
  id: true,
  originalName: true,
  displayName: true,
  mimeType: true,
  livePhotoRole: true,
  mediaRevision: true,
  rowVersion: true,
  chronologicalAt: true,
  deletedAt: true,
  purgeAfter: true,
  photoMetadata: true,
  photoLocation: true,
  renditions: {
    where: { status: 'READY' as const, kind: 'THUMBNAIL' as const },
    orderBy: { revision: 'desc' as const },
    select: { id: true, revision: true },
    take: 4,
  },
} satisfies Prisma.EagleAssetSelect;
type Photo = Prisma.EagleAssetGetPayload<{ select: typeof select }>;
const json = (value: unknown) => JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
const serialize = (a: Photo) => ({
  ...a,
  photoMetadata: a.photoMetadata?.assetRevision === a.mediaRevision ? a.photoMetadata : null,
  photoLocation: a.photoLocation?.assetRevision === a.mediaRevision ? a.photoLocation : null,
  previewId: a.renditions.find((r) => r.revision === a.mediaRevision)?.id ?? null,
  filenameSignals: filenameSignals(a.originalName, a.mimeType),
});
@Injectable()
export class PhotoAgentService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly search: EagleImageSearchService,
    @Optional() private readonly transfer?: EagleLibraryTransferService,
  ) {}
  instructions(ownerId: string) {
    return readPhotoInstructions(this.prisma, ownerId);
  }
  saveInstructions(ownerId: string, input: UpdatePhotoAgentInstructionsDto) {
    return savePhotoInstructions(this.prisma, ownerId, input);
  }
  async photos(ownerId: string, input: PhotoAgentQueryDto, includePrivate: boolean) {
    if (input.from && input.to && Date.parse(input.from) >= Date.parse(input.to))
      throw new BadRequestException('时间范围无效。');
    const rows = await this.prisma.eagleAsset.findMany({
      where: {
        ...scope(ownerId, includePrivate),
        deletedAt: null,
        ...(input.after ? { id: { gt: input.after } } : {}),
        chronologicalAt: {
          ...(input.from ? { gte: new Date(input.from) } : {}),
          ...(input.to ? { lt: new Date(input.to) } : {}),
        },
      },
      select,
      orderBy: { id: 'asc' },
      take: input.limit + 1,
    });
    return {
      items: rows.slice(0, input.limit).map(serialize),
      next: rows.length > input.limit ? rows[input.limit - 1]!.id : null,
    };
  }
  async preview(ownerId: string, assetId: string, includePrivate: boolean) {
    const asset = await this.prisma.eagleAsset.findFirst({
      where: { ...scope(ownerId, includePrivate), id: assetId, deletedAt: null },
      select,
    });
    const rendition = asset?.renditions.find((r) => r.revision === asset.mediaRevision);
    if (!asset || !rendition) throw new NotFoundException('照片预览不存在。');
    return rendition.id;
  }
  async createTask(ownerId: string, input: CreatePhotoTaskDto, includePrivate: boolean) {
    return this.prisma.$transaction((tx) => this.freezeTask(tx, ownerId, input, includePrivate));
  }
  private async freezeTask(
    tx: Prisma.TransactionClient,
    ownerId: string,
    input: CreatePhotoTaskDto,
    includePrivate: boolean,
    request?: SubmitPhotoRequestDto,
  ) {
    const assets = await tx.eagleAsset.findMany({
      where: { ...scope(ownerId, includePrivate), id: { in: input.assetIds }, deletedAt: null },
      select: {
        id: true,
        mediaRevision: true,
        rowVersion: true,
        photoMetadata: { select: { analyzedAt: true } },
      },
    });
    if (
      assets.length !== input.assetIds.length ||
      new Set(input.assetIds).size !== input.assetIds.length
    )
      throw new NotFoundException('一个或多个照片不存在。');
    return tx.eaglePhotoAgentTask.create({
      data: {
        ownerId,
        kind: input.kind,
        scope: json(assets.map(snapshotOf)),
        expiresAt: request ? null : new Date(Date.now() + 24 * 3600000),
        ...(request ? { title: request.title, rationale: request.rationale } : {}),
      },
      select: { id: true, kind: true, status: true, expiresAt: true },
    });
  }
  async submitRequest(ownerId: string, input: SubmitPhotoRequestDto, includePrivate: boolean) {
    const assetIds = [
      ...new Set(input.items.flatMap((item) => [item.assetId, ...item.evidenceIds])),
    ];
    if (
      assetIds.length > 400 ||
      new Set(input.items.map((item) => item.assetId)).size !== input.items.length
    )
      throw new BadRequestException('申请包含重复照片或过多参考照片。');
    return this.prisma.$transaction(
      async (tx) => {
        await lockOwnerPrivacyProjection(tx, ownerId, 'PHOTO');
        const task = await this.freezeTask(
          tx,
          ownerId,
          { kind: input.kind, assetIds },
          includePrivate,
          input,
        );
        const context = await this.task(tx, ownerId, task.id, includePrivate, true);
        for (const item of input.items)
          await this.proposeInTransaction(tx, ownerId, task.id, item, includePrivate, context);
        return { id: task.id, count: input.items.length };
      },
      { timeout: 30000 },
    );
  }
  private async task(
    tx: Prisma.TransactionClient,
    ownerId: string,
    id: string,
    includePrivate: boolean,
    writable = false,
  ) {
    const task = await tx.eaglePhotoAgentTask.findFirst({
      where: { ownerId, libraryMode: 'PHOTO', id },
    });
    if (!task) throw new NotFoundException('整理任务不存在。');
    const frozen = task.scope as unknown as Snapshot[];
    const assets = await tx.eagleAsset.findMany({
      where: {
        ...scope(ownerId, includePrivate),
        id: { in: frozen.map((a) => a.id) },
        purgeAfter: null,
      },
      select,
    });
    if (assets.length !== frozen.length) throw new NotFoundException('整理任务中的照片不存在。');
    if (writable && (task.status !== 'OPEN' || (task.expiresAt && task.expiresAt <= new Date())))
      throw new ConflictException('整理任务已取消或过期。');
    return { task, assets, frozen };
  }
  async tasks(ownerId: string, input: PhotoAgentQueryDto, includePrivate: boolean) {
    const rows = await this.prisma.eaglePhotoAgentTask.findMany({
      where: { ownerId, libraryMode: 'PHOTO', ...(input.after ? { id: { gt: input.after } } : {}) },
      orderBy: { id: 'asc' },
      take: input.limit + 1,
      select: {
        id: true,
        kind: true,
        status: true,
        createdAt: true,
        expiresAt: true,
        scope: true,
        title: true,
        rationale: true,
      },
    });
    const visible = [];
    for (const row of rows.slice(0, input.limit)) {
      const ids = (row.scope as unknown as Snapshot[]).map((a) => a.id);
      const count = await this.prisma.eagleAsset.count({
        where: { ...scope(ownerId, includePrivate), id: { in: ids }, purgeAfter: null },
      });
      if (count === ids.length) {
        const { scope: _, ...summary } = row;
        void _;
        const proposals = await this.prisma.eaglePhotoAgentSuggestion.findMany({
          where: { taskId: row.id, ownerId, libraryMode: 'PHOTO' },
          select: { assetId: true, status: true },
          orderBy: { createdAt: 'asc' },
        });
        visible.push({
          ...summary,
          assetCount: proposals.length,
          pendingCount: proposals.filter((item) => item.status === 'PENDING').length,
          acceptedCount: proposals.filter((item) => item.status === 'ACCEPTED').length,
          retryCount: proposals.filter((item) => ['FAILED', 'APPLYING'].includes(item.status))
            .length,
          rejectedCount: proposals.filter((item) => ['REJECTED', 'UNDONE'].includes(item.status))
            .length,
          coverIds: proposals
            .filter((item) => item.status !== 'ACCEPTED' || row.kind === 'CITY')
            .slice(0, 4)
            .map((item) => item.assetId),
        });
      }
    }
    return { items: visible, next: rows.length > input.limit ? rows[input.limit - 1]!.id : null };
  }
  async detail(ownerId: string, id: string, includePrivate: boolean) {
    return this.prisma.$transaction(async (tx) => {
      const { task, assets } = await this.task(tx, ownerId, id, includePrivate);
      const suggestions = await tx.eaglePhotoAgentSuggestion.findMany({
        where: { ownerId, libraryMode: 'PHOTO', taskId: id },
        orderBy: { id: 'asc' },
      });
      return {
        id: task.id,
        kind: task.kind,
        status: task.status,
        expiresAt: task.expiresAt,
        title: task.title,
        rationale: task.rationale,
        createdAt: task.createdAt,
        assets: assets.map(serialize),
        suggestions,
      };
    });
  }
  async history(
    ownerId: string,
    taskId: string,
    input: PhotoAgentQueryDto,
    includePrivate: boolean,
  ) {
    return this.prisma.$transaction(async (tx) => {
      await this.task(tx, ownerId, taskId, includePrivate);
      const cursor = input.after
        ? await tx.eaglePhotoAgentEvent.findFirst({
            where: { id: input.after, ownerId, libraryMode: 'PHOTO', taskId },
          })
        : null;
      if (input.after && !cursor) throw new NotFoundException('操作记录不存在。');
      const rows = await tx.eaglePhotoAgentEvent.findMany({
        where: {
          ownerId,
          libraryMode: 'PHOTO',
          taskId,
          ...(cursor
            ? {
                OR: [
                  { createdAt: { lt: cursor.createdAt } },
                  { createdAt: cursor.createdAt, id: { lt: cursor.id } },
                ],
              }
            : {}),
        },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: input.limit + 1,
      });
      return {
        items: rows.slice(0, input.limit),
        next: rows.length > input.limit ? rows[input.limit - 1]!.id : null,
      };
    });
  }
  async propose(ownerId: string, id: string, input: ProposePhotoDto, includePrivate: boolean) {
    return this.prisma.$transaction((tx) =>
      this.proposeInTransaction(tx, ownerId, id, input, includePrivate),
    );
  }
  private async proposeInTransaction(
    tx: Prisma.TransactionClient,
    ownerId: string,
    id: string,
    input: ProposePhotoDto,
    includePrivate: boolean,
    context?: Awaited<ReturnType<PhotoAgentService['task']>>,
  ) {
    if (!context) {
      await lockOwnerPrivacyProjection(tx, ownerId, 'PHOTO');
      await tx.$queryRaw`SELECT id FROM "EaglePhotoAgentTask" WHERE id=${id} AND "ownerId"=${ownerId} AND "libraryMode"='PHOTO' FOR UPDATE`;
    }
    const { task, assets, frozen } =
      context ?? (await this.task(tx, ownerId, id, includePrivate, true));
    const asset = assets.find((a) => a.id === input.assetId);
    if (!asset || asset.deletedAt) throw new NotFoundException('照片不存在。');
    if (
      !input.visualReviewed &&
      (!task.title || !['SEND_TO_MATERIAL', 'DELETE'].includes(task.kind))
    )
      throw new BadRequestException('位置与旧版申请请先查看照片画面并核对证据。');
    const snapshot = frozen.find((a) => a.id === asset.id)!;
    if (
      asset.mediaRevision !== snapshot.mediaRevision ||
      asset.rowVersion !== snapshot.rowVersion ||
      metadataAt(asset) !== snapshot.metadataAt
    )
      throw new ConflictException('照片已变化，请创建新任务。');
    const evidence = input.evidenceIds.map((e) => {
      const a = assets.find((a) => a.id === e),
        old = frozen.find((a) => a.id === e);
      if (!a || !old || a.deletedAt) throw new NotFoundException('参考照片不存在。');
      if (
        a.mediaRevision !== old.mediaRevision ||
        a.rowVersion !== old.rowVersion ||
        metadataAt(a) !== old.metadataAt
      )
        throw new ConflictException('参考照片已变化。');
      return snapshotOf(a);
    });
    if (!evidence.some((e) => e.id === asset.id)) evidence.push(snapshotOf(asset));
    if (task.kind === 'CITY') {
      if (!input.city || (!task.title && input.evidenceIds.length < 1))
        throw new BadRequestException('城市建议必须包含城市和参考照片。');
      if (asset.photoLocation || asset.photoMetadata?.latitude != null)
        throw new ConflictException('已有位置不能被批量推断覆盖。');
      if (
        input.city.precision === 'EXACT' &&
        (!input.city.accuracyMeters || input.city.accuracyMeters > 10000)
      )
        throw new BadRequestException('精确位置必须声明精度范围。');
      if (!task.title) {
        const located = assets.filter(
          (a) =>
            input.evidenceIds.includes(a.id) &&
            a.photoMetadata?.latitude != null &&
            a.photoMetadata.assetRevision === a.mediaRevision &&
            a.photoMetadata.longitude != null,
        );
        if (
          !located.length ||
          located.some(
            (a) =>
              haversineKm(
                a.photoMetadata!.latitude!,
                a.photoMetadata!.longitude!,
                input.city!.latitude,
                input.city!.longitude,
              ) > 30,
          )
        )
          throw new BadRequestException('城市缺少邻近原始 GPS 证据。');
      }
    } else if (
      task.kind === 'NON_PHOTO' &&
      (!asset.mimeType.startsWith('image/') ||
        asset.livePhotoRole ||
        asset.mimeType.includes('raw') ||
        /^(nef|cr2|cr3|arw|dng|raf|rw2)$/i.test(asset.originalName.split('.').at(-1) ?? ''))
    ) {
      throw new BadRequestException('此媒体不支持非照片剔除建议。');
    }
    const previous = await tx.eaglePhotoAgentSuggestion.findFirst({
      where: {
        ownerId,
        libraryMode: 'PHOTO',
        assetId: asset.id,
        assetRevision: asset.mediaRevision,
        kind: task.kind,
        status: { in: ['REJECTED', 'UNDONE'] },
      },
    });
    if (previous) throw new ConflictException('此版本已有人工保留决定。');
    const existing = await tx.eaglePhotoAgentSuggestion.findUnique({
      where: { taskId_assetId: { taskId: id, assetId: asset.id } },
    });
    if (existing) return existing;
    const pending = await tx.eaglePhotoAgentSuggestion.findFirst({
      where: {
        ownerId,
        libraryMode: 'PHOTO',
        assetId: asset.id,
        assetRevision: asset.mediaRevision,
        status: { in: ['PENDING', 'APPLYING', 'FAILED'] },
        task: { status: 'OPEN', OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }] },
      },
    });
    if (pending) throw new ConflictException('此照片已有待处理申请，请先处理原申请。');
    const created = await tx.eaglePhotoAgentSuggestion.create({
      data: {
        ownerId,
        taskId: id,
        assetId: asset.id,
        assetRevision: asset.mediaRevision,
        assetRowVersion: asset.rowVersion,
        kind: task.kind,
        value: json(task.kind === 'CITY' ? input.city! : { category: task.kind }),
        evidence: json(evidence),
        rationale: input.rationale,
        reviewBasis: input.visualReviewed ? 'VISUAL' : 'METADATA',
      },
    });
    await appendPhotoAgentEvent(
      tx,
      ownerId,
      id,
      'PROPOSED',
      'AGENT',
      {
        kind: task.kind,
        value: created.value,
        rationale: created.rationale,
        reviewBasis: created.reviewBasis,
        evidence: created.evidence,
        before: snapshotOf(asset),
      },
      created,
    );
    return created;
  }
  async infer(ownerId: string, id: string, input: InferPhotoCitiesDto, includePrivate: boolean) {
    if (input.offsetSeconds !== 0 && !input.cameraModel?.trim())
      throw new BadRequestException('时间校正必须指定相机型号作用域。');
    const task = await this.detail(ownerId, id, includePrivate);
    if (task.kind !== 'CITY') throw new BadRequestException('不是城市整理任务。');
    const anchors = task.assets.flatMap((a) => {
      const m = a.photoMetadata;
      if (
        !m?.capturedAt ||
        !m.captureTimeZoneKnown ||
        m.latitude == null ||
        m.longitude == null ||
        a.deletedAt
      )
        return [];
      const cities = input.cities.filter(
        (c) => haversineKm(c.latitude, c.longitude, m.latitude!, m.longitude!) <= 30,
      );
      if (cities.length !== 1) return [];
      return [
        {
          id: a.id,
          capturedAt: m.capturedAt,
          latitude: m.latitude,
          longitude: m.longitude,
          cityId: cities[0]!.id,
        },
      ];
    });
    const candidates = task.assets.flatMap((a) => {
      if (a.deletedAt || a.photoLocation || a.photoMetadata?.latitude != null) return [];
      if (input.cameraModel && a.photoMetadata?.cameraModel !== input.cameraModel) return [];
      const result = inferCity(
        a.photoMetadata?.capturedAt ?? null,
        a.photoMetadata?.captureTimeZoneKnown ?? false,
        anchors,
        input.cities,
        input.offsetSeconds,
      );
      return result
        ? [
            {
              assetId: a.id,
              city: result.city,
              evidenceIds: result.evidenceIds,
              offsetSeconds: input.offsetSeconds,
              requiresVisualReview: true,
            },
          ]
        : [];
    });
    return {
      candidates,
      unresolved:
        task.assets.filter(
          (a) => !a.deletedAt && !a.photoLocation && a.photoMetadata?.latitude == null,
        ).length - candidates.length,
      policy: 'bracketing-20min-5km-city30km-v1',
    };
  }
  async scores(ownerId: string, id: string, description: string, includePrivate: boolean) {
    const { assets } = await this.detail(ownerId, id, includePrivate);
    const context = await this.search.prepare(ownerId, description);
    if (context.status !== 'READY')
      return {
        status: 'UNAVAILABLE',
        items: assets.map((a) => ({ assetId: a.id, filenameSignals: a.filenameSignals })),
        message: '向量模型不可用；仅显示文件名线索。',
      };
    const items = await this.prisma.$queryRaw<
      Array<{ assetId: string; similarity: number }>
    >(Prisma.sql`
      SELECT a.id AS "assetId",(1-(e.embedding <=> ${context.vector}::vector))::double precision AS similarity
      FROM "EagleAssetEmbedding" e JOIN "EagleAsset" a ON a.id=e."assetId" AND a."ownerId"=e."ownerId" AND a."libraryMode"=e."libraryMode"
      WHERE a."ownerId"=${ownerId} AND a."libraryMode"='PHOTO' AND a."deletedAt" IS NULL AND (${includePrivate} OR a."isPrivate"=false)
      AND a.id=ANY(${assets.map((a) => a.id)}::text[]) AND e."spaceId"=${context.spaceId} AND e.status='READY' AND e."isCurrent"=true
      AND e."assetRevision"=a."mediaRevision" AND e.embedding IS NOT NULL ORDER BY similarity DESC LIMIT 200`);
    return {
      status: 'READY',
      spaceId: context.spaceId,
      items,
      unanalysed: assets.filter((a) => !items.some((i) => i.assetId === a.id)).map((a) => a.id),
      notice: '相似度只用于候选排序，不是分类概率。',
    };
  }
  async cancel(ownerId: string, id: string, includePrivate: boolean) {
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "EaglePhotoAgentTask" WHERE id=${id} AND "ownerId"=${ownerId} FOR UPDATE`;
      const { task } = await this.task(tx, ownerId, id, includePrivate);
      if (task.status === 'CANCELLED') return { id: task.id, status: task.status };
      if (await tx.eaglePhotoAgentSuggestion.count({ where: { taskId: id, status: 'APPLYING' } }))
        throw new ConflictException('申请正在执行，请稍后重试。');
      const updated = await tx.eaglePhotoAgentTask.update({
        where: { id },
        data: { status: 'CANCELLED' },
        select: { id: true, status: true },
      });
      await appendPhotoAgentEvent(tx, ownerId, id, 'CANCELLED', 'HUMAN', {});
      return updated;
    });
  }
  async review(
    ownerId: string,
    taskId: string,
    suggestionId: string,
    input: ReviewPhotoSuggestionDto,
    includePrivate: boolean,
  ) {
    try {
      return await this.reviewDecision(ownerId, taskId, suggestionId, input, includePrivate);
    } catch (error) {
      await this.recordFailure(
        ownerId,
        taskId,
        suggestionId,
        'REVIEW_FAILED',
        input.action,
        includePrivate,
        error,
      );
      throw error;
    }
  }
  private async recordFailure(
    ownerId: string,
    taskId: string,
    suggestionId: string,
    action: string,
    attemptedAction: string,
    includePrivate: boolean,
    error: unknown,
  ) {
    if (error instanceof NotFoundException) return;
    await this.prisma.$transaction(async (tx) => {
      await this.task(tx, ownerId, taskId, includePrivate);
      const suggestion = await tx.eaglePhotoAgentSuggestion.findFirst({
        where: { id: suggestionId, taskId, ownerId, libraryMode: 'PHOTO' },
      });
      if (
        !suggestion ||
        (action === 'REVIEW_FAILED' &&
          suggestion.kind === 'SEND_TO_MATERIAL' &&
          suggestion.status === 'FAILED')
      )
        return;
      await appendPhotoAgentEvent(
        tx,
        ownerId,
        taskId,
        action,
        'HUMAN',
        {
          kind: suggestion.kind,
          attemptedAction,
          error: error instanceof Error ? error.message : '操作失败',
        },
        suggestion,
      );
    });
  }
  private async reviewDecision(
    ownerId: string,
    taskId: string,
    suggestionId: string,
    input: ReviewPhotoSuggestionDto,
    includePrivate: boolean,
  ) {
    const requested = await this.prisma.eaglePhotoAgentSuggestion.findFirst({
      where: { id: suggestionId, taskId, ownerId, libraryMode: 'PHOTO' },
      select: { kind: true },
    });
    if (requested?.kind === 'SEND_TO_MATERIAL' && input.city)
      throw new BadRequestException('发送申请不接受位置修改。');
    if (requested?.kind === 'SEND_TO_MATERIAL' && input.action === 'ACCEPT')
      return this.reviewTransfer(ownerId, taskId, suggestionId, includePrivate);
    return this.prisma.$transaction(async (tx) => {
      await lockOwnerPrivacyProjection(tx, ownerId, 'PHOTO');
      await tx.$queryRaw`SELECT id FROM "EaglePhotoAgentTask" WHERE id=${taskId} AND "ownerId"=${ownerId} FOR UPDATE`;
      const { task, assets } = await this.task(tx, ownerId, taskId, includePrivate);
      const suggestion = await tx.eaglePhotoAgentSuggestion.findFirst({
        where: { id: suggestionId, ownerId, libraryMode: 'PHOTO', taskId },
      });
      if (!suggestion) throw new NotFoundException('整理建议不存在。');
      const expected = input.action === 'ACCEPT' ? 'ACCEPTED' : 'REJECTED';
      if (suggestion.status === expected) return suggestion;
      if (task.status !== 'OPEN' || (task.expiresAt && task.expiresAt <= new Date()))
        throw new ConflictException('整理任务已取消或过期。');
      if (suggestion.kind !== 'CITY' && input.city)
        throw new BadRequestException('非照片建议不接受城市修改。');
      if (suggestion.status !== 'PENDING') throw new ConflictException('此建议已审核。');
      if (input.action === 'REJECT') {
        const rejected = await tx.eaglePhotoAgentSuggestion.update({
          where: { id: suggestionId },
          data: { status: 'REJECTED', reviewedAt: new Date(), operation: {} },
        });
        await appendPhotoAgentEvent(
          tx,
          ownerId,
          taskId,
          'REJECTED',
          'HUMAN',
          { kind: suggestion.kind, value: suggestion.value },
          suggestion,
        );
        return rejected;
      }
      const target = assets.find((a) => a.id === suggestion.assetId)!;
      const evidence = suggestion.evidence as unknown as Evidence;
      const lockIds = [...new Set([target.id, ...evidence.map((e) => e.id)])].sort();
      await tx.$queryRaw(
        Prisma.sql`SELECT id FROM "EagleAsset" WHERE "ownerId"=${ownerId} AND "libraryMode"='PHOTO' AND id=ANY(${lockIds}::text[]) ORDER BY id FOR UPDATE`,
      );
      const current = await tx.eagleAsset.findMany({
        where: {
          ...scope(ownerId, includePrivate),
          id: { in: lockIds },
          deletedAt: null,
          purgeAfter: null,
        },
        select: {
          id: true,
          mediaRevision: true,
          rowVersion: true,
          photoMetadata: { select: { analyzedAt: true } },
        },
      });
      for (const snapshot of [
        {
          id: target.id,
          mediaRevision: suggestion.assetRevision,
          rowVersion: suggestion.assetRowVersion,
        },
        ...evidence,
      ]) {
        const a = current.find((a) => a.id === snapshot.id);
        if (
          !a ||
          a.mediaRevision !== snapshot.mediaRevision ||
          a.rowVersion !== snapshot.rowVersion ||
          ('metadataAt' in snapshot && metadataAt(a) !== snapshot.metadataAt)
        )
          throw new ConflictException('照片或参考证据已变化，请重新分析。');
      }
      let operation: Prisma.InputJsonValue = {};
      if (input.action === 'ACCEPT') {
        if (suggestion.kind === 'CITY') {
          if (
            (await tx.eaglePhotoLocation.findUnique({ where: { assetId: target.id } })) ||
            target.photoMetadata?.latitude != null
          )
            throw new ConflictException('照片已有位置。');
          const city = (input.city ?? suggestion.value) as unknown as AgentCity & {
            precision?: string;
            accuracyMeters?: number;
          };
          if (city.precision === 'EXACT' && (!city.accuracyMeters || city.accuracyMeters > 10000))
            throw new BadRequestException('精确位置必须声明精度范围。');
          await tx.eaglePhotoLocation.create({
            data: {
              assetId: target.id,
              ownerId,
              assetRevision: target.mediaRevision,
              cityId: city.id,
              name: city.name,
              country: city.country,
              region: city.region,
              latitude: city.latitude,
              longitude: city.longitude,
              source: input.city ? 'MANUAL' : 'INFERRED',
              precision: (city as AgentCity & { precision?: string }).precision ?? 'CITY',
              accuracyMeters:
                (city as AgentCity & { accuracyMeters?: number }).accuracyMeters ?? null,
              suggestionId,
            },
          });
          const changed = await tx.eagleAsset.update({
            where: { id: target.id },
            data: { rowVersion: { increment: 1 } },
            select: { rowVersion: true },
          });
          operation = json({ assetRowVersion: changed.rowVersion, locationVersion: 1 });
        } else {
          const before = await resolveEagleTrashTargets(
            tx,
            { ownerId, libraryMode: 'PHOTO' },
            [target.id],
            false,
            includePrivate,
          );
          const resourceIds = before.map((resource) => resource.id).sort();
          await tx.$queryRaw(
            Prisma.sql`SELECT id FROM "EagleAsset" WHERE "ownerId"=${ownerId} AND "libraryMode"='PHOTO' AND id=ANY(${resourceIds}::text[]) ORDER BY id FOR UPDATE`,
          );
          const result = await setEagleTrash(
            tx,
            { ownerId, libraryMode: 'PHOTO' },
            [target.id],
            false,
            includePrivate,
          );
          // Reuse the shared logical-photo trash operation, including paired media.
          if (result < 1) throw new ConflictException('关联媒体已变化，请通过图库管理。');
          const changed = await tx.eagleAsset.findUniqueOrThrow({
            where: { id: target.id },
            select: { rowVersion: true },
          });
          const after = await resolveEagleTrashTargets(
            tx,
            { ownerId, libraryMode: 'PHOTO' },
            [target.id],
            true,
            includePrivate,
          );
          operation = json({ assetRowVersion: changed.rowVersion, before, after });
        }
      }
      const updated = await tx.eaglePhotoAgentSuggestion.update({
        where: { id: suggestionId },
        data: {
          status: expected,
          reviewedAt: new Date(),
          operation,
          ...(input.city ? { value: json(input.city) } : {}),
        },
      });
      await appendPhotoAgentEvent(
        tx,
        ownerId,
        taskId,
        'EXECUTED',
        'HUMAN',
        {
          kind: suggestion.kind,
          value: updated.value,
          before: snapshotOf(target),
          operation,
        },
        suggestion,
      );
      return updated;
    });
  }
  async reviewBatch(
    ownerId: string,
    taskId: string,
    input: ReviewPhotoRequestDto,
    includePrivate: boolean,
  ) {
    // Reject a mixed or foreign scope before applying even the first item.
    await this.prisma.$transaction(async (tx) => {
      await this.task(tx, ownerId, taskId, includePrivate);
      const count = await tx.eaglePhotoAgentSuggestion.count({
        where: { ownerId, libraryMode: 'PHOTO', taskId, id: { in: input.suggestionIds } },
      });
      if (count !== input.suggestionIds.length) throw new NotFoundException('整理建议不存在。');
    });
    const results: Array<{ id: string; status: string; error?: string }> = [];
    // Each item commits separately. A failure never reports the rest as successful.
    for (const id of input.suggestionIds) {
      try {
        const result = await this.review(
          ownerId,
          taskId,
          id,
          { action: input.action },
          includePrivate,
        );
        results.push({ id, status: result.status });
      } catch (error) {
        results.push({
          id,
          status: 'ERROR',
          error: error instanceof Error ? error.message : '执行失败',
        });
      }
    }
    return {
      results,
      succeeded: results.filter((item) => item.status !== 'ERROR').length,
      failed: results.filter((item) => item.status === 'ERROR').length,
    };
  }
  private async reviewTransfer(
    ownerId: string,
    taskId: string,
    suggestionId: string,
    includePrivate: boolean,
  ) {
    if (!this.transfer) throw new ConflictException('发送服务未就绪。');
    const approved = await this.prisma.$transaction(async (tx) => {
      await lockOwnerPrivacyProjection(tx, ownerId, 'PHOTO');
      await tx.$queryRaw`SELECT id FROM "EaglePhotoAgentTask" WHERE id=${taskId} AND "ownerId"=${ownerId} FOR UPDATE`;
      const { task, assets } = await this.task(tx, ownerId, taskId, includePrivate);
      const suggestion = await tx.eaglePhotoAgentSuggestion.findFirst({
        where: { id: suggestionId, taskId, ownerId, libraryMode: 'PHOTO' },
      });
      if (!suggestion) throw new NotFoundException('整理建议不存在。');
      if (suggestion.status === 'ACCEPTED') return suggestion;
      if (
        task.status !== 'OPEN' ||
        (task.expiresAt && task.expiresAt <= new Date()) ||
        !['PENDING', 'APPLYING', 'FAILED'].includes(suggestion.status)
      )
        throw new ConflictException('申请已关闭，不能执行。');
      if (suggestion.status === 'PENDING') {
        const target = assets.find((asset) => asset.id === suggestion.assetId);
        if (
          !target ||
          target.deletedAt ||
          target.mediaRevision !== suggestion.assetRevision ||
          target.rowVersion !== suggestion.assetRowVersion
        )
          throw new ConflictException('照片已变化，请重新提交申请。');
        for (const evidence of suggestion.evidence as unknown as Evidence) {
          const current = assets.find((asset) => asset.id === evidence.id);
          if (
            !current ||
            current.deletedAt ||
            current.mediaRevision !== evidence.mediaRevision ||
            current.rowVersion !== evidence.rowVersion ||
            metadataAt(current) !== evidence.metadataAt
          )
            throw new ConflictException('参考证据已变化，请重新提交申请。');
        }
      }
      const updated = await tx.eaglePhotoAgentSuggestion.update({
        where: { id: suggestionId },
        data: {
          status: 'APPLYING',
          reviewedAt: new Date(),
          operation: json({ operationId: suggestionId }),
        },
      });
      await appendPhotoAgentEvent(
        tx,
        ownerId,
        taskId,
        'EXECUTION_STARTED',
        'HUMAN',
        {
          kind: suggestion.kind,
          operationId: suggestionId,
          previousStatus: suggestion.status,
          before: {
            mediaRevision: suggestion.assetRevision,
            rowVersion: suggestion.assetRowVersion,
          },
        },
        suggestion,
      );
      return updated;
    });
    if (approved.status === 'ACCEPTED') return approved;
    try {
      const result = await this.transfer.send(
        ownerId,
        { operationId: suggestionId, assetIds: [approved.assetId] },
        includePrivate,
        new Map([
          [
            approved.assetId,
            { mediaRevision: approved.assetRevision, rowVersion: approved.assetRowVersion },
          ],
        ]),
      );
      return await this.prisma.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT id FROM "EaglePhotoAgentTask" WHERE id=${taskId} AND "ownerId"=${ownerId} FOR UPDATE`;
        const current = await tx.eaglePhotoAgentSuggestion.findUniqueOrThrow({
          where: { id: suggestionId },
        });
        if (current.status === 'ACCEPTED') return current;
        const updated = await tx.eaglePhotoAgentSuggestion.update({
          where: { id: suggestionId },
          data: { status: 'ACCEPTED', operation: json({ operationId: suggestionId, result }) },
        });
        await appendPhotoAgentEvent(
          tx,
          ownerId,
          taskId,
          'EXECUTED',
          'SYSTEM',
          {
            kind: approved.kind,
            operationId: suggestionId,
            result,
          },
          approved,
        );
        return updated;
      });
    } catch (error) {
      // No automatic retry. Another manual approval resumes the same durable send plan.
      await this.prisma.$transaction(async (tx) => {
        const changed = await tx.eaglePhotoAgentSuggestion.updateMany({
          where: { id: suggestionId, ownerId, status: 'APPLYING' },
          data: {
            status: 'FAILED',
            operation: json({
              operationId: suggestionId,
              error: error instanceof Error ? error.message : '执行失败',
            }),
          },
        });
        if (changed.count)
          await appendPhotoAgentEvent(
            tx,
            ownerId,
            taskId,
            'EXECUTION_FAILED',
            'SYSTEM',
            {
              kind: approved.kind,
              operationId: suggestionId,
              error: error instanceof Error ? error.message : '执行失败',
            },
            approved,
          );
      });
      throw error;
    }
  }
  async undo(ownerId: string, taskId: string, suggestionId: string, includePrivate: boolean) {
    try {
      return await this.undoDecision(ownerId, taskId, suggestionId, includePrivate);
    } catch (error) {
      await this.recordFailure(
        ownerId,
        taskId,
        suggestionId,
        'UNDO_FAILED',
        'UNDO',
        includePrivate,
        error,
      );
      throw error;
    }
  }
  private async undoDecision(
    ownerId: string,
    taskId: string,
    suggestionId: string,
    includePrivate: boolean,
  ) {
    return this.prisma.$transaction(async (tx) => {
      await lockOwnerPrivacyProjection(tx, ownerId, 'PHOTO');
      await tx.$queryRaw`SELECT id FROM "EaglePhotoAgentTask" WHERE id=${taskId} AND "ownerId"=${ownerId} FOR UPDATE`;
      await this.task(tx, ownerId, taskId, includePrivate);
      const s = await tx.eaglePhotoAgentSuggestion.findFirst({
        where: { id: suggestionId, ownerId, libraryMode: 'PHOTO', taskId },
      });
      if (!s) throw new NotFoundException('整理建议不存在。');
      if (s.kind === 'SEND_TO_MATERIAL')
        throw new ConflictException('请在素材模式中使用发送到照片。');
      if (s.status === 'UNDONE') return s;
      if (s.status !== 'ACCEPTED') throw new ConflictException('只有已应用建议可以撤销。');
      await tx.$queryRaw`SELECT id FROM "EagleAsset" WHERE id=${s.assetId} AND "ownerId"=${ownerId} AND "libraryMode"='PHOTO' FOR UPDATE`;
      const a = await tx.eagleAsset.findFirst({
        where: { ...scope(ownerId, includePrivate), id: s.assetId, purgeAfter: null },
        select: { rowVersion: true, mediaRevision: true, deletedAt: true },
      });
      const op = s.operation as { assetRowVersion: number; locationVersion?: number };
      if (!a || a.mediaRevision !== s.assetRevision || a.rowVersion !== op.assetRowVersion)
        throw new ConflictException('照片已变化，无法安全撤销。');
      if (s.kind === 'CITY') {
        const result = await tx.eaglePhotoLocation.deleteMany({
          where: {
            ...scope(ownerId, true),
            assetId: s.assetId,
            suggestionId,
            rowVersion: op.locationVersion,
          },
        });
        if (result.count !== 1 || a.deletedAt)
          throw new ConflictException('位置已变化，无法安全撤销。');
        await tx.eagleAsset.update({
          where: { id: s.assetId },
          data: { rowVersion: { increment: 1 } },
        });
      } else {
        const recorded = (
          s.operation as {
            after?: Array<{ id: string; mediaRevision: number; rowVersion: number }>;
          }
        ).after;
        const resources = await resolveEagleTrashTargets(
          tx,
          { ownerId, libraryMode: 'PHOTO' },
          [s.assetId],
          true,
          includePrivate,
        );
        const resourceIds = resources.map((resource) => resource.id).sort();
        await tx.$queryRaw(
          Prisma.sql`SELECT id FROM "EagleAsset" WHERE "ownerId"=${ownerId} AND "libraryMode"='PHOTO' AND id=ANY(${resourceIds}::text[]) ORDER BY id FOR UPDATE`,
        );
        const current = await resolveEagleTrashTargets(
          tx,
          { ownerId, libraryMode: 'PHOTO' },
          [s.assetId],
          true,
          includePrivate,
        );
        if (
          (recorded &&
            (recorded.length !== current.length ||
              recorded.some(
                (snapshot) =>
                  !current.some(
                    (resource) =>
                      resource.id === snapshot.id &&
                      resource.mediaRevision === snapshot.mediaRevision &&
                      resource.rowVersion === snapshot.rowVersion,
                  ),
              ))) ||
          (!recorded && current.length > 1)
        )
          throw new ConflictException('关联媒体已变化，无法安全撤销。');
        await setEagleTrash(
          tx,
          { ownerId, libraryMode: 'PHOTO' },
          [s.assetId],
          true,
          includePrivate,
        );
      }
      const updated = await tx.eaglePhotoAgentSuggestion.update({
        where: { id: s.id },
        data: { status: 'UNDONE', reviewedAt: new Date() },
      });
      await appendPhotoAgentEvent(
        tx,
        ownerId,
        taskId,
        'UNDONE',
        'HUMAN',
        {
          kind: s.kind,
          value: s.value,
          originalOperation: s.operation,
          after: await tx.eagleAsset.findUniqueOrThrow({
            where: { id: s.assetId },
            select: { mediaRevision: true, rowVersion: true, deletedAt: true },
          }),
        },
        s,
      );
      return updated;
    });
  }
}
