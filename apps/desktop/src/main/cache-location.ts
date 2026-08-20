import path from 'node:path';

export function desktopCacheRoot(options: {
  platform: NodeJS.Platform;
  home: string;
  appData: string;
  localAppData?: string;
  xdgCacheHome?: string;
}): string {
  const paths = options.platform === 'win32' ? path.win32 : path.posix;
  const base =
    options.platform === 'darwin'
      ? paths.join(options.home, 'Library', 'Caches')
      : options.platform === 'win32'
        ? absoluteOrFallback(paths, options.localAppData, options.appData)
        : absoluteOrFallback(paths, options.xdgCacheHome, paths.join(options.home, '.cache'));
  return paths.join(base, 'SekerEagle', 'MediaCache', 'v2');
}

function absoluteOrFallback(
  paths: typeof path.posix | typeof path.win32,
  candidate: string | undefined,
  fallback: string,
): string {
  return candidate && paths.isAbsolute(candidate) ? candidate : fallback;
}
