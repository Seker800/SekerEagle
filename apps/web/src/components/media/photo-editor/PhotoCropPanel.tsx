import { useState } from 'react';
import { IconCrop, IconFlipHorizontal, IconRotateClockwise } from '@tabler/icons-react';
import { t } from '../../../i18n';
import { CROP_RATIO_PAIRS, photoCrop, type CropRatio, type PhotoEdits } from './photo-editor-model';
import { cropRectPatch } from './photo-editor-crop-geometry';
import { ScrollableToolRow } from './ScrollableToolRow';
import styles from './PhotoEditor.module.css';

const CENTERED_CROP = { cropZoom: 1, cropAspect: 0, cropX: 0.5, cropY: 0.5 };

function RatioShape({ aspect }: { aspect: number }) {
  return <span style={{ width: Math.min(32, 28 * aspect), height: Math.min(28, 32 / aspect) }} />;
}

export function PhotoCropPanel({
  edits,
  width,
  height,
  onChange,
}: {
  edits: PhotoEdits;
  width: number;
  height: number;
  onChange: (patch: Partial<PhotoEdits>) => void;
}) {
  const [preferredPortrait, setPreferredPortrait] = useState(false);
  const pair = CROP_RATIO_PAIRS.find((ratios) => ratios.some((ratio) => ratio === edits.cropRatio));
  // Read locked orientation from history, so undo / redo always restores the controls too.
  const portrait = pair && pair[0] !== pair[1] ? edits.cropRatio === pair[1] : preferredPortrait;
  const selectRatio = (cropRatio: CropRatio) => {
    if (cropRatio === edits.cropRatio) return;
    onChange(
      cropRatio === 'free'
        ? {
            cropRatio,
            ...cropRectPatch(
              width,
              height,
              { ...edits, cropRatio },
              photoCrop(width, height, edits, false),
            ),
          }
        : { cropRatio, ...CENTERED_CROP },
    );
  };
  return (
    <div className={styles.cropPanel}>
      <div className={styles.sectionTitle}>
        <strong>{t('构图')}</strong>
        <button
          type="button"
          onClick={() =>
            onChange({ ...CENTERED_CROP, cropRatio: 'free', rotation: 0, flip: false })
          }
        >
          {t('重置裁剪')}
        </button>
      </div>
      <div className={styles.cropToolbar}>
        <div className={styles.cropOrientation} role="group" aria-label={t('比例方向')}>
          {[false, true].map((value) => (
            <button
              key={String(value)}
              type="button"
              aria-pressed={portrait === value}
              onClick={() => {
                setPreferredPortrait(value);
                if (pair && pair[0] !== pair[1]) selectRatio(pair[value ? 1 : 0]);
              }}
            >
              <span className={styles.orientationIcon} data-portrait={value} aria-hidden="true" />
              {value ? t('纵向') : t('横向')}
            </button>
          ))}
        </div>
        <div className={styles.cropTransforms}>
          <button
            type="button"
            onClick={() => onChange({ rotation: (edits.rotation + 90) % 360, ...CENTERED_CROP })}
          >
            <IconRotateClockwise size={17} />
            {t('旋转')}
          </button>
          <button
            type="button"
            aria-pressed={edits.flip}
            onClick={() => onChange({ flip: !edits.flip })}
          >
            <IconFlipHorizontal size={17} />
            {t('镜像')}
          </button>
        </div>
      </div>
      <ScrollableToolRow className={styles.cropRatios} label={t('裁剪比例')}>
        <button
          type="button"
          aria-pressed={edits.cropRatio === 'free'}
          onClick={() => selectRatio('free')}
        >
          <span className={styles.ratioPreview} aria-hidden="true">
            <IconCrop size={25} />
          </span>
          <span>{t('自由')}</span>
        </button>
        <button
          type="button"
          aria-pressed={edits.cropRatio === 'original'}
          onClick={() => selectRatio('original')}
        >
          <span className={styles.ratioPreview} aria-hidden="true">
            <RatioShape aspect={edits.rotation % 180 ? height / width : width / height} />
          </span>
          <span>{t('原始比例')}</span>
        </button>
        {CROP_RATIO_PAIRS.map((ratios) => {
          const ratio = ratios[portrait ? 1 : 0];
          return (
            <button
              type="button"
              key={ratios[0]}
              aria-pressed={edits.cropRatio === ratio}
              onClick={() => selectRatio(ratio)}
            >
              <span className={styles.ratioPreview} aria-hidden="true">
                <RatioShape aspect={Number(ratio.split(':')[0]) / Number(ratio.split(':')[1])} />
              </span>
              <span>{ratio}</span>
            </button>
          );
        })}
      </ScrollableToolRow>
      <p className={styles.hint}>{t('拖动四角或边缘调整范围，拖动框内移动裁剪框')}</p>
    </div>
  );
}
