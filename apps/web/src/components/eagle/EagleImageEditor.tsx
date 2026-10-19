import {
  createImageEdit,
  imageEditPixels,
  imageEditSize,
  type ImageEdit,
} from '@sekereagle/library-core';
import { useEffect, useRef, useState, type PointerEvent } from 'react';
import { t } from '../../i18n';
import styles from './EagleImageEditor.module.css';

export interface ImageEditSaveInput {
  operationId: string;
  rowVersion: number;
  edit: ImageEdit;
}
interface EditorAsset {
  id: string;
  displayName: string;
  rowVersion: number;
  width: number | null;
  height: number | null;
}

export function EagleImageEditor({
  asset,
  previewUrl,
  onSave,
  onClose,
  onSaved,
}: {
  asset: EditorAsset;
  previewUrl: string;
  onSave: (input: ImageEditSaveInput) => Promise<{ assetId: string }>;
  onClose: () => void;
  onSaved: (assetId: string) => void;
}) {
  const [history, setHistory] = useState<ImageEdit[]>([createImageEdit()]);
  const [cursor, setCursor] = useState(0);
  const edit = history[cursor];
  const [cropping, setCropping] = useState(false);
  const [compare, setCompare] = useState(false);
  const [discarding, setDiscarding] = useState(false);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [attempt, setAttempt] = useState(0);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const imageRef = useRef<HTMLImageElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const cropRef = useRef<HTMLDivElement>(null);
  const drag = useRef<{ x: number; y: number } | null>(null);
  const [draftCrop, setDraftCrop] = useState<ImageEdit['crop'] | null>(null);
  const saveRef = useRef(false);
  const operationRef = useRef<{ signature: string; id: string } | null>(null);
  const dirty = JSON.stringify(edit) !== JSON.stringify(createImageEdit());
  const outputSize = imageEditSize(edit, asset.width ?? 1, asset.height ?? 1);
  const change = (next: ImageEdit) => {
    if (saving || JSON.stringify(edit) === JSON.stringify(next)) return;
    const nextHistory = [...history.slice(0, cursor + 1), next].slice(-100);
    setHistory(nextHistory);
    setCursor(nextHistory.length - 1);
    setError(null);
  };
  const close = () => {
    if (!saveRef.current) {
      if (dirty) setDiscarding(true);
      else onClose();
    }
  };
  useEffect(() => {
    const previous = document.activeElement;
    dialogRef.current?.focus();
    return () => {
      if (previous instanceof HTMLElement && previous.isConnected) previous.focus();
    };
  }, []);
  useEffect(() => {
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (dirty || saving) {
        event.preventDefault();
        event.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', beforeUnload);
    return () => window.removeEventListener('beforeunload', beforeUnload);
  }, [dirty, saving]);
  useEffect(() => {
    const canvas = canvasRef.current,
      image = imageRef.current;
    if (!canvas || !image || status !== 'ready' || !image.naturalWidth) return;
    try {
      const crop = imageEditPixels(edit, image.naturalWidth, image.naturalHeight);
      const size = imageEditSize(edit, image.naturalWidth, image.naturalHeight);
      canvas.width = size.width;
      canvas.height = size.height;
      const context = canvas.getContext('2d');
      if (!context) throw new Error();
      context.translate(size.width / 2, size.height / 2);
      context.rotate((edit.rotation * Math.PI) / 180);
      context.scale(edit.flipX ? -1 : 1, edit.flipY ? -1 : 1);
      context.filter = `saturate(${edit.saturation}) brightness(${edit.brightness}) contrast(${edit.contrast})`;
      context.drawImage(
        image,
        crop.left,
        crop.top,
        crop.width,
        crop.height,
        -crop.width / 2,
        -crop.height / 2,
        crop.width,
        crop.height,
      );
    } catch {
      setError(t('无法生成编辑预览。'));
      setStatus('error');
    }
  }, [edit, status]);

  const point = (event: PointerEvent<HTMLDivElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    return {
      x: Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width)),
      y: Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height)),
    };
  };
  const cropBetween = (start: { x: number; y: number }, end: { x: number; y: number }) => ({
    x: Math.min(start.x, end.x),
    y: Math.min(start.y, end.y),
    width: Math.abs(end.x - start.x),
    height: Math.abs(end.y - start.y),
  });
  const save = async () => {
    if (saveRef.current || !dirty || status !== 'ready') return;
    saveRef.current = true;
    setSaving(true);
    setError(null);
    const signature = JSON.stringify(edit);
    if (operationRef.current?.signature !== signature)
      operationRef.current = { signature, id: crypto.randomUUID() };
    try {
      const result = await onSave({
        operationId: operationRef.current.id,
        rowVersion: asset.rowVersion,
        edit,
      });
      onSaved(result.assetId);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('保存编辑失败，请重试。'));
    } finally {
      saveRef.current = false;
      setSaving(false);
    }
  };
  const selectedCrop = draftCrop ?? edit.crop;
  return (
    <div
      className={styles.backdrop}
      role="dialog"
      aria-modal="true"
      aria-label={t('图片编辑')}
      tabIndex={-1}
      ref={dialogRef}
      onKeyDown={(event) => {
        event.stopPropagation();
        if (event.key === 'Escape') {
          event.preventDefault();
          close();
        }
        if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
          event.preventDefault();
          void save();
        }
        if (event.key === 'Tab') {
          const items = [
            ...(dialogRef.current?.querySelectorAll<HTMLElement>(
              'button:not(:disabled), input:not(:disabled), select:not(:disabled)',
            ) ?? []),
          ];
          const first = items[0],
            last = items.at(-1);
          if (
            event.shiftKey &&
            (document.activeElement === first || document.activeElement === dialogRef.current)
          ) {
            event.preventDefault();
            last?.focus();
          } else if (
            !event.shiftKey &&
            (document.activeElement === last || document.activeElement === dialogRef.current)
          ) {
            event.preventDefault();
            first?.focus();
          }
        }
      }}
    >
      <header className={styles.header}>
        <div>
          <strong>{t('图片编辑')}</strong>
          <span>{asset.displayName}</span>
        </div>
        <button type="button" disabled={saving} aria-label={t('关闭编辑器')} onClick={close}>
          ×
        </button>
      </header>
      <div className={styles.workspace}>
        <div className={styles.preview}>
          <div className={styles.toolbar}>
            <button
              type="button"
              disabled={saving || cursor === 0}
              onClick={() => {
                setCursor(cursor - 1);
                setError(null);
              }}
            >
              {t('撤销')}
            </button>
            <button
              type="button"
              disabled={saving || cursor === history.length - 1}
              onClick={() => {
                setCursor(cursor + 1);
                setError(null);
              }}
            >
              {t('重做')}
            </button>
            <button
              type="button"
              aria-pressed={compare}
              onClick={() => {
                setCompare(!compare);
                setCropping(false);
              }}
            >
              {t('对比原图')}
            </button>
            <span>
              {outputSize.width} × {outputSize.height}
            </span>
          </div>
          <div className={styles.stage}>
            <div
              className={styles.cropStage}
              ref={cropRef}
              hidden={!cropping && !compare && status !== 'loading'}
              onPointerDown={(event) => {
                if (!cropping || saving || event.button !== 0) return;
                event.preventDefault();
                event.currentTarget.setPointerCapture(event.pointerId);
                drag.current = point(event);
              }}
              onPointerMove={(event) => {
                if (drag.current) setDraftCrop(cropBetween(drag.current, point(event)));
              }}
              onPointerUp={(event) => {
                if (!drag.current) return;
                const crop = cropBetween(drag.current, point(event));
                drag.current = null;
                setDraftCrop(null);
                if (crop.width > 0.005 && crop.height > 0.005) change({ ...edit, crop });
              }}
              onPointerCancel={() => {
                drag.current = null;
                setDraftCrop(null);
              }}
            >
              <img
                key={attempt}
                ref={imageRef}
                src={previewUrl}
                alt={t('编辑预览')}
                draggable={false}
                onLoad={() => setStatus('ready')}
                onError={() => setStatus('error')}
              />
              {cropping && (
                <div
                  className={styles.cropBox}
                  style={{
                    left: `${selectedCrop.x * 100}%`,
                    top: `${selectedCrop.y * 100}%`,
                    width: `${selectedCrop.width * 100}%`,
                    height: `${selectedCrop.height * 100}%`,
                  }}
                />
              )}
            </div>
            <canvas
              ref={canvasRef}
              hidden={cropping || compare || status !== 'ready'}
              aria-label={t('编辑结果预览')}
            />
            {status === 'loading' && <p role="status">{t('正在加载编辑预览…')}</p>}
            {status === 'error' && (
              <div role="alert">
                <p>{t('预览加载失败，请重试。')}</p>
                <button
                  type="button"
                  onClick={() => {
                    setStatus('loading');
                    setAttempt(attempt + 1);
                  }}
                >
                  {t('重试')}
                </button>
              </div>
            )}
          </div>
          <p className={styles.hint}>{t('预览用于调整构图，保存时使用原图分辨率。')}</p>
        </div>
        <aside className={styles.controls}>
          <fieldset disabled={saving || status !== 'ready'}>
            <legend>{t('构图')}</legend>
            <button
              type="button"
              aria-pressed={cropping}
              onClick={() => {
                setCropping(!cropping);
                setCompare(false);
              }}
            >
              {cropping ? t('完成裁剪') : t('裁剪')}
            </button>
            <p>{t('开启裁剪后，在图片上拖出选区，也可输入百分比。')}</p>
            <label>
              {t('裁剪比例')}
              <select
                aria-label={t('裁剪比例')}
                defaultValue=""
                onChange={(event) => {
                  const ratio = Number(event.target.value);
                  if (!ratio) return;
                  const sourceRatio = (asset.width ?? 1) / (asset.height ?? 1);
                  const width = Math.min(1, ratio / sourceRatio),
                    height = Math.min(1, sourceRatio / ratio);
                  change({
                    ...edit,
                    crop: { x: (1 - width) / 2, y: (1 - height) / 2, width, height },
                  });
                  setCropping(true);
                  setCompare(false);
                  event.target.value = '';
                }}
              >
                <option value="">{t('自由裁剪')}</option>
                <option value={(asset.width ?? 1) / (asset.height ?? 1)}>{t('原始比例')}</option>
                <option value="1">1:1</option>
                <option value="1.3333333333">4:3</option>
                <option value="1.5">3:2</option>
                <option value="1.7777777778">16:9</option>
                <option value="0.6666666667">2:3</option>
                <option value="0.5625">9:16</option>
              </select>
            </label>
            <div className={styles.cropInputs}>
              {(['x', 'y', 'width', 'height'] as const).map((key, index) => (
                <label key={key}>
                  {[t('左边距'), t('上边距'), t('裁剪宽度'), t('裁剪高度')][index]} %
                  <input
                    type="number"
                    min={key === 'width' || key === 'height' ? 0.1 : 0}
                    max="100"
                    step="0.1"
                    value={Math.round(edit.crop[key] * 1000) / 10}
                    onChange={(event) => {
                      if (!event.target.value) return;
                      const value = Number(event.target.value) / 100;
                      if (!Number.isFinite(value)) return;
                      const crop = { ...edit.crop };
                      if (key === 'x') crop.x = Math.max(0, Math.min(1 - crop.width, value));
                      if (key === 'y') crop.y = Math.max(0, Math.min(1 - crop.height, value));
                      if (key === 'width')
                        crop.width = Math.max(0.001, Math.min(1 - crop.x, value));
                      if (key === 'height')
                        crop.height = Math.max(0.001, Math.min(1 - crop.y, value));
                      change({ ...edit, crop });
                    }}
                  />
                </label>
              ))}
            </div>
            <div className={styles.transformButtons}>
              <button
                type="button"
                onClick={() =>
                  change({
                    ...edit,
                    rotation: ((edit.rotation + 270) % 360) as ImageEdit['rotation'],
                  })
                }
              >
                {t('向左旋转')}
              </button>
              <button
                type="button"
                onClick={() =>
                  change({
                    ...edit,
                    rotation: ((edit.rotation + 90) % 360) as ImageEdit['rotation'],
                  })
                }
              >
                {t('向右旋转')}
              </button>
              <button
                type="button"
                aria-pressed={edit.flipX}
                onClick={() => change({ ...edit, flipX: !edit.flipX })}
              >
                {t('水平翻转')}
              </button>
              <button
                type="button"
                aria-pressed={edit.flipY}
                onClick={() => change({ ...edit, flipY: !edit.flipY })}
              >
                {t('垂直翻转')}
              </button>
            </div>
          </fieldset>
          <fieldset disabled={saving || status !== 'ready'}>
            <legend>{t('调色')}</legend>
            {(['brightness', 'contrast', 'saturation'] as const).map((key, index) => (
              <label key={key}>
                {[t('亮度'), t('对比度'), t('饱和度')][index]}
                <span className={styles.value}>{Math.round(edit[key] * 100)}%</span>
                <input
                  aria-label={[t('亮度'), t('对比度'), t('饱和度')][index]}
                  type="range"
                  min="0"
                  max="2"
                  step="0.01"
                  value={edit[key]}
                  onChange={(event) => change({ ...edit, [key]: Number(event.target.value) })}
                />
              </label>
            ))}
          </fieldset>
          <button
            type="button"
            disabled={saving || !dirty}
            onClick={() => {
              change(createImageEdit());
              setCropping(false);
              setCompare(false);
            }}
          >
            {t('重置编辑')}
          </button>
        </aside>
      </div>
      <footer className={styles.footer}>
        {error && <p role="alert">{error}</p>}
        {discarding ? (
          <div role="alertdialog" aria-label={t('放弃未保存的修改？')}>
            <span>{t('放弃未保存的修改？')}</span>
            <button type="button" onClick={() => setDiscarding(false)}>
              {t('继续编辑')}
            </button>
            <button type="button" onClick={onClose}>
              {t('放弃修改')}
            </button>
          </div>
        ) : (
          <>
            <span>{t('保存为独立 PNG 副本，原片保留。')}</span>
            <button
              type="button"
              className={styles.save}
              disabled={saving || !dirty || status !== 'ready'}
              onClick={() => void save()}
            >
              {saving ? t('正在保存副本…') : t('保存副本')}
            </button>
          </>
        )}
      </footer>
    </div>
  );
}
