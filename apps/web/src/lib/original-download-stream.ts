import { fetchWithBrowserSession } from './api-client';
import { getEagleAssetContentUrl } from './eagle-api';
import type { OriginalFileTarget } from './original-file-export';

export interface OriginalFileWriter {
  write(chunk: Uint8Array): Promise<void>;
  close(): Promise<void>;
  abort(reason?: unknown): Promise<void>;
}

export async function streamOriginalToFile(
  target: OriginalFileTarget,
  output: OriginalFileWriter,
  signal: AbortSignal,
  onProgress: (received: number, total?: number) => void,
): Promise<void> {
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  try {
    const response = await fetchWithBrowserSession(
      getEagleAssetContentUrl(target.id, target.libraryMode),
      { signal },
      30 * 60_000,
    );
    if (!response.ok || !response.body) throw new Error(`HTTP ${response.status}`);
    const length = response.headers.get('content-length');
    const total =
      length !== null && Number.isSafeInteger(Number(length)) && Number(length) >= 0
        ? Number(length)
        : undefined;
    reader = response.body.getReader();
    let received = 0;
    for (;;) {
      signal.throwIfAborted();
      const chunk = await reader.read();
      if (chunk.done) break;
      await output.write(chunk.value);
      received += chunk.value.byteLength;
      onProgress(received, total);
    }
    signal.throwIfAborted();
    if (total !== undefined && received !== total) throw new Error('Incomplete response');
    await output.close();
    onProgress(received, total);
  } catch (error) {
    await output.abort(error).catch(() => undefined);
    throw error;
  } finally {
    await reader?.cancel().catch(() => undefined);
    reader?.releaseLock();
  }
}

export function uniqueOriginalFileNames(names: readonly string[]): string[] {
  const used = new Set<string>();
  const bytes = new TextEncoder();
  const truncate = (value: string, limit: number) => {
    let result = '';
    for (const char of value) {
      if (bytes.encode(result + char).length > limit) break;
      result += char;
    }
    return result;
  };
  return names.map((raw) => {
    let name =
      raw
        .normalize('NFC')
        .replace(/[<>:"/\\|?*]/gu, '_')
        .replace(/\p{Cc}/gu, '_')
        .replace(/[. ]+$/gu, '')
        .trim() || 'download';
    if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/iu.test(name)) name = `_${name}`;
    const dot = name.lastIndexOf('.');
    const extension = dot > 0 ? truncate(name.slice(dot), 32) : '';
    const stem = dot > 0 ? name.slice(0, dot) : name;
    for (let count = 1; ; count++) {
      const suffix = count === 1 ? '' : ` (${count})`;
      const candidate =
        truncate(stem, 240 - bytes.encode(extension + suffix).length) + suffix + extension;
      const key = candidate.toLocaleLowerCase('en-US');
      if (!used.has(key)) {
        used.add(key);
        return candidate;
      }
    }
  });
}
