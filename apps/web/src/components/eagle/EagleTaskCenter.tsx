import { AssetOperationsPanel } from './AssetOperationsPanel';
import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQueries, useQueryClient } from '@tanstack/react-query';
import {
  taskSection,
  taskExecutionPriority,
  type BackgroundSchedule,
  type TaskFamily,
  type TaskGroup,
  type TaskSection,
  type TaskCenterOverview,
} from '@sekereagle/library-core';
import { createEagleTaskCenterApi } from '../../lib/eagle-task-center-api';
import type { LibraryMode } from '../../lib/library-api-scope';
import { useLibraryWorkspace } from '../../lib/library-workspace';
import { getLocale, t } from '../../i18n';
import { EagleProcessingPage } from './EagleProcessingPage';
import {
  taskExecutionLabel,
  taskStatus,
  taskStatusLabel,
  taskFamilyLabels,
  taskStepLabel,
  taskWaitLabel,
} from './task-center-labels';
import styles from './EagleTaskCenter.module.css';

export function EagleTaskCenter({
  includePrivate = false,
  canManageProcessing = false,
  onReview,
}: {
  includePrivate?: boolean;
  canManageProcessing?: boolean;
  onReview?: () => void;
} = {}) {
  const { ownerId, libraryMode, api } = useLibraryWorkspace();
  const client = useQueryClient();
  const key = ['task-center', ownerId];
  const [scope, setScope] = useState<'ALL' | LibraryMode>('ALL');
  const modes: LibraryMode[] = scope === 'ALL' ? ['MATERIAL', 'PHOTO'] : [scope];
  const otherMode = libraryMode === 'PHOTO' ? 'MATERIAL' : 'PHOTO';
  const otherApi = useMemo(() => createEagleTaskCenterApi(otherMode), [otherMode]);
  const apiFor = (mode: LibraryMode) => (mode === libraryMode ? api : otherApi);
  const queries = useQueries({
    queries: modes.map((mode) => ({
      queryKey: [...key, mode, includePrivate],
      queryFn: ({ signal }: { signal: AbortSignal }) => apiFor(mode).fetchEagleTaskCenter(signal),
      refetchInterval: 10000,
    })),
  });
  const query = {
    isFetching: queries.some((result) => result.isFetching),
    isPending: queries.some((result) => result.isPending),
    error: queries.find((result) => result.error)?.error,
    refetch: () =>
      Promise.all([
        ...queries.map((result) => result.refetch()),
        client.invalidateQueries({
          predicate: (query) =>
            query.queryKey[0] === 'eagle' &&
            query.queryKey[1] === ownerId &&
            query.queryKey[3] === 'operations',
        }),
      ]),
  };
  const entries = queries.flatMap((result, index) =>
    result.data
      ? [
          {
            mode: modes[index],
            summary: result.data,
          },
        ]
      : [],
  );
  const [draft, setDraft] = useState<BackgroundSchedule | null>(null);
  const [notice, setNotice] = useState('');
  const [showDetails, setShowDetails] = useState(false);
  useEffect(() => {
    setDraft(null);
    setNotice('');
    setShowDetails(false);
  }, [ownerId, libraryMode, includePrivate, scope]);
  const save = useMutation({
    mutationFn: async (settings: BackgroundSchedule) => {
      const results = await Promise.allSettled(
        modes.map((mode) => apiFor(mode).updateEagleTaskSchedule(settings)),
      );
      await client.invalidateQueries({ queryKey: key });
      if (results.some((result) => result.status === 'rejected'))
        throw new Error(t('部分安排未保存，请核对各库当前设置后重试。'));
    },
    onSuccess: async () => {
      setDraft(null);
      setNotice(t('后台安排已保存'));
      await client.invalidateQueries({ queryKey: key });
    },
  });
  const retry = useMutation({
    mutationFn: ({ mode, family }: { mode: LibraryMode; family: TaskFamily }) =>
      apiFor(mode).retryEagleTaskFamily(family),
    onSuccess: async () => {
      setNotice(t('失败任务已重新排队'));
      await client.invalidateQueries({ queryKey: key });
    },
  });
  const start = useMutation({
    mutationFn: ({ mode, family }: { mode: LibraryMode; family: TaskFamily }) =>
      apiFor(mode).startEagleTaskFamily(family),
    onSuccess: async (result) => {
      setNotice(t('已加入 {{value1}} 个本地人脸分析任务', { value1: result.queued }));
      await client.invalidateQueries({ queryKey: key });
    },
  });
  const policy = useMutation({
    mutationFn: ({ mode, ...input }: { mode: LibraryMode; family: TaskFamily; paused: boolean }) =>
      apiFor(mode).updateEagleTaskPolicy(input),
    onSuccess: async () => {
      setNotice(t('后台安排已保存'));
      await client.invalidateQueries({ queryKey: key });
    },
  });
  const summary =
    entries.find((entry) => entry.mode === libraryMode)?.summary ?? entries[0]?.summary;
  const cards = entries
    .flatMap(({ mode, summary: entry }) =>
      entry.groups.map((group) => ({
        mode,
        group,
        schedule: entry.settings,
        embedding: entry.embedding,
      })),
    )
    .sort(
      (a, b) =>
        taskExecutionPriority(b.group.id) - taskExecutionPriority(a.group.id) ||
        a.mode.localeCompare(b.mode),
    );
  const sections: Array<{ id: TaskSection; title: string }> = [
    { id: 'IMMEDIATE', title: t('立即处理') },
    { id: 'SCHEDULED', title: t('按时段处理') },
    { id: 'PAUSED', title: t('已暂停') },
  ];
  const differentSchedules =
    entries.length > 1 &&
    entries.some(
      (entry) =>
        JSON.stringify(entry.summary.settings) !== JSON.stringify(entries[0].summary.settings),
    );
  const settings =
    draft ??
    (summary
      ? {
          mode: summary.settings.mode,
          nightStart: summary.settings.nightStart,
          nightEnd: summary.settings.nightEnd,
        }
      : null);
  const error = save.error ?? retry.error ?? policy.error ?? start.error ?? query.error;
  const modelStates = entries.flatMap(({ summary: entry }) => {
    const affected = entry.groups.some(
      (group) =>
        (group.id === 'EMBEDDING' && group.queued + group.running > 0) ||
        (group.id === 'SMART_FOLDERS' &&
          group.steps.some(
            (step) => step.id === 'SMART_FOLDER_QUERY' && step.queued + step.running > 0,
          )),
    );
    if (!affected) return [];
    return [
      entry.embedding ??
        (entry.groups.some((group) => group.waiting.some((wait) => wait.reason === 'MODEL_DRIFTED'))
          ? 'DRIFTED'
          : entry.groups.some((group) =>
                group.waiting.some((wait) => wait.reason === 'MODEL_OFFLINE'),
              )
            ? 'OFFLINE'
            : 'UNKNOWN'),
    ];
  });
  const modelIssue = modelStates.includes('DRIFTED')
    ? 'DRIFTED'
    : modelStates.includes('OFFLINE')
      ? 'OFFLINE'
      : null;
  const total = cards.reduce(
    (sum, { group, schedule }) => {
      const paused = taskSection(group, schedule) === 'PAUSED';
      return {
        running: sum.running + group.running,
        queued: sum.queued + (paused ? 0 : group.queued),
        failed: sum.failed + (paused ? 0 : group.failed),
        approval: sum.approval + group.approval,
        paused: sum.paused + (paused ? group.queued + group.failed : 0),
      };
    },
    { running: 0, queued: 0, failed: 0, approval: 0, paused: 0 },
  );
  return (
    <section className={styles.center} aria-label={t('任务中心')} tabIndex={0}>
      <header className={styles.header}>
        <div>
          <h1>{t('任务中心')}</h1>
        </div>
        <button type="button" onClick={() => void query.refetch()} disabled={query.isFetching}>
          {t('刷新')}
        </button>
      </header>
      <label className={styles.scope}>
        {t('查看范围')}
        <select
          value={scope}
          onChange={(event) => setScope(event.target.value as 'ALL' | LibraryMode)}
        >
          <option value="ALL">{t('全部图库')}</option>
          <option value="MATERIAL">{t('素材')}</option>
          <option value="PHOTO">{t('照片')}</option>
        </select>
      </label>
      {error && (
        <div role="alert" className={styles.error}>
          {error.message}
          {query.error && (
            <button type="button" onClick={() => void query.refetch()}>
              {t('重试加载')}
            </button>
          )}
        </div>
      )}
      {notice && <p role="status">{notice}</p>}
      {modelIssue && (
        <p role="alert" className={styles.error}>
          {modelIssue === 'DRIFTED'
            ? t('Mac 模型配置不匹配，向量任务等待修复；其他处理继续。')
            : t('Mac 模型连接中断，向量任务等待恢复；其他处理继续。')}
        </p>
      )}
      <AssetOperationsPanel includePrivate={includePrivate} scope={scope} />
      {query.isPending && <p role="status">{t('正在读取后台工作…')}</p>}
      {summary && !query.isPending && (
        <>
          <div className={styles.overview}>
            {total.paused > 0 && <span>{t('已暂停 {{count}} 项', { count: total.paused })}</span>}
            <span>
              {t('剩余 {{count}} 项', {
                count: (total?.queued ?? 0) + (total?.running ?? 0) + (total?.failed ?? 0),
              })}
            </span>
            <span>
              {t('运行中')} <strong>{total?.running}</strong>
            </span>
            <span>
              {t('待处理')} <strong>{total?.queued}</strong>
            </span>
            <span>
              {t('失败')} <strong>{total?.failed}</strong>
            </span>
            <span>
              {t('等待你审批')} <strong>{total?.approval}</strong>
            </span>
            <span className={styles.worker}>
              {entries.every((entry) => entry.summary.worker === 'ONLINE')
                ? t('处理服务在线')
                : t('处理服务离线')}
            </span>
          </div>
          <small>{t('这里统计处理步骤，同一张图片可能包含多个步骤。')}</small>
          {query.error && <p>{t('部分图库读取失败，当前合计仅包含已加载的图库。')}</p>}
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
                {scope === 'ALL' ? t('全部图库的后台运行方式') : t('后台运行方式')}
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
              {differentSchedules && (
                <p>
                  {t('素材与照片当前安排不同，卡片显示各自生效的安排；保存后统一应用到两个库。')}
                </p>
              )}
              <p>
                {t(
                  '暂停后不再领取新的分析任务，当前步骤完成后停下；基础浏览、地图索引和必要清理继续运行。',
                )}
              </p>
            </form>
          )}
          {!cards.length && <p>{t('暂时没有后台工作。新任务会自动出现在这里。')}</p>}
          {sections.map((section) => (
            <section key={section.id} className={styles.section} aria-label={section.title}>
              <header className={styles.sectionHeader}>
                <h2>{section.title}</h2>
              </header>
              <div className={styles.groups}>
                {cards
                  .filter((card) => taskSection(card.group, card.schedule) === section.id)
                  .map((card) => (
                    <TaskCard
                      key={`${card.mode}:${card.group.id}`}
                      group={card.group}
                      embedding={card.embedding}
                      schedule={card.schedule}
                      mode={card.mode}
                      busy={retry.isPending || policy.isPending || start.isPending}
                      onStart={() => start.mutate({ mode: card.mode, family: card.group.id })}
                      onRetry={() => retry.mutate({ mode: card.mode, family: card.group.id })}
                      onPolicy={(paused) =>
                        policy.mutate({ mode: card.mode, family: card.group.id, paused })
                      }
                    />
                  ))}
              </div>
              {!cards.some((card) => taskSection(card.group, card.schedule) === section.id) && (
                <p className={styles.empty}>{t('暂无此类工作')}</p>
              )}
            </section>
          ))}
          {cards.some((card) => card.group.id === 'APPROVALS') && (
            <section className={styles.section} aria-label={t('等待你审批')}>
              <h2>{t('等待你审批')}</h2>
              {cards
                .filter((card) => card.group.id === 'APPROVALS')
                .map((card) => (
                  <TaskCard
                    key={`${card.mode}:APPROVALS`}
                    group={card.group}
                    schedule={card.schedule}
                    mode={card.mode}
                    busy={false}
                    onRetry={() => {}}
                    onPolicy={() => {}}
                    onReview={card.mode === libraryMode ? onReview : undefined}
                  />
                ))}
            </section>
          )}
          {canManageProcessing && (
            <section className={styles.settings}>
              <h2>{t('处理记录')}</h2>
              <button
                type="button"
                aria-expanded={showDetails}
                onClick={() => setShowDetails(!showDetails)}
              >
                {t('查看详细处理记录')}
              </button>
              {showDetails && <EagleProcessingPage canManageProcessing />}
            </section>
          )}
          <aside className={styles.external}>
            <h2>{t('其他设备与维护')}</h2>
            <p>
              {t(
                '手机传输由手机的传输列表管理。独立封面维护和宿主备份尚未接入此处的实时状态，不计入上方进度。',
              )}
            </p>
            <p>
              {t('Eagle 批量导入由导入端管理，尚未接入实时状态；历史记录不计入这里的运行任务。')}
            </p>
          </aside>
        </>
      )}
    </section>
  );
}

function TaskCard({
  group,
  embedding,
  schedule,
  mode,
  busy,
  onRetry,
  onStart,
  onPolicy,
  onReview,
}: {
  group: TaskGroup;
  embedding?: TaskCenterOverview['embedding'];
  schedule: BackgroundSchedule;
  mode: LibraryMode;
  busy: boolean;
  onRetry: () => void;
  onStart?: () => void;
  onPolicy: (paused: boolean) => void;
  onReview?: () => void;
}) {
  const [title, , dependency, compute] = taskFamilyLabels(group.id);
  const remaining = group.queued + group.running + group.failed;
  const retryable = !['CLEANUP', 'APPROVALS', 'UPLOADS', 'IMPORTS', 'PHOTO_MAP'].includes(group.id);
  const disabled =
    group.availability === 'DISABLED' ||
    group.waiting.some(
      (wait) => wait.reason === 'DISABLED' && wait.count === group.queued && group.queued > 0,
    );
  const state = taskStatus(group, schedule, embedding);
  const activeSteps = group.steps.filter((step) => step.running > 0);
  const wait = group.waiting.find((item) => !['QUEUED', 'APPROVAL'].includes(item.reason));
  const execution = taskExecutionLabel(group, schedule);
  const isWaiting = (remaining > 0 || (group.unscanned ?? 0) > 0) && group.running === 0;
  const executionAsReason =
    isWaiting &&
    (disabled || group.policy?.paused || (group.background && schedule.mode === 'MANUAL'));
  const scheduledWait = isWaiting && wait?.reason === 'SCHEDULE' && schedule.mode === 'NIGHT';
  let reason: string | null = null;
  if (executionAsReason) {
    reason = execution;
  } else if (isWaiting && wait) {
    reason = taskWaitLabel(wait.reason);
    if (scheduledWait) reason += ` · ${execution}`;
  }
  return (
    <article className={styles.card} data-state={state}>
      <header>
        <div className={styles.identity}>
          <h3>{title}</h3>
          <span className={styles.badge}>{mode === 'PHOTO' ? t('照片') : t('素材')}</span>
        </div>
        {group.id === 'APPROVALS' ? (
          <strong className={styles.state}>
            {t('待审批')} {group.approval}
          </strong>
        ) : (
          <strong className={styles.state}>{taskStatusLabel(group, schedule, embedding)}</strong>
        )}
      </header>
      <div className={styles.cardBody}>
        <div className={styles.progress}>
          {(group.unscanned ?? 0) > 0 && (
            <span>{t('未扫描 {{count}} 张', { count: group.unscanned })}</span>
          )}
          {remaining > 0 &&
            !(state === 'STOPPED' && remaining === group.failed) &&
            group.id !== 'APPROVALS' && <span>{t('剩余 {{count}} 项', { count: remaining })}</span>}
          {group.failed > 0 && state !== 'STOPPED' && (
            <span className={styles.error}>
              {t('失败')} {group.failed}
            </span>
          )}
          {group.running > 0 && group.steps.length > 1 && activeSteps.length > 0 ? (
            <span className={styles.activeStep} aria-label={t('当前执行步骤')}>
              {activeSteps.map((step) => taskStepLabel(step.id)).join(' · ')}
            </span>
          ) : reason ? (
            <span className={styles.wait}>{reason}</span>
          ) : null}
          {group.id === 'APPROVALS' && !onReview && (
            <span className={styles.wait}>{t('请进入对应图库审批。')}</span>
          )}
        </div>
        <div className={styles.actions}>
          {group.id === 'FACES' && (group.unscanned ?? 0) > 0 && (
            <button type="button" disabled={busy || disabled || !onStart} onClick={onStart}>
              {t('扫描未分析照片')}
            </button>
          )}
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
          {group.background &&
            !disabled &&
            schedule.mode !== 'MANUAL' &&
            (remaining > 0 || group.policy?.paused) && (
              <button type="button" disabled={busy} onClick={() => onPolicy(!group.policy?.paused)}>
                {group.policy?.paused ? t('继续这项工作') : t('暂停这项工作')}
              </button>
            )}
        </div>
      </div>
      {group.id !== 'APPROVALS' && (
        <details>
          <summary>{t('查看处理步骤')}</summary>
          <dl className={styles.facts}>
            <div>
              <dt>{t('依赖')}</dt>
              <dd>{dependency}</dd>
            </div>
            <div>
              <dt>{t('运算')}</dt>
              <dd>{compute}</dd>
            </div>
            {!executionAsReason && !scheduledWait && (
              <div>
                <dt>{t('执行')}</dt>
                <dd>{execution}</dd>
              </div>
            )}
          </dl>
          {group.waiting.map((item) => (
            <p key={`${item.reason}:${item.nextAt}`} className={styles.wait}>
              {taskWaitLabel(item.reason)} · {item.count}
              {item.nextAt && (
                <>
                  {' '}
                  ·{' '}
                  {new Date(item.nextAt).toLocaleString(getLocale(), {
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
        </details>
      )}
    </article>
  );
}
