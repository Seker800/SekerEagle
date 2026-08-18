import { useCallback, useEffect, useState } from 'react';
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
import { EagleVectorWorkspace } from './EagleVectorWorkspace';

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
            <p>管理图片向量、人工标签建议与审核。</p>
          </div>
        </header>
        <EagleVectorWorkspace />
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
          <p>先看系统具备哪些能力，再查看当前队列和历史记录。</p>
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

      <EagleVectorWorkspace />

      <section className={styles.contentBlock} aria-labelledby="processing-capabilities-title">
        <div className={styles.sectionHeading}>
          <div>
            <h2 id="processing-capabilities-title">处理能力</h2>
            <p>即使当前没有任务，这些能力也会一直显示。</p>
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
            data-state={
              coverage?.failed ? 'warning' : coverage?.percentage === 100 ? 'enabled' : 'ondemand'
            }
          >
            <span className={styles.capabilityState}>{colorState}</span>
            <h3>图像颜色分析</h3>
            <p>提取图片代表色，支持按视觉相似颜色筛选。</p>
            <small>
              {coverage
                ? `${coverage.completed}/${coverage.eligible} 已覆盖 · ${coverage.processorVersion}`
                : '正在读取覆盖率'}
            </small>
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
            data-state="disabled"
          >
            <span className={styles.capabilityState}>尚未启用</span>
            <h3>AI 自动标签</h3>
            <p>未来用于识别画面内容并生成可搜索标签。</p>
            <small>已预留处理位置</small>
          </article>
          <article
            className={styles.capability}
            data-testid="processing-capability"
            data-state="automatic"
          >
            <span className={styles.capabilityState}>自动执行</span>
            <h3>素材永久清理</h3>
            <p>在清空回收站后安全删除原图和派生文件。</p>
            <small>维护任务</small>
          </article>
        </div>
      </section>

      <section className={styles.contentBlock} aria-labelledby="processing-queue-title">
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

      <section className={styles.contentBlock} aria-labelledby="processing-history-title">
        <div className={styles.sectionHeading}>
          <div>
            <h2 id="processing-history-title">处理记录</h2>
            <p>查看具体任务、耗时和失败原因。</p>
          </div>
          <span className={styles.refreshedAt}>
            最近刷新 {summary ? new Date(summary.refreshedAt).toLocaleTimeString('zh-CN') : '—'}
          </span>
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
  );
}
