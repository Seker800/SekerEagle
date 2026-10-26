import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { TaskFamily, TaskTransitionEvent } from '@sekereagle/library-core';
import { t, getLocale } from '../../i18n';
import { createEagleTaskCenterApi } from '../../lib/eagle-task-center-api';
import { useLibraryWorkspace } from '../../lib/library-workspace';
import type { LibraryMode } from '../../lib/library-api-scope';
import { taskStepLabel } from './task-center-labels';
import styles from './TaskTransitionHistory.module.css';
function transitionLabel(event: TaskTransitionEvent) {
  if (event.toStatus === 'PROCESSING')
    return event.fromStatus === 'PROCESSING' ? t('中断后恢复') : t('开始处理');
  if (event.toStatus === 'FAILED') return t('失败');
  if (event.toStatus === 'COMPLETED') return t('已完成');
  return t('排队ing');
}
export function TaskTransitionHistory({
  mode,
  family,
  includePrivate,
}: {
  mode: LibraryMode;
  family: TaskFamily;
  includePrivate: boolean;
}) {
  const { ownerId } = useLibraryWorkspace();
  const [open, setOpen] = useState(false);
  const api = useMemo(() => createEagleTaskCenterApi(mode), [mode]);
  const query = useQuery({
    queryKey: ['task-center', ownerId, mode, includePrivate, 'events', family],
    queryFn: ({ signal }) => api.fetchEagleTaskEvents(family, signal),
    enabled: open,
  });
  return (
    <details className={styles.history} onToggle={(event) => setOpen(event.currentTarget.open)}>
      <summary>{t('最近状态变化')}</summary>
      {query.isPending ? (
        <p>{t('正在读取后台工作…')}</p>
      ) : query.error ? (
        <button type="button" onClick={() => void query.refetch()}>
          {t('重试加载')}
        </button>
      ) : !query.data?.length ? (
        <p>{t('暂无转换记录')}</p>
      ) : (
        <ol>
          {query.data.map((event) => (
            <li key={event.id}>
              <time dateTime={event.occurredAt}>
                {new Date(event.occurredAt).toLocaleTimeString(getLocale(), {
                  hour: '2-digit',
                  minute: '2-digit',
                  second: '2-digit',
                })}
              </time>
              <span>
                {taskStepLabel(event.step)} · {transitionLabel(event)}
              </span>
            </li>
          ))}
        </ol>
      )}
    </details>
  );
}
