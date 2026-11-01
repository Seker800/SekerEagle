import { EagleConfirmationDialog } from './EagleConfirmationDialog';
import { t } from '../../i18n';
import styles from './EagleTrashConfirmation.module.css';
export function EagleTrashConfirmation({
  mode,
  onClose,
  onConfirm,
}: {
  mode: 'MATERIAL' | 'PHOTO';
  onClose: () => void;
  onConfirm: () => void;
}) {
  return (
    <EagleConfirmationDialog
      title={t('确认清空回收站')}
      description={
        <>
          <p>{mode === 'PHOTO' ? t('照片库') : t('素材库')}</p>
          <p>{t('将永久删除当前图库回收站中的全部项目，包括尚未加载的项目。此操作无法撤销。')}</p>
        </>
      }
      onCancel={onClose}
      actions={
        <>
          <button type="button" onClick={onClose}>
            {t('取消')}
          </button>
          <button type="button" className={styles.danger} onClick={onConfirm}>
            {t('确认永久删除')}
          </button>
        </>
      }
    />
  );
}
