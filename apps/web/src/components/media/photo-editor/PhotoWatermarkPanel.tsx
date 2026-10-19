import { useEffect, useMemo, useRef, useState } from 'react';
import {
  IconBan,
  IconPencil,
  IconX,
  IconAlignLeft,
  IconAlignCenter,
  IconAlignRight,
} from '@tabler/icons-react';
import { t } from '../../../i18n';
import { DEFAULT_PHOTO_EDITS, type PhotoEdits } from './photo-editor-model';
import { drawPhoto } from './photo-editor-render';
import { renderPhotoWatermark } from './photo-editor-watermark';
import {
  findWatermark,
  watermarkAlignment,
  WATERMARK_CATEGORIES,
  type PhotoMetadata,
} from './photo-watermark-model';
import styles from './PhotoEditor.module.css';
import { useWatermarkNavigation, ORDERED_WATERMARK_TEMPLATES } from './useWatermarkNavigation';
import { ScrollableToolRow } from './ScrollableToolRow';

function WatermarkPreview({
  source,
  edits,
  metadata,
  id,
}: {
  source: HTMLCanvasElement | null;
  edits: PhotoEdits;
  metadata: PhotoMetadata;
  id: string;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    if (!canvas.current || !source) return;
    const result = renderPhotoWatermark(source, { ...edits, watermark: id }, metadata);
    canvas.current.width = result.width;
    canvas.current.height = result.height;
    canvas.current.getContext('2d')?.drawImage(result, 0, 0);
  }, [source, edits, metadata, id]);
  return <canvas ref={canvas} className={styles.watermarkThumbnail} aria-hidden="true" />;
}

function WatermarkSettingsEditor({
  edits,
  source,
  metadata,
  onApply,
  onClose,
}: {
  edits: PhotoEdits;
  source: HTMLCanvasElement | null;
  metadata: PhotoMetadata;
  onApply: (patch: Partial<PhotoEdits>) => void;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState(() => ({
    ...edits,
    watermarkCamera: edits.watermarkCamera ?? metadata.camera ?? '',
    watermarkParameters: edits.watermarkParameters ?? metadata.parameters ?? '',
    watermarkCapturedAt: edits.watermarkCapturedAt ?? metadata.capturedAt ?? '',
  }));
  const change = (patch: Partial<typeof draft>) =>
    setDraft((current) => ({ ...current, ...patch }));
  return (
    <div
      className={styles.watermarkSettingsBackdrop}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        className={styles.watermarkSettings}
        role="dialog"
        aria-modal="true"
        aria-label={t('水印设置')}
        data-watermark-settings
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.stopPropagation();
            onClose();
          }
        }}
      >
        <div className={styles.watermarkSettingsHeading}>
          <strong>{t('水印设置')}</strong>
          <button type="button" aria-label={t('关闭水印设置')} onClick={onClose}>
            <IconX size={18} />
          </button>
        </div>
        <div className={styles.watermarkSettingsPreview}>
          <WatermarkPreview
            source={source}
            edits={draft}
            metadata={metadata}
            id={draft.watermark}
          />
        </div>
        <label>
          {t('签名文字')}
          <input
            autoFocus
            type="text"
            maxLength={64}
            value={draft.watermarkText}
            placeholder={t('输入署名或一句话')}
            onChange={(event) => change({ watermarkText: event.target.value })}
          />
        </label>
        <label>
          {t('显示机型')}
          <input
            type="text"
            maxLength={64}
            value={draft.watermarkCamera}
            placeholder={t('输入相机或手机型号')}
            onChange={(event) => change({ watermarkCamera: event.target.value })}
          />
        </label>
        <label>
          {t('拍摄参数')}
          <input
            type="text"
            maxLength={200}
            value={draft.watermarkParameters}
            placeholder={t('输入焦距、光圈、快门和 ISO')}
            onChange={(event) => change({ watermarkParameters: event.target.value })}
          />
        </label>
        <label>
          {t('拍摄时间')}
          <input
            type="text"
            maxLength={64}
            value={draft.watermarkCapturedAt}
            placeholder={t('输入拍摄时间')}
            onChange={(event) => change({ watermarkCapturedAt: event.target.value })}
          />
        </label>
        <label>
          {t('网站地址')}
          <input
            type="text"
            maxLength={128}
            value={draft.watermarkWebsite}
            onChange={(event) => change({ watermarkWebsite: event.target.value })}
          />
        </label>
        <p className={styles.hint}>{t('仅修改水印显示文字，不改写照片拍摄信息。')}</p>
        <label>
          {t('文字大小')}
          <output>{draft.watermarkScale}%</output>
          <input
            type="range"
            min={60}
            max={160}
            step={1}
            value={draft.watermarkScale}
            aria-label={t('文字大小')}
            onChange={(event) => change({ watermarkScale: Number(event.target.value) })}
          />
        </label>
        <div className={styles.watermarkSettingsActions}>
          <button type="button" onClick={onClose}>
            {t('取消')}
          </button>
          <button
            type="button"
            className={styles.watermarkApply}
            onClick={() => {
              onApply({
                watermarkText: draft.watermarkText,
                watermarkCamera: draft.watermarkCamera,
                watermarkParameters: draft.watermarkParameters,
                watermarkCapturedAt: draft.watermarkCapturedAt,
                watermarkWebsite: draft.watermarkWebsite,
                watermarkScale: draft.watermarkScale,
              });
              onClose();
            }}
          >
            {t('完成')}
          </button>
        </div>
      </section>
    </div>
  );
}

export function PhotoWatermarkPanel({
  edits,
  metadata,
  source,
  disabled,
  metadataLoading,
  onChange,
}: {
  edits: PhotoEdits;
  metadata: PhotoMetadata;
  source: HTMLCanvasElement | null;
  disabled: boolean;
  metadataLoading: boolean;
  onChange: (patch: Partial<PhotoEdits>) => void;
}) {
  const navigation = useWatermarkNavigation(edits.watermark);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const selected = findWatermark(edits.watermark);
  const { rotation, flip, cropRatio, cropZoom, cropAspect, cropX, cropY } = edits;
  const settingsButton = useRef<HTMLButtonElement>(null);
  const thumbnail = useMemo(() => {
    if (!source) return null;
    const oriented = document.createElement('canvas');
    drawPhoto(oriented, source, {
      ...DEFAULT_PHOTO_EDITS,
      rotation,
      flip,
      cropRatio,
      cropZoom,
      cropAspect,
      cropX,
      cropY,
    });
    const small = document.createElement('canvas');
    const scale = Math.min(1, 240 / Math.max(oriented.width, oriented.height));
    small.width = Math.max(1, Math.round(oriented.width * scale));
    small.height = Math.max(1, Math.round(oriented.height * scale));
    small.getContext('2d')?.drawImage(oriented, 0, 0, small.width, small.height);
    return small;
  }, [source, rotation, flip, cropRatio, cropZoom, cropAspect, cropX, cropY]);
  const closeSettings = () => {
    setSettingsOpen(false);
    settingsButton.current?.focus();
  };
  return (
    <>
      <ScrollableToolRow className={styles.watermarkCapabilities} label={t('水印设置')}>
        {selected?.theme && (
          <>
            <button
              type="button"
              aria-pressed={edits.watermarkTheme === 'white'}
              disabled={disabled}
              onClick={() => onChange({ watermarkTheme: 'white' })}
            >
              {selected.overlay ? t('白字') : t('白底')}
            </button>
            <button
              type="button"
              aria-pressed={edits.watermarkTheme === 'black'}
              disabled={disabled}
              onClick={() => onChange({ watermarkTheme: 'black' })}
            >
              {selected.overlay ? t('黑字') : t('黑底')}
            </button>
          </>
        )}
        {selected && (
          <button
            type="button"
            aria-pressed={edits.watermarkShowParameters}
            disabled={disabled || !(edits.watermarkParameters ?? metadata.parameters)?.trim()}
            title={
              !(edits.watermarkParameters ?? metadata.parameters)?.trim()
                ? t('照片没有拍摄参数信息')
                : t('拍摄参数')
            }
            onClick={() => onChange({ watermarkShowParameters: !edits.watermarkShowParameters })}
          >
            {t('拍摄参数')}
          </button>
        )}
        {selected?.alignment &&
          [
            { id: 'left' as const, label: t('左对齐'), Icon: IconAlignLeft },
            { id: 'center' as const, label: t('居中'), Icon: IconAlignCenter },
            { id: 'right' as const, label: t('右对齐'), Icon: IconAlignRight },
          ].map(({ id, label, Icon }) => (
            <button
              type="button"
              key={id}
              aria-label={label}
              aria-pressed={watermarkAlignment(edits.watermark, edits.watermarkAlign) === id}
              disabled={disabled}
              onClick={() => onChange({ watermark: selected.id, watermarkAlign: id })}
            >
              <Icon size={16} />
            </button>
          ))}
        {selected && (
          <button
            type="button"
            aria-pressed={edits.watermarkShowWebsite}
            disabled={disabled}
            onClick={() => onChange({ watermarkShowWebsite: !edits.watermarkShowWebsite })}
          >
            {t('网站地址')}
          </button>
        )}
        {selected?.time && (
          <button
            type="button"
            aria-pressed={edits.watermarkShowTime}
            disabled={disabled || !(edits.watermarkCapturedAt ?? metadata.capturedAt)?.trim()}
            title={
              !(edits.watermarkCapturedAt ?? metadata.capturedAt)?.trim()
                ? t('照片没有拍摄时间信息')
                : t('拍摄时间')
            }
            onClick={() => onChange({ watermarkShowTime: !edits.watermarkShowTime })}
          >
            {t('拍摄时间')}
          </button>
        )}
        {selected && (
          <button
            ref={settingsButton}
            type="button"
            aria-label={t('编辑水印文字')}
            disabled={disabled}
            onClick={() => setSettingsOpen(true)}
          >
            <IconPencil size={14} />
            {t('编辑文字')}
          </button>
        )}
      </ScrollableToolRow>
      <ScrollableToolRow className={styles.watermarkCategories} label={t('水印分类')}>
        {WATERMARK_CATEGORIES.map((item) => (
          <button
            type="button"
            key={item.id}
            disabled={disabled}
            ref={navigation.group === item.id ? navigation.categoryRef : undefined}
            aria-pressed={navigation.group === item.id}
            onClick={() => navigation.selectCategory(item.id)}
          >
            {item.label}
          </button>
        ))}
      </ScrollableToolRow>
      <ScrollableToolRow
        className={styles.watermarkOptions}
        label={t('水印模板')}
        anchorSelector="[data-category-start]"
        viewportRef={navigation.viewportRef}
        onScroll={navigation.followScroll}
        onNavigate={navigation.beginNavigation}
      >
        <button
          type="button"
          disabled={disabled}
          ref={navigation.templateRef('none')}
          aria-pressed={edits.watermark === 'none'}
          onClick={() => onChange({ watermark: 'none' })}
        >
          <IconBan size={28} />
          <span>{t('无水印')}</span>
        </button>
        {ORDERED_WATERMARK_TEMPLATES.map((template, index) => (
          <button
            key={template.id}
            type="button"
            ref={navigation.templateRef(template.id)}
            data-category-start={
              (index > 0 &&
                ORDERED_WATERMARK_TEMPLATES[index - 1].category !== template.category) ||
              undefined
            }
            disabled={disabled}
            aria-pressed={selected?.id === template.id}
            aria-label={template.label}
            onClick={() =>
              onChange({
                watermark: template.id,
                watermarkTheme: template.theme ? edits.watermarkTheme : 'black',
                watermarkShowTime: template.time && edits.watermarkShowTime,
              })
            }
          >
            <WatermarkPreview
              source={thumbnail}
              edits={edits}
              metadata={metadata}
              id={template.id}
            />
            <span>{template.label}</span>
          </button>
        ))}
      </ScrollableToolRow>
      {metadataLoading && (
        <span className={styles.watermarkMetadataStatus} role="status">
          {t('正在读取拍摄信息…')}
        </span>
      )}
      {settingsOpen && (
        <WatermarkSettingsEditor
          edits={edits}
          source={thumbnail}
          metadata={metadata}
          onApply={onChange}
          onClose={closeSettings}
        />
      )}
    </>
  );
}
