// Admission may use the server's configurable 120-second transaction budget.
export const EAGLE_OPERATION_REQUEST_TIMEOUT_MS = Number(
  import.meta.env.VITE_EAGLE_OPERATION_REQUEST_TIMEOUT_MS ?? 150_000,
);
if (
  !Number.isSafeInteger(EAGLE_OPERATION_REQUEST_TIMEOUT_MS) ||
  EAGLE_OPERATION_REQUEST_TIMEOUT_MS <= 0
)
  throw new Error('VITE_EAGLE_OPERATION_REQUEST_TIMEOUT_MS must be a positive integer');
