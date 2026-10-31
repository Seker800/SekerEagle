import { useEffect, useRef } from 'react';
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
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const element = dialog.current;
    if (element?.showModal) element.showModal();
    else element?.setAttribute('open', '');
    element?.querySelector<HTMLButtonElement>('button')?.focus();
    return () => {
      element?.close?.();
      previous?.focus();
    };
  }, []);
  return (
    <dialog
      ref={dialog}
      className={styles.dialog}
      role="alertdialog"
      aria-labelledby="empty-trash-title"
      aria-describedby="empty-trash-description"
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
    >
      <h2 id="empty-trash-title">{t('确认清空回收站')}</h2>
      <p>{mode === 'PHOTO' ? t('照片库') : t('素材库')}</p>
      <p id="empty-trash-description">
        {t('将永久删除当前图库回收站中的全部项目，包括尚未加载的项目。此操作无法撤销。')}
      </p>
      <footer>
        <button type="button" onClick={onClose}>
          {t('取消')}
        </button>
        <button type="button" className={styles.danger} onClick={onConfirm}>
          {t('确认永久删除')}
        </button>
      </footer>
    </dialog>
  );
}
