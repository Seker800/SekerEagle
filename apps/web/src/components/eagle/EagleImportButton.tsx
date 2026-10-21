import { useId, useRef } from 'react';
import { CAMERA_MEDIA_FORMATS } from '@sekereagle/library-core';
import { IconUpload } from '@tabler/icons-react';
import { t } from '../../i18n';
import styles from './EagleImportButton.module.css';

const mediaAccept = CAMERA_MEDIA_FORMATS.map((format) => format.extension).join(',');
export function EagleImportButton({ onImport }: { onImport: (files: File[]) => Promise<void> }) {
  const input = useRef<HTMLInputElement>(null);
  const id = useId();
  return (
    <>
      <input
        id={id}
        ref={input}
        type="file"
        hidden
        multiple
        accept={mediaAccept}
        aria-label={t('选择导入文件')}
        onChange={(event) => {
          const files = Array.from(event.currentTarget.files ?? []);
          event.currentTarget.value = '';
          if (files.length) void onImport(files);
        }}
      />
      <button
        className={styles.button}
        type="button"
        aria-label={t('导入')}
        aria-controls={id}
        onClick={() => input.current?.click()}
      >
        <IconUpload size={18} />
        <span className={styles.label}>{t('导入')}</span>
      </button>
    </>
  );
}
