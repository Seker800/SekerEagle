import { useState } from 'react';
import { IconLivePhoto, IconPhoto } from '@tabler/icons-react';
import { t } from '../../i18n';
import styles from './EagleLivePhotoPlayback.module.css';

export function EagleLivePhotoPlayback({
  sourceUrl,
  posterUrl,
}: {
  sourceUrl?: string | null;
  posterUrl: string;
}) {
  return sourceUrl ? (
    <Playback key={sourceUrl} sourceUrl={sourceUrl} posterUrl={posterUrl} />
  ) : null;
}
function Playback({ sourceUrl, posterUrl }: { sourceUrl: string; posterUrl: string }) {
  const [playing, setPlaying] = useState(false),
    [failed, setFailed] = useState(false);
  return (
    <div className={styles.root} onClick={(event) => event.stopPropagation()}>
      {playing && (
        <video
          className={styles.video}
          src={sourceUrl}
          poster={posterUrl}
          aria-label={t('播放实况')}
          autoPlay
          playsInline
          muted
          controls
          onEnded={() => setPlaying(false)}
          onError={() => {
            setPlaying(false);
            setFailed(true);
          }}
        />
      )}
      <button
        className={styles.toggle}
        type="button"
        aria-pressed={playing}
        onClick={() => {
          setFailed(false);
          setPlaying((value) => !value);
        }}
      >
        {playing ? <IconPhoto size={16} /> : <IconLivePhoto size={16} />}
        {playing ? t('返回静态照片') : t('播放实况')}
      </button>
      {failed && (
        <small className={styles.error} role="alert">
          {t('实况播放失败，请重试。')}
        </small>
      )}
    </div>
  );
}
