import { useEffect, useState } from 'react';
import { PhotoEditor } from '../components/media/photo-editor/PhotoEditor';
import { eaglePhotoWatermarkMetadata } from '../components/eagle/EaglePhotoEditing';
import type { EagleAssetListItem } from '../lib/eagle-api';
import type { PhotoEdits } from '@sekereagle/library-core';
import { t } from '../i18n';
type Request = <T>(action: string, payload?: unknown) => Promise<T>;
type Source = { asset: EagleAssetListItem; edits?: PhotoEdits };

/** The native bridge owns transport; this surface owns loading, retry and the shared editor. */
export function NativeEditorApp({ request }: { request: Request }) {
  const [source, setSource] = useState<Source>();
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let active = true;
    setSource(undefined);
    setError('');
    void request<Source>('open').then(
      (value) => {
        if (active) setSource(value);
      },
      (reason: unknown) => {
        if (active)
          setError(reason instanceof Error ? reason.message : t('无法读取原文件，请重试。'));
      },
    );
    return () => {
      active = false;
    };
  }, [request, attempt]);
  if (!source)
    return (
      <main className="loading" role={error ? 'alert' : 'status'}>
        <p>{error || t('正在读取照片…')}</p>
        <div className="loading-actions">
          {error && <button onClick={() => setAttempt((value) => value + 1)}>{t('重试')}</button>}
          <button onClick={() => void request('close')}>{t('关闭')}</button>
        </div>
      </main>
    );
  const { asset, edits } = source;
  return (
    <PhotoEditor
      presentation="native"
      initialTab="watermark"
      source="/source"
      name={asset.displayName || asset.originalName}
      initialMetadata={eaglePhotoWatermarkMetadata(asset)}
      initialEdits={edits}
      onDraftChange={(recipe) => request('draft', { recipe })}
      onClose={() => void request('close')}
      onOpenSaved={async () => {
        await request('showSaved');
      }}
      onSave={async (file, recipe) => {
        await request('begin', { name: file.name, size: file.size, recipe });
        for (let offset = 0; offset < file.size; offset += 48 * 1024) {
          const bytes = new Uint8Array(await file.slice(offset, offset + 48 * 1024).arrayBuffer());
          await request('chunk', { offset, data: btoa(String.fromCharCode(...bytes)) });
        }
        return request<{ id: string; name: string }>('save');
      }}
    />
  );
}
