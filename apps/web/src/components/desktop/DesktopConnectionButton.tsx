import { useEffect, useState } from 'react';
import { IconPlugConnected } from '@tabler/icons-react';
import { getDesktopConnectionBridge, type DesktopConnectionStatus } from '../../lib/media-resolver';

const SLOT_LABELS = { LOCAL: '本地', LAN: '局域网', PUBLIC: '外网' } as const;

export function DesktopConnectionButton() {
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
  const latency = status?.latencyMs;
  const accessible = `桌面连接：${label}${latency === null || latency === undefined ? '' : `，${Math.round(latency)} 毫秒`}`;

  return (
    <button
      className="desktop-connection-button"
      type="button"
      aria-label={accessible}
      title={status?.activeUrl ?? '管理桌面连接'}
      onClick={() => void bridge.openConnectionManager()}
    >
      <span aria-hidden="true" className={status?.activeSlot ? 'is-online' : undefined} />
      <IconPlugConnected size={15} />
      {label}
      {latency === null || latency === undefined ? null : <small>{Math.round(latency)}ms</small>}
    </button>
  );
}
