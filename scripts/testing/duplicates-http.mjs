import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { CopyObjectCommand } from '@aws-sdk/client-s3';
import { setTimeout as delay } from 'node:timers/promises';
export async function verifyDuplicatesHttp({
  db,
  origin,
  accessToken,
  ownerId,
  assetId,
  s3,
  bucket,
}) {
  const call = (
    path,
    method = 'GET',
    body,
    requestOrigin = origin,
    cookie = `sekereagle_access=${accessToken}`,
  ) =>
    fetch(`${origin}/api${path}`, {
      method,
      headers: { cookie, origin: requestOrigin, 'content-type': 'application/json' },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
  const source = await db.eagleAsset.findUniqueOrThrow({
    where: { id: assetId },
    include: { renditions: { where: { status: 'READY' } } },
  });
  const cloneId = randomUUID(),
    originalKey = `users/${ownerId}/assets/${cloneId}/original`;
  await s3.send(
    new CopyObjectCommand({
      Bucket: bucket,
      Key: originalKey,
      CopySource: `${bucket}/${source.originalObjectKey}`,
    }),
  );
  await db.eagleAsset.create({
    data: {
      id: cloneId,
      ownerId,
      libraryMode: 'PHOTO',
      originalName: 'same-photo-imported-again.jpg',
      displayName: '重复导入样图',
      normalizedDisplayName: 'duplicate sample',
      mimeType: source.mimeType,
      format: source.format,
      byteSize: source.byteSize,
      sha256: source.sha256,
      width: source.width,
      height: source.height,
      lifecycleStatus: 'READY',
      mediaRevision: 1,
      originalObjectKey: originalKey,
    },
  });
  for (const rendition of source.renditions.filter(
    (r) => r.revision === source.mediaRevision && ['THUMBNAIL', 'PREVIEW'].includes(r.kind),
  )) {
    const storageKey = `users/${ownerId}/assets/${cloneId}/renditions/1/${rendition.kind}-${rendition.variant}`;
    await s3.send(
      new CopyObjectCommand({
        Bucket: bucket,
        Key: storageKey,
        CopySource: `${bucket}/${rendition.storageKey}`,
      }),
    );
    await db.eagleAssetRendition.create({
      data: {
        ownerId,
        libraryMode: 'PHOTO',
        assetId: cloneId,
        kind: rendition.kind,
        variant: rendition.variant,
        revision: 1,
        status: 'READY',
        mimeType: rendition.mimeType,
        byteSize: rendition.byteSize,
        width: rendition.width,
        height: rendition.height,
        storageKey,
      },
    });
  }
  assert.equal((await call('/photos/duplicates', 'GET', undefined, origin, '')).status, 401);
  let response = await call('/photos/duplicates');
  assert.equal(response.status, 200);
  const page = await response.json();
  const group = page.groups.find((g) => g.previews.some((r) => r.id === cloneId));
  assert.ok(group, 'new exact copy is visible over the real authenticated API');
  response = await call(`/photos/duplicates/${group.signature}/members`);
  assert.equal(response.status, 200);
  assert.ok((await response.json()).items.some((row) => row.id === cloneId));
  assert.equal((await call(`/eagle/duplicates/${group.signature}/members`)).status, 404);
  assert.equal(
    (
      await call('/photos/duplicates/cleanup', 'POST', {
        operationId: randomUUID(),
        groups: [{ signature: group.signature, keepIds: [source.id] }],
        ownerId,
      })
    ).status,
    400,
  );
  assert.equal(
    (
      await call(
        '/photos/duplicates/scan',
        'POST',
        { operationId: randomUUID() },
        'https://untrusted.invalid',
      )
    ).status,
    403,
  );
  const operationId = randomUUID();
  response = await call('/photos/duplicates/cleanup', 'POST', {
    operationId,
    groups: [{ signature: group.signature, keepIds: [source.id] }],
  });
  assert.equal(response.status, 201);
  for (let i = 0; i < 160; i++) {
    const row = await db.eagleAsset.findUniqueOrThrow({ where: { id: cloneId } });
    if (row.deletedAt) break;
    await delay(100);
    if (i === 159) throw new Error('separate executor did not finish duplicate cleanup');
  }
  assert.equal(
    (await db.eagleAsset.findUniqueOrThrow({ where: { id: source.id } })).deletedAt,
    null,
  );
  const restored = await call('/photos/operations', 'POST', {
    operationId: randomUUID(),
    kind: 'RESTORE',
    assetIds: [cloneId],
  });
  assert.equal(restored.status, 201);
  for (let i = 0; i < 160; i++) {
    if (!(await db.eagleAsset.findUniqueOrThrow({ where: { id: cloneId } })).deletedAt) break;
    await delay(100);
    if (i === 159) throw new Error('restore did not finish');
  }
  response = await call('/photos/duplicates/scan', 'POST', { operationId: randomUUID() });
  assert.equal(response.status, 201);
  const scan = await response.json();
  for (let i = 0; i < 200; i++) {
    const response = await call('/photos/operations'),
      rows = await response.json(),
      operation = rows.find((row) => row.id === scan.operationId);
    if (operation && !operation.queued && !operation.running) {
      assert.equal(operation.failed, 0);
      break;
    }
    await delay(100);
    if (i === 199) throw new Error('real object storage scan did not finish');
  }
  const indexed = await (await call('/photos/duplicates')).json();
  assert.ok(indexed.coverage.indexed >= 4);
  return { cloneId, groupCount: page.totalGroups, indexed: indexed.coverage.indexed };
}
