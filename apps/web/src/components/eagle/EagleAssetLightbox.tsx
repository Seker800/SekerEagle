import { useEffect, useRef } from 'react';
import { IconX } from '@tabler/icons-react';
import { getEagleAssetContentUrl, type EagleAssetListItem } from '../../lib/eagle-api';
import styles from './EagleAssetLightbox.module.css';

interface EagleAssetLightboxProps {
  asset: EagleAssetListItem;
  onClose: () => void;
}

export function EagleAssetLightbox({ asset, onClose }: EagleAssetLightboxProps) {
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    dialogRef.current?.focus();
  }, []);

  return (
    <div
      ref={dialogRef}
      className={styles.backdrop}
      role="dialog"
      aria-modal="true"
      aria-label="素材大图预览"
      tabIndex={-1}
      onKeyDown={(event) => {
        if (event.key === 'Escape') onClose();
      }}
    >
      <header>
        <div>
          <strong>{asset.displayName}</strong>
          <span>
            {asset.width && asset.height
              ? `${asset.width} × ${asset.height}`
              : asset.format.toUpperCase()}
          </span>
        </div>
        <button type="button" aria-label="关闭大图预览" onClick={onClose}>
          <IconX size={22} />
        </button>
      </header>
      <div className={styles.stage} onClick={onClose}>
        {asset.mimeType.startsWith('video/') ? (
          <video
            src={getEagleAssetContentUrl(asset.id)}
            controls
            autoPlay
            onClick={(event) => event.stopPropagation()}
          />
        ) : (
          <img
            src={getEagleAssetContentUrl(asset.id)}
            alt={asset.displayName}
            onClick={(event) => event.stopPropagation()}
          />
        )}
      </div>
      <footer>Esc 关闭 · 双击素材或按 Enter 进入详情 · Space 快速预览</footer>
    </div>
  );
}
