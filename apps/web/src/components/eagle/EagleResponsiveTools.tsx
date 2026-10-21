import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { IconDotsVertical } from '@tabler/icons-react';
import { t } from '../../i18n';
import { useCompactLayout } from '../../hooks/useCompactLayout';
import styles from './EagleResponsiveTools.module.css';
export function EagleResponsiveTools({
  children,
  panel,
  scopeKey,
  className,
  count = 0,
}: {
  children: ReactNode;
  panel?: ReactNode;
  scopeKey: string;
  className?: string;
  count?: number;
}) {
  const compact = useCompactLayout();
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => setOpen(false), [compact, scopeKey]);
  useLayoutEffect(() => {
    const element = dialog.current;
    if (!element) return;
    if (open && !element.open) element.showModal();
    else if (!open && element.open) {
      element.close();
      trigger.current?.focus();
    }
  }, [open, compact]);
  if (!compact) return <div className={className}>{children}</div>;
  return (
    <>
      <button
        type="button"
        ref={trigger}
        className={styles.trigger}
        aria-label={t('视图与筛选')}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen(true)}
      >
        <IconDotsVertical size={20} />
        {count > 0 && <span>{count}</span>}
      </button>
      <dialog
        ref={dialog}
        className={styles.sheet}
        aria-label={t('视图与筛选')}
        onCancel={(event) => {
          event.preventDefault();
          setOpen(false);
        }}
        onClick={(event) => {
          if (event.target === event.currentTarget) setOpen(false);
        }}
      >
        <div className={styles.handle} aria-hidden="true" />
        <header>
          <h2>{t('视图与筛选')}</h2>
          <button type="button" onClick={() => setOpen(false)}>
            {t('完成')}
          </button>
        </header>
        <div
          className={`${className ?? ''} ${styles.controls}`}
          onClick={(event) => {
            if (event.target instanceof Element && event.target.closest('[data-dismiss-tools]'))
              setOpen(false);
          }}
        >
          {children}
        </div>
        {panel && <section className={styles.panel}>{panel}</section>}
      </dialog>
    </>
  );
}
