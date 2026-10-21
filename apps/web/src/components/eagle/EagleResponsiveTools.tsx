import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { IconAdjustmentsHorizontal, IconDotsVertical } from '@tabler/icons-react';
import { t } from '../../i18n';
import { useCompactLayout } from '../../hooks/useCompactLayout';
import styles from './EagleResponsiveTools.module.css';
export function EagleResponsiveTools({
  children,
  panel,
  actions,
  scopeKey,
  className,
  count = 0,
}: {
  children: ReactNode;
  panel?: ReactNode;
  actions?: ReactNode;
  scopeKey: string;
  className?: string;
  count?: number;
}) {
  const compact = useCompactLayout();
  const [open, setOpen] = useState<'view' | 'actions' | null>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => setOpen(null), [compact, scopeKey]);
  useLayoutEffect(() => {
    const element = dialog.current;
    if (!element) return;
    if (open && !element.open) element.showModal();
    else if (!open && element.open) {
      element.close();
      trigger.current?.focus();
    }
  }, [open, compact]);
  const label = open === 'actions' ? t('更多操作') : t('视图与筛选');
  if (!compact) return <div className={className}>{children}</div>;
  return (
    <>
      {(['view', ...(actions ? ['actions' as const] : [])] as const).map((kind) => (
        <button
          type="button"
          key={kind}
          className={styles.trigger}
          aria-label={kind === 'view' ? t('视图与筛选') : t('更多操作')}
          aria-haspopup="dialog"
          aria-expanded={open === kind}
          onClick={(event) => {
            trigger.current = event.currentTarget;
            setOpen(kind);
          }}
        >
          {kind === 'view' ? (
            <IconAdjustmentsHorizontal size={23} />
          ) : (
            <IconDotsVertical size={23} />
          )}
          {kind === 'view' && count > 0 && <span>{count}</span>}
        </button>
      ))}
      <dialog
        ref={dialog}
        className={styles.sheet}
        aria-label={label}
        onCancel={(event) => {
          event.preventDefault();
          setOpen(null);
        }}
        onClick={(event) => {
          if (event.target === event.currentTarget) setOpen(null);
        }}
      >
        <header>
          <h2>{label}</h2>
          <button type="button" onClick={() => setOpen(null)}>
            {t('完成')}
          </button>
        </header>
        <div
          className={`${className ?? ''} ${styles.controls}`}
          onClick={(event) => {
            if (event.target instanceof Element && event.target.closest('[data-dismiss-tools]'))
              setOpen(null);
          }}
        >
          {open === 'actions' ? actions : children}
        </div>
        {open !== 'actions' && panel && <section className={styles.panel}>{panel}</section>}
      </dialog>
    </>
  );
}
