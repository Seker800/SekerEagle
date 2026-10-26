import { pathToFileURL, fileURLToPath } from 'node:url';
import { readPrivateJson } from './fleet.mjs';
import { readSecret } from './main.mjs';
import { boundedBody } from './server.mjs';
export async function control(command, input, config, fetcher = fetch) {
  const url = new URL(config.baseUrl);
  if (
    url.protocol !== 'http:' ||
    url.hostname !== '127.0.0.1' ||
    !url.port ||
    url.username ||
    url.password ||
    url.pathname !== '/' ||
    url.search ||
    url.hash
  )
    throw new Error('LOOPBACK_ADMIN_REQUIRED');
  const path =
    command === 'status' ? '/admin/fleet' : command === 'policy' ? '/admin/policy' : null;
  if (!path) throw new Error('Use status or policy <private-policy-file>.');
  const token = await readSecret(config.adminTokenFile);
  const response = await fetcher(url.origin + path, {
    method: command === 'status' ? 'GET' : 'POST',
    headers: {
      authorization: `Bearer ${token}`,
      ...(command === 'status' ? {} : { 'content-type': 'application/json' }),
    },
    ...(command === 'status' ? {} : { body: JSON.stringify(input) }),
    redirect: 'error',
    signal: AbortSignal.timeout(10000),
  });
  if (!response.ok) throw new Error(`COMPUTE_CONTROL_${response.status}`);
  return JSON.parse((await boundedBody(response.body, 256 * 1024)).toString('utf8'));
}
async function main() {
  const config = await readPrivateJson(
    process.env.EAGLE_COMPUTE_CLIENT_CONFIG ??
      fileURLToPath(new URL('../../.runtime/compute-control-client.json', import.meta.url)),
  );
  const command = process.argv[2];
  const input = command === 'policy' ? await readPrivateJson(process.argv[3]) : undefined;
  process.stdout.write(JSON.stringify(await control(command, input, config)) + '\n');
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  main().catch((error) => {
    process.stderr.write(
      error.message.startsWith('COMPUTE_CONTROL_')
        ? error.message + '\n'
        : 'Compute control failed; inspect the private client configuration.\n',
    );
    process.exitCode = 1;
  });
