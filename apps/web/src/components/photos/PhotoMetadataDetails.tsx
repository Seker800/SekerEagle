import { t } from '../../i18n';
import type { PhotoMetadata } from '../../lib/eagle-api';
export function PhotoMetadataDetails({ metadata }: { metadata?: PhotoMetadata | null }) {
  if (!metadata) return <p>{t('摄影信息等待处理，或原文件未包含摄影信息。')}</p>;
  return (
    <section className="photo-metadata">
      <h3>{t('摄影信息')}</h3>
      {metadata.captureMetadataInherited && <p>{t('拍摄信息继承自原片')}</p>}
      <dl>
        <dt>{t('拍摄时间')}</dt>
        <dd>
          {metadata.capturedLocal?.replace('T', ' ') ?? (metadata.captureMetadataInherited ? t('未知拍摄时间，沿用原片时间线') : t('未知拍摄时间，按导入时间排列'))}
          {metadata.capturedAt && !metadata.captureTimeZoneKnown ? ` · ${t('时区未知')}` : ''}
        </dd>
        <dt>{t('相机')}</dt>
        <dd>{[metadata.cameraMake, metadata.cameraModel].filter(Boolean).join(' ') || '—'}</dd>
        <dt>{t('镜头')}</dt>
        <dd>{metadata.lensModel ?? '—'}</dd>
        <dt>{t('摄影参数')}</dt>
        <dd>
          {[
            metadata.focalLength != null ? `${metadata.focalLength} mm` : null,
            metadata.aperture != null ? `f/${metadata.aperture}` : null,
            metadata.exposureSeconds != null ? `${metadata.exposureSeconds} s` : null,
            metadata.iso != null ? `ISO ${metadata.iso}` : null,
          ]
            .filter(Boolean)
            .join(' · ') || '—'}
        </dd>
        <dt>GPS</dt>
        <dd>
          {metadata.latitude != null && metadata.longitude != null
            ? `${metadata.latitude.toFixed(6)}, ${metadata.longitude.toFixed(6)}`
            : '—'}
        </dd>
        <dt>{t('清晰度参考分')}</dt>
        <dd>{metadata.sharpnessScore?.toFixed(1) ?? '—'}</dd>
      </dl>
    </section>
  );
}
