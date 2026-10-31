import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { setTimeout, clearTimeout } from 'node:timers';
import { test } from 'node:test';
import { Client } from 'pg';
import { PrismaClient } from '@prisma/client';
import { assertSafeRuntimeTarget } from '../../packages/config/dist/index.js';
assertSafeRuntimeTarget({
  databaseUrl: process.env.DATABASE_URL ?? '',
  s3Endpoint: process.env.S3_ENDPOINT ?? '',
  s3Bucket: process.env.S3_BUCKET ?? '',
});
assert.equal(new URL(process.env.DATABASE_URL).pathname, '/sekereagle_test');

test('due outbox changes coalesce in a transaction without waking for future work or heartbeats', async () => {
  const url = new URL(process.env.DATABASE_URL);
  url.searchParams.delete('schema');
  const listener = new Client({ connectionString: url.toString() });
  const db = new PrismaClient();
  const ownerId = randomUUID();
  const channel = 'sekereagle_object_deletion_wakeup',
    barrierChannel = 'sekereagle_test_barrier';
  const events = [];
  listener.on('notification', (message) => {
    if (message.channel === channel) events.push(message);
  });
  const flush = async () => {
    const token = randomUUID();
    const done = new Promise((resolve, reject) => {
      const handler = (message) => {
        if (message.channel === barrierChannel && message.payload === token) {
          clearTimeout(timer);
          listener.off('notification', handler);
          resolve();
        }
      };
      const timer = setTimeout(() => {
        listener.off('notification', handler);
        reject(new Error('Notification barrier timed out'));
      }, 5000);
      listener.on('notification', handler);
    });
    await db.$executeRaw`SELECT pg_notify(${barrierChannel}, ${token})`;
    await done;
  };
  try {
    await listener.connect();
    await listener.query(`LISTEN ${channel}`);
    await listener.query(`LISTEN ${barrierChannel}`);
    const data = (suffix, availableAt) => ({
      ownerId,
      libraryMode: 'PHOTO',
      objectKeys: [],
      prefixes: [`users/${ownerId}/${suffix}/`],
      availableAt,
    });
    const future = await db.eagleObjectDeletion.create({
      data: data('future', new Date(Date.now() + 3600000)),
    });
    await flush();
    assert.equal(events.length, 0);
    await db.$transaction(async (tx) => {
      await tx.eagleObjectDeletion.createMany({
        data: [data('due-a', new Date(0)), data('due-b', new Date(0))],
      });
    });
    await flush();
    assert.equal(events.length, 1);
    assert.equal(events[0].payload, 'ready');
    await db.eagleObjectDeletion.update({
      where: { id: future.id },
      data: { availableAt: new Date(0) },
    });
    await flush();
    assert.equal(events.length, 2);
    await db.eagleObjectDeletion.update({
      where: { id: future.id },
      data: { availableAt: new Date(0) },
    });
    await db.eagleObjectDeletion.update({
      where: { id: future.id },
      data: { status: 'PROCESSING', lockedAt: new Date() },
    });
    await db.eagleObjectDeletion.update({
      where: { id: future.id },
      data: { lockedAt: new Date() },
    });
    await flush();
    assert.equal(events.length, 2);
  } finally {
    await db.eagleObjectDeletion.deleteMany({ where: { ownerId } });
    await listener.end();
    await db.$disconnect();
  }
});
