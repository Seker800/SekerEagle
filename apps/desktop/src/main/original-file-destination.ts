import { constants } from 'node:fs';
import { copyFile, stat, unlink } from 'node:fs/promises';
import path from 'node:path';
import { addDuplicateFileNameSuffix } from './original-drag-export';

const MAX_DESTINATION_ATTEMPTS = 10_000;

export async function copyPreparedFilesToDirectory(
  sourceFiles: readonly string[],
  destinationDirectory: string,
): Promise<string[]> {
  if (sourceFiles.length === 0) throw new Error('批量下载内容为空。');
  if (!path.isAbsolute(destinationDirectory)) throw new Error('批量下载文件夹无效。');
  const destinationMetadata = await stat(destinationDirectory).catch(() => null);
  if (!destinationMetadata?.isDirectory()) throw new Error('批量下载目标必须是文件夹。');

  const copiedFiles: string[] = [];
  try {
    for (const sourceFile of sourceFiles) {
      copiedFiles.push(await copyWithoutReplacing(sourceFile, destinationDirectory));
    }
    return copiedFiles;
  } catch (error) {
    await Promise.all(copiedFiles.map((file) => unlink(file).catch(() => undefined)));
    throw new Error('批量下载原文件失败。', { cause: error });
  }
}

async function copyWithoutReplacing(
  sourceFile: string,
  destinationDirectory: string,
): Promise<string> {
  const fileName = path.basename(sourceFile);
  for (let attempt = 1; attempt <= MAX_DESTINATION_ATTEMPTS; attempt += 1) {
    const candidateName = attempt === 1 ? fileName : addDuplicateFileNameSuffix(fileName, attempt);
    const candidate = path.join(destinationDirectory, candidateName);
    try {
      await copyFile(sourceFile, candidate, constants.COPYFILE_EXCL);
      return candidate;
    } catch (error) {
      if (isAlreadyExists(error)) continue;
      await unlink(candidate).catch(() => undefined);
      throw error;
    }
  }
  throw new Error('批量下载目录中的同名文件过多。');
}

function isAlreadyExists(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'EEXIST';
}
