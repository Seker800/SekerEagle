import { DUPLICATE_GROUPING_VERSION } from '@sekereagle/library-core';
import { useAssetOperationActions } from './useAssetOperationActions';
import { ApiError } from '../../lib/api-error';
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { IconCopy, IconX, IconCheck, IconZoomIn } from '@tabler/icons-react';
import { useLibraryWorkspace } from '../../lib/library-workspace';
import {
  createDuplicatesApi,
  type DuplicateCleanupInput,
  type DuplicateGroupSummary,
} from '../../lib/eagle-duplicates-api';
import { MediaLoadScheduler } from '../media/loading/mediaLoadScheduler';
import type { ThumbnailLoadService } from '../media/loading/thumbnailLoadService';
import { EagleAssetThumbnail } from './EagleAssetThumbnail';
import { useAssetOperationList } from './useAssetOperations';
import { getEagleWorkspaceCache } from './eagle-workspace-cache';
import { t } from '../../i18n';
import { EagleImageViewer } from './EagleImageViewer';
import { getEaglePreviewContentUrl } from './eagle-media-sources';
import styles from './EagleDuplicates.module.css';
const bytes = (n: number) =>
  n < 1024
    ? `${n} B`
    : n < 1024 ** 2
      ? `${(n / 1024).toFixed(1)} KB`
      : n < 1024 ** 3
        ? `${(n / 1024 ** 2).toFixed(1)} MB`
        : `${(n / 1024 ** 3).toFixed(2)} GB`;
interface Props {
  scopeRevision?: string;
  includePrivate: boolean;
  onClose: () => void;
}
export function EagleDuplicates({ includePrivate, scopeRevision = '', onClose }: Props) {
  const { libraryMode, ownerId } = useLibraryWorkspace(),
    client = useQueryClient();
  const api = useMemo(() => createDuplicatesApi(libraryMode), [libraryMode]);
  const scheduler = useMemo(() => new MediaLoadScheduler(), []);
  const loadService = useMemo(
    () => getEagleWorkspaceCache(client, ownerId, libraryMode).thumbnails,
    [client, ownerId, libraryMode],
  );
  const [kind, setKind] = useState('ALL'),
    [showIgnored, setShowIgnored] = useState(false),
    [expanded, setExpanded] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<{
    input: DuplicateCleanupInput;
    count: number;
    removeCount: number;
  } | null>(null);
  const [notice, setNotice] = useState('');
  const [selected, setSelected] = useState<Map<string, DuplicateGroupSummary>>(new Map());
  const selectionRevision = useRef<string | undefined>(undefined);
  const cache = getEagleWorkspaceCache(client, ownerId, libraryMode);
  const changes = cache.operations;
  useSyncExternalStore(changes.subscribe, changes.getSnapshot, changes.getSnapshot);
  const action = useAssetOperationActions();
  const priorChoices = new Map(
    changes.entries.flatMap(
      (row) =>
        row.duplicateInput?.groups?.map((choice) => [choice.signature, choice] as const) ?? [],
    ),
  );
  const submitted = Object.fromEntries(
    changes.entries
      .filter((row) => row.pending)
      .flatMap((row) => (row.groupSignatures ?? []).map((signature) => [signature, row.id])),
  );
  const hadConfirmation = useRef(false);
  useEffect(() => {
    if (confirm) {
      hadConfirmation.current = true;
      dialog.current?.querySelector<HTMLElement>('[role=alertdialog] button')?.focus();
    } else if (hadConfirmation.current) {
      hadConfirmation.current = false;
      dialog.current?.querySelector<HTMLElement>('button[aria-expanded=true]')?.focus();
    }
  }, [confirm]);
  const dialog = useRef<HTMLDialogElement>(null),
    scanId = useRef<string | null>(null);
  useEffect(() => {
    const el = dialog.current,
      previous = document.activeElement as HTMLElement | null;
    el?.showModal();
    return () => {
      el?.close();
      previous?.focus();
    };
  }, []);
  const queryKey = [
    'eagle',
    ownerId,
    libraryMode,
    'duplicates',
    includePrivate,
    scopeRevision,
    kind,
    showIgnored,
    DUPLICATE_GROUPING_VERSION,
  ];
  const results = useInfiniteQuery({
    queryKey,
    initialPageParam: undefined as { cursor: string; revision: string } | undefined,
    queryFn: ({ pageParam, signal }) =>
      api.list({ ...pageParam, kind, showIgnored: String(showIgnored) }, signal),
    getNextPageParam: (last) =>
      last.nextCursor ? { cursor: last.nextCursor, revision: last.revision } : undefined,
    staleTime: 30_000,
    retry: false,
  });
  const data = results.data?.pages[0],
    allGroups = results.data?.pages.flatMap((p) => p.groups) ?? [];
  const hiddenGroups = new Set(
    changes.entries.flatMap((row) =>
      row.pending
        ? (row.groupSignatures ?? [])
        : (row.completedAt ?? 0) > results.dataUpdatedAt
          ? (row.finishedGroups ?? [])
          : [],
    ),
  );
  const pendingGlobal = changes.entries.filter(
    (row) => row.pending && row.kind === 'DUPLICATE_CLEANUP',
  );
  const groups = allGroups.filter(
    (group) =>
      !hiddenGroups.has(group.signature) &&
      (showIgnored ||
        !pendingGlobal.some(
          (row) =>
            row.duplicateInput?.allVerified ||
            (row.duplicateInput?.allExact && group.kind === 'EXACT'),
        )),
  );
  const operationQueries = useAssetOperationList(includePrivate),
    operations = operationQueries
      .flatMap((q) => q.data ?? [])
      .filter(
        (op) =>
          op.libraryMode === libraryMode &&
          (op.kind === 'DUPLICATE_SCAN' || op.kind === 'DUPLICATE_CLEANUP'),
      );
  const active = operations.filter((op) => op.running || op.queued),
    scanning = active.some((op) => op.kind === 'DUPLICATE_SCAN');
  const terminalScan = operations
    .filter(
      (op) =>
        op.kind === 'DUPLICATE_SCAN' &&
        !op.running &&
        !op.queued &&
        !changes.entries.some((row) => row.id === op.id),
    )
    .map((op) => `${op.id}:${op.completed}:${op.failed}`)
    .sort()
    .join('|');
  const observedScan = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (terminalScan && observedScan.current !== terminalScan) {
      observedScan.current = terminalScan;
      void client.invalidateQueries(
        { queryKey: ['eagle', ownerId, libraryMode, 'duplicates'] },
        { cancelRefetch: false },
      );
    }
  }, [terminalScan, client, ownerId, libraryMode]);
  const invalidate = () =>
    client.invalidateQueries({ queryKey: ['eagle', ownerId, libraryMode, 'operations'] });
  const scan = useMutation({
    mutationFn: () => {
      scanId.current ??= crypto.randomUUID();
      cache.beginOperation(scanId.current, 'DUPLICATE_SCAN', []);
      return api.scan(scanId.current);
    },
    onSuccess: (result) => {
      if (result.operationId && scanId.current && result.operationId !== scanId.current) {
        changes.finish(scanId.current, 'DUPLICATE_SCAN', []);
        cache.beginOperation(result.operationId, 'DUPLICATE_SCAN', []);
      }
      if (!result.operationId && scanId.current)
        changes.finish(scanId.current, 'DUPLICATE_SCAN', []);
      scanId.current = null;
      setNotice(
        result.operationId
          ? t('检查已加入后台任务，关闭此窗口后仍会继续。')
          : t('现有可用图片都已检查，新图片处理完成后可再次检查。'),
      );
      void invalidate();
      // A check also renews the visible projection, even when there is no new work.
      if (!result.operationId) void results.refetch({ cancelRefetch: false });
    },
  });
  const attemptedUpgrade = useRef<string | null>(null);
  const upgradeKey = `${ownerId}:${libraryMode}:${includePrivate}:${DUPLICATE_GROUPING_VERSION}`;
  useEffect(() => {
    if (
      (data?.outdatedGroups ||
        (data?.originalCheckCompleted === false && data.coverage.total > 0)) &&
      attemptedUpgrade.current !== upgradeKey &&
      !scanning &&
      !scan.isPending
    ) {
      attemptedUpgrade.current = upgradeKey;
      scan.mutate();
    }
  }, [
    data?.outdatedGroups,
    data?.originalCheckCompleted,
    data?.coverage.total,
    upgradeKey,
    scanning,
    scan.isPending,
    scan.mutate,
  ]);
  const cleanup = useMutation({
    mutationFn: async (input: DuplicateCleanupInput) => {
      const signatures =
        changes.entries.find((row) => row.id === input.operationId)?.groupSignatures ??
        (input.allVerified
          ? groups.map((group) => group.signature)
          : (input.signatures ??
            (input.allExact
              ? groups.filter((group) => group.kind === 'EXACT').map((group) => group.signature)
              : (input.groups?.map((group) => group.signature) ?? []))));
      const ids = new Set<string>();
      for (const choice of input.groups ?? []) {
        if (choice.removeIds) choice.removeIds.forEach((id) => ids.add(id));
        else {
          const memberPages = client.getQueryData<{
            pages: Array<{ items: Array<{ id: string }> }>;
          }>(['eagle', ownerId, libraryMode, 'duplicate-members', choice.signature, scopeRevision]);
          memberPages?.pages.forEach((page) =>
            page.items.forEach((item) => {
              if (!choice.keepIds?.includes(item.id)) ids.add(item.id);
            }),
          );
        }
      }
      cache.beginOperation(
        input.operationId,
        'DUPLICATE_CLEANUP',
        [...ids],
        input.allVerified ? data?.verifiedItems : input.allExact ? data?.exactItems : undefined,
      );
      changes.setGroups(input.operationId, signatures);
      changes.setDuplicateInput(input.operationId, input);
      advance(signatures);
      try {
        return await api.cleanup(input);
      } catch (error) {
        if (
          error instanceof ApiError &&
          error.status >= 400 &&
          error.status < 500 &&
          error.status !== 408
        ) {
          changes.reject(input.operationId, error.message);
          setExpanded(input.groups?.[0]?.signature ?? null);
          await client.invalidateQueries({
            queryKey: ['eagle', ownerId, libraryMode, 'assets', 'library-count'],
          });
          changes.confirmCounts();
        } else {
          setConfirm(null);
          changes.uncertain(
            input.operationId,
            error instanceof Error ? error.message : String(error),
          );
        }
        throw error;
      }
    },
    onSuccess: (result, input) => {
      setConfirm(null);
      setSelected(new Map());
      const signatures =
        changes.entries.find((row) => row.id === input.operationId)?.groupSignatures ??
        (input.allVerified
          ? groups.map((group) => group.signature)
          : (input.signatures ??
            (input.allExact
              ? groups.filter((group) => group.kind === 'EXACT').map((group) => group.signature)
              : (input.groups?.map((group) => group.signature) ?? []))));
      if (result.operationId) {
        changes.setGroups(result.operationId, signatures);
        if (result.assetIds) changes.expand(result.operationId, result.assetIds);
      } else changes.finish(input.operationId, 'DUPLICATE_CLEANUP', []);
      advance(signatures);
      setNotice(
        result.operationId
          ? t('清理已加入后台任务，可在任务中心查看进度。完成后可从回收站恢复。')
          : t('没有需要清理的项目。'),
      );
      void invalidate();
    },
  });
  const advance = (signatures: string[]) => {
    setExpanded((current) => {
      if (current && !signatures.includes(current)) return current;
      const index = groups.findIndex((group) => group.signature === current);
      const remaining = [...groups.slice(index + 1), ...groups.slice(0, index + 1)];
      return (
        remaining.find(
          (group) => !signatures.includes(group.signature) && !submitted[group.signature],
        )?.signature ?? null
      );
    });
  };
  const refresh = async () => {
    const result = await results.refetch();
    if (!result.isError) {
      setNotice('');
    }
  };
  const confirmAll = () => {
    if (!data) return;
    setConfirm({
      input:
        data.verifiedGroups === undefined
          ? { operationId: crypto.randomUUID(), allExact: true, revision: data.exactRevision }
          : { operationId: crypto.randomUUID(), allVerified: true, revision: data.revision },
      count: data.verifiedGroups ?? data.exactGroups,
      removeCount: data.verifiedItems ?? data.exactItems,
    });
  };
  useEffect(() => {
    if (selectionRevision.current !== data?.revision) {
      selectionRevision.current = data?.revision;
      setSelected(new Map());
    }
  }, [data?.revision]);
  return (
    <dialog
      ref={dialog}
      className={styles.dialog}
      aria-label={t('查重清理')}
      onCancel={(event) => {
        event.preventDefault();
        if (confirm && !cleanup.isPending) setConfirm(null);
        else onClose();
      }}
    >
      <header className={styles.header}>
        <div>
          <h2>
            <IconCopy size={21} />
            {t('查重清理')}
          </h2>
          <p>
            {libraryMode === 'PHOTO' ? t('照片库') : t('素材库')} ·{' '}
            {t('检查当前图库全部可访问内容，不含回收站')}
          </p>
        </div>
        <button type="button" aria-label={t('关闭查重清理')} onClick={onClose}>
          <IconX size={21} />
        </button>
      </header>
      {confirm ? (
        <section className={styles.confirm} role="alertdialog" aria-label={t('确认清理')}>
          <h3>{t('清理 {{count}} 组重复副本', { count: confirm.count })}</h3>
          <p>
            {t('保留 {{keep}} 项，清理 {{remove}} 项', {
              keep: confirm.count,
              remove: confirm.removeCount,
            })}
          </p>
          <p>{t('每组按推荐保留一项，其余移入回收站，可以恢复。')}</p>
          <p>
            {t(
              '完全重复项的独有标签和最高评分会合并到保留项。说明、来源和编辑关系仍保存在原项目中，请先检查需要保留的信息。',
            )}
          </p>
          <p>{t('现在不会释放磁盘空间，清空回收站后才会释放实际占用。')}</p>
          {cleanup.error && <p role="alert">{cleanup.error.message}</p>}
          <div className={styles.actions}>
            <button type="button" disabled={cleanup.isPending} onClick={() => setConfirm(null)}>
              {t('返回检查')}
            </button>
            <button
              className={styles.danger}
              type="button"
              disabled={cleanup.isPending}
              onClick={() => cleanup.mutate(confirm.input)}
            >
              {cleanup.isPending ? t('正在提交…') : t('确认移入回收站')}
            </button>
          </div>
        </section>
      ) : (
        <>
          <div className={styles.tools}>
            <div className={styles.tabs} role="group" aria-label={t('查重类型')}>
              {[
                ['ALL', t('全部')],
                ['EXACT', t('完全重复')],
                ['SIMILAR', t('原图画面相同')],
              ].map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  aria-pressed={kind === value}
                  onClick={() => {
                    setKind(value);
                    setExpanded(null);
                  }}
                >
                  {label}
                  {data && value === 'EXACT'
                    ? ` ${data.exactGroups}`
                    : data && value === 'SIMILAR'
                      ? ` ${data.similarGroups}`
                      : ''}
                </button>
              ))}
            </div>
            <div className={styles.actions}>
              <button type="button" disabled={results.isFetching} onClick={() => void refresh()}>
                {results.isFetching ? t('正在读取查重结果…') : t('刷新结果')}
              </button>
              <button
                type="button"
                disabled={scan.isPending || scanning}
                onClick={() => scan.mutate()}
              >
                {scanning ? t('后台检查中…') : t('检查新内容')}
              </button>
            </div>
          </div>
          <div className={styles.content}>
            {!!data?.outdatedGroups && (
              <p role="status">{t('旧版近似结果已停用，正在核验原图；连拍不作为重复副本清理。')}</p>
            )}
            {data && (
              <div className={styles.coverage}>
                <strong>{t('{{count}} 组待检查', { count: data.totalGroups })}</strong>
                <span>
                  {t('视觉检查 {{done}} / {{total}} 张', {
                    done: data.coverage.indexed.toLocaleString(),
                    total: data.coverage.total.toLocaleString(),
                  })}
                  {data.coverage.waiting > 0
                    ? ` · ${t('{{count}} 张等待预览', { count: data.coverage.waiting })}`
                    : ''}
                  {` · ${t('已核验 {{value1}} 张候选原图', { value1: (data.coverage.originalsVerified ?? 0).toLocaleString() })}`}
                </span>
                <details className={styles.help}>
                  <summary>{t('查重依据与空间说明')}</summary>
                  <p>
                    {t(
                      '文件完全相同依据原文件哈希；原图画面相同依据完整分辨率的定向像素哈希。缩略图只找候选，连拍和重新压缩的近似照片不进入清理结果。',
                    )}
                  </p>
                  <p>
                    {t(
                      '原图核验目前支持单帧八位 JPEG 和 PNG；RAW、实况、编辑副本及其他格式仅检查文件完全相同，不将相似预览当作证据。',
                    )}
                  </p>
                  {!!data.coverage.unsupportedOriginals && (
                    <p>
                      {t('{{value1}} 张候选原图未通过格式或资源预算核验，不会进入画面相同清理。', {
                        value1: data.coverage.unsupportedOriginals,
                      })}
                    </p>
                  )}
                  <p>{t('现在不会释放磁盘空间，清空回收站后才会释放实际占用。')}</p>
                </details>
              </div>
            )}
            {active.map((op) => (
              <div key={op.id} className={styles.progress} role="status">
                {op.kind === 'DUPLICATE_SCAN' ? t('检查图片') : t('清理重复项')} ·{' '}
                {op.completed.toLocaleString()} / {op.total.toLocaleString()}{' '}
                {op.running ? t('正在处理') : t('排队中')}
                {op.queued > 0 && (
                  <button
                    type="button"
                    disabled={action.isPending}
                    onClick={() => action.mutate({ operation: op, action: 'cancel' })}
                  >
                    {t('取消排队')}
                  </button>
                )}
              </div>
            ))}
            {operations
              .filter((op) => op.failed > 0)
              .map((op) => (
                <p key={op.id} className={styles.warning}>
                  {t('已完成 {{done}} 项，{{failed}} 项未完成', {
                    done: op.completed,
                    failed: op.failed,
                  })}
                  {op.errors?.map((error) => (
                    <span key={error.code}>
                      {error.code === 'ASSET_CHANGED'
                        ? t('资源已改变，请重新选择。')
                        : t('操作失败，请重试。')}{' '}
                      ({error.count})
                    </span>
                  ))}
                  <button
                    type="button"
                    disabled={action.isPending}
                    onClick={() => action.mutate({ operation: op, action: 'retry' })}
                  >
                    {t('重试未完成项')}
                  </button>
                </p>
              ))}
            {changes.entries
              .filter((row) => row.pending && row.kind === 'DUPLICATE_CLEANUP' && row.uncertain)
              .map((row) => (
                <div key={row.id} role="alert">
                  <p>
                    {t('正在确认操作是否受理，请勿重复提交。')} {row.message}
                  </p>
                  <button
                    type="button"
                    disabled={cleanup.isPending || !row.duplicateInput}
                    onClick={() => row.duplicateInput && cleanup.mutate(row.duplicateInput)}
                  >
                    {t('重试确认')}
                  </button>
                </div>
              ))}
            {action.error && <p role="alert">{action.error.message}</p>}
            {notice && (
              <p role="status" className={styles.notice}>
                {notice}
                <button type="button" onClick={() => setNotice('')}>
                  {t('关闭')}
                </button>
              </p>
            )}
            {scan.error && (
              <div role="alert">
                <p>{scan.error.message}</p>
                <button type="button" disabled={scan.isPending} onClick={() => scan.mutate()}>
                  {t('重试')}
                </button>
              </div>
            )}
            {results.error && (
              <div role="alert">
                <p>{results.error.message}</p>
                <button type="button" onClick={() => void refresh()}>
                  {t('重试')}
                </button>
              </div>
            )}
            {results.isPending && <p role="status">{t('正在读取查重结果…')}</p>}
            {data && (
              <div className={styles.resultTools}>
                <label>
                  <input
                    type="checkbox"
                    checked={showIgnored}
                    onChange={(event) => {
                      setShowIgnored(event.target.checked);
                      setExpanded(null);
                    }}
                  />
                  {t('查看已忽略')} ({data.ignoredGroups})
                </label>
                {!showIgnored && (data.verifiedGroups ?? data.exactGroups) > 0 && (
                  <button
                    type="button"
                    disabled={
                      cleanup.isPending ||
                      Object.keys(submitted).length > 0 ||
                      active.some((op) => op.kind === 'DUPLICATE_CLEANUP')
                    }
                    onClick={confirmAll}
                  >
                    {t('每组保留一份，清理全部重复副本')}
                  </button>
                )}
              </div>
            )}
            {!showIgnored && groups.length > 0 && (
              <div className={styles.bulkActions}>
                <button
                  type="button"
                  onClick={() =>
                    setSelected((current) => {
                      const next = new Map(current);
                      const all = groups.every((group) => next.has(group.signature));
                      for (const group of groups)
                        if (all) next.delete(group.signature);
                        else if (!submitted[group.signature]) next.set(group.signature, group);
                      return next;
                    })
                  }
                >
                  {t('选择或取消本页')}
                </button>
                <span>{t('已选 {{value1}} 组，每组保留一份', { value1: selected.size })}</span>
                <button
                  type="button"
                  disabled={!selected.size}
                  onClick={() => setSelected(new Map())}
                >
                  {t('清空选择')}
                </button>
                <button
                  type="button"
                  disabled={!selected.size || cleanup.isPending}
                  onClick={() =>
                    setConfirm({
                      input: {
                        operationId: crypto.randomUUID(),
                        revision: data!.revision,
                        signatures: [...selected.keys()],
                      },
                      count: selected.size,
                      removeCount: [...selected.values()].reduce(
                        (n, group) => n + group.count - 1,
                        0,
                      ),
                    })
                  }
                >
                  {t('清理所选重复组')}
                </button>
              </div>
            )}
            {groups.map((group, index) => (
              <article key={group.signature} className={styles.group}>
                {!showIgnored && (
                  <label className={styles.groupSelection}>
                    <input
                      type="checkbox"
                      aria-label={t('选择重复组 {{value1}}', { value1: index + 1 })}
                      checked={selected.has(group.signature)}
                      disabled={!!submitted[group.signature]}
                      onChange={(event) =>
                        setSelected((current) => {
                          const next = new Map(current);
                          if (event.target.checked) next.set(group.signature, group);
                          else next.delete(group.signature);
                          return next;
                        })
                      }
                    />
                    {t('每组保留推荐的一份')}
                  </label>
                )}
                <button
                  className={styles.groupHeader}
                  type="button"
                  disabled={!!submitted[group.signature]}
                  aria-expanded={expanded === group.signature}
                  onClick={() =>
                    setExpanded((current) => (current === group.signature ? null : group.signature))
                  }
                >
                  <div className={styles.previews}>
                    {group.previews.map((asset, i) => (
                      <div key={asset.id}>
                        <EagleAssetThumbnail
                          asset={asset}
                          scheduler={scheduler}
                          loadService={loadService}
                          order={index * 2 + i}
                          displayWidth={92}
                        />
                      </div>
                    ))}
                  </div>
                  <div>
                    <div className={styles.groupSummary}>
                      <strong>
                        {group.kind === 'EXACT' ? t('文件完全相同') : t('原图像素完全相同')} ·{' '}
                        {group.count} {t('项')}
                      </strong>
                      <small>
                        {t('保留一项后可清理 {{size}} 文件', { size: bytes(group.removableBytes) })}
                      </small>
                    </div>
                    <p>{group.previews[0]?.displayName}</p>
                  </div>
                  <span>
                    {submitted[group.signature]
                      ? t('已提交清理')
                      : expanded === group.signature
                        ? t('收起')
                        : t('比较并选择')}
                  </span>
                </button>
                {expanded === group.signature && (
                  <DuplicateComparison
                    key={group.signature}
                    group={group}
                    initialSelection={priorChoices.get(group.signature)}
                    ignored={showIgnored}
                    api={api}
                    scheduler={scheduler}
                    loadService={loadService}
                    scopeRevision={scopeRevision}
                    submitting={cleanup.isPending}
                    cleanupError={
                      !confirm &&
                      cleanup.variables?.groups?.some(
                        (selected) => selected.signature === group.signature,
                      )
                        ? cleanup.error?.message
                        : undefined
                    }
                    onIgnored={() => {
                      advance([group.signature]);
                      void results.refetch();
                    }}
                    onCleanup={(selection) => {
                      const selectedGroups = [{ signature: group.signature, ...selection }];
                      const previous = cleanup.variables;
                      cleanup.mutate(
                        cleanup.error &&
                          JSON.stringify(previous?.groups) === JSON.stringify(selectedGroups)
                          ? previous!
                          : { operationId: crypto.randomUUID(), groups: selectedGroups },
                      );
                    }}
                  />
                )}
              </article>
            ))}
            {data &&
              !groups.length &&
              !results.error &&
              !active.some((op) => op.kind === 'DUPLICATE_CLEANUP') &&
              !pendingGlobal.length && (
                <div className={styles.empty}>
                  {!scanning && !scan.isPending && !data.outdatedGroups && <IconCheck size={35} />}
                  <h3>
                    {scanning || scan.isPending
                      ? t('正在检查查重结果…')
                      : data.outdatedGroups
                        ? t('查重规则尚未更新')
                        : showIgnored
                          ? t('没有已忽略的结果')
                          : kind === 'EXACT'
                            ? t('没有完全重复的文件')
                            : data.coverage.indexed < data.coverage.total
                              ? t('视觉检查尚未完成')
                              : kind === 'SIMILAR'
                                ? t('未发现已核验的画面相同副本')
                                : t('未发现符合当前规则的重复项')}
                  </h3>
                  <p>
                    {scanning || scan.isPending
                      ? t('后台检查完成后会自动显示结果，可以继续浏览。')
                      : data.outdatedGroups
                        ? t('旧规则结果已停用，请等待更新完成；失败时可重新检查。')
                        : kind === 'EXACT' && !showIgnored
                          ? t('文件字节不同的备份副本请查看“原图画面相同”；需先完成候选原图核验。')
                          : data.coverage.indexed < data.coverage.total
                            ? t('还有图片未完成视觉检查，可以点击“检查新内容”。')
                            : t('当前分类没有待处理结果，可切换分类或检查新内容。')}
                  </p>
                  {!showIgnored && kind === 'EXACT' && data.similarGroups > 0 && (
                    <button
                      type="button"
                      onClick={() => {
                        setKind('SIMILAR');
                        setExpanded(null);
                      }}
                    >
                      {t('查看原图画面相同 {{value1}} 组', {
                        value1: data.similarGroups.toLocaleString(),
                      })}
                    </button>
                  )}
                  {!showIgnored && kind === 'SIMILAR' && data.exactGroups > 0 && (
                    <button
                      type="button"
                      onClick={() => {
                        setKind('EXACT');
                        setExpanded(null);
                      }}
                    >
                      {t('查看完全重复 {{value1}} 组', {
                        value1: data.exactGroups.toLocaleString(),
                      })}
                    </button>
                  )}
                </div>
              )}
            {results.hasNextPage && (
              <button
                type="button"
                disabled={results.isFetchingNextPage}
                onClick={() => void results.fetchNextPage()}
              >
                {results.isFetchingNextPage ? t('正在加载…') : t('加载更多组')}
              </button>
            )}
          </div>
        </>
      )}
    </dialog>
  );
}
function DuplicateComparison({
  group,
  initialSelection,
  ignored,
  api,
  scheduler,
  loadService,
  scopeRevision,
  submitting,
  cleanupError,
  onIgnored,
  onCleanup,
}: {
  group: DuplicateGroupSummary;
  initialSelection?: { keepIds?: string[]; removeIds?: string[] };
  ignored: boolean;
  api: ReturnType<typeof createDuplicatesApi>;
  scheduler: MediaLoadScheduler;
  loadService: ThumbnailLoadService;
  scopeRevision: string;
  submitting: boolean;
  cleanupError?: string;
  onIgnored: () => void;
  onCleanup: (selection: { keepIds: string[] } | { removeIds: string[] }) => void;
}) {
  const { ownerId, libraryMode, api: workspaceApi } = useLibraryWorkspace();
  const [previewIndex, setPreviewIndex] = useState<number | null>(null);
  const [keepIds, setKeepIds] = useState(initialSelection?.keepIds ?? [group.recommendedId]);
  const [removeIds, setRemoveIds] = useState<string[]>(initialSelection?.removeIds ?? []);
  const actionBar = useRef<HTMLDivElement>(null);
  const isKept = (id: string) =>
    group.kind === 'EXACT' ? keepIds.includes(id) : !removeIds.includes(id);
  const members = useInfiniteQuery({
    queryKey: ['eagle', ownerId, libraryMode, 'duplicate-members', group.signature, scopeRevision],
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam, signal }) => api.members(group.signature, pageParam, signal),
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    retry: false,
  });
  const ignore = useMutation({
    mutationFn: () => api.ignore(group.signature, !ignored),
    onSuccess: onIgnored,
  });
  useEffect(() => {
    if (members.isPending) return;
    actionBar.current?.closest('article')?.scrollIntoView?.({ block: 'start' });
    actionBar.current?.querySelector('button')?.focus({ preventScroll: true });
  }, [members.isPending]);
  const items = members.data?.pages.flatMap((p) => p.items) ?? [];
  const removeCount = group.kind === 'EXACT' ? group.count - keepIds.length : removeIds.length;
  const keepCount = group.count - removeCount;
  const preview = previewIndex === null ? undefined : items[previewIndex];
  const descriptor = useQuery({
    queryKey: [
      'eagle',
      ownerId,
      libraryMode,
      'duplicate-pyramid',
      scopeRevision,
      preview?.id,
      preview?.mediaRevision,
    ],
    enabled: !!preview,
    queryFn: ({ signal }) => workspaceApi.getEaglePyramidDescriptor('', preview!.id, signal),
    retry: false,
  });
  const previewUrl = preview ? getEaglePreviewContentUrl(preview) : null;
  return (
    <div className={styles.comparison}>
      <p>
        {group.kind === 'EXACT'
          ? t('完全重复项合并标签和最高评分；说明、来源及编辑关系保留在回收站原项中。')
          : t('原图像素已核验完全相同。可用上方批量工具每组保留一份；这里也可手动选择额外保留项。')}
      </p>
      {members.isPending && <p role="status">{t('正在读取组内图片…')}</p>}
      {(members.error || ignore.error) && (
        <p role="alert">
          {(members.error ?? ignore.error)?.message}
          <button type="button" onClick={() => void members.refetch()}>
            {t('重试')}
          </button>
        </p>
      )}
      <div ref={actionBar} className={styles.reviewActions}>
        <button
          type="button"
          disabled={ignore.isPending || submitting}
          onClick={() => ignore.mutate()}
        >
          {ignored ? t('重新检查这组') : t('忽略这组')}
        </button>
        <span className={styles.recovery}>{t('清理项移入回收站，可恢复')}</span>
        {!ignored && (
          <button
            type="button"
            className={styles.danger}
            disabled={
              submitting ||
              ignore.isPending ||
              !keepCount ||
              removeCount === 0 ||
              !members.data ||
              !!members.error
            }
            onClick={() => onCleanup(group.kind === 'EXACT' ? { keepIds } : { removeIds })}
          >
            {t('保留 {{keep}} 项，清理 {{remove}} 项', {
              keep: keepCount,
              remove: removeCount,
            })}
          </button>
        )}
      </div>
      {!keepCount && <p role="alert">{t('每组至少保留一项。')}</p>}
      {cleanupError && <p role="alert">{cleanupError}</p>}
      <div className={styles.members}>
        {items.map((item, index) => (
          <article
            key={item.id}
            className={`${styles.member} ${isKept(item.id) ? styles.kept : ''}`}
          >
            <div className={styles.image}>
              <EagleAssetThumbnail
                asset={item}
                scheduler={scheduler}
                loadService={loadService}
                order={index}
                displayWidth={320}
              />
            </div>
            <div className={styles.memberBody}>
              <label>
                <input
                  type="checkbox"
                  aria-label={t('保留 {{value1}}', { value1: item.displayName })}
                  checked={isKept(item.id)}
                  onChange={(event) => {
                    if (group.kind === 'EXACT')
                      setKeepIds((current) =>
                        event.target.checked
                          ? [...current, item.id]
                          : current.filter((id) => id !== item.id),
                      );
                    else
                      setRemoveIds((current) =>
                        event.target.checked
                          ? current.filter((id) => id !== item.id)
                          : [...current, item.id],
                      );
                  }}
                />
                {t('保留此项')}
                {!isKept(item.id) && <span className={styles.warning}>{t('移入回收站')}</span>}
                {item.id === group.recommendedId && <small>{t('推荐保留')}</small>}
              </label>
              <strong title={item.displayName}>{item.displayName}</strong>
              <span>
                {item.format.toUpperCase()} · {item.width ?? '—'} × {item.height ?? '—'} ·{' '}
                {bytes(item.byteSize)}
              </span>
              <span>
                {t('入库')} {new Date(item.libraryAddedAt).toLocaleDateString()}{' '}
                {item.rating ? `· ${'★'.repeat(item.rating)}` : ''}
                {item.photoMetadata?.capturedAt && (
                  <>
                    {' '}
                    · {t('拍摄')} {new Date(item.photoMetadata.capturedAt).toLocaleString()}
                  </>
                )}
              </span>
              {item.manualTags.length > 0 && (
                <span>
                  {t('标签')}：{item.manualTags.map((tag) => tag.name).join('、')}
                </span>
              )}
              {item.editedCopy && (
                <span className={styles.warning}>{t('编辑成片，请保留需要的版本')}</span>
              )}
              {item.livePhoto && (
                <span className={styles.warning}>{t('实况照片，清理包含关联动态组件')}</span>
              )}
              {item.annotation?.description && (
                <p>
                  {t('说明')}：{item.annotation.description}
                </p>
              )}
              {item.annotation?.sourceUrl && (
                <p>
                  {t('来源')}：{item.annotation.sourceUrl}
                </p>
              )}
              <button type="button" onClick={() => setPreviewIndex(index)}>
                <IconZoomIn size={16} />
                {t('放大比较')}
              </button>
            </div>
          </article>
        ))}
      </div>
      {members.hasNextPage && (
        <button
          type="button"
          disabled={members.isFetchingNextPage}
          onClick={() => void members.fetchNextPage()}
        >
          {t('加载更多组内图片')}
        </button>
      )}
      {preview && previewUrl && (
        <EagleImageViewer
          asset={preview}
          readOnly
          image={{ src: previewUrl, alt: preview.displayName, assetId: preview.id }}
          descriptor={descriptor.data ?? undefined}
          onClose={() => setPreviewIndex(null)}
          subtitle={t('查重比较 · {{value1}} × {{value2}}', {
            value1: preview.width ?? '—',
            value2: preview.height ?? '—',
          })}
          navigation={{
            previous: previewIndex! > 0 ? () => setPreviewIndex(previewIndex! - 1) : undefined,
            next:
              previewIndex! < items.length - 1
                ? () => setPreviewIndex(previewIndex! + 1)
                : undefined,
            position: { current: previewIndex! + 1, total: items.length },
          }}
        />
      )}
    </div>
  );
}
