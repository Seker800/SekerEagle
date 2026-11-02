import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { PhotoEditParts, PhotoEditRecipe } from '@sekereagle/library-core';
import { writePortableLut } from '@sekereagle/photo-render-core/portable-lut';
import { loadPhotoLut } from '../media/photo-editor/photo-lut-storage';
import { useLibraryWorkspace } from '../../lib/library-workspace';
import { t } from '../../i18n';
import type { EagleAssetListItem } from '../../lib/eagle-api';
import type { PhotoEditSession } from './EaglePhotoEditing';
import styles from './EagleBatchPhotoEdit.module.css';

export function EagleBatchPhotoEdit({
  assetIds,
  recipe,
  onClose,
}: {
  assetIds: string[];
  recipe: PhotoEditRecipe;
  resolveSession: (asset: EagleAssetListItem) => Promise<PhotoEditSession>;
  onClose: () => void;
}) {
  const { api } = useLibraryWorkspace();
  const dialog = useRef<HTMLDialogElement>(null);
  const alive = useRef(true);
  const operationIds = useRef(new Map<string, string>());
  const [parts, setParts] = useState<PhotoEditParts>({
    adjustments: true,
    filter: true,
    watermark: true,
    crop: false,
  });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    alive.current = true;
    dialog.current?.showModal();
    return () => {
      alive.current = false;
      dialog.current?.close();
    };
  }, []);
  async function run() {
    if (submitting) return;
    setSubmitting(true);
    setError('');
    try {
      const targets = [...new Set(assetIds)];
      // Ask only for target filters without a durable server source. Legacy
      // browser uploads and draft recipes can refer to this machine's LUT store.
      const preservedLuts: Record<string, string> = {};
      if (!parts.filter) {
        const context = await api.getBatchEaglePhotoEditContext(targets);
        for (const filter of [...new Set(context.preservedFilterIds)].sort()) {
          try {
            preservedLuts[filter] = writePortableLut(await loadPhotoLut(filter.slice(4)));
          } catch {
            throw new Error(t('无法读取目标照片的自定义滤镜，请检查本机滤镜库后重试。'));
          }
        }
      }
      // Transfer each required numeric table once, never render target images here.
      const lut =
        parts.filter && recipe.edits.filter.startsWith('lut:')
          ? writePortableLut(await loadPhotoLut(recipe.edits.filter.slice(4)))
          : undefined;
      const input = {
        assetIds: targets,
        recipe,
        parts,
        ...(lut ? { lut } : {}),
        ...(Object.keys(preservedLuts).length ? { preservedLuts } : {}),
      };
      const key = JSON.stringify(input);
      const operationId = operationIds.current.get(key) ?? crypto.randomUUID();
      operationIds.current.set(key, operationId);
      await api.batchEditEaglePhotos('', { operationId, ...input });
      if (alive.current) onClose();
    } catch (reason) {
      if (alive.current) setError(reason instanceof Error ? reason.message : t('操作失败'));
    } finally {
      if (alive.current) setSubmitting(false);
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
        onClose();
      }}
    >
      <header>
        <h2>{t('批量套用编辑参数')}</h2>
        <button onClick={onClose} aria-label={t('关闭')}>
          ×
        </button>
      </header>
      <p>{t('使用每张照片自己的拍摄信息，保存为独立副本。')}</p>
      <fieldset disabled={submitting}>
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
      <p>{t('提交后将在后台处理，可在任务中心查看进度。')}</p>
      {error && <p role="alert">{error}</p>}
      <footer>
        <button
          disabled={submitting || !assetIds.length || !Object.values(parts).some(Boolean)}
          onClick={() => void run()}
        >
          {submitting ? t('正在处理…') : t('开始套用')}
        </button>
        <button onClick={onClose}>{t('关闭')}</button>
      </footer>
    </dialog>,
    document.body,
  );
}
