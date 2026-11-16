import { useState } from 'react';
import { t } from '../../i18n';
import type { EagleUploadItem, EagleUploadSummary } from './useEagleUploadController';
import styles from './EagleUploadQueue.module.css';

export function EagleUploadQueue({
  items,
  summary,
  onPause,
  onResume,
  onRetryAll,
  onRetry,
  onDismiss,
}: {
  items: EagleUploadItem[];
  summary: EagleUploadSummary;
  onPause: () => void;
  onResume: () => void;
  onRetryAll: () => Promise<void>;
  onRetry: (id: number) => Promise<void>;
  onDismiss: () => void;
}) {
  const [collapsed, setCollapsed] = useState(false);
  if (!items.length) return null;
  const active = items.filter((item) => item.state === 'uploading').length;
  const ended = items.some(
    (item) => item.state === 'completed' || item.state === 'duplicate' || item.state === 'failed',
  );
  const pending = summary.waiting > 0;
  const status = summary.paused
    ? t('已暂停')
    : pending
      ? t('正在导入')
      : summary.failed > 0
        ? t('导入结束，有失败项')
        : t('导入完成');
  return (
    <section className={styles.queue} aria-label={t('导入队列')}>
      <header className={styles.header}>
        <div className={styles.title}>
          <strong>{t('导入队列')}</strong>
          <span className={styles.count}>{summary.total}</span>
          <span className={styles.status} role="status">
            {status}
          </span>
        </div>
        <div className={styles.actions}>
          {pending && (
            <button type="button" onClick={summary.paused ? onResume : onPause}>
              {summary.paused ? t('继续全部') : t('暂停全部')}
            </button>
          )}
          <button type="button" onClick={() => void onRetryAll()} disabled={summary.failed === 0}>
            {t('重试全部失败')}
          </button>
          <button type="button" onClick={onDismiss} disabled={!ended}>
            {t('清除已结束')}
          </button>
          <button type="button" onClick={() => setCollapsed((value) => !value)}>
            {collapsed ? t('展开列表') : t('收起列表')}
          </button>
        </div>
      </header>

      <div className={styles.overall}>
        <progress max={100} value={summary.percent} aria-label={t('总进度')} />
        <span className={styles.percent}>{summary.percent}%</span>
        <span className={styles.speed}>
          {summary.bytesPerSecond > 0
            ? `${formatSpeed(summary.bytesPerSecond)}${
                summary.remainingSeconds !== null
                  ? ` · ${formatRemaining(summary.remainingSeconds)}`
                  : ''
              }`
            : pending
              ? active > 0
                ? t('正在计算速度…')
                : t('等待入库校验…')
              : ''}
        </span>
      </div>

      <div className={styles.counts}>
        <span>
          {t('已上传 {{value1}}/{{value2}}', { value1: summary.uploaded, value2: summary.total })}
        </span>
        <span>{t('成功 {{value1}}', { value1: summary.completed })}</span>
        <span>{t('重复跳过 {{value1}}', { value1: summary.duplicate })}</span>
        <span>{t('失败 {{value1}}', { value1: summary.failed })}</span>
        <span>{t('等待 {{value1}}', { value1: summary.waiting })}</span>
      </div>

      {summary.paused && pending && (
        <p className={styles.hint}>
          {t('已暂停，正在上传的 {{value1}} 张会先完成。', { value1: active })}
        </p>
      )}

      {!collapsed && (
        <ul>
          {items.map((item) => (
            <li key={item.id}>
              <span className={styles.name} title={item.name}>
                {item.name}
              </span>
              <span className={styles.size}>{(item.size / 1024 / 1024).toFixed(1)} MB</span>
              <progress max={100} value={item.percent} aria-label={item.name} />
              <span className={item.state === 'failed' ? styles.failedText : styles.stateText}>
                {item.state === 'completed'
                  ? t('导入成功')
                  : item.state === 'duplicate'
                    ? t('重复跳过')
                    : item.state === 'failed'
                      ? t('导入失败')
                      : item.state === 'checking'
                        ? t('查重中')
                        : item.state === 'uploaded'
                          ? t('已上传，入库校验中')
                          : item.state === 'queued'
                            ? t('等待导入')
                            : item.phase === 'validating'
                              ? t('校验中')
                              : `${item.percent}%`}
              </span>
              {item.error && (
                <span className={styles.error} role="alert">
                  {item.error}
                </span>
              )}
              {item.state === 'failed' && (
                <button type="button" onClick={() => void onRetry(item.id)}>
                  {t('重试')}
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function formatSpeed(bytes: number) {
  return bytes >= 1024 * 1024
    ? `${(bytes / 1024 / 1024).toFixed(1)} MB/s`
    : `${Math.max(1, Math.round(bytes / 1024))} KB/s`;
}

function formatRemaining(seconds: number) {
  if (seconds < 60) return t('剩余约 {{value1}} 秒', { value1: seconds });
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return t('剩余约 {{value1}} 分 {{value2}} 秒', { value1: minutes, value2: rest });
}
