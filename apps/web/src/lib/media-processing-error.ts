import { t } from '../i18n';

export interface MediaProcessingFailure {
  label: string;
  detail: string;
  retryable: boolean;
}

export function mediaProcessingFailure(code: string | null | undefined): MediaProcessingFailure {
  const normalized = code?.split(':')[0]?.trim() ?? '';
  if (normalized === 'IMAGE_DECODE_FAILED' || normalized === 'IMAGE_CONTENT_MISMATCH')
    return {
      label: t('文件不完整'),
      detail: t('该文件不完整或无法解码，请重新导出或从相机卡复制完整的文件后再上传。'),
      retryable: false,
    };
  if (normalized === 'IMAGE_PIXEL_LIMIT_EXCEEDED')
    return {
      label: t('像素超出处理上限'),
      detail: t('图片像素数量超出当前处理器的安全上限。'),
      retryable: false,
    };
  if (normalized === 'UNSUPPORTED_MEDIA_TYPE')
    return {
      label: t('格式不支持'),
      detail: t('当前处理器不支持该文件格式。'),
      retryable: false,
    };
  if (normalized === 'CONTENT_SHA256_MISMATCH')
    return {
      label: t('内容校验失败'),
      detail: t('原文件内容与入库校验值不一致，请重新上传。'),
      retryable: false,
    };
  return {
    label: t('处理失败'),
    detail: code || t('处理失败，可尝试重新处理。'),
    retryable: true,
  };
}
