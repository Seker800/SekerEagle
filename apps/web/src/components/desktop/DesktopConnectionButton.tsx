import { getLocale, t } from '../../i18n';
import { useCallback, useEffect, useRef, useState } from 'react';
import { IconPlugConnected, IconRefresh, IconSettings } from '@tabler/icons-react';
import { getDesktopConnectionBridge, type DesktopConnectionStatus } from '../../lib/media-resolver';
const SLOT_LABELS = {
  LOCAL: t('本地'),
  LAN: t('局域网'),
  PUBLIC: t('外网'),
} as const;
export type DesktopPageConnection = 'checking' | 'online' | 'offline';
type StatusPhase = 'loading' | 'ready' | 'unavailable';
type ConnectionTone = 'online' | 'offline' | 'unknown';
export function DesktopConnectionButton({
  pageConnection,
  reloadPage = () => window.location.reload(),
}: {
  pageConnection: DesktopPageConnection;
  reloadPage?: () => void;
}) {
  const bridge = getDesktopConnectionBridge();
  const [appVersion, setAppVersion] = useState<string | null>(null);
  const [status, setStatus] = useState<DesktopConnectionStatus | null>(null);
  const [phase, setPhase] = useState<StatusPhase>('loading');
  const latestRequest = useRef(0);
  const refreshStatus = useCallback(() => {
    if (!bridge) return;
    const request = latestRequest.current + 1;
    latestRequest.current = request;
    void bridge
      .getConnectionStatus()
      .then((next) => {
        if (latestRequest.current !== request) return;
        setStatus(next);
        setPhase('ready');
      })
      .catch(() => {
        if (latestRequest.current !== request) return;
        setStatus(null);
        setPhase('unavailable');
      });
  }, [bridge]);
  useEffect(() => {
    if (!bridge) return;
    void bridge
      .getAppInfo?.()
      .then((info) => setAppVersion(info.version))
      .catch(() => setAppVersion(null));
  }, [bridge]);
  useEffect(() => {
    refreshStatus();
  }, [refreshStatus]);
  useEffect(() => {
    if (!bridge) return;
    const refresh = () => {
      if (document.visibilityState === 'hidden') return;
      refreshStatus();
    };
    window.addEventListener('focus', refresh);
    window.addEventListener('online', refresh);
    window.addEventListener('pageshow', refresh);
    document.addEventListener('visibilitychange', refresh);
    return () => {
      window.removeEventListener('focus', refresh);
      window.removeEventListener('online', refresh);
      window.removeEventListener('pageshow', refresh);
      document.removeEventListener('visibilitychange', refresh);
    };
  }, [bridge, refreshStatus]);
  if (!bridge) return null;
  const view = connectionView(status, phase, pageConnection);
  const titleValue =
    view.tone === 'online' && !status?.activeSlot
      ? t('当前页面连接正常，桌面尚未确认线路')
      : view.tone === 'offline'
        ? view.label
        : (status?.activeUrl ?? view.label);
  return (
    <div className="desktop-connection-controls" role="group" aria-label={t('桌面连接控制')}>
      <span>
        {appVersion
          ? t('客户端 {{value1}}', { value1: appVersion })
          : t('旧版客户端（版本不可用）')}
      </span>
      <button
        className="desktop-connection-button"
        type="button"
        aria-label={t('刷新当前页面 · {{value1}}', {
          value1: view.label,
        })}
        title={t('{{value1}} · 点击刷新当前页面', {
          value1: titleValue,
        })}
        onClick={reloadPage}
      >
        <span
          aria-hidden="true"
          className={
            view.tone === 'online'
              ? 'is-online'
              : view.tone === 'unknown'
                ? 'is-unknown'
                : undefined
          }
        />
        <IconPlugConnected size={15} />
        {view.label}
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
function connectionView(
  status: DesktopConnectionStatus | null,
  phase: StatusPhase,
  pageConnection: DesktopPageConnection,
): { label: string; tone: ConnectionTone } {
  if (pageConnection === 'offline') return { label: t('未连接'), tone: 'offline' };
  if (status?.activeSlot) return { label: SLOT_LABELS[status.activeSlot], tone: 'online' };
  if (pageConnection === 'online') return { label: t('已连接'), tone: 'online' };
  if (phase === 'unavailable') return { label: t('连接状态未知'), tone: 'unknown' };
  if (phase === 'loading' || pageConnection === 'checking') {
    return { label: t('正在检测连接…'), tone: 'unknown' };
  }
  return { label: t('未连接'), tone: 'offline' };
}
