import { useLayoutEffect, useRef, type ReactNode } from 'react';
import { useCompactLayout } from '../../hooks/useCompactLayout';
import styles from './EagleResponsiveDetails.module.css';
/** Rehosts the same inspector as a phone sheet, retaining the desktop sidebar. */
export function EagleResponsiveDetails({
  children,
  label,
  onClose,
}: {
  children: ReactNode;
  label: string;
  onClose: () => void;
}) {
  const compact = useCompactLayout();
  const dialog = useRef<HTMLDialogElement>(null);
  useLayoutEffect(() => {
    if (compact && dialog.current && !dialog.current.open) dialog.current.showModal();
  }, [compact]);
  if (!compact) return <>{children}</>;
  return (
    <dialog
      className={styles.sheet}
      aria-label={label}
      ref={dialog}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      {children}
    </dialog>
  );
}
