import { open, constants } from 'node:fs/promises';
import { Buffer } from 'node:buffer';

export async function readAgentToken(env = process.env) {
  if (env.SEKEREAGLE_AGENT_PAT_FILE && env.SEKEREAGLE_AGENT_PAT)
    throw new Error('Configure exactly one PAT source.');
  if (!env.SEKEREAGLE_AGENT_PAT_FILE) return env.SEKEREAGLE_AGENT_PAT;
  if (process.platform === 'win32') throw new Error('PAT file source requires POSIX permissions.');
  const handle = await open(
    env.SEKEREAGLE_AGENT_PAT_FILE,
    constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
  );
  try {
    const stat = await handle.stat();
    if (
      !stat.isFile() ||
      (stat.mode & 0o077) !== 0 ||
      stat.size < 1 ||
      stat.size > 1024 ||
      (process.getuid && stat.uid !== process.getuid())
    )
      throw new Error('PAT file must be owner-only.');
    const buffer = Buffer.alloc(1025);
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
    if (bytesRead > 1024) throw new Error('PAT file exceeds limit.');
    const token = buffer.subarray(0, bytesRead).toString('utf8').trim();
    if (!/^sea_pat_[A-Za-z0-9_-]+$/.test(token)) throw new Error('Invalid PAT file.');
    return token;
  } finally {
    await handle.close();
  }
}
