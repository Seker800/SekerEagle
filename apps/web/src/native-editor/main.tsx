import { createRoot } from 'react-dom/client';
import { PhotoEditor } from '../components/media/photo-editor/PhotoEditor';
import { eaglePhotoWatermarkMetadata } from '../components/eagle/EaglePhotoEditing';
import type { EagleAssetListItem } from '../lib/eagle-api';
import type { PhotoEdits } from '@sekereagle/library-core';
import './native-editor.css';
import { t } from '../i18n';

declare global {
  interface Window {
    EditorHost: { request(id: number, action: string, payload: string): void };
    editorReply: (id: number, result: { value?: unknown; error?: string }) => void;
  }
}
let sequence = 0;
const pending = new Map<
  number,
  { resolve: (value: unknown) => void; reject: (reason: Error) => void }
>();
window.editorReply = (id, result) => {
  const entry = pending.get(id);
  pending.delete(id);
  if (result.error) entry?.reject(new Error(result.error));
  else entry?.resolve(result.value);
};
function request<T>(action: string, payload: unknown = {}): Promise<T> {
  return new Promise((resolve, reject) => {
    const id = ++sequence;
    pending.set(id, { resolve: (value) => resolve(value as T), reject });
    window.EditorHost.request(id, action, JSON.stringify(payload));
  });
}
const root = createRoot(document.getElementById('root')!);
root.render(
  <main className="loading" role="status">
    <p>{t('正在读取照片…')}</p>
    <button onClick={() => void request('close')}>{t('关闭')}</button>
  </main>,
);
async function start() {
  const { asset, edits } = await request<{ asset: EagleAssetListItem; edits?: PhotoEdits }>('open');
  root.render(
    <PhotoEditor
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
          const data = btoa(String.fromCharCode(...bytes));
          await request('chunk', { offset, data });
        }
        return request<{ id: string; name: string }>('save');
      }}
    />,
  );
}
void start().catch((error: unknown) => {
  root.render(
    <main role="alert">
      <p>{error instanceof Error ? error.message : t('操作失败')}</p>
      <button onClick={() => void request('close')}>{t('关闭')}</button>
    </main>,
  );
});
