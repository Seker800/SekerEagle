export const desktopContentSecurityPolicy =
  "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: sekereagle-media:; media-src 'self' blob:; connect-src 'self' sekereagle-media:; font-src 'self' data:; object-src 'none'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'";

export function isAllowedMediaOrigin(serverUrl: string, origin: string | null): boolean {
  return origin === null || origin === new URL(serverUrl).origin;
}

export function mediaCorsHeaders(serverUrl: string): Record<string, string> {
  return {
    'access-control-allow-origin': new URL(serverUrl).origin,
    'access-control-allow-credentials': 'true',
    'access-control-expose-headers': 'X-SekerEagle-Cache-Result',
    vary: 'Origin',
  };
}

export function isAllowedAppNavigation(serverUrl: string, destination: string): boolean {
  try {
    const server = new URL(serverUrl);
    const target = new URL(destination);
    return (
      (target.protocol === 'https:' || target.protocol === 'http:') &&
      target.origin === server.origin
    );
  } catch {
    return false;
  }
}
