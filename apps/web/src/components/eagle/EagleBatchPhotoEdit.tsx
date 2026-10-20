import { readPhotoMetadata } from '../media/photo-editor/photo-editor-metadata';
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  DEFAULT_PHOTO_EDITS,
  selectPhotoEditParts,
  type PhotoEditParts,
  type PhotoEditRecipe,
} from '@sekereagle/library-core';
import { useLibraryWorkspace } from '../../lib/library-workspace';
import { t } from '../../i18n';
import type { EagleAssetListItem } from '../../lib/eagle-api';
import type { PhotoEditSession } from './EaglePhotoEditing';
import { createPhotoRenderer } from '../media/photo-editor/photo-editor-render';
import {
  loadEditablePhoto,
  renderEditedPhotoFile,
} from '../media/photo-editor/photo-editor-export';
import styles from './EagleBatchPhotoEdit.module.css';
type Row = {
  id: string;
  name: string;
  status: 'pending' | 'running' | 'success' | 'error';
  error?: string;
};
export function EagleBatchPhotoEdit({
  assetIds,
  recipe,
  resolveSession,
  onClose,
}: {
  assetIds: string[];
  recipe: PhotoEditRecipe;
  resolveSession: (asset: EagleAssetListItem) => Promise<PhotoEditSession>;
  onClose: () => void;
}) {
  const { api } = useLibraryWorkspace();
  const dialog = useRef<HTMLDialogElement>(null);
  const [parts, setParts] = useState<PhotoEditParts>({
    adjustments: true,
    filter: true,
    watermark: true,
    crop: false,
  });
  const [rows, setRows] = useState<Row[]>(() =>
    [...new Set(assetIds)].map((id, index) => ({
      id,
      name: t('照片 {{value1}}', { value1: index + 1 }),
      status: 'pending',
    })),
  );
  const [running, setRunning] = useState(false),
    [started, setStarted] = useState(false);
  const cancelled = useRef(false),
    alive = useRef(true),
    controller = useRef<AbortController | null>(null);
  const retained = useRef(
    new Map<string, { session: PhotoEditSession; file?: File; edits: PhotoEditRecipe }>(),
  );
  useEffect(() => {
    alive.current = true;
    dialog.current?.showModal();
    return () => {
      alive.current = false;
      cancelled.current = true;
      controller.current?.abort();
      dialog.current?.close();
    };
  }, []);
  const update = (id: string, patch: Partial<Row>) => {
    if (alive.current)
      setRows((current) => current.map((row) => (row.id === id ? { ...row, ...patch } : row)));
  };
  async function run() {
    if (running) return;
    cancelled.current = false;
    controller.current = new AbortController();
    setRunning(true);
    setStarted(true);
    let renderer: ReturnType<typeof createPhotoRenderer> | null = null;
    try {
      for (const row of rows.filter((row) => row.status !== 'success')) {
        if (cancelled.current || !alive.current) break;
        update(row.id, { status: 'running', error: undefined });
        try {
          let cached = retained.current.get(row.id);
          if (!cached) {
            const asset = await api.getEagleAsset('', row.id);
            const session = await resolveSession(asset);
            cached = {
              session,
              edits: {
                version: 1,
                edits: selectPhotoEditParts(
                  recipe.edits,
                  session.initialEdits ?? DEFAULT_PHOTO_EDITS,
                  parts,
                ),
              },
            };
            retained.current.set(row.id, cached);
            update(row.id, { name: asset.displayName });
          }
          if (cancelled.current || !alive.current) {
            update(row.id, { status: 'pending' });
            break;
          }
          if (!cached.file) {
            renderer ??= createPhotoRenderer();
            const image = await loadEditablePhoto(cached.session.source, controller.current.signal);
            try {
              cached.file = await renderEditedPhotoFile(
                image,
                cached.edits.edits,
                {
                  ...(await readPhotoMetadata(
                    cached.session.source,
                    controller.current.signal,
                  ).catch(() => ({}))),
                  ...Object.fromEntries(
                    Object.entries(cached.session.initialMetadata).filter(
                      ([, value]) => value !== undefined,
                    ),
                  ),
                },
                renderer,
                cached.session.name,
              );
            } finally {
              image.src = '';
            }
          }
          if (cancelled.current || !alive.current) {
            update(row.id, { status: 'pending' });
            break;
          }
          await cached.session.onSave(cached.file, cached.edits);
          update(row.id, { status: 'success' });
          retained.current.delete(row.id);
        } catch (reason) {
          if (cancelled.current) {
            update(row.id, { status: 'pending' });
            break;
          }
          update(row.id, {
            status: 'error',
            error: reason instanceof Error ? reason.message : t('操作失败'),
          });
          // Keep at most one full-size failed upload for resumable retry.
          if (retained.current.get(row.id)?.file) break;
        }
      }
    } finally {
      renderer?.dispose();
      if (alive.current) setRunning(false);
    }
  }
  const options: Array<[keyof PhotoEditParts, string]> = [
    ['adjustments', t('调整')],
    ['filter', t('滤镜')],
    ['watermark', t('水印')],
    ['crop', t('裁剪与旋转')],
  ];
  return createPortal(
    <dialog
      ref={dialog}
      className={styles.dialog}
      aria-label={t('批量套用编辑参数')}
      onCancel={(event) => {
        event.preventDefault();
        if (running) {
          cancelled.current = true;
          controller.current?.abort();
        } else onClose();
      }}
    >
      <header>
        <h2>{t('批量套用编辑参数')}</h2>
        <button onClick={onClose} disabled={running} aria-label={t('关闭')}>
          ×
        </button>
      </header>
      <p>{t('使用每张照片自己的拍摄信息，保存为独立副本。')}</p>
      <fieldset disabled={started}>
        <legend>{t('套用内容')}</legend>
        {options.map(([key, label]) => (
          <label key={key}>
            <input
              type="checkbox"
              checked={parts[key]}
              onChange={(event) =>
                setParts((current) => ({ ...current, [key]: event.target.checked }))
              }
            />
            {label}
          </label>
        ))}
      </fieldset>
      <p role="status" aria-live="polite">
        {t('已完成 {{value1}} / {{value2}}', {
          value1: rows.filter((row) => row.status === 'success').length,
          value2: rows.length,
        })}
      </p>
      <ol>
        {rows.map((row) => (
          <li key={row.id}>
            <span title={row.name}>{row.name}</span>
            <small>
              {row.status === 'success'
                ? t('已保存')
                : row.status === 'running'
                  ? t('正在处理…')
                  : row.status === 'error'
                    ? row.error
                    : t('等待处理')}
            </small>
          </li>
        ))}
      </ol>
      <footer>
        {running ? (
          <button
            onClick={() => {
              cancelled.current = true;
              controller.current?.abort();
            }}
          >
            {t('停止后续处理')}
          </button>
        ) : (
          <button
            disabled={
              !Object.values(parts).some(Boolean) || rows.every((row) => row.status === 'success')
            }
            onClick={() => void run()}
          >
            {started ? t('继续未完成项') : t('开始套用')}
          </button>
        )}
        <button disabled={running} onClick={onClose}>
          {t('关闭')}
        </button>
      </footer>
    </dialog>,
    document.body,
  );
}
