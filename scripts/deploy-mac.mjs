#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { isIP } from 'node:net';
import { networkInterfaces } from 'node:os';
import { resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const envFile = new URL('../.env', import.meta.url);
const baseComposeFile = 'deploy/mac/docker-compose.yml';
const lanComposeFile = 'deploy/mac/docker-compose.lan.yml';
const gatewayPort = 8180;

export function parseEnv(contents) {
  const values = new Map();

  for (const rawLine of contents.split(/\r?\n/u)) {
    const line = rawLine.trim();
    if (line.length === 0 || line.startsWith('#')) continue;

    const separator = line.indexOf('=');
    if (separator < 1) continue;

    const key = line.slice(0, separator).trim();
    let value = line.slice(separator + 1).trim();
    if (
      value.length >= 2 &&
      ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'")))
    ) {
      value = value.slice(1, -1);
    }
    values.set(key, value);
  }

  return values;
}

export function isPrivateIpv4(address) {
  if (isIP(address) !== 4) return false;
  const [first, second] = address.split('.').map(Number);
  return (
    first === 10 ||
    (first === 172 && second >= 16 && second <= 31) ||
    (first === 192 && second === 168)
  );
}

export function selectComposeFiles(lanAddress) {
  return lanAddress ? [baseComposeFile, lanComposeFile] : [baseComposeFile];
}

export function composeArgs(composeFiles, commandArgs) {
  return [
    'compose',
    '--env-file',
    '.env',
    ...composeFiles.flatMap((file) => ['-f', file]),
    ...commandArgs,
  ];
}

export function expectedGatewayBindings(lanAddress) {
  return [
    { HostIp: '127.0.0.1', HostPort: String(gatewayPort) },
    ...(lanAddress ? [{ HostIp: lanAddress, HostPort: String(gatewayPort) }] : []),
  ];
}

export function assertGatewayBindings(portBindings, lanAddress) {
  const actualBindings = portBindings['8080/tcp'] ?? [];
  for (const expected of expectedGatewayBindings(lanAddress)) {
    if (
      !actualBindings.some(
        (actual) => actual.HostIp === expected.HostIp && actual.HostPort === expected.HostPort,
      )
    ) {
      throw new Error(
        `Gateway binding verification failed: expected ${expected.HostIp}:${expected.HostPort}`,
      );
    }
  }
}

function localIpv4Addresses() {
  return new Set(
    Object.values(networkInterfaces())
      .flatMap((entries) => entries ?? [])
      .filter((entry) => entry.family === 'IPv4')
      .map((entry) => entry.address),
  );
}

function runDocker(args, options = {}) {
  const result = spawnSync('docker', args, {
    cwd: root,
    encoding: 'utf8',
    stdio: options.capture ? ['ignore', 'pipe', 'inherit'] : 'inherit',
  });

  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`Docker command failed with exit code ${result.status}`);
  }
  return result.stdout ?? '';
}

async function waitForReady(url, attempts = 30) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await fetch(url, { signal: globalThis.AbortSignal.timeout(3_000) });
      if (response.ok) return;
      lastError = new Error(`HTTP ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    if (attempt < attempts) await delay(2_000);
  }
  throw new Error(`${url} did not become ready: ${lastError?.message ?? 'unknown error'}`);
}

async function main() {
  const allowedArgs = new Set(['--preflight']);
  const unknownArgs = process.argv.slice(2).filter((argument) => !allowedArgs.has(argument));
  if (unknownArgs.length > 0) {
    throw new Error(`Unknown argument: ${unknownArgs.join(', ')}`);
  }

  const env = parseEnv(await readFile(envFile, 'utf8'));
  const lanAddress = env.get('SEKEREAGLE_GATEWAY_LAN_ADDRESS')?.trim() ?? '';

  if (lanAddress && !isPrivateIpv4(lanAddress)) {
    throw new Error('SEKEREAGLE_GATEWAY_LAN_ADDRESS must be a private IPv4 address');
  }
  if (lanAddress && !localIpv4Addresses().has(lanAddress)) {
    throw new Error(
      `Configured LAN address ${lanAddress} is not assigned to this Mac; update .env before deploying`,
    );
  }

  const composeFiles = selectComposeFiles(lanAddress);
  const mode = lanAddress ? `local + LAN (${lanAddress})` : 'local only';
  process.stdout.write(`Deployment mode: ${mode}\n`);
  process.stdout.write(`Compose files: ${composeFiles.join(', ')}\n`);

  runDocker(composeArgs(composeFiles, ['config', '--quiet']));
  if (process.argv.includes('--preflight')) {
    process.stdout.write('Deployment preflight passed; no containers were changed.\n');
    return;
  }

  runDocker(composeArgs(composeFiles, ['up', '-d', '--build', '--remove-orphans']));

  const gatewayContainerId = runDocker(composeArgs(composeFiles, ['ps', '-q', 'gateway']), {
    capture: true,
  }).trim();
  if (!gatewayContainerId) throw new Error('Gateway container was not created');
  const portBindings = JSON.parse(
    runDocker(['inspect', '--format', '{{json .HostConfig.PortBindings}}', gatewayContainerId], {
      capture: true,
    }),
  );
  assertGatewayBindings(portBindings, lanAddress);

  const healthUrls = [
    `http://127.0.0.1:${gatewayPort}/api/health/ready`,
    ...(lanAddress ? [`http://${lanAddress}:${gatewayPort}/api/health/ready`] : []),
  ];
  for (const url of healthUrls) await waitForReady(url);

  runDocker(composeArgs(composeFiles, ['ps']));
  process.stdout.write(`Deployment verified: ${healthUrls.join(', ')}\n`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    process.stderr.write(`Deployment failed: ${error.message}\n`);
    process.exitCode = 1;
  });
}
