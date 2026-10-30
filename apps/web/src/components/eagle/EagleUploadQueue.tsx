import { t } from '../../i18n';
import type { EagleUploadItem } from './useEagleUploadController';
import styles from './EagleUploadQueue.module.css';

export function EagleUploadQueue({
  items,
  status,
  onRetry,
  onDismiss,
}: {
  items: EagleUploadItem[];
  status: string | null;
  onRetry: (id: number) => Promise<void>;
  onDismiss: () => void;
}) {
  if (!items.length) return null;
  return (
    <section className={styles.queue} aria-label={t('导入队列')}>
      <header>
        <span role="status">{status}</span>
        <button
          type="button"
          onClick={onDismiss}
          disabled={!items.some((item) => item.state === 'completed' || item.state === 'failed')}
        >
          {t('清除已结束的导入')}
        </button>
      </header>
      <ul>
        {items.map((item) => (
          <li key={item.id}>
            <span className={styles.name}>{item.name}</span>
            <span>{(item.size / 1024 / 1024).toFixed(1)} MB</span>
            <progress max={100} value={item.percent} aria-label={item.name} />
            <span>
              {item.state === 'completed'
                ? t('导入成功')
                : item.state === 'failed'
                  ? t('导入失败')
                  : item.state === 'queued'
                    ? t('等待导入')
                    : `${item.percent}%`}
            </span>
            {item.error && <span role="alert">{item.error}</span>}
            {item.state === 'failed' && (
              <button type="button" onClick={() => void onRetry(item.id)}>
                {t('重试')}
              </button>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
