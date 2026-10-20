import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from 'react';
import { IconMenu2, IconX } from '@tabler/icons-react';
import { t } from '../../i18n';
import styles from './EagleLibraryNavigation.module.css';

const compactQuery = '(max-width: 720px)';
const compactSnapshot = () => window.matchMedia?.(compactQuery).matches ?? false;
const subscribeCompact = (changed: () => void) => {
  const media = window.matchMedia?.(compactQuery);
  media?.addEventListener('change', changed);
  return () => media?.removeEventListener('change', changed);
};

/** One navigation tree: a sidebar on desktop and a native modal drawer on narrow screens. */
export function EagleLibraryNavigation({
  children,
  header,
  label,
  className,
  headerClassName,
  activeKey,
  scopeKey,
}: {
  children: ReactNode | ((dismiss: () => void) => ReactNode);
  header: ReactNode;
  label: string;
  className: string;
  headerClassName: string;
  activeKey: string;
  scopeKey: string;
}) {
  const compact = useSyncExternalStore(subscribeCompact, compactSnapshot, () => false);
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const close = useCallback(() => setOpen(false), []);
  useEffect(close, [activeKey, scopeKey, compact, close]);
  const content = typeof children === 'function' ? children(close) : children;
  return (
    <nav className={`${className} ${styles.navigation}`} aria-label={label}>
      <div className={headerClassName}>
        {header}
        {compact && (
          <button
            ref={trigger}
            className={styles.toggle}
            type="button"
            aria-label={t('打开导航')}
            aria-expanded={open}
            onClick={() => setOpen(true)}
          >
            <IconMenu2 size={22} />
          </button>
        )}
      </div>
      {compact ? (
        <NavigationDrawer
          open={open}
          label={label}
          onClose={close}
          onClosed={() => trigger.current?.focus()}
        >
          {content}
        </NavigationDrawer>
      ) : (
        <div className={styles.content} data-navigation-content>
          {content}
        </div>
      )}
    </nav>
  );
}
function NavigationDrawer({
  open,
  children,
  label,
  onClose,
  onClosed,
}: {
  open: boolean;
  children: ReactNode;
  label: string;
  onClose: () => void;
  onClosed: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const returnFocus = useRef(onClosed);
  returnFocus.current = onClosed;
  useLayoutEffect(() => {
    const element = dialog.current;
    if (!element) return;
    if (open && !element.open) element.showModal();
    else if (!open && element.open) {
      element.close();
      returnFocus.current();
    }
  }, [open]);
  return (
    <dialog
      ref={dialog}
      className={styles.drawer}
      aria-label={label}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className={styles.heading}>
        <strong>{label}</strong>
        <button type="button" aria-label={t('关闭导航')} onClick={onClose}>
          <IconX size={22} />
        </button>
      </div>
      <div
        className={styles.content}
        data-navigation-content
        onClick={(event) => {
          if (
            event.target instanceof Element &&
            event.target.closest('[data-navigation-destination]')
          )
            onClose();
        }}
      >
        {children}
      </div>
    </dialog>
  );
}
