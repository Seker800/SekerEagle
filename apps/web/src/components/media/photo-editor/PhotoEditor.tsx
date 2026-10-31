import { writePortableLut } from '@sekereagle/photo-render-core/portable-lut';
import { loadPhotoLut } from './photo-lut-storage';
import { useCompactLayout } from '../../../hooks/useCompactLayout';
import { loadEditablePhoto, renderEditedPhotoFile } from './photo-editor-export';
import type { PhotoEditRecipe } from '@sekereagle/library-core';
import { ApiError } from '../../../lib/api-error';
import { withinPhotoOutputBudget } from './photo-editor-limits';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  IconAdjustments,
  IconArrowBackUp,
  IconArrowForwardUp,
  IconCrop,
  IconDeviceFloppy,
  IconPhoto,
  IconX,
  IconFrame,
} from '@tabler/icons-react';
import { t } from '../../../i18n';
import {
  DEFAULT_PHOTO_EDITS,
  hasPhotoEdits,
  photoCrop,
  type PhotoEdits,
} from './photo-editor-model';
import {
  createPhotoRenderer,
  composePhoto,
  MAX_PHOTO_PIXELS,
  sourceCanvas,
} from './photo-editor-render';
import styles from './PhotoEditor.module.css';
import { type SavedPhoto } from './photo-editor-save';
import { PhotoAdjustmentControl } from './PhotoAdjustmentControl';
import { PhotoAdjustmentsPanel } from './PhotoAdjustmentsPanel';
import {
  PHOTO_ADJUSTMENTS,
  resetPhotoAdjustments,
  type ActiveAdjustmentKey,
} from './photo-adjustment-catalog';
import { PhotoWatermarkPanel } from './PhotoWatermarkPanel';
import { PhotoCropViewport } from './PhotoCropViewport';
import { PhotoToolPanel } from './PhotoToolPanel';
import { PhotoCropPanel } from './PhotoCropPanel';
import { PhotoFilterOptions } from './PhotoFilterOptions';
import { readPhotoMetadata } from './photo-editor-metadata';
import { findWatermark, photoWatermarkLayout, type PhotoMetadata } from './photo-watermark-model';

type Tab = 'adjust' | 'filters' | 'crop' | 'watermark';
type History = { past: PhotoEdits[]; current: PhotoEdits; future: PhotoEdits[] };

export function PhotoEditor({
  initialTab = 'adjust',
  presentation = 'web',
  source,
  previewSource,
  sourceSize,
  name,
  onClose,
  onSave,
  onSaveRecipe,
  saveUnavailable,
  initialMetadata,
  initialEdits,
  onDraftChange,
  onCopyEdits,
  onOpenSaved,
}: {
  initialTab?: Tab;
  presentation?: 'web' | 'native';
  saveUnavailable?: string;
  source: string;
  previewSource?: string;
  sourceSize?: { width: number; height: number };
  name: string;
  initialMetadata?: PhotoMetadata;
  initialEdits?: PhotoEdits;
  onDraftChange?: (recipe: PhotoEditRecipe) => Promise<unknown>;
  onCopyEdits?: (recipe: PhotoEditRecipe) => void;
  onOpenSaved?: (assetId: string) => Promise<void>;
  onClose: () => void;
  onSaveRecipe?: (recipe: PhotoEditRecipe, lut?: string) => Promise<SavedPhoto>;
  onSave?: (file: File, recipe?: PhotoEditRecipe) => Promise<SavedPhoto>;
}) {
  const compactLayout = useCompactLayout();
  const compact = presentation === 'native' || compactLayout;
  const [history, setHistory] = useState<History>({
    past: [],
    current: { ...DEFAULT_PHOTO_EDITS, ...initialEdits },
    future: [],
  });
  const edits = useMemo(() => ({ ...DEFAULT_PHOTO_EDITS, ...history.current }), [history.current]);
  const [copied, setCopied] = useState(false);
  const [draftStatus, setDraftStatus] = useState('');
  const draftQueue = useRef(Promise.resolve());
  const pendingDraftWrites = useRef(0);
  const persistedDraftKey = useRef(JSON.stringify(edits));
  const currentDraftKey = useRef(JSON.stringify(edits));
  currentDraftKey.current = JSON.stringify(edits);
  const latestDraft = useRef(onDraftChange);
  latestDraft.current = onDraftChange;
  useEffect(() => {
    if (!onDraftChange) return;
    const key = JSON.stringify(edits);
    if (key === persistedDraftKey.current && pendingDraftWrites.current === 0) {
      setDraftStatus('');
      return;
    }
    setDraftStatus(presentation === 'native' ? t('正在保存参数…') : t('正在自动保存…'));
    const timer = setTimeout(() => {
      pendingDraftWrites.current++;
      setDraftStatus(presentation === 'native' ? t('正在保存参数…') : t('正在自动保存…'));
      draftQueue.current = draftQueue.current
        .catch(() => undefined)
        .then(() => latestDraft.current?.({ version: 1, edits }))
        .then(
          () => {
            pendingDraftWrites.current--;
            persistedDraftKey.current = key;
            if (currentDraftKey.current === key)
              setDraftStatus(presentation === 'native' ? t('参数已保存') : t('已自动保存'));
          },
          () => {
            pendingDraftWrites.current--;
            if (currentDraftKey.current === key) setDraftStatus(t('草稿保存失败，请重试。'));
          },
        );
    }, 500);
    return () => clearTimeout(timer);
  }, [edits, onDraftChange, presentation]);
  const [tab, setTab] = useState<Tab>(initialTab);
  const [loaded, setLoaded] = useState<HTMLImageElement | null>(null);
  const imageWidth = sourceSize?.width ?? loaded?.naturalWidth ?? 1;
  const imageHeight = sourceSize?.height ?? loaded?.naturalHeight ?? 1;
  const exportController = useRef<AbortController | null>(null);
  useEffect(() => () => exportController.current?.abort(), []);
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [error, setError] = useState('');
  const [sourceConflict, setSourceConflict] = useState(false);
  const [busy, setBusy] = useState(false);
  const [rendering, setRendering] = useState(false);
  const [saved, setSaved] = useState(false);
  const [savedName, setSavedName] = useState('');
  const [savedId, setSavedId] = useState('');
  const [renderedKey, setRenderedKey] = useState('');
  const [compare, setCompare] = useState(false);
  const [metadata, setMetadata] = useState<PhotoMetadata>({});
  const [metadataLoading, setMetadataLoading] = useState(true);
  const [watermarkSource, setWatermarkSource] = useState<HTMLCanvasElement | null>(null);
  const skipCompareClickRef = useRef(false);
  const previewKey = JSON.stringify({ edits, compare, tab, metadata });
  const [confirmClose, setConfirmClose] = useState(false);
  const [previewSize, setPreviewSize] = useState({ width: 1, height: 1 });
  const dialogRef = useRef<HTMLElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const imageAreaRef = useRef<HTMLDivElement>(null);
  const [areaSize, setAreaSize] = useState({ width: 640, height: 480 });
  const rendererRef = useRef<ReturnType<typeof createPhotoRenderer> | null>(null);
  const previewRef = useRef<HTMLCanvasElement | null>(null);
  const latestRef = useRef({ edits, busy, saved, onClose, confirmClose });
  latestRef.current = { edits, busy, saved, onClose, confirmClose };
  const viewRef = useRef({ source, compare, tab });
  viewRef.current = { source, compare, tab };
  const renderSequence = useRef(0),
    paintedSequence = useRef(0);
  const sliderStartRef = useRef<PhotoEdits | null>(null);
  const pendingSaveRef = useRef<{ key: string; file: File } | null>(null);

  function update(patch: Partial<PhotoEdits>, record = true) {
    if ((Object.keys(patch) as (keyof PhotoEdits)[]).every((key) => edits[key] === patch[key]))
      return;
    setSaved(false);
    pendingSaveRef.current = null;
    setHistory((current) => ({
      past: record ? [...current.past, current.current].slice(-50) : current.past,
      current: { ...current.current, ...patch },
      future: [],
    }));
  }
  function finishSlider() {
    const before = sliderStartRef.current;
    sliderStartRef.current = null;
    if (before)
      setHistory((current) =>
        JSON.stringify(before) === JSON.stringify(current.current)
          ? current
          : {
              ...current,
              past: [...current.past, before].slice(-50),
            },
      );
  }
  function undo() {
    setSaved(false);
    setHistory((current) =>
      current.past.length
        ? {
            past: current.past.slice(0, -1),
            current: current.past[current.past.length - 1],
            future: [current.current, ...current.future],
          }
        : current,
    );
  }
  function redo() {
    setSaved(false);
    setHistory((current) =>
      current.future.length
        ? {
            past: [...current.past, current.current],
            current: current.future[0],
            future: current.future.slice(1),
          }
        : current,
    );
  }
  function requestClose() {
    if (busy) return;
    if (hasPhotoEdits(edits) && !saved) setConfirmClose(true);
    else onClose();
  }

  useEffect(() => {
    const previouslyFocused =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    dialogRef.current?.focus();
    function keydown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        if (dialogRef.current?.querySelector('[data-watermark-settings]')) return;
        if (event.target instanceof HTMLInputElement && event.target.type === 'number') return;
        event.preventDefault();
        event.stopImmediatePropagation();
        const current = latestRef.current;
        if (current.confirmClose) {
          setConfirmClose(false);
          return;
        }
        if (!current.busy) {
          if (hasPhotoEdits(current.edits) && !current.saved) setConfirmClose(true);
          else current.onClose();
        }
      }
      if (event.key === 'Tab') {
        const focusRoot =
          dialogRef.current?.querySelector('[data-watermark-settings], [role="alertdialog"]') ??
          dialogRef.current;
        const controls = Array.from(
          focusRoot?.querySelectorAll<HTMLElement>(
            'button:not(:disabled), input:not(:disabled), select:not(:disabled)',
          ) ?? [],
        );
        const first = controls[0];
        const last = controls[controls.length - 1];
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
    }
    function beforeUnload(event: BeforeUnloadEvent) {
      if (hasPhotoEdits(latestRef.current.edits) && !latestRef.current.saved)
        event.preventDefault();
    }
    window.addEventListener('keydown', keydown, true);
    window.addEventListener('beforeunload', beforeUnload);
    return () => {
      document.body.style.overflow = overflow;
      window.removeEventListener('keydown', keydown, true);
      window.removeEventListener('beforeunload', beforeUnload);
      previouslyFocused?.focus();
    };
  }, []);

  useEffect(() => {
    const element = imageAreaRef.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => {
      setAreaSize({ width: entry.contentRect.width, height: entry.contentRect.height });
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    let cancelled = false;
    setError('');
    setLoaded(null);
    previewRef.current = null;
    let renderer: ReturnType<typeof createPhotoRenderer>;
    try {
      renderer = createPhotoRenderer();
      rendererRef.current = renderer;
    } catch {
      setError(t('照片处理失败，请重试。'));
      return;
    }
    const image = new Image();
    image.onload = () => {
      if (cancelled) return;
      if (
        Math.max(
          image.naturalWidth * image.naturalHeight,
          (sourceSize?.width ?? image.naturalWidth) * (sourceSize?.height ?? image.naturalHeight),
        ) > MAX_PHOTO_PIXELS
      ) {
        setError(t('暂支持不超过 4800 万像素的照片，请先缩小图片。'));
        return;
      }
      try {
        previewRef.current = sourceCanvas(image, 1280);
        setLoaded(image);
      } catch {
        setError(t('照片读取失败，请选择 JPG、PNG 或 WebP 图片。'));
      }
    };
    image.onerror = () => {
      if (!cancelled) setError(t('照片读取失败，请选择 JPG、PNG 或 WebP 图片。'));
    };
    image.src = previewSource ?? source;
    return () => {
      cancelled = true;
      image.onload = null;
      image.onerror = null;
      image.src = '';
      renderer.dispose();
      rendererRef.current = null;
    };
  }, [source, previewSource, sourceSize?.width, sourceSize?.height, loadAttempt]);

  useEffect(() => {
    const controller = new AbortController();
    setMetadata(initialMetadata ?? {});
    // Managed previews have no EXIF; the session already carries library metadata.
    if (previewSource) {
      setMetadataLoading(false);
      return () => controller.abort();
    }
    setMetadataLoading(true);
    void readPhotoMetadata(source, controller.signal)
      .then((value) => {
        if (!controller.signal.aborted)
          setMetadata({
            camera: initialMetadata?.camera ?? value.camera,
            parameters: initialMetadata?.parameters ?? value.parameters,
            capturedAt: initialMetadata?.capturedAt ?? value.capturedAt,
          });
      })
      .catch(() => {
        /* EXIF is optional; absent or unreadable metadata is never invented. */
      })
      .finally(() => {
        if (!controller.signal.aborted) setMetadataLoading(false);
      });
    return () => controller.abort();
  }, [source, previewSource, initialMetadata]);

  useEffect(() => {
    const input = previewRef.current;
    const renderer = rendererRef.current;
    if (!loaded || !input || !renderer) return;
    let cancelled = false;
    const sequence = ++renderSequence.current;
    setRendering(true);
    const timer = window.setTimeout(() => {
      const renderEdits: PhotoEdits = compare
        ? {
            ...resetPhotoAdjustments(edits),
            filter: 'original',
            filterStrength: DEFAULT_PHOTO_EDITS.filterStrength,
          }
        : edits;
      void renderer
        .render(input, renderEdits)
        .then((result) => {
          if (!canvasRef.current || sequence < paintedSequence.current) return;
          const view = viewRef.current;
          if (view.source !== source || view.compare !== compare || view.tab !== tab) return;
          composePhoto(canvasRef.current, result, renderEdits, metadata, tab !== 'crop');
          setWatermarkSource(result);
          paintedSequence.current = sequence;
          setPreviewSize({ width: canvasRef.current.width, height: canvasRef.current.height });
          if (!cancelled) setRendering(false);
          setRenderedKey(JSON.stringify({ edits, compare, tab, metadata }));
          setError('');
        })
        .catch(() => {
          if (!cancelled) {
            setError(t('照片处理失败，请重试。'));
            setRendering(false);
          }
        });
    }, 16);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [loaded, edits, compare, tab, metadata]);

  const fullCrop = loaded ? photoCrop(imageWidth, imageHeight, edits) : null;
  const fullTemplate = findWatermark(edits.watermark);
  const fullOutput =
    fullCrop && fullTemplate
      ? photoWatermarkLayout(fullCrop.width, fullCrop.height, fullTemplate)
      : fullCrop;
  const outputTooLarge =
    !!fullOutput && !withinPhotoOutputBudget(fullOutput.width, fullOutput.height);
  const outputWarning = outputTooLarge
    ? t('水印后的图片超过编辑器尺寸限制，请裁剪图片或选择叠印水印。')
    : '';
  async function savePhoto() {
    if (
      saveUnavailable ||
      sourceConflict ||
      outputTooLarge ||
      !loaded ||
      !rendererRef.current ||
      busy ||
      compare ||
      tab === 'crop' ||
      (edits.watermark !== 'none' && metadataLoading) ||
      renderedKey !== previewKey
    )
      return;
    setBusy(true);
    setError('');
    let savingToAlbum = false;
    try {
      if (onSaveRecipe) {
        const recipe: PhotoEditRecipe = {
          version: 1,
          edits: {
            ...edits,
            watermarkCamera: edits.watermarkCamera ?? metadata.camera ?? null,
            watermarkParameters: edits.watermarkParameters ?? metadata.parameters ?? null,
            watermarkCapturedAt: edits.watermarkCapturedAt ?? metadata.capturedAt ?? null,
          },
        };
        const lut = edits.filter.startsWith('lut:')
          ? writePortableLut(await loadPhotoLut(edits.filter.slice(4)))
          : undefined;
        const result = await onSaveRecipe(recipe, lut);
        setSavedName(result.name);
        setSavedId(result.id);
        setSaved(true);
        return;
      }
      if (!onSave) throw new Error('PHOTO_SAVE_UNAVAILABLE');
      const saveKey = JSON.stringify({ source, edits, metadata });
      let file = pendingSaveRef.current?.key === saveKey ? pendingSaveRef.current.file : undefined;
      if (!file) {
        const controller = new AbortController();
        exportController.current = controller;
        const original = previewSource
          ? await loadEditablePhoto(source, controller.signal)
          : loaded;
        try {
          if (original.naturalWidth !== imageWidth || original.naturalHeight !== imageHeight)
            throw new Error('PHOTO_SOURCE_DIMENSIONS_CHANGED');
          file = await renderEditedPhotoFile(original, edits, metadata, rendererRef.current, name);
          if (controller.signal.aborted) return;
          pendingSaveRef.current = { key: saveKey, file };
        } finally {
          if (original !== loaded) original.src = '';
          exportController.current = null;
        }
      }
      savingToAlbum = true;
      const savedPhoto = await onSave(file, { version: 1, edits });
      pendingSaveRef.current = null;
      setSavedName(savedPhoto.name);
      setSavedId(savedPhoto.id);
      setSaved(true);
    } catch (cause) {
      if (cause instanceof ApiError && cause.status === 409) {
        setSourceConflict(true);
        setError(t('原照片或保存条件已变化，请关闭后重新打开编辑器。'));
      } else {
        setError(
          cause instanceof ApiError || ((onSaveRecipe || savingToAlbum) && cause instanceof Error)
            ? cause.message
            : t('照片保存失败，请重试。'),
        );
      }
    } finally {
      setBusy(false);
    }
  }
  async function openSavedPhoto() {
    if (!onOpenSaved || busy) return;
    setBusy(true);
    setError('');
    try {
      await onOpenSaved(savedId);
    } catch {
      setError(t('定位失败，请重试'));
    } finally {
      setBusy(false);
    }
  }
  function slider(
    label: string,
    key: ActiveAdjustmentKey | 'filterStrength',
    min = -100,
    max = 100,
    step = 1,
    unit?: string,
    options: { compact?: boolean; disabled?: boolean } = {},
  ) {
    return (
      <PhotoAdjustmentControl
        key={key}
        label={label}
        value={edits[key]}
        min={min}
        max={max}
        step={step}
        unit={unit}
        compact={options.compact ?? tab === 'adjust'}
        disabled={busy || !loaded || options.disabled === true}
        onStart={() => {
          sliderStartRef.current ??= edits;
        }}
        onCommit={finishSlider}
        onChange={(value) => update({ [key]: value }, sliderStartRef.current === null)}
        onReset={() => update({ [key]: DEFAULT_PHOTO_EDITS[key] })}
      />
    );
  }
  const crop = previewRef.current
    ? photoCrop(previewRef.current.width, previewRef.current.height, edits)
    : null;
  const tabs = [
    { id: 'crop' as const, label: t('裁剪'), Icon: IconCrop },
    { id: 'filters' as const, label: t('滤镜'), Icon: IconPhoto },
    { id: 'adjust' as const, label: t('调整'), Icon: IconAdjustments },
    { id: 'watermark' as const, label: t('水印'), Icon: IconFrame },
  ];
  const compareControl = (
    <button
      type="button"
      className={styles.compare}
      aria-pressed={compare}
      aria-label={compare ? t('返回编辑') : t('对比原图')}
      title={compare ? t('返回编辑') : t('对比原图')}
      disabled={!loaded || busy}
      onPointerDown={(event) => {
        if (event.button !== 0) return;
        skipCompareClickRef.current = true;
        event.currentTarget.setPointerCapture?.(event.pointerId);
        setCompare(true);
      }}
      onPointerUp={() => setCompare(false)}
      onPointerCancel={() => {
        setCompare(false);
        skipCompareClickRef.current = false;
      }}
      onLostPointerCapture={() => setCompare(false)}
      onClick={() => {
        if (skipCompareClickRef.current) {
          skipCompareClickRef.current = false;
          return;
        }
        setCompare((value) => !value);
      }}
    >
      <IconPhoto size={19} />
    </button>
  );
  return (
    <section
      ref={dialogRef}
      tabIndex={-1}
      className={styles.editor}
      data-presentation={presentation}
      role="dialog"
      aria-modal="true"
      aria-label={t('编辑照片')}
      onKeyDown={(event) => event.stopPropagation()}
    >
      <header className={styles.header} inert={confirmClose}>
        <button
          type="button"
          className={styles.iconButton}
          data-mobile-back
          aria-label={t('关闭编辑器')}
          disabled={busy}
          onClick={requestClose}
        >
          <IconX size={20} />
        </button>
        <div className={styles.history}>
          <button
            type="button"
            aria-label={t('撤销')}
            disabled={!history.past.length || busy}
            onClick={undo}
          >
            <IconArrowBackUp size={22} />
          </button>
          <button
            type="button"
            aria-label={t('重做')}
            disabled={!history.future.length || busy}
            onClick={redo}
          >
            <IconArrowForwardUp size={22} />
          </button>
        </div>
        <div className={styles.title}>
          <strong>{t('编辑照片')}</strong>
          <span>{name}</span>
          {onDraftChange && <small role="status">{draftStatus}</small>}
        </div>
        {onCopyEdits && (
          <button
            type="button"
            disabled={busy || !loaded}
            title={t('复制编辑参数')}
            aria-label={t('复制编辑参数')}
            onClick={() => {
              onCopyEdits({ version: 1, edits });
              setCopied(true);
            }}
          >
            <IconAdjustments size={20} />
          </button>
        )}
        <button
          type="button"
          className={styles.exportButton}
          disabled={
            !loaded ||
            Boolean(saveUnavailable) ||
            sourceConflict ||
            (tab !== 'crop' && outputTooLarge) ||
            busy ||
            rendering ||
            compare ||
            (edits.watermark !== 'none' && metadataLoading) ||
            renderedKey !== previewKey ||
            (saved && tab !== 'crop')
          }
          onClick={() => {
            if (tab === 'crop') setTab('adjust');
            else void savePhoto();
          }}
        >
          <IconDeviceFloppy size={18} />
          {busy
            ? t('正在保存…')
            : tab === 'crop'
              ? t('完成裁剪')
              : saved
                ? t('已保存')
                : t('保存到相册')}
        </button>
      </header>
      <main className={styles.stage} inert={confirmClose}>
        <div className={styles.stageTop}>
          <span>{compare ? t('调整前') : tab === 'crop' ? t('裁剪区域预览') : t('成片预览')}</span>
          <span>
            {loaded
              ? (() => {
                  const size = photoCrop(imageWidth, imageHeight, edits);
                  const template = tab !== 'crop' ? findWatermark(edits.watermark) : undefined;
                  const output = template
                    ? photoWatermarkLayout(size.width, size.height, template)
                    : size;
                  return `${output.width} × ${output.height}`;
                })()
              : ''}
          </span>
        </div>
        <div
          className={`${styles.imageArea} ${tab === 'crop' ? styles.cropImageArea : ''}`}
          ref={imageAreaRef}
        >
          <div
            className={styles.imageFrame}
            data-cropping={tab === 'crop'}
            style={{
              aspectRatio: `${previewSize.width} / ${previewSize.height}`,
              width: Math.max(
                1,
                Math.min(
                  areaSize.width,
                  (areaSize.height * previewSize.width) / previewSize.height,
                ),
              ),
            }}
          >
            <canvas
              ref={canvasRef}
              aria-label={t('照片编辑预览')}
              className={loaded ? styles.canvas : styles.hiddenCanvas}
            />
            {loaded && tab === 'crop' && crop && (
              <PhotoCropViewport
                edits={edits}
                width={imageWidth}
                height={imageHeight}
                disabled={busy || compare}
                onStart={() => {
                  sliderStartRef.current ??= edits;
                }}
                onChange={(patch) => update(patch, false)}
                onCommit={finishSlider}
              />
            )}
          </div>
          {!loaded && !error && <p role="status">{t('正在读取照片…')}</p>}
        </div>
        {outputWarning && (
          <div className={styles.error} role="alert">
            {outputWarning}
          </div>
        )}
        {saveUnavailable && (
          <p className={styles.error} role="status">
            {saveUnavailable}
          </p>
        )}
        {(sourceConflict || error) && (
          <div className={styles.error} role="alert">
            {sourceConflict ? t('原照片或保存条件已变化，请关闭后重新打开编辑器。') : error}
            {!sourceConflict && (
              <button
                type="button"
                disabled={busy}
                onClick={() => setLoadAttempt((value) => value + 1)}
              >
                {t('重新加载')}
              </button>
            )}
          </div>
        )}
        <div className={styles.stageBottom}>
          {tab === 'watermark' && compareControl}
          {compact && saved ? (
            <div className={styles.compactSaveNotice} role="status">
              <span>{t('已保存到相册')}</span>
              {onOpenSaved && (
                <button
                  type="button"
                  aria-label={t('查看已保存照片')}
                  disabled={busy}
                  onClick={() => void openSavedPhoto()}
                >
                  {t('查看已保存照片')}
                </button>
              )}
            </div>
          ) : (
            <span className={styles.renderState} role="status">
              {rendering
                ? t('正在更新…')
                : copied
                  ? t('参数已复制，可返回图库多选后套用。')
                  : saved
                    ? t('已保存到相册')
                    : ''}
            </span>
          )}
        </div>
      </main>
      {saved && !compact && (
        <div className={styles.saveNotice} role="status">
          {t('已保存到相册')} · {savedName}
          {onOpenSaved && (
            <button type="button" disabled={busy} onClick={() => void openSavedPhoto()}>
              {t('查看已保存照片')}
            </button>
          )}
        </div>
      )}
      <aside className={styles.panel} inert={confirmClose}>
        <fieldset
          className={`${styles.controls} ${tab === 'adjust' ? styles.adjustmentControls : tab === 'crop' ? styles.cropControls : ''}`}
          disabled={!loaded || busy}
        >
          {tab === 'adjust' && (
            <PhotoAdjustmentsPanel
              touch={compact}
              edits={edits}
              disabled={!loaded || busy}
              canReset={PHOTO_ADJUSTMENTS.some(
                (option) => edits[option.key] !== DEFAULT_PHOTO_EDITS[option.key],
              )}
              onReset={() => update(resetPhotoAdjustments(edits))}
              onGestureStart={() => {
                sliderStartRef.current ??= edits;
              }}
              onGestureCommit={finishSlider}
              onChangeOption={(key, value) => update({ [key]: value }, false)}
              compareControl={compareControl}
              onResetOption={(option) => update({ [option.key]: DEFAULT_PHOTO_EDITS[option.key] })}
              renderControl={(option) =>
                option.key &&
                slider(
                  option.label,
                  option.key,
                  option.min ?? -100,
                  option.max ?? 100,
                  option.step ?? 1,
                  option.unit,
                )
              }
            />
          )}
          {tab === 'filters' && (
            <PhotoToolPanel
              inspector={
                <>
                  <div className={styles.parameterRow}>
                    {compareControl}
                    {slider(t('滤镜强度'), 'filterStrength', 0, 100, 1, undefined, {
                      compact: true,
                      disabled: edits.filter === 'original',
                    })}
                  </div>
                  <p className={styles.parameterHint}>{t('滤镜强度')}</p>
                </>
              }
            >
              <PhotoFilterOptions
                selected={edits.filter}
                disabled={!loaded || busy}
                onChange={(filter) => update({ filter })}
              />
            </PhotoToolPanel>
          )}
          {tab === 'watermark' && (
            <PhotoWatermarkPanel
              edits={edits}
              metadata={metadata}
              source={watermarkSource}
              disabled={!loaded || busy}
              metadataLoading={metadataLoading}
              onChange={update}
            />
          )}
          {tab === 'crop' && (
            <PhotoCropPanel
              compareControl={compareControl}
              edits={edits}
              width={imageWidth}
              height={imageHeight}
              onChange={update}
            />
          )}
        </fieldset>
        <p className={styles.note}>{t('保留原图，修改后的照片以“已编辑”后缀保存到相册。')}</p>
      </aside>
      <nav className={styles.tabs} aria-label={t('照片编辑工具')} inert={confirmClose}>
        {tabs.map(({ id, label, Icon }) => (
          <button
            type="button"
            key={id}
            aria-pressed={tab === id}
            disabled={busy}
            title={label}
            onClick={() => {
              setCompare(false);
              setTab(id);
            }}
          >
            <Icon size={19} />
            <span>{label}</span>
          </button>
        ))}
      </nav>
      {confirmClose && (
        <div className={styles.confirmBackdrop}>
          <section
            className={styles.confirm}
            role="alertdialog"
            aria-modal="true"
            aria-label={onDraftChange ? t('关闭编辑器？') : t('放弃未保存的修改？')}
          >
            <h2>{onDraftChange ? t('关闭编辑器？') : t('放弃未保存的修改？')}</h2>
            <p>
              {onDraftChange
                ? t('关闭后保留编辑草稿，原图不会改变。')
                : t('原图不会改变，关闭后本次调整将丢失。')}
            </p>
            <button data-mobile-back type="button" autoFocus onClick={() => setConfirmClose(false)}>
              {t('继续编辑')}
            </button>
            <button
              type="button"
              onClick={() => {
                void (async () => {
                  if (onDraftChange) {
                    try {
                      await draftQueue.current;
                      await onDraftChange({ version: 1, edits });
                    } catch {
                      setDraftStatus(t('草稿保存失败，请重试。'));
                      return;
                    }
                  }
                  onClose();
                })();
              }}
            >
              {onDraftChange ? t('保留草稿并关闭') : t('放弃修改')}
            </button>
          </section>
        </div>
      )}
    </section>
  );
}
