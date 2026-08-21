import { useEffect, useState } from 'react';
import { IconPlugConnected, IconRefresh, IconSettings } from '@tabler/icons-react';
import { getDesktopConnectionBridge, type DesktopConnectionStatus } from '../../lib/media-resolver';

const SLOT_LABELS = { LOCAL: '本地', LAN: '局域网', PUBLIC: '外网' } as const;

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
  const label = status?.activeSlot ? SLOT_LABELS[status.activeSlot] : '未连接';

  return (
    <div className="desktop-connection-controls" role="group" aria-label="桌面连接控制">
      <button
        className="desktop-connection-button"
        type="button"
        aria-label={`刷新当前页面，${label}连接`}
        title={`${status?.activeUrl ?? label} · 点击刷新当前页面`}
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
        aria-label="管理桌面连接"
        title="管理本地、局域网和外网连接"
        onClick={() => void bridge.openConnectionManager()}
      >
        <IconSettings aria-hidden="true" size={14} />
      </button>
    </div>
  );
}
