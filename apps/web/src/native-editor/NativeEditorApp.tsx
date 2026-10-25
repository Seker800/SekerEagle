import { useEffect, useRef, useState } from 'react';
import { PhotoEditor } from '../components/media/photo-editor/PhotoEditor';
import { eaglePhotoWatermarkMetadata } from '../components/eagle/EaglePhotoEditing';
import type { EagleAssetListItem } from '../lib/eagle-api';
import type { PhotoEdits } from '@sekereagle/library-core';
import { t } from '../i18n';
type Request = <T>(action: string, payload?: unknown) => Promise<T>;
type Source = { asset: EagleAssetListItem; edits?: PhotoEdits };

/** The native bridge owns transport; this surface owns loading, retry and the shared editor. */
export function NativeEditorApp({ request }: { request: Request }) {
  const activeSave = useRef(true);
  useEffect(() => {
    activeSave.current = true;
    return () => {
      activeSave.current = false;
    };
  }, []);
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
      previewSource="/source"
      sourceSize={
        asset.width && asset.height ? { width: asset.width, height: asset.height } : undefined
      }
      name={asset.displayName || asset.originalName}
      initialMetadata={eaglePhotoWatermarkMetadata(asset)}
      initialEdits={edits}
      onDraftChange={(recipe) => request('draft', { recipe })}
      onClose={() => void request('close')}
      onOpenSaved={async () => {
        await request('showSaved');
      }}
      onSaveRecipe={async (recipe, lut) => {
        await request('lutBegin', { size: lut?.length ?? 0 });
        if (lut)
          for (let offset = 0; offset < lut.length; offset += 48 * 1024) {
            await request('lutChunk', { offset, data: lut.slice(offset, offset + 48 * 1024) });
          }
        await request('saveRecipe', { recipe });
        while (activeSave.current) {
          const result = await request<{
            status: string;
            message?: string;
            asset?: { id: string; name: string };
          }>('saveStatus');
          if (result.status === 'COMPLETED' && result.asset) return result.asset;
          if (result.status === 'FAILED')
            throw new Error(result.message || t('照片保存失败，请重试。'));
          await new Promise((resolve) => window.setTimeout(resolve, 1500));
        }
        throw new Error(t('编辑会话已失效，请重新打开。'));
      }}
    />
  );
}
