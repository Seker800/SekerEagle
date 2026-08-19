import { BadRequestException } from '@nestjs/common';

export function normalizeEagleUploadOriginalName(value: string): string {
  const name = value.normalize('NFKC').split(/[\\/]/).at(-1)?.trim() ?? '';
  if (!name || name.length > 255 || [...name].some(isControlCharacter)) {
    throw new BadRequestException('文件名无效。');
  }
  return name;
}

function isControlCharacter(character: string): boolean {
  const codePoint = character.codePointAt(0) ?? 0;
  return codePoint <= 31 || codePoint === 127;
}
