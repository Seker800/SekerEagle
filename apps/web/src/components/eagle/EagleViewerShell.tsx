import { useEffect, useRef, type ReactNode } from 'react';
import { IconChevronLeft, IconChevronRight, IconX } from '@tabler/icons-react';
import { t } from '../../i18n';
import styles from './EagleViewerShell.module.css';
export interface EagleViewerNavigation {
  previous?: () => void;
  next?: () => void;
  position: { current: number; total: number };
}
export function EagleViewerShell({
  title,
  subtitle,
  children,
  actions,
  collection,
  navigation,
  onClose,
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
  actions?: ReactNode;
  collection?: ReactNode;
  navigation?: EagleViewerNavigation;
  onClose: () => void;
}) {
  const dialog = useRef<HTMLElement>(null);
  const latest = useRef({ navigation, onClose });
  latest.current = { navigation, onClose };
  useEffect(() => {
    const previous = document.activeElement;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    dialog.current?.focus();
    const keydown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.ctrlKey || event.altKey || event.metaKey) return;
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopImmediatePropagation();
        latest.current.onClose();
        return;
      }
      if (
        event.target instanceof HTMLElement &&
        event.target.closest('input, textarea, select, [contenteditable="true"]')
      )
        return;
      const move =
        event.key === 'ArrowLeft'
          ? latest.current.navigation?.previous
          : event.key === 'ArrowRight'
            ? latest.current.navigation?.next
            : undefined;
      if (move) {
        event.preventDefault();
        event.stopImmediatePropagation();
        move();
      }
    };
    window.addEventListener('keydown', keydown);
    return () => {
      window.removeEventListener('keydown', keydown);
      document.body.style.overflow = overflow;
      if (previous instanceof HTMLElement && previous.isConnected) previous.focus();
    };
  }, []);
  return (
    <div className={styles.backdrop} onClick={onClose} role="presentation">
      <section
        ref={dialog}
        className={styles.dialog}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        onClick={(event) => event.stopPropagation()}
        onKeyDown={(event) => {
          if (event.key !== 'Tab') return;
          const controls = Array.from(
            event.currentTarget.querySelectorAll<HTMLElement>(
              'button:not(:disabled), summary, video[controls], [href], input:not(:disabled)',
            ),
          ).filter(
            (element) =>
              element.tabIndex >= 0 &&
              !element.closest('[hidden]') &&
              getComputedStyle(element).display !== 'none',
          );
          const first = controls[0],
            last = controls.at(-1);
          if (
            event.shiftKey &&
            (document.activeElement === first || document.activeElement === dialog.current)
          ) {
            event.preventDefault();
            last?.focus();
          } else if (
            !event.shiftKey &&
            (document.activeElement === last || document.activeElement === dialog.current)
          ) {
            event.preventDefault();
            first?.focus();
          }
        }}
      >
        <header className={styles.header}>
          <div className={styles.information}>
            <strong title={title}>{title}</strong>
            {subtitle && <span>{subtitle}</span>}
          </div>
          {navigation && (
            <span className={styles.counter} aria-live="polite" aria-atomic="true">
              {navigation.position.current}
              <span> / {navigation.position.total}</span>
            </span>
          )}
          <button
            className={styles.close}
            type="button"
            aria-label={t('关闭')}
            title={t('关闭')}
            onClick={onClose}
          >
            <IconX size={21} />
          </button>
        </header>
        <div className={styles.stage}>
          {children}
          {navigation && (
            <nav className={styles.navigation} aria-label={t('图片切换')}>
              <button
                type="button"
                aria-label={t('上一张')}
                disabled={!navigation.previous}
                onClick={navigation.previous}
              >
                <IconChevronLeft size={24} />
              </button>
              <button
                type="button"
                aria-label={t('下一张')}
                disabled={!navigation.next}
                onClick={navigation.next}
              >
                <IconChevronRight size={24} />
              </button>
            </nav>
          )}
        </div>
        <footer className={styles.footer}>
          {collection}
          {actions && (
            <div className={styles.actions} role="toolbar" aria-label={t('图片操作')}>
              {actions}
            </div>
          )}
        </footer>
      </section>
    </div>
  );
}
export function eagleViewerMetadata(asset: {
  format: string;
  width: number | null;
  height: number | null;
}) {
  return [
    asset.format.toUpperCase(),
    asset.width && asset.height ? `${asset.width} × ${asset.height}` : '',
  ]
    .filter(Boolean)
    .join(' · ');
}
