import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';

const requiredFiles = [
  'LICENSE',
  'NOTICE',
  'THIRD_PARTY_NOTICES.md',
  'README.md',
  'README.en.md',
  'SECURITY.md',
  'CONTRIBUTING.md',
  'CODE_OF_CONDUCT.md',
  'SUPPORT.md',
  'PRIVACY.md',
  'CHANGELOG.md',
  'docs/provenance.md',
  'plugins/browser-capture/LICENSE',
  'plugins/eagle-importer/LICENSE',
  'services/mlx-embedding/LICENSE',
];

const failures = [];
const read = (path) => readFile(path, 'utf8');
const tracked = execFileSync(
  'git',
  ['ls-files', '--cached', '--others', '--exclude-standard', '-z'],
  {
    encoding: 'utf8',
  },
)
  .split('\0')
  .filter(Boolean);

for (const path of requiredFiles) {
  try {
    await read(path);
  } catch {
    failures.push(`missing required public-project file: ${path}`);
  }
}

const forbiddenTrackedPaths = tracked.filter(
  (path) =>
    path === '.env' ||
    (path.startsWith('.env.') && path !== '.env.example') ||
    path.startsWith('.local/') ||
    path.startsWith('.runtime/') ||
    path.startsWith('.omx/') ||
    /(^|\/)(?:id_rsa|id_ed25519|\.npmrc|\.pypirc)$/.test(path) ||
    /\.(?:pem|p12|pfx|key)$/i.test(path),
);
for (const path of forbiddenTrackedPaths) failures.push(`sensitive path is tracked: ${path}`);

const packageManifests = tracked.filter((path) => path.endsWith('package.json'));
for (const path of packageManifests) {
  const manifest = JSON.parse(await read(path));
  if (manifest.license !== 'Apache-2.0') {
    failures.push(`${path} must declare license Apache-2.0`);
  }
}

const rootLicense = await read('LICENSE');
if (
  !rootLicense.includes('Apache License') ||
  !rootLicense.includes('END OF TERMS AND CONDITIONS')
) {
  failures.push('LICENSE is not a complete Apache-2.0 license text');
}

const sidecarLicense = await read('services/mlx-embedding/LICENSE');
if (
  !sidecarLicense.includes('GNU GENERAL PUBLIC LICENSE') ||
  !sidecarLicense.includes('END OF TERMS AND CONDITIONS')
) {
  failures.push('services/mlx-embedding/LICENSE is not a complete GPLv3 license text');
}

const pyproject = await read('services/mlx-embedding/pyproject.toml');
if (!/^license = "GPL-3\.0-only"$/m.test(pyproject)) {
  failures.push('MLX sidecar must declare GPL-3.0-only');
}
if (!/"mlx-embeddings==0\.1\.0"/.test(pyproject)) {
  failures.push('review the MLX license boundary after changing mlx-embeddings');
}

const readme = await read('README.md');
for (const requiredText of ['Apache-2.0', 'GPL-3.0-only', 'Apple Silicon', '不是 Eagle 官方产品']) {
  if (!readme.includes(requiredText))
    failures.push(`README is missing disclosure: ${requiredText}`);
}
if (readme.includes('空 Prisma schema'))
  failures.push('README still contains the obsolete initial milestone');
if (!readme.includes('href="README.en.md"'))
  failures.push('README is missing the English language switch');

const englishReadme = await read('README.en.md');
for (const requiredText of [
  'Apache License 2.0',
  'GPL-3.0-only',
  'Apple Silicon',
  'not an official Eagle product',
]) {
  if (!englishReadme.includes(requiredText))
    failures.push(`English README is missing disclosure: ${requiredText}`);
}
if (!englishReadme.includes('href="README.md"'))
  failures.push('English README is missing the Simplified Chinese language switch');

const lock = JSON.parse(await read('package-lock.json'));
for (const [path, metadata] of Object.entries(lock.packages ?? {})) {
  const license = typeof metadata.license === 'string' ? metadata.license : '';
  if (/AGPL|SSPL|BUSL|Commons Clause/i.test(license)) {
    failures.push(`dependency requires license review: ${path || '(root)'} (${license})`);
  }
  if (/\bGPL/i.test(license) && !/LGPL/i.test(license)) {
    failures.push(`unexpected GPL Node dependency: ${path || '(root)'} (${license})`);
  }
}

const tokenPatterns = [
  ['private key', /-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/],
  ['GitHub token', /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{20,}\b/],
  ['AWS access key', /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/],
  ['Hugging Face token', /\bhf_[A-Za-z0-9]{20,}\b/],
  ['OpenAI key', /\bsk-[A-Za-z0-9_-]{20,}\b/],
];
for (const path of tracked) {
  if (/\.(?:png|jpe?g|gif|webp|ico|woff2?|ttf|otf)$/i.test(path)) continue;
  let contents;
  try {
    contents = await read(path);
  } catch {
    continue;
  }
  for (const [name, pattern] of tokenPatterns) {
    if (pattern.test(contents)) failures.push(`${name} pattern found in tracked file: ${path}`);
  }
}

if (failures.length > 0) {
  process.stderr.write(`Open-source readiness check failed:\n- ${failures.join('\n- ')}\n`);
  process.exitCode = 1;
} else {
  process.stdout.write(
    `Open-source readiness check passed (${tracked.length} publishable files, ${packageManifests.length} package manifests).\n`,
  );
}
