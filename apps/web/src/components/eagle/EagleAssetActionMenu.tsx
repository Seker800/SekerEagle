import { useEffect, useRef, type CSSProperties, type ReactNode } from 'react';
import { t } from '../../i18n';
import styles from './EagleAssetActionMenu.module.css';

/** Shared menu for right-click and explicit touch actions; domain actions stay with the caller. */
export function EagleAssetActionMenu({
  position,
  count,
  onClose,
  children,
}: {
  position: { x: number; y: number };
  count: number;
  onClose: () => void;
  children: ReactNode;
}) {
  const menu = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const previous = document.activeElement;
    menu.current?.querySelector<HTMLElement>('[role="menuitem"]:not(:disabled)')?.focus();
    return () => {
      if (previous instanceof HTMLElement && previous.isConnected) previous.focus();
    };
  }, []);
  return (
    <>
      <button
        className={styles.dismiss}
        type="button"
        tabIndex={-1}
        aria-label={t('关闭素材操作菜单')}
        onClick={onClose}
        onContextMenu={(event) => {
          event.preventDefault();
          onClose();
        }}
      />
      <div
        ref={menu}
        className={styles.menu}
        role="menu"
        aria-label={t('素材操作')}
        style={{ '--menu-x': `${position.x}px`, '--menu-y': `${position.y}px` } as CSSProperties}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.preventDefault();
            event.stopPropagation();
            onClose();
            return;
          }
          if (event.key === 'Tab') {
            onClose();
            return;
          }
          if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
          const items = Array.from(
            event.currentTarget.querySelectorAll<HTMLElement>('[role="menuitem"]:not(:disabled)'),
          );
          if (!items.length) return;
          event.preventDefault();
          event.stopPropagation();
          const current = items.indexOf(document.activeElement as HTMLElement);
          const next =
            event.key === 'Home'
              ? 0
              : event.key === 'End'
                ? items.length - 1
                : (current + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
          items[next]?.focus();
        }}
      >
        <div className={styles.title}>{t('已选择 {{value1}} 项', { value1: count })}</div>
        {children}
      </div>
    </>
  );
}
