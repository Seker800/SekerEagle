import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { BackgroundSchedule, TaskFamily, TaskGroup } from '@sekereagle/library-core';
import { useLibraryWorkspace } from '../../lib/library-workspace';
import { getLocale, t } from '../../i18n';
import { EagleProcessingPage } from './EagleProcessingPage';
import { EagleAiTagSetupPanel } from './EagleAiTagSetupPanel';
import { taskFamilyLabels, taskStepLabel, taskWaitLabel } from './task-center-labels';
import styles from './EagleTaskCenter.module.css';

export function EagleTaskCenter({
  includePrivate = false,
  canManageProcessing = false,
  onReview,
  initialSettings = false,
}: {
  includePrivate?: boolean;
  canManageProcessing?: boolean;
  onReview?: () => void;
  initialSettings?: boolean;
} = {}) {
  const { ownerId, libraryMode, api } = useLibraryWorkspace();
  const client = useQueryClient();
  const key = ['task-center', ownerId, libraryMode, includePrivate];
  const query = useQuery({
    queryKey: key,
    queryFn: ({ signal }) => api.fetchEagleTaskCenter(signal),
    refetchInterval: 10000,
  });
  const [draft, setDraft] = useState<BackgroundSchedule | null>(null);
  const [notice, setNotice] = useState('');
  const [showAi, setShowAi] = useState(initialSettings);
  const [showDetails, setShowDetails] = useState(false);
  useEffect(() => {
    setDraft(null);
    setNotice('');
    setShowAi(initialSettings);
    setShowDetails(false);
  }, [ownerId, libraryMode, includePrivate, initialSettings]);
  const save = useMutation({
    mutationFn: (settings: BackgroundSchedule) => api.updateEagleTaskSchedule(settings),
    onSuccess: async () => {
      setDraft(null);
      setNotice(t('后台安排已保存'));
      await client.invalidateQueries({ queryKey: key });
    },
  });
  const retry = useMutation({
    mutationFn: (family: TaskFamily) => api.retryEagleTaskFamily(family),
    onSuccess: async () => {
      setNotice(t('失败任务已重新排队'));
      await client.invalidateQueries({ queryKey: key });
    },
  });
  const policy = useMutation({
    mutationFn: (input: { family: TaskFamily; paused: boolean; priority: number }) =>
      api.updateEagleTaskPolicy(input),
    onSuccess: async () => {
      setNotice(t('后台安排已保存'));
      await client.invalidateQueries({ queryKey: key });
    },
  });
  const summary = query.data;
  const settings =
    draft ??
    (summary
      ? {
          mode: summary.settings.mode,
          nightStart: summary.settings.nightStart,
          nightEnd: summary.settings.nightEnd,
        }
      : null);
  const error = save.error ?? retry.error ?? policy.error ?? query.error;
  const total = summary?.groups.reduce(
    (sum, group) => ({
      running: sum.running + group.running,
      queued: sum.queued + group.queued,
      failed: sum.failed + group.failed,
      approval: sum.approval + group.approval,
    }),
    { running: 0, queued: 0, failed: 0, approval: 0 },
  );
  return (
    <section className={styles.center} aria-label={t('任务中心')}>
      <header className={styles.header}>
        <div>
          <h1>{t('任务中心')}</h1>
          <p>{t('图库的后台工作，都在这里查看和安排。')}</p>
        </div>
        <button type="button" onClick={() => void query.refetch()} disabled={query.isFetching}>
          {t('刷新')}
        </button>
      </header>
      {error && (
        <div role="alert" className={styles.error}>
          {error.message}
          {!summary && (
            <button type="button" onClick={() => void query.refetch()}>
              {t('重试加载')}
            </button>
          )}
        </div>
      )}
      {notice && <p role="status">{notice}</p>}
      {query.isPending && <p role="status">{t('正在读取后台工作…')}</p>}
      {summary && (
        <>
          <div className={styles.overview}>
            <span>
              {t('剩余 {{count}} 项', {
                count: (total?.queued ?? 0) + (total?.running ?? 0) + (total?.failed ?? 0),
              })}
            </span>
            <span>
              {t('运行中')} <strong>{total?.running}</strong>
            </span>
            <span>
              {t('等待执行')} <strong>{total?.queued}</strong>
            </span>
            <span>
              {t('失败')} <strong>{total?.failed}</strong>
            </span>
            <span>
              {t('等待你审批')} <strong>{total?.approval}</strong>
            </span>
            <span className={styles.worker}>
              {summary.worker === 'ONLINE' ? t('处理服务在线') : t('处理服务离线')}
            </span>
          </div>
          <small>{t('这里统计处理步骤，同一张图片可能包含多个步骤。')}</small>
          {settings && (
            <form
              className={styles.schedule}
              onSubmit={(event) => {
                event.preventDefault();
                setNotice('');
                save.mutate(settings);
              }}
            >
              <label>
                {t('后台运行方式')}
                <select
                  value={settings.mode}
                  onChange={(event) => setDraft({ ...settings, mode: event.target.value })}
                >
                  <option value="ALWAYS">{t('随时处理')}</option>
                  <option value="NIGHT">{t('按时段处理')}</option>
                  <option value="MANUAL">{t('暂停')}</option>
                </select>
              </label>
              {settings.mode === 'NIGHT' && (
                <>
                  <label>
                    {t('开始时间')}
                    <input
                      type="time"
                      required
                      value={settings.nightStart}
                      onChange={(event) =>
                        setDraft({ ...settings, nightStart: event.target.value })
                      }
                    />
                  </label>
                  <label>
                    {t('结束时间')}
                    <input
                      type="time"
                      required
                      value={settings.nightEnd}
                      onChange={(event) => setDraft({ ...settings, nightEnd: event.target.value })}
                    />
                  </label>
                  <span>{t('北京时间')}</span>
                </>
              )}
              <button type="submit" disabled={save.isPending}>
                {save.isPending ? t('保存中…') : t('保存安排')}
              </button>
              <p>
                {t(
                  '暂停后不再领取新的分析任务，当前步骤完成后停下；基础浏览、地图索引和必要清理继续运行。',
                )}
              </p>
            </form>
          )}
          <div className={styles.groups}>
            {summary.groups.length ? (
              summary.groups.map((group) => (
                <TaskCard
                  key={group.id}
                  group={group}
                  busy={retry.isPending || policy.isPending}
                  onRetry={() => retry.mutate(group.id)}
                  onPolicy={(next) => policy.mutate({ family: group.id, ...next })}
                  onReview={onReview}
                />
              ))
            ) : (
              <p>{t('暂时没有后台工作。新任务会自动出现在这里。')}</p>
            )}
          </div>
          <section className={styles.settings}>
            <h2>{t('处理设置与记录')}</h2>
            <button type="button" aria-expanded={showAi} onClick={() => setShowAi(!showAi)}>
              {t('AI 内容识别设置')}
            </button>
            {showAi && <EagleAiTagSetupPanel />}
            {canManageProcessing && (
              <>
                <button
                  type="button"
                  aria-expanded={showDetails}
                  onClick={() => setShowDetails(!showDetails)}
                >
                  {t('查看详细处理记录')}
                </button>
                {showDetails && <EagleProcessingPage canManageProcessing />}
              </>
            )}
          </section>
          <aside className={styles.external}>
            <h2>{t('其他设备与维护')}</h2>
            <p>
              {t(
                '手机传输由手机的传输列表管理。独立封面维护和宿主备份尚未接入此处的实时状态，不计入上方进度。',
              )}
            </p>
          </aside>
        </>
      )}
    </section>
  );
}

function TaskCard({
  group,
  busy,
  onRetry,
  onPolicy,
  onReview,
}: {
  group: TaskGroup;
  busy: boolean;
  onRetry: () => void;
  onPolicy: (next: { paused: boolean; priority: number }) => void;
  onReview?: () => void;
}) {
  const [title, description] = taskFamilyLabels(group.id);
  const remaining = group.queued + group.running + group.failed;
  const retryable = !['CLEANUP', 'APPROVALS', 'UPLOADS', 'IMPORTS', 'PHOTO_MAP'].includes(group.id);
  return (
    <article className={styles.card}>
      <header>
        <h2>{title}</h2>
        <span>
          {group.background
            ? t('按后台安排执行')
            : group.id === 'APPROVALS'
              ? t('人工决定')
              : t('自动维护')}
        </span>
      </header>
      <p>{description}</p>
      <div className={styles.counts}>
        {group.id !== 'APPROVALS' && (
          <strong>
            {remaining > 0 ? t('剩余 {{count}} 项', { count: remaining }) : t('已就绪')}
          </strong>
        )}
        {group.running > 0 && (
          <span>
            {t('运行中')} {group.running}
          </span>
        )}
        {group.queued > 0 && (
          <span>
            {t('等待')} {group.queued}
          </span>
        )}
        {group.failed > 0 && (
          <span className={styles.error}>
            {t('失败')} {group.failed}
          </span>
        )}
        {group.approval > 0 && (
          <span>
            {t('待审批')} {group.approval}
          </span>
        )}
      </div>
      {group.waiting.map((wait) => (
        <p key={`${wait.reason}:${wait.nextAt}`} className={styles.wait}>
          {taskWaitLabel(wait.reason)} · {wait.count}
          {wait.nextAt && (
            <>
              {' '}
              ·{' '}
              {new Date(wait.nextAt).toLocaleString(getLocale(), {
                timeZone: 'Asia/Shanghai',
                month: 'numeric',
                day: 'numeric',
                hour: '2-digit',
                minute: '2-digit',
                hour12: false,
              })}{' '}
              {t('北京时间')}
            </>
          )}
        </p>
      ))}
      {group.failed > 0 && retryable && (
        <button type="button" disabled={busy} onClick={onRetry}>
          {t('重试失败任务')}
        </button>
      )}
      {group.id === 'APPROVALS' && onReview && (
        <button type="button" onClick={onReview}>
          {t('去审批')}
        </button>
      )}
      {group.background && (
        <div className={styles.policy}>
          <button
            type="button"
            disabled={busy}
            onClick={() =>
              onPolicy({ paused: !group.policy?.paused, priority: group.policy?.priority ?? 0 })
            }
          >
            {group.policy?.paused ? t('继续这项工作') : t('暂停这项工作')}
          </button>
          <label>
            {t('处理顺序')}
            <select
              disabled={busy}
              value={group.policy?.priority ?? 0}
              onChange={(event) =>
                onPolicy({
                  paused: group.policy?.paused ?? false,
                  priority: Number(event.target.value),
                })
              }
            >
              <option value={0}>{t('正常')}</option>
              <option value={1}>{t('优先')}</option>
            </select>
          </label>
        </div>
      )}
      <details>
        <summary>{t('查看处理步骤')}</summary>
        <ul>
          {group.steps.map((step) => (
            <li key={step.id}>
              <span>{taskStepLabel(step.id)}</span>
              <span>
                {t('已完成')} {step.completed} · {t('运行中')} {step.running} · {t('等待')}{' '}
                {step.queued} · {t('失败')} {step.failed}
              </span>
            </li>
          ))}
        </ul>
        <small>{t('这里统计处理步骤，同一张图片可能包含多个步骤。')}</small>
      </details>
    </article>
  );
}
