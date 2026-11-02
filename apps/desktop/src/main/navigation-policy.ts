export const desktopContentSecurityPolicy =
  "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: sekereagle-media:; media-src 'self' blob:; connect-src 'self' sekereagle-media:; font-src 'self' data:; object-src 'none'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'";

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
