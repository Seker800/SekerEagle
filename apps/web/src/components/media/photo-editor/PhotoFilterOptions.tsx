import { useEffect, useRef, useState } from 'react';
import { IconCheck, IconUpload } from '@tabler/icons-react';
import { t } from '../../../i18n';
import type { PhotoFilter } from './photo-editor-model';
import { importPhotoLut, listPhotoLuts, type PhotoLutEntry } from './photo-lut-storage';
import { ScrollableToolRow } from './ScrollableToolRow';
import styles from './PhotoEditor.module.css';
const builtins: { id: PhotoFilter; label: string }[] = [
  { id: 'original', label: t('原图') },
  { id: 'vintage', label: t('复古') },
  { id: 'oceanic', label: t('清冷') },
  { id: 'monochrome', label: t('黑白') },
];
export function PhotoFilterOptions({
  selected,
  disabled,
  onChange,
}: {
  selected: PhotoFilter;
  disabled: boolean;
  onChange: (filter: PhotoFilter) => void;
}) {
  const [entries, setEntries] = useState<PhotoLutEntry[]>([]);
  const [importing, setImporting] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    let cancelled = false;
    void listPhotoLuts()
      .then((value) => {
        if (!cancelled) setEntries(value);
      })
      .catch(() => {
        if (!cancelled) setError(t('本地滤镜读取失败'));
      });
    return () => {
      cancelled = true;
    };
  }, []);
  async function importFiles(files: File[]) {
    setError('');
    setMessage('');
    if (files.length > 128) {
      setError(t('一次最多导入 128 个 LUT'));
      return;
    }
    setImporting(true);
    let count = 0;
    const failures: string[] = [];
    for (const file of files) {
      try {
        await importPhotoLut(file);
        count++;
      } catch {
        failures.push(file.name);
      }
    }
    try {
      setEntries(await listPhotoLuts());
    } catch {
      setError(t('本地滤镜读取失败'));
    }
    if (failures.length)
      setError(t('部分 LUT 导入失败：{{value1}}', { value1: failures.slice(0, 3).join('、') }));
    if (count) setMessage(t('已导入 {{value1}} 个 LUT，仅保存在此浏览器', { value1: count }));
    setImporting(false);
  }
  return (
    <>
      <div className={styles.adjustmentCategoryRow}>
        <span className={styles.panelHeading}>{t('照片滤镜')}</span>
        <button
          type="button"
          disabled={disabled || importing}
          onClick={() => input.current?.click()}
        >
          <IconUpload size={14} />
          {importing ? t('正在导入 LUT') : t('导入 LUT')}
        </button>
        <input
          ref={input}
          type="file"
          accept=".cube,.png"
          multiple
          hidden
          aria-label={t('导入 LUT')}
          disabled={disabled || importing}
          onChange={(event) => {
            const files = Array.from(event.target.files ?? []);
            event.target.value = '';
            if (files.length) void importFiles(files);
          }}
        />
      </div>
      <ScrollableToolRow className={styles.filters} label={t('照片滤镜')}>
        {[
          ...builtins,
          ...entries.map((entry) => ({ id: `lut:${entry.id}` as PhotoFilter, label: entry.name })),
        ].map(({ id, label }) => (
          <button
            type="button"
            key={id}
            aria-label={label}
            title={label}
            disabled={disabled}
            aria-pressed={selected === id}
            onClick={() => onChange(id)}
          >
            <span className={styles.swatch} data-filter={id.startsWith('lut:') ? 'personal' : id}>
              {id.startsWith('lut:') ? 'LUT' : null}
            </span>
            <span>{label}</span>
            {selected === id && <IconCheck size={14} />}
          </button>
        ))}
      </ScrollableToolRow>
      {error && (
        <p role="alert" className={styles.parameterHint}>
          {error}
        </p>
      )}
      {message && (
        <p role="status" className={styles.parameterHint}>
          {message}
        </p>
      )}
    </>
  );
}
