import { getLocale, tForLocale, type MessageId } from '../i18n';
import type { SupportedLocale } from '../i18n/locale';

const ERROR_CODE_MESSAGES = {
  ORIGIN_REJECTED: '请求来源不受信任。',
  CONTENT_HASH_MISMATCH: '上传文件完整性校验失败。',
  MANIFEST_DECLARATION_MISMATCH: '导入清单声明不一致。',
  MISSING_FOLDER_DEFINITION: '导入清单缺少文件夹定义。',
} as const satisfies Readonly<Record<string, MessageId>>;

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string | null,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export async function errorFromResponse(
  response: Response,
  fallback: MessageId,
  locale: SupportedLocale = getLocale(),
): Promise<ApiError> {
  const body = (await response.json().catch(() => null)) as {
    code?: unknown;
    message?: unknown;
  } | null;
  const code = typeof body?.code === 'string' ? body.code : null;
  const codedMessage = code ? ERROR_CODE_MESSAGES[code as keyof typeof ERROR_CODE_MESSAGES] : null;
  const serverMessage = normalizeServerMessage(body?.message);
  const message = codedMessage
    ? tForLocale(locale, codedMessage)
    : locale === 'zh-CN' && serverMessage
      ? serverMessage
      : tForLocale(locale, fallback, { value1: response.status });
  return new ApiError(message, response.status, code);
}

function normalizeServerMessage(value: unknown): string | null {
  if (typeof value === 'string' && value.trim()) return value;
  if (Array.isArray(value)) {
    const messages = value.filter(
      (item): item is string => typeof item === 'string' && !!item.trim(),
    );
    return messages.length ? messages.join('；') : null;
  }
  return null;
}
