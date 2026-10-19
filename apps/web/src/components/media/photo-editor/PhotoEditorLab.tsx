import { useEffect, useState } from 'react';
import { PhotoEditor } from './PhotoEditor';
import { t } from '../../../i18n';
import sampleImage from './fixtures/fronalpstock.jpg';
import { listLocalPhotos, saveLocalPhoto, type LocalPhoto } from './photo-editor-local-album';
import styles from './PhotoEditorLab.module.css';

function LocalPhotoCard({ photo, onOpen }: { photo: LocalPhoto; onOpen: () => void }) {
  const [url, setUrl] = useState('');
  useEffect(() => {
    const source = URL.createObjectURL(photo.blob);
    setUrl(source);
    return () => URL.revokeObjectURL(source);
  }, [photo.blob]);
  return (
    <button type="button" className={styles.card} onClick={onOpen} disabled={!url}>
      <img src={url || undefined} alt={photo.name} />
      <span>{photo.name}</span>
    </button>
  );
}

/** Development-only workbench. Its test album is explicitly separate from the server library. */
export function PhotoEditorLab() {
  const [photo, setPhoto] = useState<{ source: string; name: string } | null>(null);
  const [photos, setPhotos] = useState<LocalPhoto[]>([]);
  const [error, setError] = useState('');
  useEffect(() => {
    void listLocalPhotos()
      .then(setPhotos)
      .catch(() => setError(t('本地测试相册读取失败。')));
  }, []);
  useEffect(
    () => () => {
      if (photo?.source.startsWith('blob:')) URL.revokeObjectURL(photo.source);
    },
    [photo],
  );
  return photo ? (
    <PhotoEditor
      key={photo.source}
      source={photo.source}
      name={photo.name}
      onClose={() => setPhoto(null)}
      onSave={async (file) => {
        const result = await saveLocalPhoto(file);
        setPhotos(await listLocalPhotos());
        return result;
      }}
    />
  ) : (
    <main className={styles.lab}>
      <header>
        <p className={styles.eyebrow}>SEKEREAGLE · PHOTO STUDIO</p>
        <h1>{t('照片编辑本地测试')}</h1>
        <p>{t('选择本机照片开始编辑，图片仅在浏览器内处理。')}</p>
      </header>
      <div className={styles.actions}>
        <label>
          {t('选择照片')}
          <input
            type="file"
            accept="image/jpeg,image/png,image/webp"
            aria-label={t('选择照片')}
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (!file) return;
              if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
                setError(t('照片读取失败，请选择 JPG、PNG 或 WebP 图片。'));
                return;
              }
              setError('');
              setPhoto({ source: URL.createObjectURL(file), name: file.name });
            }}
          />
        </label>
        <button
          type="button"
          onClick={() => setPhoto({ source: sampleImage, name: 'Fronalpstock.jpg' })}
        >
          {t('使用高清实拍照片')}
        </button>
      </div>
      {error && <p role="alert">{error}</p>}
      <section aria-label={t('本地测试相册')}>
        <h2>{t('本地测试相册')}</h2>
        <p>{t('本页保存到当前浏览器；正式素材库保存到服务器相册。')}</p>
        <div className={styles.album}>
          <button
            type="button"
            className={styles.card}
            onClick={() => setPhoto({ source: sampleImage, name: 'Fronalpstock.jpg' })}
          >
            <img src={sampleImage} alt={t('高清实拍原图')} />
            <span>Fronalpstock · {t('原图')} · 6000 × 2696</span>
          </button>
          {photos.map((entry) => (
            <LocalPhotoCard
              key={entry.id}
              photo={entry}
              onOpen={() => setPhoto({ source: URL.createObjectURL(entry.blob), name: entry.name })}
            />
          ))}
        </div>
      </section>
      <footer>
        Fronalpstock © Hannes Röst ·{' '}
        <a
          href="https://commons.wikimedia.org/wiki/File:Fronalpstock_big.jpg"
          target="_blank"
          rel="noreferrer"
        >
          Wikimedia Commons
        </a>{' '}
        ·{' '}
        <a href="https://creativecommons.org/licenses/by-sa/3.0/" target="_blank" rel="noreferrer">
          CC BY-SA 3.0
        </a>{' '}
        · {t('测试照片仅缩小尺寸')}
      </footer>
    </main>
  );
}
