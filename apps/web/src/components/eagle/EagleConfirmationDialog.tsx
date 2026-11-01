import { useEffect, useId, useRef, type ReactNode } from 'react';
import styles from './EagleConfirmationDialog.module.css';

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
  useEffect(() => {
    const active = document.activeElement;
    if (active instanceof HTMLButtonElement && active.disabled && dialog.current?.contains(active))
      dialog.current.focus();
  });
  return (
    <dialog
      ref={dialog}
      tabIndex={-1}
      className={`${styles.dialog} ${className}`}
      role="alertdialog"
      aria-labelledby={titleId}
      aria-describedby={descriptionId}
      onKeyDown={(event) => {
        if (event.key !== 'Tab') return;
        const element = event.currentTarget;
        const controls = [
          ...element.querySelectorAll<HTMLElement>(
            'button:not(:disabled), a[href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])',
          ),
        ].filter((control) => !control.closest('[hidden], [inert]'));
        const first = controls[0],
          last = controls.at(-1);
        if (!first) {
          event.preventDefault();
          element.focus();
        } else if (
          event.shiftKey &&
          (document.activeElement === first || document.activeElement === element)
        ) {
          event.preventDefault();
          last?.focus();
        } else if (
          !event.shiftKey &&
          (document.activeElement === last || document.activeElement === element)
        ) {
          event.preventDefault();
          first.focus();
        }
      }}
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
