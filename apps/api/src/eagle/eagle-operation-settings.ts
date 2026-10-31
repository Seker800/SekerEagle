/** Execution work quanta, never limits on a user's logical selection. */
export function operationSetting(name: string, fallback: number, maximum?: number) {
  const value = process.env[name] === undefined ? fallback : Number(process.env[name]);
  if (!Number.isSafeInteger(value) || value <= 0 || (maximum !== undefined && value > maximum))
    throw new Error(
      `${name} must be a positive integer${maximum ? ` no greater than the database parameter budget ${maximum}` : ''}`,
    );
  return value;
}
export const OPERATION_DB_BATCH_SIZE = operationSetting(
  'EAGLE_OPERATION_DB_BATCH_SIZE',
  512,
  Math.floor(32767 / 12),
);
export const OPERATION_SEND_CONCURRENCY = operationSetting('EAGLE_OPERATION_SEND_CONCURRENCY', 4);
export const OPERATION_POLL_MS = operationSetting('EAGLE_OPERATION_POLL_MS', 1000);
