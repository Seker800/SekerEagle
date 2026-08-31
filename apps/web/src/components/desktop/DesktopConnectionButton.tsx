import { getLocale, t } from '../../i18n';
import { useEffect, useState } from 'react';
import { IconPlugConnected, IconRefresh, IconSettings } from '@tabler/icons-react';
import { getDesktopConnectionBridge, type DesktopConnectionStatus } from '../../lib/media-resolver';
const SLOT_LABELS = {
  LOCAL: t('本地'),
  LAN: t('局域网'),
  PUBLIC: t('外网'),
} as const;
export function DesktopConnectionButton({
  reloadPage = () => window.location.reload(),
}: {
  reloadPage?: () => void;
}) {
  const bridge = getDesktopConnectionBridge();
  const [status, setStatus] = useState<DesktopConnectionStatus | null>(null);
  useEffect(() => {
    if (!bridge) return;
    void bridge
      .getConnectionStatus()
      .then(setStatus)
      .catch(() => setStatus(null));
  }, [bridge]);
  if (!bridge) return null;
  const label = status?.activeSlot ? SLOT_LABELS[status.activeSlot] : t('未连接');
  return (
    <div className="desktop-connection-controls" role="group" aria-label={t('桌面连接控制')}>
      <button
        className="desktop-connection-button"
        type="button"
        aria-label={t('刷新当前页面，{{value1}}连接', {
          value1: label,
        })}
        title={t('{{value1}} · 点击刷新当前页面', {
          value1: status?.activeUrl ?? label,
        })}
        onClick={reloadPage}
      >
        <span aria-hidden="true" className={status?.activeSlot ? 'is-online' : undefined} />
        <IconPlugConnected size={15} />
        {label}
        <IconRefresh aria-hidden="true" size={14} />
      </button>
      <button
        className="desktop-connection-settings"
        type="button"
        aria-label={t('管理桌面连接')}
        title={t('管理本地、局域网和外网连接')}
        onClick={() => void bridge.openConnectionManager(getLocale())}
      >
        <IconSettings aria-hidden="true" size={14} />
      </button>
    </div>
  );
}
