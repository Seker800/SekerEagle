import { Buffer } from 'node:buffer';
import { setTimeout, clearTimeout } from 'node:timers';
import { createServer } from 'node:http';
import { execFile } from 'node:child_process';
import { timingSafeEqual } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { readSecret } from './main.mjs';
import { boundedBody } from './server.mjs';

const allowed = (path, method) =>
  (path === '/admin/fleet' && method === 'GET') ||
  (['/admin/policy', '/admin/enroll'].includes(path) && method === 'POST');
// Request data is sent only on stdin. Neither a command nor a URL comes from the caller.
const remoteSource = `
import { readSecret } from './main.mjs';
import { boundedBody } from './server.mjs';
try {
 const input=JSON.parse((await boundedBody(process.stdin,131072)).toString('utf8'));
 const allowed=(input.path==='/admin/fleet'&&input.method==='GET')||(['/admin/policy','/admin/enroll'].includes(input.path)&&input.method==='POST');
 if(!allowed||typeof input.body!=='string'||Buffer.byteLength(input.body)>16384)throw Error('INPUT');
 const token=await readSecret('/credentials/admin-token');
 const response=await fetch('http://127.0.0.1:11436'+input.path,{method:input.method,headers:{authorization:'Bearer '+token,'content-type':'application/json'},...(input.method==='POST'?{body:input.body}:{}),redirect:'error',signal:AbortSignal.timeout(6000)});
 const body=(await boundedBody(response.body,262144)).toString('utf8');
 process.stdout.write(JSON.stringify({status:response.status,body}));
} catch { process.exitCode=1; }
`;
const remoteCommand =
  '/usr/local/bin/docker exec -i sekereagle-nas-staging-compute-coordinator-1 node --input-type=module -e ' +
  "'" +
  remoteSource.replaceAll("'", "'\\''") +
  "'";

function validateTarget(target) {
  if (typeof target !== 'string' || !/^[a-zA-Z][a-zA-Z0-9_.-]{0,79}$/.test(target))
    throw new Error('INVALID_SSH_TARGET');
}
export async function sshAdminRequest(target, input, execute = execFile) {
  validateTarget(target);
  if (
    !allowed(input.path, input.method) ||
    typeof input.body !== 'string' ||
    Buffer.byteLength(input.body) > 16384
  )
    throw new Error('INVALID_CONTROL_REQUEST');
  return new Promise((resolve, reject) => {
    const child = execute(
      '/usr/bin/ssh',
      [
        '-T',
        '-o',
        'BatchMode=yes',
        '-o',
        'StrictHostKeyChecking=yes',
        '-o',
        'ConnectTimeout=6',
        target,
        remoteCommand,
      ],
      { timeout: 8000, maxBuffer: 1024 * 1024 },
      (error, stdout) => {
        if (error) return reject(new Error('SSH_CONTROL_UNAVAILABLE'));
        try {
          const value = JSON.parse(stdout);
          if (
            !Number.isInteger(value.status) ||
            value.status < 200 ||
            value.status > 599 ||
            typeof value.body !== 'string' ||
            Buffer.byteLength(value.body) > 262144
          )
            throw new Error('INVALID_CONTROL_RESPONSE');
          resolve(value);
        } catch {
          reject(new Error('INVALID_CONTROL_RESPONSE'));
        }
      },
    );
    child.stdin.on('error', () => {});
    child.stdin.end(JSON.stringify(input));
  });
}
export function createSshBridge({ token, target, invoke }) {
  validateTarget(target);
  if (typeof token !== 'string' || token.length < 8 || token.length > 1024 || /[\r\n]/.test(token))
    throw new Error('INVALID_CREDENTIAL');
  const expected = Buffer.from('Bearer ' + token);
  let active = 0;
  const server = createServer((req, res) => {
    void handle(req, res);
  });
  async function handle(req, res) {
    const send = (status, value) => {
      if (!res.destroyed) {
        res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' });
        res.end(value);
      }
    };
    const actual = Buffer.from(req.headers.authorization ?? '');
    if (actual.length !== expected.length || !timingSafeEqual(actual, expected))
      return send(401, '{"error":"UNAUTHORIZED"}');
    if (!allowed(req.url, req.method)) return send(404, '{"error":"NOT_FOUND"}');
    if (active >= 2) return send(503, '{"error":"CONTROL_BUSY"}');
    active++;
    const timer = setTimeout(() => req.destroy(), 8000);
    timer.unref();
    try {
      const body = (await boundedBody(req, req.method === 'GET' ? 0 : 16384)).toString('utf8');
      clearTimeout(timer);
      const result = await (invoke ?? ((input) => sshAdminRequest(target, input)))({
        path: req.url,
        method: req.method,
        body,
      });
      send(result.status, result.body);
    } catch (error) {
      send(error.status === 413 ? 413 : 502, '{"error":"CONTROL_UNAVAILABLE"}');
    } finally {
      clearTimeout(timer);
      active--;
    }
  }
  server.requestTimeout = 8000;
  server.headersTimeout = 5000;
  server.maxHeadersCount = 32;
  return server;
}
async function main() {
  const token = await readSecret(process.env.EAGLE_COMPUTE_ADMIN_TOKEN_FILE);
  const server = createSshBridge({ token, target: process.env.EAGLE_COMPUTE_SSH_TARGET });
  // This is an authenticated local management adapter, never a LAN listener.
  server.listen(11436, '127.0.0.1');
  process.once('SIGTERM', () => server.close());
  process.once('SIGINT', () => server.close());
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  main().catch(() => {
    process.stderr.write('SSH compute control bridge failed.\n');
    process.exitCode = 1;
  });
