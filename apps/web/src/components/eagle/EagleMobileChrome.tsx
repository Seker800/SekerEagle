import type { ReactNode } from 'react';
import {
  IconPhoto,
  IconTags,
  IconMapPin,
  IconUsers,
  IconMenu2,
  IconSearch,
  IconX,
} from '@tabler/icons-react';
import type { LibraryMode } from '../../lib/library-api-scope';
import { t } from '../../i18n';
import styles from './EagleMobileChrome.module.css';
export type MobileDestination = 'timeline' | 'map' | 'people' | 'tags' | 'more';
/** Phone presentation only: destinations still select the shared workspace views. */
export function EagleMobileChrome({
  switcher,
  searchOpen,
  onSearch,
  tools,
  children,
}: {
  switcher: ReactNode;
  searchOpen: boolean;
  onSearch: () => void;
  tools: ReactNode;
  children: ReactNode;
}) {
  return (
    <>
      <header className={styles.header}>{tools}</header>
      {children}
      <div className={styles.dock}>
        <div className={styles.bottom}>
          <div className={styles.switcher}>{switcher}</div>
          <button
            className={styles.search}
            type="button"
            aria-label={searchOpen ? t('关闭搜索') : t('搜索')}
            aria-expanded={searchOpen}
            onClick={onSearch}
          >
            {searchOpen ? <IconX size={21} /> : <IconSearch size={21} />}
          </button>
        </div>
      </div>
    </>
  );
}

/** The same scoped destinations live inside the actions dropdown. */
export function EagleMobileNavigation({
  mode,
  active,
  onNavigate,
}: {
  mode: LibraryMode;
  active: MobileDestination;
  onNavigate: (destination: MobileDestination) => void;
}) {
  const destinations: { key: MobileDestination; label: string; icon: typeof IconPhoto }[] = [
    { key: 'timeline', label: mode === 'PHOTO' ? t('照片') : t('素材'), icon: IconPhoto },
    ...(mode === 'PHOTO'
      ? [
          { key: 'map' as const, label: t('地图'), icon: IconMapPin },
          { key: 'people' as const, label: t('人物'), icon: IconUsers },
        ]
      : [{ key: 'tags' as const, label: t('标签'), icon: IconTags }]),
    { key: 'more', label: t('更多'), icon: IconMenu2 },
  ];
  return (
    <nav data-dismiss-tools className={styles.destinations} aria-label={t('主导航')}>
      {destinations.map(({ key, label, icon: Icon }) => (
        <button
          type="button"
          key={key}
          aria-current={active === key ? 'page' : undefined}
          onClick={() => onNavigate(key)}
        >
          <Icon size={25} stroke={1.7} />
          <span>{label}</span>
        </button>
      ))}
    </nav>
  );
}
