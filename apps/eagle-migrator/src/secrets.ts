const PAT_PATTERN = /se_pat_[A-Za-z0-9._~-]+/gi;
const BEARER_PATTERN = /Authorization\s*:\s*Bearer\s+[^\s,;]+/gi;
const URL_SECRET_PATTERN = /([?&](?:token|access_token|signature|x-amz-signature)=)[^&\s]+/gi;

export function redactSensitiveText(value: unknown, maximumLength = 500): string {
  return stringifyUnknown(value)
    .replace(BEARER_PATTERN, 'Authorization: [REDACTED]')
    .replace(PAT_PATTERN, '[REDACTED_PAT]')
    .replace(URL_SECRET_PATTERN, '$1[REDACTED]')
    .slice(0, maximumLength);
}

function stringifyUnknown(value: unknown): string {
  if (typeof value === 'string') return value;
  if (value instanceof Error) return value.message;
  if (value === null || value === undefined) return '';
  if (typeof value === 'number' || typeof value === 'bigint' || typeof value === 'boolean') {
    return value.toString();
  }
  return '[unprintable value]';
}
