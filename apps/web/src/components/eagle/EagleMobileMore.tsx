import {
  IconCloudUpload,
  IconDeviceMobile,
  IconSettings,
  IconLogout,
  IconChevronRight,
  IconUser,
  IconServer,
} from '@tabler/icons-react';
import { t } from '../../i18n';
import styles from './EagleMobileMore.module.css';
export const isAndroidClient = () => /SekerEagleAndroid\//.test(navigator.userAgent);
export function EagleMobileMore({
  email,
  origin,
  native,
  onSettings,
  onLogout,
}: {
  email: string;
  origin: string;
  native: boolean;
  onSettings: () => void;
  onLogout: () => void;
}) {
  const row = (title: string, Icon: typeof IconUser) => (
    <>
      <Icon size={23} />
      <span>{title}</span>
      <IconChevronRight size={19} />
    </>
  );
  return (
    <section className={styles.more} aria-label={t('更多')}>
      <div className={styles.identity}>
        <IconUser size={32} />
        <div>
          <strong>{email}</strong>
          <span>
            <IconServer size={14} />
            {origin}
          </span>
        </div>
        {native && (
          <a href="/_native/account" aria-label={t('连接设置')}>
            <IconChevronRight size={21} />
          </a>
        )}
      </div>
      <div className={styles.actions}>
        {native ? (
          <a href="/_native/backup">{row(t('备份'), IconCloudUpload)}</a>
        ) : (
          <button disabled>{row(t('备份'), IconCloudUpload)}</button>
        )}
        {native ? (
          <a href="/_native/cleanup">{row(t('释放空间'), IconDeviceMobile)}</a>
        ) : (
          <button disabled>{row(t('释放空间'), IconDeviceMobile)}</button>
        )}
        <button type="button" onClick={onSettings}>
          {row(t('设置'), IconSettings)}
        </button>
        <button type="button" onClick={onLogout}>
          {row(t('退出'), IconLogout)}
        </button>
      </div>
      {!native && <p className={styles.hint}>{t('手机备份与释放空间请在安卓应用中使用。')}</p>}
    </section>
  );
}
