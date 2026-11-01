/** Execution work quanta, never limits on a user's logical selection. */
export function operationSetting(name: string, fallback: number, maximum?: number) {
  const value = process.env[name] === undefined ? fallback : Number(process.env[name]);
  if (!Number.isSafeInteger(value) || value <= 0 || (maximum !== undefined && value > maximum))
    throw new Error(
      `${name} must be a positive integer${maximum ? ` no greater than ${maximum}` : ''}`,
    );
  return value;
}
export const OPERATION_DB_BATCH_SIZE = operationSetting('EAGLE_OPERATION_DB_BATCH_SIZE', 512);
export const OPERATION_SEND_CONCURRENCY = operationSetting('EAGLE_OPERATION_SEND_CONCURRENCY', 4);
export const OPERATION_POLL_MS = operationSetting('EAGLE_OPERATION_POLL_MS', 1000);

export const OPERATION_ADMISSION_TIMEOUT_MS = operationSetting(
  'EAGLE_OPERATION_ADMISSION_TIMEOUT_MS',
  120000,
);
export const OPERATION_METADATA_BATCH_SIZE = operationSetting(
  'EAGLE_OPERATION_METADATA_BATCH_SIZE',
  32,
);

/** Bounds row locks and purge/event work per clear command step, not user selection. */
export const OPERATION_EMPTY_TRASH_BATCH_SIZE = operationSetting(
  'EAGLE_EMPTY_TRASH_BATCH_SIZE',
  512,
  512,
);
