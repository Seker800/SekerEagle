import 'reflect-metadata';
import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ExecutionContext } from '@nestjs/common';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { AccessAuthGuard } from '../auth/access-auth.guard';
import { AdminGuard } from '../auth/admin.guard';
import { BackupController } from './backup.controller';
import { publicBackupStatus } from './backup-status';

test('backup metadata requires an authenticated browser administrator', () => {
  assert.deepEqual(Reflect.getMetadata(GUARDS_METADATA, BackupController), [
    AccessAuthGuard,
    AdminGuard,
  ]);
  const guard = new AdminGuard();
  for (const user of [
    undefined,
    { kind: 'pat', role: 'ADMIN' },
    { kind: 'browser', role: 'USER' },
  ]) {
    const context = {
      switchToHttp: () => ({ getRequest: () => ({ user }) }),
    } as unknown as ExecutionContext;
    assert.throws(() => guard.canActivate(context));
  }
});

test('status is a narrow projection with no credentials, paths or exception messages', () => {
  const status = publicBackupStatus({
    configured: true,
    target: 'SekerDesign',
    password: 'secret',
    path: '/private',
    error: 'secret',
  });
  assert.deepEqual(status, {
    configured: true,
    target: 'SekerDesign',
    status: 'never',
    lastAttemptAt: null,
    lastSuccessAt: null,
    nextScheduledAt: null,
    overdue: false,
  });
});

test('a failed attempt retains its previous successful backup and becomes overdue', () => {
  const status = publicBackupStatus(
    {
      configured: true,
      status: 'failed',
      lastSuccessAt: '2026-10-01T00:00:00Z',
      nextScheduledAt: 'invalid',
    },
    Date.parse('2026-10-18T00:00:00Z'),
  );
  assert.equal(status.lastSuccessAt, '2026-10-01T00:00:00Z');
  assert.equal(status.status, 'failed');
  assert.equal(status.overdue, true);
  assert.equal(status.nextScheduledAt, null);
});

test('missing, malformed and oversized status files fail closed without leaking file details', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'eagle-backup-status-'));
  const previous = process.env.SEKEREAGLE_BACKUP_STATUS_FILE;
  const path = join(directory, 'status.json');
  process.env.SEKEREAGLE_BACKUP_STATUS_FILE = path;
  try {
    const controller = new BackupController();
    await assert.rejects(controller.status(), /Backup status is temporarily unavailable/);
    await writeFile(path, '{broken');
    await assert.rejects(controller.status(), /Backup status is temporarily unavailable/);
    await writeFile(path, JSON.stringify({ password: 's'.repeat(20_000) }));
    await assert.rejects(controller.status(), /Backup status is temporarily unavailable/);
    await writeFile(
      path,
      JSON.stringify({
        configured: true,
        target: 'SekerDesign',
        status: 'succeeded',
        lastSuccessAt: '2026-10-18T01:00:00Z',
        secret: 'never expose',
      }),
    );
    const status = await controller.status();
    assert.equal(status.lastSuccessAt, '2026-10-18T01:00:00Z');
    assert.equal(JSON.stringify(status).includes('never expose'), false);
  } finally {
    if (previous === undefined) delete process.env.SEKEREAGLE_BACKUP_STATUS_FILE;
    else process.env.SEKEREAGLE_BACKUP_STATUS_FILE = previous;
    await rm(directory, { recursive: true, force: true });
  }
});
