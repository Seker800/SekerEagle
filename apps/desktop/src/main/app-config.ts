const FORBIDDEN_SEKERCHAT_HOST = '192.168.31.89';

export const DEFAULT_DESKTOP_SERVER_URL = 'http://localhost:8180';

export function normalizeDesktopServerUrl(input: string): string {
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    throw new Error('SekerEagle 服务器地址无效。');
  }
  if (
    (url.protocol !== 'http:' && url.protocol !== 'https:') ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    (url.pathname !== '/' && url.pathname !== '')
  ) {
    throw new Error('服务器地址必须是无凭据、查询和子路径的 HTTP(S) origin。');
  }
  const hostname = url.hostname.toLowerCase();
  if (hostname === FORBIDDEN_SEKERCHAT_HOST) throw new Error('禁止连接受保护的外部系统。');
  const loopbackIp = hostname === '127.0.0.1' || hostname === '[::1]' || hostname === '::1';
  const loopback = hostname === 'localhost' || loopbackIp;
  if (url.protocol !== 'https:' && !loopback) {
    throw new Error('非 loopback 服务器必须使用 HTTPS。');
  }
  if (url.protocol === 'http:' && loopbackIp) url.hostname = 'localhost';
  return url.origin;
}
