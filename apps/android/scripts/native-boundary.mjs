/** Deliberately narrow structural gate; runtime mode and auth contracts remain separately tested. */
export function assertNativeBoundary(files) {
  const manifest = files.get('app/src/main/AndroidManifest.xml') ?? '';
  const activities = [...manifest.matchAll(/<activity\b([^>]+)>([\s\S]*?)<\/activity>/g)];
  const launcher = activities.filter(([, , body]) =>
    body.includes('android.intent.category.LAUNCHER'),
  );
  if (launcher.length !== 1 || !launcher[0][1].includes('".NativeActivity"'))
    throw new Error('The only launcher must be NativeActivity.');
  if (
    !/android:exported="false"/.test(
      activities.find(([, attr]) => attr.includes('".MainActivity"'))?.[1] ?? '',
    )
  )
    throw new Error('The legacy preview must not be exported.');
  for (const [path, source] of files) {
    if (!path.startsWith('app/src/main/kotlin/') || !path.endsWith('.kt')) continue;
    if (/import\s+android\.webkit\b|\bWebView\s*\(/.test(source))
      throw new Error('Native Kotlin surfaces must not import or create a WebView.');
    if (/Native(?:Photo|Material)(?:Repository|Viewer|Gallery)/.test(source))
      throw new Error('Both modes must use the shared native gallery implementation.');
  }
  const repository =
    files.get('app/src/main/kotlin/com/sekereagle/android/NativeGalleryRepository.kt') ?? '';
  if (
    !repository.includes('NativeGalleryPolicy.listPath(mode.name') ||
    !repository.includes('NativeGalleryPolicy.mediaPath(mode.name')
  )
    throw new Error('Native repository must bind list and derived media to the same mode policy.');
}
