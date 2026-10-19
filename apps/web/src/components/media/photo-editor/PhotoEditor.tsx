import { useEffect, useRef, useState } from 'react';
import {
  IconAdjustments,
  IconArrowBackUp,
  IconArrowForwardUp,
  IconCheck,
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
  type PhotoFilter,
} from './photo-editor-model';
import {
  createPhotoRenderer,
  composePhoto,
  MAX_PHOTO_PIXELS,
  sourceCanvas,
} from './photo-editor-render';
import styles from './PhotoEditor.module.css';
import { editedPhotoName, type SavedPhoto } from './photo-editor-save';
import { PhotoAdjustmentControl } from './PhotoAdjustmentControl';
import { PhotoAdjustmentsPanel } from './PhotoAdjustmentsPanel';
import {
  PHOTO_ADJUSTMENTS,
  resetPhotoAdjustments,
  type ActiveAdjustmentKey,
} from './photo-adjustment-catalog';
import { PhotoWatermarkPanel } from './PhotoWatermarkPanel';
import { PhotoCropViewport } from './PhotoCropViewport';
import { PhotoCropPanel } from './PhotoCropPanel';
import { ScrollableToolRow } from './ScrollableToolRow';
import { readPhotoMetadata } from './photo-editor-metadata';
import { findWatermark, photoWatermarkLayout, type PhotoMetadata } from './photo-watermark-model';

type Tab = 'adjust' | 'filters' | 'crop' | 'watermark';
type History = { past: PhotoEdits[]; current: PhotoEdits; future: PhotoEdits[] };
const FILTERS: { id: PhotoFilter; label: string }[] = [
  { id: 'original', label: t('原图') },
  { id: 'vintage', label: t('复古') },
  { id: 'oceanic', label: t('清冷') },
  { id: 'monochrome', label: t('黑白') },
];

export function PhotoEditor({
  source,
  name,
  onClose,
  onSave,
}: {
  source: string;
  name: string;
  onClose: () => void;
  onSave: (file: File) => Promise<SavedPhoto>;
}) {
  const [history, setHistory] = useState<History>({
    past: [],
    current: { ...DEFAULT_PHOTO_EDITS },
    future: [],
  });
  const edits = history.current;
  const [tab, setTab] = useState<Tab>('adjust');
  const [loaded, setLoaded] = useState<HTMLImageElement | null>(null);
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [rendering, setRendering] = useState(false);
  const [saved, setSaved] = useState(false);
  const [savedName, setSavedName] = useState('');
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
  const latestRef = useRef({ edits, busy, saved, onClose });
  latestRef.current = { edits, busy, saved, onClose };
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
      if (image.naturalWidth * image.naturalHeight > MAX_PHOTO_PIXELS) {
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
    image.src = source;
    return () => {
      cancelled = true;
      image.onload = null;
      image.onerror = null;
      renderer.dispose();
      rendererRef.current = null;
    };
  }, [source, loadAttempt]);

  useEffect(() => {
    const controller = new AbortController();
    setMetadata({});
    setMetadataLoading(true);
    void readPhotoMetadata(source, controller.signal)
      .then((value) => {
        if (!controller.signal.aborted) setMetadata(value);
      })
      .catch(() => {
        /* EXIF is optional; absent or unreadable metadata is never invented. */
      })
      .finally(() => {
        if (!controller.signal.aborted) setMetadataLoading(false);
      });
    return () => controller.abort();
  }, [source]);

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

  async function savePhoto() {
    if (
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
    try {
      const saveKey = JSON.stringify({ source, edits, metadata });
      let file = pendingSaveRef.current?.key === saveKey ? pendingSaveRef.current.file : undefined;
      if (!file) {
        const result = await rendererRef.current.render(sourceCanvas(loaded), edits);
        const output = document.createElement('canvas');
        composePhoto(output, result, edits, metadata);
        const blob = await new Promise<Blob>((resolve, reject) =>
          output.toBlob(
            (value) => (value ? resolve(value) : reject(new Error('ENCODE_FAILED'))),
            'image/png',
          ),
        );
        file = new File([blob], editedPhotoName(name), { type: 'image/png' });
        pendingSaveRef.current = { key: saveKey, file };
      }
      const savedPhoto = await onSave(file);
      pendingSaveRef.current = null;
      setSavedName(savedPhoto.name);
      setSaved(true);
    } catch {
      setError(t('照片保存失败，请重试。'));
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
        compact={tab === 'adjust'}
        disabled={busy || !loaded}
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
      role="dialog"
      aria-modal="true"
      aria-label={t('编辑照片')}
      onKeyDown={(event) => event.stopPropagation()}
    >
      <header className={styles.header} inert={confirmClose}>
        <button
          type="button"
          className={styles.iconButton}
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
        </div>
        <button
          type="button"
          className={styles.exportButton}
          disabled={
            !loaded ||
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
                  const size = photoCrop(loaded.naturalWidth, loaded.naturalHeight, edits);
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
                width={loaded.naturalWidth}
                height={loaded.naturalHeight}
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
        {error && (
          <div className={styles.error} role="alert">
            {error}
            <button
              type="button"
              disabled={busy}
              onClick={() => setLoadAttempt((value) => value + 1)}
            >
              {t('重新加载')}
            </button>
          </div>
        )}
        <div className={styles.stageBottom}>
          {tab !== 'adjust' && compareControl}
          <span className={styles.renderState} role="status">
            {rendering ? t('正在更新…') : saved ? t('已保存到相册') : ''}
          </span>
        </div>
      </main>
      {saved && (
        <div className={styles.saveNotice} role="status">
          {t('已保存到相册')} · {savedName}
        </div>
      )}
      <aside className={styles.panel} inert={confirmClose}>
        <fieldset
          className={`${styles.controls} ${tab === 'adjust' ? styles.adjustmentControls : tab === 'crop' ? styles.cropControls : ''}`}
          disabled={!loaded || busy}
        >
          {tab === 'adjust' && (
            <PhotoAdjustmentsPanel
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
            <>
              <div className={styles.sectionTitle}>
                <strong>{t('照片滤镜')}</strong>
              </div>
              <ScrollableToolRow className={styles.filters} label={t('照片滤镜')}>
                {FILTERS.map(({ id, label }) => (
                  <button
                    type="button"
                    key={id}
                    aria-pressed={edits.filter === id}
                    onClick={() => update({ filter: id })}
                  >
                    <span className={styles.swatch} data-filter={id} />
                    <span>{label}</span>
                    {edits.filter === id && <IconCheck size={14} />}
                  </button>
                ))}
              </ScrollableToolRow>
              {edits.filter !== 'original' && slider(t('滤镜强度'), 'filterStrength', 0, 100)}
            </>
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
              edits={edits}
              width={loaded?.naturalWidth ?? 1}
              height={loaded?.naturalHeight ?? 1}
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
            aria-label={t('放弃未保存的修改？')}
          >
            <h2>{t('放弃未保存的修改？')}</h2>
            <p>{t('原图不会改变，关闭后本次调整将丢失。')}</p>
            <button type="button" autoFocus onClick={() => setConfirmClose(false)}>
              {t('继续编辑')}
            </button>
            <button type="button" onClick={onClose}>
              {t('放弃修改')}
            </button>
          </section>
        </div>
      )}
    </section>
  );
}
