import { isIP } from 'node:net';
import { DEFAULT_DESKTOP_SERVER_URL } from './app-config';

const FORBIDDEN_SEKERCHAT_HOST = '192.168.31.89';
const DEPLOYMENT_ID = /^[0-9a-f]{64}$/u;
const MAX_URL_LENGTH = 2048;

export const CONNECTION_SLOTS = ['LOCAL', 'LAN', 'PUBLIC'] as const;
export type ConnectionSlot = (typeof CONNECTION_SLOTS)[number];
export type ConnectionMode = 'AUTO' | ConnectionSlot;

export interface DesktopConnectionSettings {
  mode: ConnectionMode;
  localUrl: string;
  lanUrl: string;
  publicUrl: string;
  allowInsecureLan: boolean;
  allowInsecurePublicHttp: boolean;
  deploymentId: string | null;
  activeSlot: ConnectionSlot | null;
}

export const DEFAULT_CONNECTION_SETTINGS: DesktopConnectionSettings = Object.freeze({
  mode: 'AUTO',
  localUrl: DEFAULT_DESKTOP_SERVER_URL,
  lanUrl: '',
  publicUrl: '',
  allowInsecureLan: false,
  allowInsecurePublicHttp: false,
  deploymentId: null,
  activeSlot: null,
});

export function connectionSettingsForServerUrl(serverUrl: string): DesktopConnectionSettings {
  const url = new URL(serverUrl);
  const loopback = isLoopback(unbracket(url.hostname.toLowerCase()));
  return normalizeConnectionSettings({
    ...DEFAULT_CONNECTION_SETTINGS,
    localUrl: loopback ? serverUrl : '',
    publicUrl: loopback ? '' : serverUrl,
  });
}

export function normalizeConnectionSettings(input: unknown): DesktopConnectionSettings {
  const value = isRecord(input) ? input : {};
  const mode = parseMode(value.mode);
  const allowInsecureLan = value.allowInsecureLan === true;
  const allowInsecurePublicHttp = value.allowInsecurePublicHttp === true;
  const settings: DesktopConnectionSettings = {
    mode,
    localUrl: normalizeSlotUrl(
      'LOCAL',
      stringOrDefault(value.localUrl, DEFAULT_DESKTOP_SERVER_URL),
      {
        allowInsecureLan,
        allowInsecurePublicHttp,
      },
    ),
    lanUrl: normalizeSlotUrl('LAN', stringOrDefault(value.lanUrl, ''), {
      allowInsecureLan,
      allowInsecurePublicHttp,
    }),
    publicUrl: normalizeSlotUrl('PUBLIC', stringOrDefault(value.publicUrl, ''), {
      allowInsecureLan,
      allowInsecurePublicHttp,
    }),
    allowInsecureLan,
    allowInsecurePublicHttp,
    deploymentId: parseDeploymentId(value.deploymentId),
    activeSlot: parseActiveSlot(value.activeSlot),
  };
  if (!configuredSlots(settings).length) throw new Error('至少需要配置一个服务器地址。');
  if (mode !== 'AUTO' && !connectionUrl(settings, mode)) {
    throw new Error('所选连接地址尚未配置。');
  }
  if (settings.activeSlot && !connectionUrl(settings, settings.activeSlot)) {
    settings.activeSlot = null;
  }
  return settings;
}

export function configuredSlots(settings: DesktopConnectionSettings): ConnectionSlot[] {
  return CONNECTION_SLOTS.filter((slot) => Boolean(connectionUrl(settings, slot)));
}

export function connectionUrl(settings: DesktopConnectionSettings, slot: ConnectionSlot): string {
  if (slot === 'LOCAL') return settings.localUrl;
  if (slot === 'LAN') return settings.lanUrl;
  return settings.publicUrl;
}

function normalizeSlotUrl(
  slot: ConnectionSlot,
  input: string,
  options: { allowInsecureLan: boolean; allowInsecurePublicHttp: boolean },
): string {
  const trimmed = input.trim();
  if (!trimmed) return '';
  const label = connectionSlotLabel(slot);
  if (trimmed.length > MAX_URL_LENGTH) throw new Error(`${label}地址过长。`);
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    throw new Error(`${label}地址无效，请只填写完整的 HTTP(S) 地址。`);
  }
  if (!['http:', 'https:'].includes(url.protocol)) {
    throw new Error(`${label}地址必须使用 HTTP 或 HTTPS。`);
  }
  if (url.username || url.password) throw new Error(`${label}地址不能包含用户名或密码。`);
  if (url.search || url.hash) throw new Error(`${label}地址不能包含查询参数或锚点。`);
  if (url.pathname !== '/' && url.pathname !== '') {
    throw new Error(`${label}地址不能包含子路径或末尾标点。示例：http://yuntai.design:8180`);
  }

  const hostname = unbracket(url.hostname.toLowerCase());
  if (hostname === FORBIDDEN_SEKERCHAT_HOST) throw new Error('禁止连接受保护的外部系统。');
  const loopback = isLoopback(hostname);

  if (slot === 'LOCAL') {
    if (!loopback) throw new Error('本地地址必须使用 loopback 主机。');
    if (url.protocol === 'http:' && hostname !== 'localhost') url.hostname = 'localhost';
  } else if (slot === 'LAN') {
    if (loopback) throw new Error('局域网地址不能使用 loopback 主机。');
    if (url.protocol === 'http:' && (!options.allowInsecureLan || !isPrivateIp(hostname))) {
      throw new Error('局域网 HTTP 仅允许显式启用的私有 IP。');
    }
  } else {
    if (loopback) throw new Error('外网地址不能使用 loopback 主机。');
    if (url.protocol === 'http:' && !options.allowInsecurePublicHttp) {
      throw new Error('外网 HTTP 仅允许在明确接受明文传输风险后启用。');
    }
  }
  return url.origin;
}

function parseMode(value: unknown): ConnectionMode {
  return value === 'LOCAL' || value === 'LAN' || value === 'PUBLIC' || value === 'AUTO'
    ? value
    : 'AUTO';
}

function parseActiveSlot(value: unknown): ConnectionSlot | null {
  return value === 'LOCAL' || value === 'LAN' || value === 'PUBLIC' ? value : null;
}

function parseDeploymentId(value: unknown): string | null {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value !== 'string' || !DEPLOYMENT_ID.test(value)) {
    throw new Error('图库部署身份无效。');
  }
  return value;
}

function stringOrDefault(value: unknown, fallback: string): string {
  if (value === undefined) return fallback;
  if (typeof value !== 'string') throw new Error('服务器地址必须是字符串。');
  return value;
}

function isLoopback(hostname: string): boolean {
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1';
}

function isPrivateIp(hostname: string): boolean {
  const version = isIP(hostname);
  if (version === 4) {
    const [first = Number.NaN, second = Number.NaN] = hostname.split('.').map(Number);
    return (
      first === 10 ||
      (first === 172 && second >= 16 && second <= 31) ||
      (first === 192 && second === 168) ||
      (first === 169 && second === 254) ||
      (first === 100 && second >= 64 && second <= 127)
    );
  }
  return version === 6 && (/^f[cd]/u.test(hostname) || /^fe[89ab]/u.test(hostname));
}

function unbracket(hostname: string): string {
  return hostname.replace(/^\[|\]$/gu, '');
}

function connectionSlotLabel(slot: ConnectionSlot): string {
  if (slot === 'LOCAL') return '本地';
  if (slot === 'LAN') return '局域网';
  return '外网';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
