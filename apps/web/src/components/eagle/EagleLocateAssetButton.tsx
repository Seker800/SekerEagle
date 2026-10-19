import { IconTimeline } from '@tabler/icons-react';
import { useRef, useState } from 'react';
import { t } from '../../i18n';
import styles from './EagleLocateAssetButton.module.css';

export function EagleLocateAssetButton({
  assetId,
  onLocate,
}: {
  assetId: string;
  onLocate: (assetId: string) => Promise<void>;
}) {
  return <LocateAction key={assetId} assetId={assetId} onLocate={onLocate} />;
}
function LocateAction({
  assetId,
  onLocate,
}: {
  assetId: string;
  onLocate: (id: string) => Promise<void>;
}) {
  const pending = useRef(false);
  const [status, setStatus] = useState<'idle' | 'pending' | 'error'>('idle');
  async function locate() {
    if (pending.current) return;
    pending.current = true;
    setStatus('pending');
    try {
      await onLocate(assetId);
      setStatus('idle');
    } catch {
      setStatus('error');
    } finally {
      pending.current = false;
    }
  }
  return (
    <div className={styles.root}>
      <button
        type="button"
        aria-label={t('定位到时间线')}
        disabled={status === 'pending'}
        onClick={() => void locate()}
      >
        <IconTimeline size={16} />
        {status === 'pending' ? t('正在定位…') : t('定位到时间线')}
      </button>
      {status === 'error' && <small role="alert">{t('无法定位这张图片，请重试。')}</small>}
    </div>
  );
}
