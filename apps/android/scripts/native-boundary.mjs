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
    if (path === 'app/src/main/kotlin/com/sekereagle/android/NativeEditor.kt') {
      if (
        !source.includes('val editorOrigin = "https://${repo.editorHost}"') ||
        !source.includes('settings.allowFileAccess = false') ||
        !source.includes('uri.host != repo.editorHost') ||
        !source.includes('request.method != "GET"') ||
        !source.includes('shouldOverrideUrlLoading') ||
        !source.includes('context.assets.open("editor$path")') ||
        source.includes('CookieManager') ||
        /loadUrl\(/g[Symbol.match](source)?.length !== 1 ||
        /loadUrl\(.*session/.test(source)
      )
        throw new Error('Editor must use only bundled offline content.');
      continue;
    }
    if (/import\s+android\.webkit\b|\bWebView\s*\(/.test(source))
      throw new Error('Native Kotlin surfaces must not import or create a WebView.');
    if (/Native(?:Photo|Material)(?:Repository|Viewer|Gallery)/.test(source))
      throw new Error('Both modes must use the shared native gallery implementation.');
  }
  const model =
    files.get('app/src/main/kotlin/com/sekereagle/android/NativeGalleryViewModel.kt') ?? '';
  const screen =
    files.get('app/src/main/kotlin/com/sekereagle/android/NativeGalleryScreen.kt') ?? '';
  if (!model.includes('NativeTransferManager.get(') || /\bNativeUploads\s*\(/.test(model))
    throw new Error('Manual uploads must belong to the application transfer manager.');
  if (screen.includes('NativeUploadDialog('))
    throw new Error('Upload progress must not block gallery browsing.');
  if (
    !/<service\b[^>]*android:name="\.NativeUploadService"[^>]*android:exported="false"[^>]*android:foregroundServiceType="dataSync"/.test(
      manifest,
    )
  )
    throw new Error('Background uploads require a private dataSync foreground service.');
  const repository =
    files.get('app/src/main/kotlin/com/sekereagle/android/NativeGalleryRepository.kt') ?? '';
  if (
    !repository.includes('NativeGalleryPolicy.listPath(mode.name') ||
    !repository.includes('NativeGalleryPolicy.mediaPath(mode.name')
  )
    throw new Error('Native repository must bind list and derived media to the same mode policy.');
}
