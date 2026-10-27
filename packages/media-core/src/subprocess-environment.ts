/** Decoder processes receive only runtime paths and bounded native thread settings. */
export function mediaSubprocessEnvironment(
  source: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
  const threads = Number(source.EAGLE_COMPUTE_NATIVE_THREADS ?? 1);
  if (!Number.isInteger(threads) || threads < 1 || threads > 8)
    throw new Error('INVALID_NATIVE_THREAD_BUDGET');
  const result: NodeJS.ProcessEnv = {};
  for (const key of ['PATH', 'TMPDIR', 'TMP', 'TEMP', 'SystemRoot', 'WINDIR', 'LANG', 'LC_ALL']) {
    if (source[key] !== undefined) result[key] = source[key];
  }
  return { ...result, OMP_NUM_THREADS: String(threads), OPENBLAS_NUM_THREADS: String(threads) };
}
