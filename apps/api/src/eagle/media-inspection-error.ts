import { BadRequestException, ServiceUnavailableException } from '@nestjs/common';

/** Preserve retryability without exposing source paths or subprocess diagnostics. */
export function inspectionFailure(error: unknown, kind: 'image' | 'raw' | 'video') {
  if (error instanceof BadRequestException || error instanceof ServiceUnavailableException)
    return error;
  const detail = error instanceof Error ? error : undefined;
  const runtime = error as { code?: string; signal?: string; killed?: boolean } | null;
  const transient =
    [
      'ENOMEM',
      'ENOSPC',
      'EMFILE',
      'ENFILE',
      'EIO',
      'ECONNRESET',
      'ETIMEDOUT',
      'EPIPE',
      'ENETUNREACH',
      'EAI_AGAIN',
      'ERR_STREAM_PREMATURE_CLOSE',
    ].includes(runtime?.code ?? '') ||
    runtime?.killed ||
    runtime?.signal === 'SIGKILL' ||
    /out of memory|cannot allocate memory|bad alloc|timeout/i.test(detail?.message ?? '');
  if (transient)
    return new ServiceUnavailableException({
      code: 'MEDIA_INSPECTION_RETRYABLE',
      message: '媒体检查暂时失败，请稍后重试；原文件不会被判定为损坏。',
    });
  if (/pixel limit|exceeds pixel|像素|尺寸超出安全限制/i.test(detail?.message ?? ''))
    return new BadRequestException({
      code: 'IMAGE_PIXEL_LIMIT_EXCEEDED',
      message: kind === 'video' ? '视频尺寸超出安全限制。' : '图片输入超过 1.2 亿像素安全上限。',
    });
  return new BadRequestException({
    code: 'INVALID_MEDIA',
    message:
      kind === 'video'
        ? '无法读取该相机视频，请确认文件完整且容器与编码受支持。'
        : kind === 'raw'
          ? '无法读取该 RAW，请确认相机受 LibRaw 支持且原文件完整。'
          : '无法解码该图片，请确认文件完整且格式受支持。',
  });
}
