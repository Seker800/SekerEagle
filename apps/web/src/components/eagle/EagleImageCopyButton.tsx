import { IconCopy } from '@tabler/icons-react';
import { useEffect, useRef, useState } from 'react';
import { t } from '../../i18n';
import { copyImageToClipboard } from '../../lib/image-clipboard';
import styles from './EagleImageCopyButton.module.css';

export function EagleImageCopyButton({ sourceUrl }: { sourceUrl: string }) {
  // Each image owns its feedback; a previous photo's pending copy cannot update the next photo.
  return <ImageCopyAction key={sourceUrl} sourceUrl={sourceUrl} />;
}

function ImageCopyAction({ sourceUrl }: { sourceUrl: string }) {
  const [status, setStatus] = useState<'idle' | 'pending' | 'copied' | 'error'>('idle');
  const [error, setError] = useState('');
  const active = useRef(true);
  const pending = useRef(false);
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
    };
  }, []);
  const copy = async () => {
    if (pending.current) return;
    pending.current = true;
    setStatus('pending');
    try {
      // Call within the click gesture so the browser can authorize clipboard.write.
      await copyImageToClipboard(sourceUrl);
      if (active.current) setStatus('copied');
    } catch (cause) {
      if (active.current) {
        setError(
          t('复制图片失败{{value1}}', {
            value1: cause instanceof Error ? `：${cause.message}` : '',
          }),
        );
        setStatus('error');
      }
    } finally {
      pending.current = false;
    }
  };
  return (
    <div className={styles.root}>
      <button
        className={styles.button}
        type="button"
        aria-label={t('复制图片')}
        disabled={status === 'pending'}
        onClick={() => void copy()}
      >
        <IconCopy size={16} />
        {status === 'pending' ? t('正在复制…') : t('复制图片')}
      </button>
      {status === 'copied' && <small role="status">{t('已复制')}</small>}
      {status === 'error' && <small role="alert">{error}</small>}
    </div>
  );
}
