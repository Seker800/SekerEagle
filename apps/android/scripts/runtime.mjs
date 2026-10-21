import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
export function androidSdk() {
  const sdk =
    process.env.ANDROID_HOME ||
    process.env.ANDROID_SDK_ROOT ||
    [join(homedir(), 'Library/Android/sdk'), join(homedir(), '.local/android-sdk')].find(
      existsSync,
    );
  if (!sdk) throw new Error('Install Android SDK and set ANDROID_HOME.');
  return sdk;
}
