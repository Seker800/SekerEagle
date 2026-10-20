/** Decoder processes receive only runtime paths and bounded native thread settings. */
export function mediaSubprocessEnvironment(source: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const result: NodeJS.ProcessEnv = {};
  for (const key of ['PATH', 'TMPDIR', 'TMP', 'TEMP', 'SystemRoot', 'WINDIR', 'LANG', 'LC_ALL']) {
    if (source[key] !== undefined) result[key] = source[key];
  }
  return { ...result, OMP_NUM_THREADS: '1', OPENBLAS_NUM_THREADS: '1' };
}
