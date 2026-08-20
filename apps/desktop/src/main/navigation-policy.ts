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
