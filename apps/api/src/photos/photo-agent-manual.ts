import { isDeepStrictEqual } from 'node:util';
import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import type { PrismaService } from '../prisma/prisma.service';
import type { EagleLibraryTransferService } from '../eagle/eagle-library-transfer.service';
import { lockOwnerPrivacyProjection } from '../eagle/eagle-privacy.service';
import { resolveEagleTrashTargets, setEagleTrash } from '../eagle/eagle-trash';
import { appendPhotoAgentEvent } from './photo-agent-history';
import type { ManualPhotoActionDto } from './photo-agent.dto';

type Action = ManualPhotoActionDto['action'];
type Target = { suggestionId: string; assetId: string; mediaRevision: number; rowVersion: number };
type Receipt = { affectedAssetCount: number; action: Action };
type Start = { input: ManualPhotoActionDto; targets: Target[] };
type Context = {
  assets: Array<{ id: string; mediaRevision: number; rowVersion: number; deletedAt: Date | null }>;
};

export async function manualActionsBySuggestion(
  tx: Prisma.TransactionClient,
  ownerId: string,
  taskId: string,
) {
  const events = await tx.eaglePhotoAgentEvent.findMany({
    where: { ownerId, libraryMode: 'PHOTO', taskId, action: 'MANUAL_EXECUTED' },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    select: { details: true },
  });
  const result = new Map<string, Action>();
  for (const event of events) {
    const detail = event.details as unknown as Start;
    for (const target of detail.targets ?? [])
      if (!result.has(target.suggestionId)) result.set(target.suggestionId, detail.input.action);
  }
  return result;
}

/** Human-selected operations have their own receipt; they never rewrite the Agent's proposed action. */
export async function performManualPhotoAction(
  db: PrismaService,
  transfer: EagleLibraryTransferService | undefined,
  ownerId: string,
  taskId: string,
  input: ManualPhotoActionDto,
  includePrivate: boolean,
  load: (tx: Prisma.TransactionClient) => Promise<Context>,
): Promise<Receipt> {
  const canonical = {
    operationId: input.operationId,
    action: input.action,
    items: input.items
      .map(({ suggestionId, mediaRevision, rowVersion }) => ({
        suggestionId,
        mediaRevision,
        rowVersion,
      }))
      .sort((a, b) => a.suggestionId.localeCompare(b.suggestionId)),
  };
  if (new Set(input.items.map((i) => i.suggestionId)).size !== input.items.length)
    throw new BadRequestException('请选择不重复的照片。');
  const eventWhere = {
    ownerId,
    libraryMode: 'PHOTO' as const,
    taskId,
    details: { path: ['operationId'], equals: input.operationId },
  };
  async function lock(tx: Prisma.TransactionClient) {
    await lockOwnerPrivacyProjection(tx, ownerId, 'PHOTO');
    await tx.$queryRaw`SELECT id FROM "EaglePhotoAgentTask" WHERE id=${taskId} AND "ownerId"=${ownerId} AND "libraryMode"='PHOTO' FOR UPDATE`;
    return load(tx);
  }
  async function finish(tx: Prisma.TransactionClient, start: Start): Promise<Receipt> {
    const done = await tx.eaglePhotoAgentEvent.findFirst({
      where: { ...eventWhere, action: 'MANUAL_EXECUTED' },
    });
    if (done) return (done.details as unknown as { result: Receipt }).result;
    // A manual operation supersedes pending advice, while prior decisions retain their original meaning.
    await tx.eaglePhotoAgentSuggestion.updateMany({
      where: {
        ownerId,
        libraryMode: 'PHOTO',
        taskId,
        id: { in: start.targets.map((t) => t.suggestionId) },
        status: { in: ['PENDING', 'FAILED'] },
      },
      data: { status: 'REJECTED', reviewedAt: new Date() },
    });
    const result = { affectedAssetCount: start.targets.length, action: input.action };
    await appendPhotoAgentEvent(tx, ownerId, taskId, 'MANUAL_EXECUTED', 'HUMAN', {
      operationId: input.operationId,
      ...start,
      result,
    });
    return result;
  }
  const prepared = await db.$transaction(
    async (tx) => {
      const context = await lock(tx);
      const old = await tx.eaglePhotoAgentEvent.findFirst({
        where: { ...eventWhere, action: 'MANUAL_STARTED' },
      });
      if (old) {
        const start = old.details as unknown as Start;
        if (!isDeepStrictEqual(start.input, canonical))
          throw new ConflictException('操作标识与所选照片或处理方式不一致。');
        const done = await tx.eaglePhotoAgentEvent.findFirst({
          where: { ...eventWhere, action: 'MANUAL_EXECUTED' },
        });
        return {
          start,
          result: done ? (done.details as unknown as { result: Receipt }).result : null,
        };
      }
      const suggestions = await tx.eaglePhotoAgentSuggestion.findMany({
        where: {
          ownerId,
          libraryMode: 'PHOTO',
          taskId,
          id: { in: canonical.items.map((i) => i.suggestionId) },
        },
      });
      if (suggestions.length !== canonical.items.length)
        throw new NotFoundException('整理建议不存在。');
      const targets = canonical.items.map((item) => {
        const suggestion = suggestions.find((s) => s.id === item.suggestionId)!;
        if (suggestion.status === 'APPLYING')
          throw new ConflictException('原申请尚未执行完成，请先处理原申请。');
        const asset = context.assets.find((a) => a.id === suggestion.assetId);
        if (
          !asset ||
          asset.deletedAt ||
          asset.mediaRevision !== item.mediaRevision ||
          asset.rowVersion !== item.rowVersion
        )
          throw new ConflictException('照片已变化，请刷新后重新选择。');
        return { ...item, assetId: asset.id };
      });
      const ids = targets.map((t) => t.assetId).sort();
      await tx.$queryRaw`SELECT id FROM "EagleAsset" WHERE "ownerId"=${ownerId} AND "libraryMode"='PHOTO' AND id=ANY(${ids}::text[]) ORDER BY id FOR UPDATE`;
      const current = await tx.eagleAsset.findMany({
        where: {
          ownerId,
          libraryMode: 'PHOTO',
          id: { in: ids },
          deletedAt: null,
          purgeAfter: null,
          ...(includePrivate ? {} : { isPrivate: false }),
        },
      });
      if (
        current.length !== ids.length ||
        targets.some(
          (t) =>
            !current.some(
              (a) =>
                a.id === t.assetId &&
                a.mediaRevision === t.mediaRevision &&
                a.rowVersion === t.rowVersion,
            ),
        )
      )
        throw new ConflictException('照片已变化，请刷新后重新选择。');
      const start = { input: canonical, targets };
      await appendPhotoAgentEvent(tx, ownerId, taskId, 'MANUAL_STARTED', 'HUMAN', {
        operationId: input.operationId,
        ...start,
      });
      if (input.action === 'DELETE') {
        const resources = await resolveEagleTrashTargets(
          tx,
          { ownerId, libraryMode: 'PHOTO' },
          ids,
          false,
          includePrivate,
        );
        const resourceIds = resources.map((r) => r.id).sort();
        await tx.$queryRaw`SELECT id FROM "EagleAsset" WHERE "ownerId"=${ownerId} AND "libraryMode"='PHOTO' AND id=ANY(${resourceIds}::text[]) ORDER BY id FOR UPDATE`;
        if (
          (await setEagleTrash(tx, { ownerId, libraryMode: 'PHOTO' }, ids, false, includePrivate)) <
          ids.length
        )
          throw new ConflictException('照片关联媒体已变化。');
        return { start, result: await finish(tx, start) };
      }
      return { start, result: null };
    },
    { timeout: 30000 },
  );
  if (prepared.result) return prepared.result;
  if (!transfer) throw new ConflictException('发送服务未就绪。');
  try {
    await transfer.send(
      ownerId,
      { operationId: input.operationId, assetIds: prepared.start.targets.map((t) => t.assetId) },
      includePrivate,
      new Map(
        prepared.start.targets.map((t) => [
          t.assetId,
          { mediaRevision: t.mediaRevision, rowVersion: t.rowVersion },
        ]),
      ),
    );
    return await db.$transaction(
      async (tx) => {
        await lock(tx);
        return finish(tx, prepared.start);
      },
      { timeout: 30000 },
    );
  } catch (error) {
    // A failed copy remains an explicit, manually retried operation with the same durable transfer plan.
    if (!(error instanceof NotFoundException))
      await db.$transaction(async (tx) => {
        await lock(tx);
        await appendPhotoAgentEvent(tx, ownerId, taskId, 'MANUAL_FAILED', 'HUMAN', {
          operationId: input.operationId,
          input: canonical,
          error: error instanceof Error ? error.message : '操作失败',
        });
      });
    throw error;
  }
}
