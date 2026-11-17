import { IconCopy } from '@tabler/icons-react';
import { useEffect, useRef, useState } from 'react';
import { t } from '../../i18n';
import type { EagleAssetListItem } from '../../lib/eagle-api';
import { getEagleShareImageUrl } from '../../lib/eagle-api';
import { copyImageToClipboard, copyShareImageToClipboard } from '../../lib/image-clipboard';
import styles from './EagleImageCopyButton.module.css';

export function EagleImageCopyButton({
  asset,
  sourceUrl,
}: {
  asset?: EagleAssetListItem;
  sourceUrl: string;
}) {
  // Each image owns its feedback; a previous photo's pending copy cannot update the next photo.
  const key = asset ? `${asset.libraryMode ?? ''}:${asset.id}` : sourceUrl;
  return <ImageCopyAction key={key} asset={asset} sourceUrl={sourceUrl} />;
}

function ImageCopyAction({ asset, sourceUrl }: { asset?: EagleAssetListItem; sourceUrl: string }) {
  const [status, setStatus] = useState<'idle' | 'pending' | 'copied' | 'error'>('idle');
  const [error, setError] = useState('');
  const active = useRef(true);
  const pending = useRef(false);
  const share = Boolean(asset?.mimeType.startsWith('image/'));
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
    setError('');
    try {
      if (asset && share) {
        await copyShareImageToClipboard(getEagleShareImageUrl(asset.id, asset.libraryMode));
      } else {
        await copyImageToClipboard(sourceUrl);
      }
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
  const pendingLabel = share ? t('正在准备 4K…') : t('正在复制…');
  const copiedLabel = share ? t('已复制 4K') : t('已复制');
  return (
    <div className={styles.root}>
      <button
        className={styles.button}
        type="button"
        aria-label={t('复制图片')}
        disabled={status === 'pending'}
        data-pending={status === 'pending' || undefined}
        onClick={() => void copy()}
      >
        <IconCopy size={16} />
        <span data-viewer-secondary-label>
          {status === 'pending' ? pendingLabel : t('复制图片')}
        </span>
        {status === 'pending' && <span className={styles.pendingTrack} aria-hidden="true" />}
      </button>
      {status === 'copied' && <small role="status">{copiedLabel}</small>}
      {status === 'error' && <small role="alert">{error}</small>}
    </div>
  );
}
