import { PrismaClient } from '@prisma/client';
import { assertSafeRuntimeTarget, describeRuntimeTarget } from '@sekereagle/config';

const databaseUrl = process.env.DATABASE_URL ?? '';
const s3Endpoint = process.env.S3_ENDPOINT ?? '';
const s3Bucket = process.env.S3_BUCKET ?? '';
assertSafeRuntimeTarget({ databaseUrl, s3Endpoint, s3Bucket });
process.stdout.write(
  `SekerEagle worker target: ${describeRuntimeTarget({ databaseUrl, s3Endpoint, s3Bucket })}\n`,
);

const prisma = new PrismaClient();
let timer: NodeJS.Timeout | undefined;
let stopping = false;

async function heartbeat(): Promise<void> {
  await prisma.$queryRaw`SELECT 1`;
}

async function stop(signal: string): Promise<void> {
  if (stopping) return;
  stopping = true;
  if (timer) clearInterval(timer);
  process.stdout.write(`SekerEagle worker received ${signal}\n`);
  await prisma.$disconnect();
  process.exitCode = 0;
}

async function main(): Promise<void> {
  await heartbeat();
  process.stdout.write('SekerEagle worker ready\n');
  timer = setInterval(() => {
    void heartbeat().catch((error: unknown) => {
      const message = error instanceof Error ? error.message : 'unknown worker heartbeat error';
      process.stderr.write(`${message}\n`);
    });
  }, 30_000);
}

process.on('SIGTERM', () => void stop('SIGTERM'));
process.on('SIGINT', () => void stop('SIGINT'));
void main().catch(async (error: unknown) => {
  const message = error instanceof Error ? error.message : 'unknown worker startup error';
  process.stderr.write(`${message}\n`);
  await prisma.$disconnect();
  process.exitCode = 1;
});
