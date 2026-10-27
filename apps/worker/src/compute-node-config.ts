import { execFileSync } from 'node:child_process';
import { open, lstat, constants } from 'node:fs/promises';
export type MediaOperation = 'image' | 'pyramid' | 'faces' | 'video';
export function nodeOperations(value: string): MediaOperation[] {
  const result = value.split(',').map((x) => x.trim());
  if (
    !result.length ||
    new Set(result).size !== result.length ||
    result.some((x) => !['image', 'pyramid', 'faces', 'video'].includes(x))
  )
    throw new Error('INVALID_NODE_OPERATIONS');
  return result as MediaOperation[];
}
export function validateWindowsTokenAcl(value: unknown) {
  const acl = value as { owner?: unknown; current?: unknown; protected?: unknown; allow?: unknown };
  if (
    !acl ||
    typeof acl.current !== 'string' ||
    !acl.current ||
    acl.owner !== acl.current ||
    acl.protected !== true ||
    !Array.isArray(acl.allow) ||
    !acl.allow.length ||
    !acl.allow.every((sid) => [acl.current, 'S-1-5-18', 'S-1-5-32-544'].includes(sid))
  )
    throw new Error('PRIVATE_TOKEN_REQUIRED');
}
export async function readComputeToken(path: string) {
  if ((await lstat(path)).isSymbolicLink()) throw new Error('PRIVATE_TOKEN_REQUIRED');
  if (process.platform === 'win32') {
    const script = `[Console]::OutputEncoding=[System.Text.Encoding]::UTF8;$ErrorActionPreference='Stop';$acl=Get-Acl -LiteralPath $env:EAGLE_TOKEN_PATH;$current=[Security.Principal.WindowsIdentity]::GetCurrent().User.Value;@{owner=$acl.GetOwner([Security.Principal.SecurityIdentifier]).Value;current=$current;protected=$acl.AreAccessRulesProtected;allow=@($acl.Access | Where-Object {$_.AccessControlType -eq 'Allow'} | ForEach-Object {$_.IdentityReference.Translate([Security.Principal.SecurityIdentifier]).Value})} | ConvertTo-Json -Compress`;
    validateWindowsTokenAcl(
      JSON.parse(
        execFileSync(
          'powershell.exe',
          [
            '-NoProfile',
            '-NonInteractive',
            '-EncodedCommand',
            Buffer.from(script, 'utf16le').toString('base64'),
          ],
          {
            timeout: 10000,
            maxBuffer: 16384,
            encoding: 'utf8',
            env: {
              PATH: process.env.PATH,
              SystemRoot: process.env.SystemRoot,
              WINDIR: process.env.WINDIR,
              EAGLE_TOKEN_PATH: path,
            },
          },
        ),
      ),
    );
  }
  const file = await open(
    path,
    constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0),
  );
  try {
    const stat = await file.stat();
    if (
      !stat.isFile() ||
      stat.size > 1024 ||
      (process.platform !== 'win32' &&
        (stat.mode & 0o077 || (process.getuid && stat.uid !== process.getuid())))
    )
      throw new Error('PRIVATE_TOKEN_REQUIRED');
    const token = (await file.readFile('utf8')).trim();
    if (token.length < 16) throw new Error('PRIVATE_TOKEN_REQUIRED');
    return token;
  } finally {
    await file.close();
  }
}
