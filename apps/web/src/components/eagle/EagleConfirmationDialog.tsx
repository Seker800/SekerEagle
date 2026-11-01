import { useEffect, useId, useRef, type ReactNode } from 'react';
import styles from './EagleTrashConfirmation.module.css';

/** Native modal focus/escape protocol; callers own the decision, copy and async state. */
export function EagleConfirmationDialog({
  title,
  description,
  children,
  actions,
  onCancel,
  className = '',
}: {
  title: ReactNode;
  description: ReactNode;
  children?: ReactNode;
  actions: ReactNode;
  onCancel: () => void;
  className?: string;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId(),
    descriptionId = useId();
  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const element = dialog.current;
    if (element?.showModal) element.showModal();
    else element?.setAttribute('open', '');
    (element?.querySelector<HTMLElement>('button:not(:disabled)') ?? element)?.focus();
    return () => {
      element?.close?.();
      if (previous?.isConnected) previous.focus({ preventScroll: true });
    };
  }, []);
  return (
    <dialog
      ref={dialog}
      tabIndex={-1}
      className={`${styles.dialog} ${className}`}
      role="alertdialog"
      aria-labelledby={titleId}
      aria-describedby={descriptionId}
      onCancel={(event) => {
        event.preventDefault();
        event.stopPropagation();
        onCancel();
      }}
    >
      <h2 id={titleId}>{title}</h2>
      <div id={descriptionId}>{description}</div>
      {children}
      <footer>{actions}</footer>
    </dialog>
  );
}
