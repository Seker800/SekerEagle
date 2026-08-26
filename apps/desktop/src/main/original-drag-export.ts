import { createWriteStream } from 'node:fs';
import { chmod, mkdir, mkdtemp, readdir, rename, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const NAMESPACE_ID = /^[0-9a-f]{64}$/u;
const MAX_DRAG_ASSETS = 100;
const MAX_FILE_NAME_BYTES = 240;
const DEFAULT_REQUEST_INTERVAL_MS = 110;

export const ORIGINAL_DRAG_EXPORT_TTL_MS = 60 * 60 * 1_000;

type FetchOriginal = (assetId: string) => Promise<Response>;

export interface PreparedOriginalDrag {
  directory: string;
  files: [string, ...string[]];
}

interface OriginalDragExporterOptions {
  rootPath: string;
  fetchOriginal: FetchOriginal;
  now?: () => number;
  minimumRequestIntervalMs?: number;
}

export function parseAssetDragInput(input: unknown): string[] {
  if (!Array.isArray(input) || input.length === 0 || input.length > MAX_DRAG_ASSETS) {
    throw new Error('待拖出的素材数量无效。');
  }
  const assetIds = input.map((value) => {
    if (typeof value !== 'string' || !UUID_V4.test(value)) {
      throw new Error('待拖出的素材标识无效。');
    }
    return value.toLowerCase();
  });
  if (new Set(assetIds).size !== assetIds.length) throw new Error('待拖出的素材标识重复。');
  return assetIds;
}

export class OriginalDragExporter {
  private readonly rootPath: string;
  private readonly fetchOriginal: FetchOriginal;
  private readonly now: () => number;
  private readonly minimumRequestIntervalMs: number;
  private nextRequestAt = 0;
  private requestQueue: Promise<void> = Promise.resolve();

  constructor({
    rootPath,
    fetchOriginal,
    now = Date.now,
    minimumRequestIntervalMs = DEFAULT_REQUEST_INTERVAL_MS,
  }: OriginalDragExporterOptions) {
    if (!path.isAbsolute(rootPath)) throw new Error('原文件临时目录必须是绝对路径。');
    if (!Number.isFinite(minimumRequestIntervalMs) || minimumRequestIntervalMs < 0) {
      throw new Error('原文件请求间隔无效。');
    }
    this.rootPath = rootPath;
    this.fetchOriginal = fetchOriginal;
    this.now = now;
    this.minimumRequestIntervalMs = minimumRequestIntervalMs;
  }

  async prepare(namespaceId: string, input: unknown): Promise<PreparedOriginalDrag> {
    if (!NAMESPACE_ID.test(namespaceId)) throw new Error('原文件临时目录命名空间无效。');
    const assetIds = parseAssetDragInput(input);
    const accountRoot = path.join(this.rootPath, namespaceId);
    await ensurePrivateDirectory(this.rootPath);
    await ensurePrivateDirectory(accountRoot);
    const directory = await mkdtemp(path.join(accountRoot, 'drag-'));
    await chmod(directory, 0o700);

    const files: string[] = [];
    const usedNames = new Set<string>();
    try {
      for (const assetId of assetIds) {
        const response = await this.fetchOriginalWithPacing(assetId);
        if (!response.ok || !response.body) {
          throw new Error(`原文件下载失败（${response.status}）。`);
        }
        const requestedName = readResponseFileName(response.headers) ?? `${assetId}.bin`;
        const fileName = uniqueFileName(sanitizeFileName(requestedName), usedNames);
        const filePath = path.join(directory, fileName);
        const partialPath = `${filePath}.partial`;
        await pipeline(
          Readable.fromWeb(response.body as globalThis.ReadableStream<Uint8Array>),
          createWriteStream(partialPath, { flags: 'wx', mode: 0o600 }),
        );
        await verifyContentLength(response.headers, partialPath);
        await rename(partialPath, filePath);
        files.push(filePath);
      }
      return { directory, files: files as [string, ...string[]] };
    } catch (error) {
      await rm(directory, { recursive: true, force: true });
      if (error instanceof Error && error.message.includes('原文件')) throw error;
      throw new Error('原文件准备失败。', { cause: error });
    }
  }

  async remove(prepared: PreparedOriginalDrag): Promise<void> {
    const resolved = path.resolve(prepared.directory);
    const root = `${path.resolve(this.rootPath)}${path.sep}`;
    if (!resolved.startsWith(root)) throw new Error('拒绝清理临时目录之外的路径。');
    await rm(resolved, { recursive: true, force: true });
  }

  async cleanupExpired(): Promise<void> {
    let namespaces;
    try {
      namespaces = await readdir(this.rootPath, { withFileTypes: true });
    } catch (error) {
      if (isMissingPath(error)) return;
      throw error;
    }
    await Promise.all(
      namespaces
        .filter((entry) => entry.isDirectory() && NAMESPACE_ID.test(entry.name))
        .map(async (namespace) => {
          const namespacePath = path.join(this.rootPath, namespace.name);
          const entries = await readdir(namespacePath, { withFileTypes: true });
          await Promise.all(
            entries
              .filter((entry) => entry.isDirectory() && entry.name.startsWith('drag-'))
              .map(async (entry) => {
                const directory = path.join(namespacePath, entry.name);
                const metadata = await stat(directory);
                if (this.now() - metadata.mtimeMs > ORIGINAL_DRAG_EXPORT_TTL_MS) {
                  await rm(directory, { recursive: true, force: true });
                }
              }),
          );
        }),
    );
  }

  private async fetchOriginalWithPacing(assetId: string): Promise<Response> {
    const request = this.requestQueue.then(async () => {
      const delayMs = Math.max(0, this.nextRequestAt - this.now());
      if (delayMs > 0) await delay(delayMs);
      this.nextRequestAt = this.now() + this.minimumRequestIntervalMs;
      return this.fetchOriginal(assetId);
    });
    this.requestQueue = request.then(
      () => undefined,
      () => undefined,
    );
    return request;
  }
}

async function ensurePrivateDirectory(directory: string): Promise<void> {
  await mkdir(directory, { recursive: true, mode: 0o700 });
  await chmod(directory, 0o700);
}

function readResponseFileName(headers: Headers): string | null {
  const disposition = headers.get('content-disposition');
  if (!disposition) return null;
  const encoded = /(?:^|;)\s*filename\*=UTF-8''([^;]+)/iu.exec(disposition)?.[1];
  if (encoded) {
    try {
      return decodeURIComponent(encoded.trim());
    } catch {
      throw new Error('原文件名称编码无效。');
    }
  }
  return /(?:^|;)\s*filename="([^"]+)"/iu.exec(disposition)?.[1] ?? null;
}

function sanitizeFileName(input: string): string {
  let name = input
    .normalize('NFKC')
    .replace(/[<>:"/\\|?*\u0000-\u001f\u007f]/gu, '_')
    .replace(/^\.+/u, '')
    .replace(/[ .]+$/u, '');
  if (!name) name = 'original.bin';
  if (/^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:[ ._]|$)/iu.test(name)) name = `_${name}`;
  return fitFileName(name);
}

function uniqueFileName(fileName: string, usedNames: Set<string>): string {
  const extension = path.extname(fileName);
  const stem = extension ? fileName.slice(0, -extension.length) : fileName;
  let candidate = fileName;
  let duplicate = 2;
  while (usedNames.has(candidate.toLocaleLowerCase('en-US'))) {
    const suffix = ` (${duplicate})`;
    candidate = fitFileName(`${stem}${suffix}${extension}`, suffix);
    duplicate += 1;
  }
  usedNames.add(candidate.toLocaleLowerCase('en-US'));
  return candidate;
}

function fitFileName(fileName: string, suffix = ''): string {
  const extension = truncateUtf8(path.extname(fileName), 32);
  const sourceStem = extension ? fileName.slice(0, -path.extname(fileName).length) : fileName;
  const stemWithoutSuffix =
    suffix && sourceStem.endsWith(suffix) ? sourceStem.slice(0, -suffix.length) : sourceStem;
  const availableStemBytes =
    MAX_FILE_NAME_BYTES - Buffer.byteLength(extension, 'utf8') - Buffer.byteLength(suffix, 'utf8');
  const stem = truncateUtf8(stemWithoutSuffix, Math.max(1, availableStemBytes));
  return `${stem || 'original'}${suffix}${extension}`;
}

function truncateUtf8(value: string, maximumBytes: number): string {
  let result = '';
  let bytes = 0;
  for (const character of value) {
    const characterBytes = Buffer.byteLength(character, 'utf8');
    if (bytes + characterBytes > maximumBytes) break;
    result += character;
    bytes += characterBytes;
  }
  return result.replace(/[ .]+$/u, '');
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function verifyContentLength(headers: Headers, filePath: string): Promise<void> {
  const rawLength = headers.get('content-length');
  if (!rawLength) return;
  const expectedLength = Number(rawLength);
  if (!Number.isSafeInteger(expectedLength) || expectedLength < 0) {
    throw new Error('原文件长度无效。');
  }
  const actualLength = (await stat(filePath)).size;
  if (actualLength !== expectedLength) throw new Error('原文件下载不完整。');
}

function isMissingPath(error: unknown): boolean {
  return Boolean(error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT');
}
