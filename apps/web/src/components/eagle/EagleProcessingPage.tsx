import { getLocale, t } from '../../i18n';
import { useCallback, useEffect, useState, type KeyboardEvent } from 'react';
import {
  fetchEagleProcessingSummary,
  listEagleProcessingJobs,
  reconcileEagleProcessingJobs,
  retryAllFailedEagleProcessingJobs,
  retryEagleProcessingJob,
  updateEagleProcessingSettings,
  type EagleProcessingJob,
  type EagleProcessingLane,
  type EagleProcessingMode,
  type EagleProcessingStatus,
  type EagleProcessingSummary,
} from '../../lib/eagle-processing-admin-api';
import styles from './EagleProcessingPage.module.css';
import { EagleVectorProcessingPanel } from './EagleVectorProcessingPanel';
const LANE_LABELS: Record<EagleProcessingLane, string> = {
  INTERACTIVE: t('上传处理'),
  BACKGROUND: t('后台分析'),
  MAINTENANCE: t('维护清理'),
};
const STATUS_LABELS: Record<EagleProcessingStatus, string> = {
  PENDING: t('等待'),
  PROCESSING: t('运行中'),
  COMPLETED: t('已完成'),
  FAILED: t('失败'),
};
const KIND_LABELS: Record<string, string> = {
  GENERATE_RENDITIONS: t('生成缩略图与预览图'),
  GENERATE_THUMBNAIL: t('生成缩略图'),
  GENERATE_PREVIEW: t('生成预览图'),
  PROBE_MEDIA: t('读取媒体信息'),
  EXTRACT_COLOR_PALETTE: t('提取图片代表色'),
  GENERATE_IMAGE_PYRAMID: t('生成大图缩放切片'),
  GENERATE_EMBEDDING: t('生成图片向量'),
  PURGE_ASSET: t('永久清理素材'),
};
type ProcessingPage = 'QUEUE' | 'HISTORY' | 'BROWSE' | 'COLOR' | 'VECTOR';
const PROCESSING_TABS: ReadonlyArray<{
  id: ProcessingPage;
  label: string;
  description: string;
}> = [
  {
    id: 'QUEUE',
    label: t('当前任务'),
    description: t('队列状态与后台处理时段'),
  },
  {
    id: 'HISTORY',
    label: t('处理记录'),
    description: t('按状态、通道和类型查看任务'),
  },
  {
    id: 'BROWSE',
    label: t('浏览优化'),
    description: t('缩略图、预览与大图切片'),
  },
  {
    id: 'COLOR',
    label: t('颜色筛选'),
    description: t('代表色提取与覆盖率'),
  },
  {
    id: 'VECTOR',
    label: t('图片向量'),
    description: t('模型、覆盖率与运行状态'),
  },
];
export function EagleProcessingPage({
  accessToken: providedAccessToken,
  canManageProcessing = true,
}: {
  accessToken?: string;
  canManageProcessing?: boolean;
} = {}) {
  const accessToken = providedAccessToken ?? '';
  const [summary, setSummary] = useState<EagleProcessingSummary | null>(null);
  const [jobs, setJobs] = useState<EagleProcessingJob[]>([]);
  const [status, setStatus] = useState<EagleProcessingStatus | ''>('');
  const [lane, setLane] = useState<EagleProcessingLane | ''>('');
  const [kind, setKind] = useState('');
  const [mode, setMode] = useState<EagleProcessingMode>('NIGHT');
  const [nightStart, setNightStart] = useState('23:00');
  const [nightEnd, setNightEnd] = useState('06:00');
  const [activePage, setActivePage] = useState<ProcessingPage>('QUEUE');
  const [isLoading, setIsLoading] = useState(true);
  const [isActing, setIsActing] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const reload = useCallback(async () => {
    if (!canManageProcessing) {
      setIsLoading(false);
      return;
    }
    setError('');
    try {
      const [nextSummary, nextJobs] = await Promise.all([
        fetchEagleProcessingSummary(accessToken),
        listEagleProcessingJobs(accessToken, {
          status: status || undefined,
          lane: lane || undefined,
          kind: kind || undefined,
        }),
      ]);
      setSummary(nextSummary);
      setJobs(nextJobs.items);
      setMode(nextSummary.settings.mode);
      setNightStart(nextSummary.settings.nightStart);
      setNightEnd(nextSummary.settings.nightEnd);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('读取素材处理状态失败'));
    } finally {
      setIsLoading(false);
    }
  }, [accessToken, canManageProcessing, kind, lane, status]);
  useEffect(() => {
    setIsLoading(true);
    void reload();
  }, [reload]);
  useEffect(() => {
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') void reload();
    }, 10000);
    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') void reload();
    };
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, [reload]);
  const runAction = async (action: () => Promise<unknown>, success: string) => {
    setIsActing(true);
    setNotice('');
    setError('');
    try {
      await action();
      setNotice(success);
      await reload();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('操作失败'));
    } finally {
      setIsActing(false);
    }
  };
  const handleTabKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    let nextIndex: number | null = null;
    if (event.key === 'ArrowRight') nextIndex = (index + 1) % PROCESSING_TABS.length;
    if (event.key === 'ArrowLeft')
      nextIndex = (index - 1 + PROCESSING_TABS.length) % PROCESSING_TABS.length;
    if (event.key === 'Home') nextIndex = 0;
    if (event.key === 'End') nextIndex = PROCESSING_TABS.length - 1;
    if (nextIndex === null) return;
    event.preventDefault();
    const nextTab = PROCESSING_TABS[nextIndex];
    setActivePage(nextTab.id);
    document.getElementById(`processing-tab-${nextTab.id.toLowerCase()}`)?.focus();
  };
  const coverage = summary?.colorCoverage;
  const colorState =
    mode === 'MANUAL'
      ? t('已暂停')
      : coverage?.failed
        ? t('{{value1}} 项失败', {
            value1: coverage.failed,
          })
        : coverage && coverage.eligible > 0 && coverage.completed < coverage.eligible
          ? t('补算中 {{value1}}%', {
              value1: coverage.percentage,
            })
          : coverage?.eligible === 0
            ? t('等待素材')
            : t('可用于筛选');
  const activeTab = PROCESSING_TABS.find((tab) => tab.id === activePage) ?? PROCESSING_TABS[0];
  if (!canManageProcessing)
    return (
      <section className={styles.section}>
        <header className={styles.header}>
          <div>
            <h1>{t('处理任务')}</h1>
            <p>{t('查看图片向量的自动处理状态；标签业务在左侧“标签”区域完成。')}</p>
          </div>
        </header>
        <EagleVectorProcessingPanel />
      </section>
    );
  if (isLoading && !summary)
    return (
      <section>
        <h3>{t('处理任务')}</h3>
        <p className={styles.muted}>{t('正在读取处理状态…')}</p>
      </section>
    );
  if (error && !summary) {
    return (
      <section>
        <h3>{t('处理任务')}</h3>
        <div className={styles.error} role="alert">
          {error}
        </div>
        <button
          className={styles.secondaryButton}
          type="button"
          onClick={() => {
            setIsLoading(true);
            void reload();
          }}
        >
          {' ' + t('重试加载') + ' '}
        </button>
      </section>
    );
  }
  return (
    <section className={styles.section}>
      <header className={styles.header}>
        <div>
          <h1>{activeTab.label}</h1>
          <p>{activeTab.description}</p>
        </div>
        <div className={styles.workerState} data-online={summary?.worker.status === 'ONLINE'}>
          <span aria-hidden="true" />
          {summary?.worker.status === 'ONLINE' ? t('在线') : t('离线')}
        </div>
      </header>

      {error ? (
        <div className={styles.error} role="alert">
          {error}
        </div>
      ) : null}
      {notice ? (
        <div className={styles.notice} role="status">
          {notice}
        </div>
      ) : null}

      <div className={styles.navigationBar}>
        <nav className={styles.tabs} aria-label={t('素材处理功能')}>
          {PROCESSING_TABS.map((tab, index) => {
            const isActive = activePage === tab.id;
            return (
              <button
                key={tab.id}
                id={`processing-tab-${tab.id.toLowerCase()}`}
                className={isActive ? styles.tabActive : styles.tab}
                type="button"
                aria-current={isActive ? 'page' : undefined}
                aria-controls={`processing-panel-${tab.id.toLowerCase()}`}
                onClick={() => setActivePage(tab.id)}
                onKeyDown={(event) => handleTabKeyDown(event, index)}
              >
                {tab.label}
              </button>
            );
          })}
        </nav>
      </div>

      <div
        id="processing-panel-vector"
        className={styles.tabPanel}
        role="region"
        aria-labelledby="processing-tab-vector"
        tabIndex={0}
        hidden={activePage !== 'VECTOR'}
      >
        <EagleVectorProcessingPanel compact />
      </div>

      <section
        id="processing-panel-browse"
        className={`${styles.contentBlock} ${styles.tabPanel}`}
        role="region"
        aria-labelledby="processing-tab-browse"
        tabIndex={0}
        hidden={activePage !== 'BROWSE'}
      >
        <div className={styles.capabilityGrid}>
          <article
            className={styles.capability}
            data-testid="processing-capability"
            data-state="enabled"
          >
            <span className={styles.capabilityState}>{t('已启用')}</span>
            <h3>{t('缩略图与预览图')}</h3>
            <p>{t('为素材列表和大图浏览生成合适尺寸的图片。')}</p>
            <small>{t('上传后立即执行')}</small>
          </article>
          <article
            className={styles.capability}
            data-testid="processing-capability"
            data-state="ondemand"
          >
            <span className={styles.capabilityState}>{t('按需执行')}</span>
            <h3>{t('媒体信息检测')}</h3>
            <p>{t('读取格式、尺寸、时长等媒体基础信息。')}</p>
            <small>{t('需要时自动排队')}</small>
          </article>
          <article
            className={styles.capability}
            data-testid="processing-capability"
            data-state="ondemand"
          >
            <span className={styles.capabilityState}>{t('大图自动启用')}</span>
            <h3>{t('大图缩放切片')}</h3>
            <p>{t('为超大图片生成分层切片，缩放时只加载当前区域。')}</p>
            <small>{t('符合尺寸阈值时自动执行')}</small>
          </article>
        </div>
      </section>

      <section
        id="processing-panel-color"
        className={`${styles.contentBlock} ${styles.tabPanel}`}
        role="region"
        aria-labelledby="processing-tab-color"
        tabIndex={0}
        hidden={activePage !== 'COLOR'}
      >
        <article
          className={styles.featureStatus}
          data-state={
            coverage?.failed ? 'warning' : coverage?.percentage === 100 ? 'enabled' : 'ondemand'
          }
        >
          <div>
            <span className={styles.capabilityState}>{colorState}</span>
            <h3>{t('图片代表色')}</h3>
            <p>{t('分析会在缩略图就绪后后台执行，不会阻塞素材导入。')}</p>
          </div>
          <div className={styles.coverageMetric}>
            <strong>{coverage?.percentage ?? 0}%</strong>
            <span>
              {coverage
                ? t('{{value1}}/{{value2}} 已覆盖', {
                    value1: coverage.completed,
                    value2: coverage.eligible,
                  })
                : t('正在读取')}
            </span>
            <small>{coverage?.processorVersion ?? t('处理器版本未知')}</small>
          </div>
        </article>
        <p className={styles.featureHint}>
          {t('缺失或失败的分析任务可在“当前任务”中扫描和重试。')}
        </p>
      </section>

      <section
        className={styles.taskCenter}
        aria-label={t('处理任务详情')}
      >
        <section
          id="processing-panel-queue"
          className={`${styles.contentBlock} ${styles.tabPanel}`}
          role="region"
          aria-labelledby="processing-tab-queue"
          tabIndex={0}
          hidden={activePage !== 'QUEUE'}
        >
          <div className={styles.taskCenterHeading}>
            <span className={styles.refreshedAt}>
              {' ' + t('最近刷新') + ' '}
              {summary ? new Date(summary.refreshedAt).toLocaleTimeString(getLocale()) : '—'}
            </span>
          </div>
          <div className={styles.metrics}>
            {(
              [
                ['PROCESSING', t('运行中'), summary?.counts.running ?? 0],
                ['PENDING', t('等待中'), summary?.counts.queued ?? 0],
                ['FAILED', t('失败'), summary?.counts.failed ?? 0],
                ['COMPLETED', t('24 小时完成'), summary?.counts.completedLast24Hours ?? 0],
              ] as const
            ).map(([nextStatus, label, value]) => (
              <button
                key={nextStatus}
                type="button"
                className={status === nextStatus ? styles.metricActive : styles.metric}
                onClick={() => setStatus(status === nextStatus ? '' : nextStatus)}
              >
                <span>{label}</span>
                <strong>{value}</strong>
              </button>
            ))}
          </div>
          <div className={styles.queueGrid}>
            {summary?.queues.map((queue) => (
              <button
                key={queue.lane}
                type="button"
                className={lane === queue.lane ? styles.queueActive : styles.queue}
                onClick={() => setLane(lane === queue.lane ? '' : queue.lane)}
              >
                <strong>{LANE_LABELS[queue.lane]}</strong>
                <span>
                  {' ' + t('等待') + ' '}
                  {queue.queued}
                  {' ' + t('· 运行') + ' '}
                  {queue.running}
                  {' ' + t('· 失败') + ' '}
                  {queue.failed}
                </span>
                <small>
                  {queue.lane === 'BACKGROUND'
                    ? mode === 'MANUAL'
                      ? t('当前暂停')
                      : mode === 'NIGHT'
                        ? `${nightStart}–${nightEnd}`
                        : t('全天执行')
                    : t('始终执行')}
                </small>
              </button>
            ))}
          </div>
          <div className={styles.settings}>
            <div className={styles.scheduleSettings}>
              <label>
                {' ' + t('后台处理') + ' '}
                <select
                  value={mode}
                  disabled={isActing}
                  onChange={(event) => setMode(event.target.value as EagleProcessingMode)}
                >
                  <option value="ALWAYS">{t('全天')}</option>
                  <option value="NIGHT">{t('夜间')}</option>
                  <option value="MANUAL">{t('暂停')}</option>
                </select>
              </label>
              {mode === 'NIGHT' ? (
                <>
                  <label>
                    {' ' + t('开始') + ' '}
                    <input
                      type="time"
                      value={nightStart}
                      onChange={(event) => setNightStart(event.target.value)}
                    />
                  </label>
                  <label>
                    {' ' + t('结束') + ' '}
                    <input
                      type="time"
                      value={nightEnd}
                      onChange={(event) => setNightEnd(event.target.value)}
                    />
                  </label>
                </>
              ) : null}
              <button
                className={styles.primaryButton}
                type="button"
                disabled={isActing}
                onClick={() =>
                  void runAction(
                    () =>
                      updateEagleProcessingSettings(accessToken, { mode, nightStart, nightEnd }),
                    t('处理时段已保存'),
                  )
                }
              >
                {' ' + t('保存设置') + ' '}
              </button>
            </div>
            <div className={styles.queueActions}>
              <button
                className={styles.secondaryButton}
                type="button"
                disabled={isActing}
                onClick={() =>
                  void runAction(
                    () => reconcileEagleProcessingJobs(accessToken),
                    t('缺失任务扫描完成'),
                  )
                }
              >
                {' ' + t('扫描缺失任务') + ' '}
              </button>
              <button
                className={styles.dangerButton}
                type="button"
                disabled={isActing || !summary?.counts.failed}
                onClick={() => {
                  if (window.confirm(t('重新排队全部失败任务？')))
                    void runAction(
                      () => retryAllFailedEagleProcessingJobs(accessToken),
                      t('失败任务已重新排队'),
                    );
                }}
              >
                {' ' + t('重试全部失败') + ' '}
              </button>
            </div>
          </div>
        </section>

        <section
          id="processing-panel-history"
          className={`${styles.contentBlock} ${styles.tabPanel}`}
          role="region"
          aria-labelledby="processing-tab-history"
          tabIndex={0}
          hidden={activePage !== 'HISTORY'}
        >
          <div className={styles.filters}>
            <select
              aria-label={t('任务状态')}
              value={status}
              onChange={(event) => setStatus(event.target.value as EagleProcessingStatus | '')}
            >
              <option value="">{t('全部状态')}</option>
              {Object.entries(STATUS_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
            <select
              aria-label={t('任务通道')}
              value={lane}
              onChange={(event) => setLane(event.target.value as EagleProcessingLane | '')}
            >
              <option value="">{t('全部通道')}</option>
              {Object.entries(LANE_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
            <select
              aria-label={t('任务类型')}
              value={kind}
              onChange={(event) => setKind(event.target.value)}
            >
              <option value="">{t('全部类型')}</option>
              {Object.entries(KIND_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
            <button className={styles.secondaryButton} type="button" onClick={() => void reload()}>
              {' ' + t('立即刷新') + ' '}
            </button>
          </div>
          <div className={styles.tableWrap}>
            <table>
              <thead>
                <tr>
                  <th>{t('状态')}</th>
                  <th>{t('任务')}</th>
                  <th>{t('通道')}</th>
                  <th>{t('素材')}</th>
                  <th>{t('尝试')}</th>
                  <th>{t('入队时间')}</th>
                  <th>{t('耗时')}</th>
                  <th>{t('错误 / 操作')}</th>
                </tr>
              </thead>
              <tbody>
                {jobs.map((job) => (
                  <tr key={job.id}>
                    <td>
                      <span className={styles.statusBadge} data-status={job.status}>
                        {STATUS_LABELS[job.status]}
                      </span>
                    </td>
                    <td>{KIND_LABELS[job.kind] ?? job.kind}</td>
                    <td>{LANE_LABELS[job.lane]}</td>
                    <td title={job.id}>…{job.assetReference}</td>
                    <td>{job.attempts}</td>
                    <td>{new Date(job.createdAt).toLocaleString(getLocale())}</td>
                    <td>
                      {job.durationMs == null
                        ? '—'
                        : t('{{value1}} 秒', {
                            value1: (job.durationMs / 1000).toFixed(1),
                          })}
                    </td>
                    <td>
                      {job.lastError ? (
                        <details>
                          <summary>{job.lastError}</summary>
                          <pre>{job.lastError}</pre>
                        </details>
                      ) : (
                        '—'
                      )}
                      {job.status === 'FAILED' ? (
                        <button
                          className={styles.inlineButton}
                          type="button"
                          disabled={isActing}
                          onClick={() =>
                            void runAction(
                              () => retryEagleProcessingJob(accessToken, job.id),
                              t('任务已重新排队'),
                            )
                          }
                        >
                          {' ' + t('重试') + ' '}
                        </button>
                      ) : null}
                    </td>
                  </tr>
                ))}
                {jobs.length === 0 ? (
                  <tr>
                    <td className={styles.empty} colSpan={8}>
                      {' ' + t('当前筛选条件下没有任务') + ' '}
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </section>
      </section>
    </section>
  );
}
