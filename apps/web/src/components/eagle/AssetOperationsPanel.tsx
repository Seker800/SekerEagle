import { useMemo } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { AssetOperationSummary } from '@sekereagle/library-core';
import { createAssetOperationsApi } from '../../lib/asset-operations-api';
import type { LibraryMode } from '../../lib/library-api-scope';
import { useLibraryWorkspace } from '../../lib/library-workspace';
import { t } from '../../i18n';
import { useAssetOperationList } from './useAssetOperations';
import styles from './EagleTaskCenter.module.css';

export function AssetOperationsPanel({
  includePrivate,
  scope,
}: {
  includePrivate: boolean;
  scope: 'ALL' | LibraryMode;
}) {
  const { ownerId } = useLibraryWorkspace();
  const client = useQueryClient();
  const queries = useAssetOperationList(includePrivate);
  const apis = useMemo(
    () => ({
      MATERIAL: createAssetOperationsApi('MATERIAL'),
      PHOTO: createAssetOperationsApi('PHOTO'),
    }),
    [],
  );
  const action = useMutation({
    mutationFn: ({ operation, retry }: { operation: AssetOperationSummary; retry: boolean }) =>
      retry
        ? apis[operation.libraryMode].retry(operation.id)
        : apis[operation.libraryMode].cancel(operation.id),
    onSuccess: () =>
      client.invalidateQueries({
        predicate: (query) =>
          query.queryKey[0] === 'eagle' &&
          query.queryKey[1] === ownerId &&
          query.queryKey[3] === 'operations',
      }),
  });
  const operations = queries
    .flatMap((query) => query.data ?? [])
    .filter((operation) => scope === 'ALL' || operation.libraryMode === scope);
  const active = operations.filter(
    (operation) => operation.running || operation.queued || operation.failed,
  );
  const history = operations.filter((operation) => !active.includes(operation));
  const titles = (operation: AssetOperationSummary) =>
    operation.kind === 'SEND'
      ? operation.libraryMode === 'PHOTO'
        ? t('发送到素材')
        : t('发送到照片')
      : operation.kind === 'TRASH'
        ? t('移入回收站')
        : operation.kind === 'RESTORE'
          ? t('恢复')
          : t('清空回收站');
  const state = (operation: AssetOperationSummary) =>
    operation.running
      ? operation.kind === 'SEND'
        ? t('发送中…')
        : t('处理中…')
      : operation.queued
        ? t('排队中')
        : operation.failed
          ? operation.completed
            ? t('已部分完成（{{count}}项失败）', { count: operation.failed })
            : t('已停止（{{count}}项失败）', { count: operation.failed })
          : operation.cancelled
            ? t('已停止')
            : t('已完成');
  const errorLabel = (code: string) =>
    code === 'NOT_FOUND'
      ? t('部分内容不存在或不可访问，其余项目继续处理。')
      : code === 'AUTH_REQUIRED'
        ? t('账号状态已改变，请重新登录后重试。')
        : code === 'PRIVATE_LOCKED'
          ? t('请解锁私密内容后重试。')
          : code === 'ASSET_CHANGED'
            ? t('资源已改变，请重新选择。')
            : code === 'ASSET_UNAVAILABLE'
              ? t('资源已移除或不再可访问。')
              : t('操作失败，请重试。');
  function card(operation: AssetOperationSummary) {
    return (
      <article key={operation.id} className={styles.card} data-state={operation.state}>
        <header>
          <div className={styles.identity}>
            <h3>{titles(operation)}</h3>
            <span className={styles.badge}>
              {operation.libraryMode === 'PHOTO' ? t('照片') : t('素材')}
            </span>
          </div>
          <strong className={styles.state}>{state(operation)}</strong>
        </header>
        <div className={styles.cardBody}>
          <div className={styles.progress}>
            {operation.total > 1 && (
              <span>
                {t('已完成 {{value1}} / {{value2}} 项', {
                  value1: operation.completed,
                  value2: operation.total,
                })}
              </span>
            )}
            {!!operation.skipped && (
              <span>{t('已跳过 {{count}} 项已移除的内容', { count: operation.skipped })}</span>
            )}
            {operation.cancelled > 0 && (
              <span className={styles.wait}>
                {t('已取消 {{count}} 项', { count: operation.cancelled })}
              </span>
            )}
          </div>
          <div className={styles.actions}>
            {operation.failed > 0 && (
              <button
                type="button"
                disabled={action.isPending}
                onClick={() => action.mutate({ operation, retry: true })}
              >
                {t('重试失败任务')}
              </button>
            )}
            {operation.queued > 0 && (
              <button
                type="button"
                disabled={action.isPending}
                onClick={() => action.mutate({ operation, retry: false })}
              >
                {t('停止排队')}
              </button>
            )}
          </div>
        </div>
        {operation.errors.length > 0 && (
          <details>
            <summary>{t('查看失败原因')}</summary>
            {operation.errors.map((error) => (
              <p key={error.code}>
                {errorLabel(error.code)} · {error.count}
              </p>
            ))}
          </details>
        )}
      </article>
    );
  }
  if (!operations.length && !queries.some((query) => query.error)) return null;
  return (
    <section className={styles.section} aria-label={t('操作队列')}>
      <header className={styles.sectionHeader}>
        <h2>{t('操作队列')}</h2>
      </header>
      {queries.some((query) => query.error) && <p role="alert">{t('暂时无法读取操作队列。')}</p>}
      {action.error && <p role="alert">{t('操作失败，请重试。')}</p>}
      <div className={styles.groups}>{active.map(card)}</div>
      {history.length > 0 && (
        <details className={styles.operationHistory}>
          <summary>
            {t('操作记录')} · {history.length}
          </summary>
          <div className={styles.groups}>{history.map(card)}</div>
        </details>
      )}
    </section>
  );
}
