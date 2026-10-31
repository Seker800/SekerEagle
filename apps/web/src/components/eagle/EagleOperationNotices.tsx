import { createEagleQueryKeys } from './eagle-query-keys';
import { useAssetOperationActions } from './useAssetOperationActions';
import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useLibraryWorkspace } from '../../lib/library-workspace';
import { createDuplicatesApi } from '../../lib/eagle-duplicates-api';
import { createAssetOperationsApi } from '../../lib/asset-operations-api';
import { getEagleWorkspaceCache } from './eagle-workspace-cache';
import { useEnqueueAssetOperation } from './useAssetOperations';
import { t } from '../../i18n';
import styles from './EagleOperationNotices.module.css';

function failedRequestIds(requestIds: string[], failedIds: string[]) {
  const failed = new Set(failedIds);
  return requestIds.filter((id) => failed.has(id));
}

export function EagleOperationNotices({ onShowProgress }: { onShowProgress?: () => void }) {
  const { ownerId, libraryMode } = useLibraryWorkspace();
  const client = useQueryClient();
  const changes = getEagleWorkspaceCache(client, ownerId, libraryMode).operations;
  useSyncExternalStore(changes.subscribe, changes.getSnapshot, changes.getSnapshot);
  const api = useMemo(() => createAssetOperationsApi(libraryMode), [libraryMode]);
  const enqueue = useEnqueueAssetOperation();
  const action = useAssetOperationActions();
  const [error, setError] = useState<string | null>(null);
  const rows = changes.entries.filter((row) => !row.dismissed);
  const finished = rows
    .filter((row) => !row.pending && !row.message && !(row.summary?.failed ?? row.failedIds.length))
    .map((row) => row.id)
    .join(',');
  useEffect(() => {
    if (!finished) return;
    const ids = new Set(finished.split(','));
    const entries = changes.entries.filter((row) => ids.has(row.id));
    const deadline = Math.min(...entries.map((row) => (row.completedAt ?? Date.now()) + 6000));
    const timer = setTimeout(
      () =>
        entries
          .filter((row) => (row.completedAt ?? 0) + 6000 <= Date.now())
          .forEach((row) => changes.dismiss(row.id)),
      Math.max(0, deadline - Date.now()),
    );
    return () => clearTimeout(timer);
  }, [changes, finished]);
  return (
    <>
      {rows.map((row) => (
        <div
          key={row.id}
          className={styles.notice}
          role={
            (row.summary?.failed ?? row.failedIds.length) || (!row.pending && row.message)
              ? 'alert'
              : 'status'
          }
        >
          <strong>
            {row.kind === 'TRASH' || row.kind === 'DUPLICATE_CLEANUP'
              ? t('移入回收站')
              : row.kind === 'RESTORE'
                ? t('恢复')
                : row.kind === 'SEND'
                  ? t('发送')
                  : row.kind === 'DUPLICATE_SCAN'
                    ? t('检查新内容')
                    : t('清空回收站')}
          </strong>
          <span>
            {row.uncertain
              ? t('正在确认操作是否受理，请勿重复提交。')
              : row.pending
                ? t('正在处理 {{done}} / {{total}} 项', {
                    done: (row.summary?.completed ?? 0) - (row.summary?.skipped ?? 0),
                    total: row.summary?.total ?? row.expectedTotal,
                  })
                : row.message && !row.summary
                  ? t('操作失败，请重试。')
                  : t('已完成 {{done}} 项，{{failed}} 项未完成', {
                      done: (row.summary?.completed ?? 0) - (row.summary?.skipped ?? 0),
                      failed: row.summary?.failed ?? row.failedIds.length,
                    })}
          </span>
          {row.summary && row.summary.cancelled > 0 && (
            <span>{t('已取消 {{count}} 项', { count: row.summary.cancelled })}</span>
          )}
          {row.summary && (row.summary.skipped ?? 0) > 0 && (
            <span>{t('已跳过 {{count}} 项已移除的内容', { count: row.summary.skipped ?? 0 })}</span>
          )}
          {row.message && <span>{row.message}</span>}
          {row.summary?.errors.map((item) => (
            <span key={item.code}>
              {item.code === 'ASSET_CHANGED'
                ? t('资源已改变，请重新选择。')
                : item.code === 'NOT_FOUND' || item.code === 'ASSET_UNAVAILABLE'
                  ? t('部分内容不存在或不可访问，其余项目继续处理。')
                  : t('操作失败，请重试。')}{' '}
              ({item.count})
            </span>
          ))}
          {['TRASH', 'DUPLICATE_CLEANUP'].includes(row.kind) && !row.undoId && (
            <button
              type="button"
              disabled={action.isPending}
              onClick={() =>
                action.mutate({
                  operation: { id: row.id, kind: row.kind, libraryMode },
                  action: 'undo',
                })
              }
            >
              {action.isPending
                ? t('正在提交撤销…')
                : row.kind === 'DUPLICATE_CLEANUP'
                  ? t('恢复清理项（保留已合并信息）')
                  : t('撤销删除')}
            </button>
          )}
          {row.undoId && <span>{t('已申请撤销，可查看恢复进度。')}</span>}
          {(row.failedIds.length > 0 || (row.summary?.failed ?? 0) > 0) && (
            <button
              type="button"
              onClick={() => {
                if (
                  row.summary &&
                  (row.kind === 'DUPLICATE_CLEANUP' || row.summary.undoOf || !row.failedIds.length)
                )
                  action.mutate({ operation: row.summary, action: 'retry' });
                else
                  void enqueue(row.kind, failedRequestIds(row.requestAssetIds, row.failedIds))
                    .then(() => changes.dismiss(row.id))
                    .catch(() => undefined);
              }}
            >
              {t('重试未完成项')}
            </button>
          )}
          {row.uncertain && (
            <button
              type="button"
              onClick={() =>
                void (
                  row.duplicateInput
                    ? createDuplicatesApi(libraryMode)
                        .cleanup(row.duplicateInput)
                        .then(() => api.list(true))
                        .then((rows) => rows.find((value) => value.id === row.id))
                    : api.enqueue({
                        operationId: row.id,
                        kind: row.kind,
                        assetIds: row.requestAssetIds,
                      })
                )
                  .then((result) => {
                    if (result) changes.observe(result);
                    void client.invalidateQueries({
                      queryKey: createEagleQueryKeys(ownerId, libraryMode).operations,
                    });
                  })
                  .catch((reason) =>
                    setError(reason instanceof Error ? reason.message : String(reason)),
                  )
              }
            >
              {t('重试确认')}
            </button>
          )}
          {onShowProgress && (
            <button type="button" onClick={onShowProgress}>
              {t('查看进度')}
            </button>
          )}
          <button
            type="button"
            aria-label={t('关闭操作提示')}
            onClick={() => changes.dismiss(row.id)}
          >
            {t('关闭')}
          </button>
        </div>
      ))}
      {(error || action.error) && (
        <div role="alert" className={styles.notice}>
          {error ?? action.error?.message}
          <button
            type="button"
            onClick={() => {
              setError(null);
              action.reset();
            }}
          >
            {t('关闭')}
          </button>
        </div>
      )}
    </>
  );
}
