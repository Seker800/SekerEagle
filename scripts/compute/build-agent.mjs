import { build } from 'esbuild';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { writeFile } from 'node:fs/promises';
export function assertStatelessGraph(inputs) {
  if (
    Object.keys(inputs).some((name) =>
      /(?:library-persistence|(?:^|\/)(?:pg|\.prisma|@smithy|@prisma|@aws-sdk)\/|apps\/api\/)/.test(
        name.replaceAll('\\', '/'),
      ),
    )
  )
    throw new Error('COMPUTE_NODE_DATA_PLANE_DEPENDENCY');
}
export async function buildAgent() {
  const root = fileURLToPath(new URL('../../', import.meta.url));
  const outfile = resolve(root, 'apps/worker/dist/compute-agent.cjs');
  const result = await build({
    absWorkingDir: root,
    entryPoints: ['apps/worker/src/compute-agent.ts'],
    outfile,
    bundle: true,
    platform: 'node',
    target: 'node22',
    format: 'cjs',
    external: ['sharp', 'exifr'],
    metafile: true,
    write: false,
  });
  assertStatelessGraph(result.metafile.inputs);
  for (const file of result.outputFiles) await writeFile(file.path, file.contents);
  await writeFile(outfile + '.meta.json', JSON.stringify(result.metafile, null, 2) + '\n');
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await buildAgent();
