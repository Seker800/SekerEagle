import { t } from '../../i18n';
import { useCallback, useEffect, useState } from 'react';
import {
  fetchEagleVectorSummary,
  retryFailedEagleEmbeddings,
  scanMissingEagleEmbeddings,
  type EagleVectorSummary,
} from '../../lib/eagle-vector-api';
import styles from './EagleVectorProcessingPanel.module.css';
export function EagleVectorProcessingPanel() {
  const [summary, setSummary] = useState<EagleVectorSummary | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const reload = useCallback(async () => {
    setError('');
    try {
      setSummary(await fetchEagleVectorSummary());
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('读取图片向量状态失败'));
    }
  }, []);
  useEffect(() => {
    void reload();
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
  const runAction = async <T,>(
    action: () => Promise<T>,
    message: string | ((result: T) => string),
  ) => {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const result = await action();
      setNotice(typeof message === 'function' ? message(result) : message);
      await reload();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('操作失败'));
    } finally {
      setBusy(false);
    }
  };
  const coverage = summary?.embeddingCoverage;
  return (
    <section className={styles.panel} aria-label={t('图片向量处理状态')}>
      <header className={styles.header}>
        <div>
          <span className={styles.eyebrow}>Qwen3-VL-Embedding</span>
          <h2>{t('图片向量')}</h2>
          <p>{t('这里只管理图片向量的生成与运行状态；标签配置、推荐审核和手动分类位于“标签”。')}</p>
        </div>
        <div className={styles.coverage}>
          <strong>{coverage?.percentage ?? 0}%</strong>
          <span>{t('向量覆盖率')}</span>
          <small>
            {coverage?.ready ?? 0}/{coverage?.eligible ?? 0} · {summary?.dimensions ?? 1024}
            {' ' + t('维') + ' '}
          </small>
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

      <div className={styles.metrics}>
        <article>
          <span>{t('任务状态')}</span>
          <strong>
            {' ' + t('等待') + ' '}
            {coverage?.queued ?? 0}
            {' ' + t('· 运行') + ' '}
            {coverage?.running ?? 0}
            {' ' + t('· 未入队')} {coverage?.missing ?? 0}
          </strong>
          <small>
            {coverage?.failed ?? 0}
            {' ' + t('项失败')}
          </small>
        </article>
        <article>
          <span>{t('处理时段')}</span>
          <strong>{formatSchedule(summary)}</strong>
          <small>{t('后台分析不会阻塞素材导入')}</small>
        </article>
        <article>
          <span>{t('Metal 宿主')}</span>
          <strong>{formatHostStatus(summary?.host.status)}</strong>
          <small>{summary?.model ?? t('正在读取模型信息')}</small>
        </article>
      </div>

      <div className={styles.actions}>
        <button
          type="button"
          disabled={busy || (coverage?.missing ?? 0) === 0}
          onClick={() =>
            void runAction(scanMissingEagleEmbeddings, ({ created, repaired }) =>
              created || repaired
                ? t('已排队 {{value1}} 个缺失图片向量', {
                    value1: created + repaired,
                  })
                : t('没有发现可排队的缺失图片向量'),
            )
          }
        >
          {' ' + t('扫描缺失向量') + ' '}
        </button>
        <button
          type="button"
          disabled={busy || (coverage?.failed ?? 0) === 0}
          onClick={() =>
            void runAction(retryFailedEagleEmbeddings, t('失败的图片向量任务已重新排队'))
          }
        >
          {' ' + t('重试失败任务')}
          {coverage?.failed ? ` (${coverage.failed})` : ''}
        </button>
      </div>
      {(coverage?.blocked ?? 0) > 0 ? (
        <p className={styles.hint}>
          {t('有') + ' '}
          {coverage?.blocked}
          {' ' + t('项缺少可用预览，请先修复媒体处理。')}
        </p>
      ) : null}
    </section>
  );
}
function formatSchedule(summary: EagleVectorSummary | null): string {
  if (summary?.processingSchedule.mode === 'ALWAYS') return t('全天执行');
  if (summary?.processingSchedule.mode === 'MANUAL') return t('已暂停');
  return t('夜间 {{value1}}–{{value2}} 执行', {
    value1: summary?.processingSchedule.nightStart ?? '23:00',
    value2: summary?.processingSchedule.nightEnd ?? '06:00',
  });
}
function formatHostStatus(status?: EagleVectorSummary['host']['status']): string {
  if (status === 'ONLINE') return t('在线');
  if (status === 'DRIFTED') return t('合同不一致');
  if (status === 'NOT_CONFIGURED') return t('未配置');
  return t('离线');
}
