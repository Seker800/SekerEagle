import { useState, useSyncExternalStore } from 'react';
import { t } from '../../i18n';
import type { OriginalDownloadQueue } from '../../lib/original-download-queue';
import styles from './EagleDownloadQueue.module.css';

export function EagleDownloadQueue({ queue }: { queue: OriginalDownloadQueue }) {
  const { items, running } = useSyncExternalStore(queue.subscribe, queue.getSnapshot);
  const [limit, setLimit] = useState(100);
  if (!items.length) return null;
  const labels = {
    queued: t('等待下载'),
    downloading: t('正在下载'),
    completed: t('下载完成'),
    failed: t('下载失败'),
    cancelled: t('已暂停'),
    browser: t('已交给浏览器'),
  };
  const pending = items.some((item) => ['queued', 'failed', 'cancelled'].includes(item.state));
  return (
    <section className={styles.queue} aria-label={t('下载队列')}>
      <strong>
        {t('下载队列')} ·{' '}
        {items.filter((item) => item.state === 'completed' || item.state === 'browser').length}/
        {items.length}
      </strong>
      {pending && !running && queue.canSaveToDirectory() && (
        <button type="button" onClick={() => void queue.saveToDirectory()}>
          {t('保存到文件夹')}
        </button>
      )}
      {!running && (
        <button type="button" onClick={() => queue.clear()}>
          {t('关闭')}
        </button>
      )}
      <ul>
        {items.slice(0, limit).map((item) => (
          <li key={item.id}>
            <span className={styles.name} title={item.target.originalName}>
              {item.target.originalName}
            </span>
            <span role="status">{labels[item.state]}</span>
            {item.state === 'downloading' && (
              <progress
                value={item.total ? item.received : undefined}
                max={item.total || undefined}
              />
            )}
            {!running &&
              ['queued', 'failed', 'cancelled'].includes(item.state) &&
              !queue.canSaveToDirectory() && (
                <button type="button" onClick={() => void queue.handToBrowser(item.id)}>
                  {t('发起下载')}
                </button>
              )}
          </li>
        ))}
      </ul>
      {limit < items.length && (
        <button type="button" onClick={() => setLimit((value) => value + 100)}>
          {t('加载更多')}
        </button>
      )}
    </section>
  );
}
