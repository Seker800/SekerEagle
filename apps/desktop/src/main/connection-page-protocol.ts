export interface ConnectionPageAsset {
  file: string;
  type: string;
}

const ASSETS: Readonly<Record<string, ConnectionPageAsset>> = Object.freeze({
  '/': { file: 'index.html', type: 'text/html; charset=utf-8' },
  '/connection.js': { file: 'connection.js', type: 'text/javascript; charset=utf-8' },
  '/connection.css': { file: 'connection.css', type: 'text/css; charset=utf-8' },
});

export function connectionPageAsset(input: string): ConnectionPageAsset | null {
  const url = parseConnectionPageUrl(input);
  return url ? (ASSETS[url.pathname] ?? null) : null;
}

export function isConnectionPageUrl(input: string): boolean {
  const url = parseConnectionPageUrl(input);
  return url?.pathname === '/';
}

function parseConnectionPageUrl(input: string): URL | null {
  try {
    const url = new URL(input);
    return url.protocol === 'sekereagle-app:' && url.hostname === 'connection' ? url : null;
  } catch {
    return null;
  }
}
