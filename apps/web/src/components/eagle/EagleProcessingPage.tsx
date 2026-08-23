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
  INTERACTIVE: '上传处理',
  BACKGROUND: '后台分析',
  MAINTENANCE: '维护清理',
};

const STATUS_LABELS: Record<EagleProcessingStatus, string> = {
  PENDING: '等待',
  PROCESSING: '运行中',
  COMPLETED: '已完成',
  FAILED: '失败',
};

const KIND_LABELS: Record<string, string> = {
  GENERATE_RENDITIONS: '生成缩略图与预览图',
  GENERATE_THUMBNAIL: '生成缩略图',
  GENERATE_PREVIEW: '生成预览图',
  PROBE_MEDIA: '读取媒体信息',
  EXTRACT_COLOR_PALETTE: '提取图片代表色',
  GENERATE_IMAGE_PYRAMID: '生成大图缩放切片',
  GENERATE_EMBEDDING: '生成图片向量',
  PURGE_ASSET: '永久清理素材',
};

type ProcessingTab = 'BROWSE' | 'COLOR' | 'VECTOR';
type ProcessingPage = ProcessingTab | 'TASKS';
type TaskCenterTab = 'QUEUE' | 'HISTORY';

const PROCESSING_TABS: ReadonlyArray<{
  id: ProcessingTab;
  label: string;
  description: string;
}> = [
  { id: 'BROWSE', label: '浏览优化', description: '缩略图、预览与大图切片' },
  { id: 'COLOR', label: '颜色筛选', description: '代表色提取与覆盖率' },
  { id: 'VECTOR', label: '图片向量', description: '模型、覆盖率与运行状态' },
];

const TASK_CENTER_TABS: ReadonlyArray<{ id: TaskCenterTab; label: string }> = [
  { id: 'QUEUE', label: '当前任务' },
  { id: 'HISTORY', label: '处理记录' },
];

export function EagleProcessingPage({
  accessToken: providedAccessToken,
  canManageProcessing = true,
}: { accessToken?: string; canManageProcessing?: boolean } = {}) {
  const accessToken = providedAccessToken ?? '';
  const [summary, setSummary] = useState<EagleProcessingSummary | null>(null);
  const [jobs, setJobs] = useState<EagleProcessingJob[]>([]);
  const [status, setStatus] = useState<EagleProcessingStatus | ''>('');
  const [lane, setLane] = useState<EagleProcessingLane | ''>('');
  const [kind, setKind] = useState('');
  const [mode, setMode] = useState<EagleProcessingMode>('NIGHT');
  const [nightStart, setNightStart] = useState('23:00');
  const [nightEnd, setNightEnd] = useState('06:00');
  const [activePage, setActivePage] = useState<ProcessingPage>('BROWSE');
  const [taskCenterTab, setTaskCenterTab] = useState<TaskCenterTab>('QUEUE');
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
      setError(cause instanceof Error ? cause.message : '读取素材处理状态失败');
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
    }, 10_000);
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
      setError(cause instanceof Error ? cause.message : '操作失败');
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

  const handleTaskTabKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    let nextIndex: number | null = null;
    if (event.key === 'ArrowRight') nextIndex = (index + 1) % TASK_CENTER_TABS.length;
    if (event.key === 'ArrowLeft')
      nextIndex = (index - 1 + TASK_CENTER_TABS.length) % TASK_CENTER_TABS.length;
    if (event.key === 'Home') nextIndex = 0;
    if (event.key === 'End') nextIndex = TASK_CENTER_TABS.length - 1;
    if (nextIndex === null) return;

    event.preventDefault();
    const nextTab = TASK_CENTER_TABS[nextIndex];
    setTaskCenterTab(nextTab.id);
    document.getElementById(`task-center-tab-${nextTab.id.toLowerCase()}`)?.focus();
  };

  const coverage = summary?.colorCoverage;
  const colorState =
    mode === 'MANUAL'
      ? '已暂停'
      : coverage?.failed
        ? `${coverage.failed} 项失败`
        : coverage && coverage.eligible > 0 && coverage.completed < coverage.eligible
          ? `补算中 ${coverage.percentage}%`
          : coverage?.eligible === 0
            ? '等待素材'
            : '可用于筛选';

  if (!canManageProcessing)
    return (
      <section className={styles.section}>
        <header className={styles.header}>
          <div>
            <h1>素材处理</h1>
            <p>查看图片向量的自动处理状态；标签业务在左侧“标签”区域完成。</p>
          </div>
        </header>
        <EagleVectorProcessingPanel />
      </section>
    );

  if (isLoading && !summary)
    return (
      <section>
        <h3>素材处理</h3>
        <p className={styles.muted}>正在读取处理状态…</p>
      </section>
    );
  if (error && !summary) {
    return (
      <section>
        <h3>素材处理</h3>
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
          重试加载
        </button>
      </section>
    );
  }

  return (
    <section className={styles.section}>
      <header className={styles.header}>
        <div>
          <h1>素材处理</h1>
          <p>按素材用途查看处理结果，运行与排障集中在任务中心。</p>
        </div>
        <div className={styles.workerState} data-online={summary?.worker.status === 'ONLINE'}>
          <span aria-hidden="true" />
          {summary?.worker.status === 'ONLINE' ? '在线' : '离线'}
          {summary?.worker.version ? <small>{summary.worker.version}</small> : null}
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
        <nav className={styles.tabs} aria-label="素材处理功能">
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
                <strong>{tab.label}</strong>
                <span>{tab.description}</span>
              </button>
            );
          })}
        </nav>
        <button
          className={activePage === 'TASKS' ? styles.taskCenterActive : styles.taskCenterButton}
          type="button"
          aria-pressed={activePage === 'TASKS'}
          aria-controls="processing-panel-tasks"
          onClick={() => setActivePage('TASKS')}
        >
          <span>任务中心</span>
          <small>
            {summary?.counts.failed ? `${summary.counts.failed} 项失败` : '运行、调度与记录'}
          </small>
        </button>
      </div>

      <div
        id="processing-panel-vector"
        className={styles.tabPanel}
        role="region"
        aria-labelledby="processing-tab-vector"
        tabIndex={0}
        hidden={activePage !== 'VECTOR'}
      >
        <EagleVectorProcessingPanel />
      </div>

      <section
        id="processing-panel-browse"
        className={`${styles.contentBlock} ${styles.tabPanel}`}
        role="region"
        aria-labelledby="processing-tab-browse"
        tabIndex={0}
        hidden={activePage !== 'BROWSE'}
      >
        <div className={styles.sectionHeading}>
          <div>
            <h2>浏览优化</h2>
            <p>素材导入后自动准备列表、预览和大图浏览所需的文件。</p>
          </div>
        </div>
        <div className={styles.capabilityGrid}>
          <article
            className={styles.capability}
            data-testid="processing-capability"
            data-state="enabled"
          >
            <span className={styles.capabilityState}>已启用</span>
            <h3>缩略图与预览图</h3>
            <p>为素材列表和大图浏览生成合适尺寸的图片。</p>
            <small>上传后立即执行</small>
          </article>
          <article
            className={styles.capability}
            data-testid="processing-capability"
            data-state="ondemand"
          >
            <span className={styles.capabilityState}>按需执行</span>
            <h3>媒体信息检测</h3>
            <p>读取格式、尺寸、时长等媒体基础信息。</p>
            <small>需要时自动排队</small>
          </article>
          <article
            className={styles.capability}
            data-testid="processing-capability"
            data-state="ondemand"
          >
            <span className={styles.capabilityState}>大图自动启用</span>
            <h3>大图缩放切片</h3>
            <p>为超大图片生成分层切片，缩放时只加载当前区域。</p>
            <small>符合尺寸阈值时自动执行</small>
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
        <div className={styles.sectionHeading}>
          <div>
            <h2>颜色筛选</h2>
            <p>从图片中提取代表色，用于图库的视觉相似颜色筛选。</p>
          </div>
        </div>
        <article
          className={styles.featureStatus}
          data-state={
            coverage?.failed ? 'warning' : coverage?.percentage === 100 ? 'enabled' : 'ondemand'
          }
        >
          <div>
            <span className={styles.capabilityState}>{colorState}</span>
            <h3>图片代表色</h3>
            <p>分析会在缩略图就绪后后台执行，不会阻塞素材导入。</p>
          </div>
          <div className={styles.coverageMetric}>
            <strong>{coverage?.percentage ?? 0}%</strong>
            <span>
              {coverage ? `${coverage.completed}/${coverage.eligible} 已覆盖` : '正在读取'}
            </span>
            <small>{coverage?.processorVersion ?? '处理器版本未知'}</small>
          </div>
        </article>
        <p className={styles.featureHint}>缺失或失败的分析任务可在“任务中心”中扫描和重试。</p>
      </section>

      <section
        id="processing-panel-tasks"
        className={`${styles.taskCenter} ${styles.tabPanel}`}
        aria-label="任务中心"
        hidden={activePage !== 'TASKS'}
      >
        <div className={styles.taskCenterHeading}>
          <div>
            <h2>任务中心</h2>
            <p>集中查看运行状态、处理时段和历史记录。</p>
          </div>
          <span className={styles.refreshedAt}>
            最近刷新 {summary ? new Date(summary.refreshedAt).toLocaleTimeString('zh-CN') : '—'}
          </span>
        </div>
        <nav className={styles.taskTabs} role="tablist" aria-label="任务中心视图">
          {TASK_CENTER_TABS.map((tab, index) => {
            const isActive = taskCenterTab === tab.id;
            return (
              <button
                key={tab.id}
                id={`task-center-tab-${tab.id.toLowerCase()}`}
                type="button"
                role="tab"
                aria-selected={isActive}
                aria-controls={`task-center-panel-${tab.id.toLowerCase()}`}
                tabIndex={isActive ? 0 : -1}
                data-active={isActive}
                onClick={() => setTaskCenterTab(tab.id)}
                onKeyDown={(event) => handleTaskTabKeyDown(event, index)}
              >
                {tab.label}
              </button>
            );
          })}
        </nav>

        <section
          id="task-center-panel-queue"
          className={styles.contentBlock}
          role="tabpanel"
          aria-labelledby="task-center-tab-queue"
          hidden={taskCenterTab !== 'QUEUE'}
        >
          <div className={styles.sectionHeading}>
            <div>
              <h2 id="processing-queue-title">当前队列</h2>
              <p>这里显示此刻等待、运行和失败的任务。</p>
            </div>
          </div>
          <div className={styles.metrics}>
            {(
              [
                ['PROCESSING', '运行中', summary?.counts.running ?? 0],
                ['PENDING', '等待中', summary?.counts.queued ?? 0],
                ['FAILED', '失败', summary?.counts.failed ?? 0],
                ['COMPLETED', '24 小时完成', summary?.counts.completedLast24Hours ?? 0],
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
                  等待 {queue.queued} · 运行 {queue.running} · 失败 {queue.failed}
                </span>
                <small>
                  {queue.lane === 'BACKGROUND'
                    ? mode === 'MANUAL'
                      ? '当前暂停'
                      : mode === 'NIGHT'
                        ? `${nightStart}–${nightEnd}`
                        : '全天执行'
                    : '始终执行'}
                </small>
              </button>
            ))}
          </div>
          <div className={styles.settings}>
            <label>
              后台处理
              <select
                value={mode}
                disabled={isActing}
                onChange={(event) => setMode(event.target.value as EagleProcessingMode)}
              >
                <option value="ALWAYS">全天</option>
                <option value="NIGHT">夜间</option>
                <option value="MANUAL">暂停</option>
              </select>
            </label>
            {mode === 'NIGHT' ? (
              <>
                <label>
                  开始
                  <input
                    type="time"
                    value={nightStart}
                    onChange={(event) => setNightStart(event.target.value)}
                  />
                </label>
                <label>
                  结束
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
                  () => updateEagleProcessingSettings(accessToken, { mode, nightStart, nightEnd }),
                  '处理时段已保存',
                )
              }
            >
              保存设置
            </button>
            <button
              className={styles.secondaryButton}
              type="button"
              disabled={isActing}
              onClick={() =>
                void runAction(() => reconcileEagleProcessingJobs(accessToken), '缺失任务扫描完成')
              }
            >
              扫描缺失任务
            </button>
            <button
              className={styles.dangerButton}
              type="button"
              disabled={isActing || !summary?.counts.failed}
              onClick={() => {
                if (window.confirm('重新排队全部失败任务？'))
                  void runAction(
                    () => retryAllFailedEagleProcessingJobs(accessToken),
                    '失败任务已重新排队',
                  );
              }}
            >
              重试全部失败
            </button>
          </div>
        </section>

        <section
          id="task-center-panel-history"
          className={styles.contentBlock}
          role="tabpanel"
          aria-labelledby="task-center-tab-history"
          hidden={taskCenterTab !== 'HISTORY'}
        >
          <div className={styles.sectionHeading}>
            <div>
              <h2 id="processing-history-title">处理记录</h2>
              <p>查看具体任务、耗时和失败原因。</p>
            </div>
          </div>
          <div className={styles.filters}>
            <select
              aria-label="任务状态"
              value={status}
              onChange={(event) => setStatus(event.target.value as EagleProcessingStatus | '')}
            >
              <option value="">全部状态</option>
              {Object.entries(STATUS_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
            <select
              aria-label="任务通道"
              value={lane}
              onChange={(event) => setLane(event.target.value as EagleProcessingLane | '')}
            >
              <option value="">全部通道</option>
              {Object.entries(LANE_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
            <select
              aria-label="任务类型"
              value={kind}
              onChange={(event) => setKind(event.target.value)}
            >
              <option value="">全部类型</option>
              {Object.entries(KIND_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
            <button className={styles.secondaryButton} type="button" onClick={() => void reload()}>
              立即刷新
            </button>
          </div>
          <div className={styles.tableWrap}>
            <table>
              <thead>
                <tr>
                  <th>状态</th>
                  <th>任务</th>
                  <th>通道</th>
                  <th>素材</th>
                  <th>尝试</th>
                  <th>入队时间</th>
                  <th>耗时</th>
                  <th>错误 / 操作</th>
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
                    <td>{new Date(job.createdAt).toLocaleString('zh-CN')}</td>
                    <td>
                      {job.durationMs == null ? '—' : `${(job.durationMs / 1000).toFixed(1)} 秒`}
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
                              '任务已重新排队',
                            )
                          }
                        >
                          重试
                        </button>
                      ) : null}
                    </td>
                  </tr>
                ))}
                {jobs.length === 0 ? (
                  <tr>
                    <td className={styles.empty} colSpan={8}>
                      当前筛选条件下没有任务
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
