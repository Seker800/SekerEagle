import assert from 'node:assert/strict';
import test from 'node:test';
import { NotFoundException } from '@nestjs/common';
import { EagleLibraryTransferService } from './eagle-library-transfer.service';

test('unauthorized or mixed source IDs fail before any object copy or operation plan', async () => {
  let copied = 0;
  const db = {
    eagleLibraryTransfer: { findUnique: async () => null },
    eagleAsset: {
      findMany: async ({ where }: { where: unknown }) => {
        assert.deepEqual(where, {
          ownerId: 'owner',
          libraryMode: 'PHOTO',
          id: { in: ['foreign'] },
          deletedAt: null,
          isPrivate: false,
        });
        return [];
      },
    },
  } as never;
  const storage = {
    copyObject: async () => {
      copied++;
    },
  } as never;
  await assert.rejects(
    () =>
      new EagleLibraryTransferService(db, storage, 'PHOTO').send(
        'owner',
        { operationId: 'op', assetIds: ['foreign'] },
        false,
      ),
    NotFoundException,
  );
  assert.equal(copied, 0);
});

test('approval snapshot mismatch fails before a transfer plan or any object copy', async () => {
  let writes = 0;
  const db = {
    eagleLibraryTransfer: {
      findUnique: async () => null,
      upsert: async () => {
        writes++;
      },
    },
    eagleAsset: { findMany: async () => [{ id: 'photo', mediaRevision: 2, rowVersion: 1 }] },
  } as never;
  const storage = {
    copyObject: async () => {
      writes++;
    },
  } as never;
  await assert.rejects(
    new EagleLibraryTransferService(db, storage, 'PHOTO').send(
      'owner',
      { operationId: 'op', assetIds: ['photo'] },
      false,
      new Map([['photo', { mediaRevision: 1, rowVersion: 1 }]]),
    ),
    /照片已变化/,
  );
  assert.equal(writes, 0);
});

test('an edit between approval validation and plan creation cannot silently replace the approved version', async () => {
  let reads = 0,
    writes = 0;
  const db = {
    eagleLibraryTransfer: {
      findUnique: async () => null,
      upsert: async () => {
        writes++;
      },
    },
    eagleAsset: {
      findMany: async () => [
        {
          id: 'photo',
          mediaRevision: 1,
          rowVersion: ++reads === 1 ? 1 : 2,
          mimeType: 'image/jpeg',
          lifecycleStatus: 'READY',
        },
      ],
    },
  } as never;
  await assert.rejects(
    new EagleLibraryTransferService(
      db,
      {
        copyObject: async () => {
          writes++;
        },
      } as never,
      'PHOTO',
    ).send(
      'owner',
      { operationId: 'op', assetIds: ['photo'] },
      false,
      new Map([['photo', { mediaRevision: 1, rowVersion: 1 }]]),
    ),
    /照片已变化/,
  );
  assert.equal(reads, 2);
  assert.equal(writes, 0);
});

test('sending current browse outputs copies independent derivatives and publishes a ready target', async () => {
  const ownerId='00000000-0000-4000-8000-000000000001';
  const sourceId='00000000-0000-4000-8000-000000000002';
  const targetId='00000000-0000-4000-8000-000000000003';
  const renditions=[['PREVIEW','default'],['THUMBNAIL','256'],['THUMBNAIL','512']].map(([kind,variant],i)=>({id:`r${i}`,kind,variant,revision:2,status:'READY',storageKey:`users/${ownerId}/assets/${sourceId}/r${i}.webp`,mimeType:'image/webp',byteSize:1n,width:512,height:512}));
  const plan=renditions.map(r=>({...r,byteSize:undefined,size:'1',sourceKey:r.storageKey,targetKey:`users/${ownerId}/assets/${targetId}/${r.id}.webp`}));
  const source={id:sourceId,ownerId,libraryMode:'PHOTO',mediaRevision:2,rowVersion:1,originalObjectKey:`users/${ownerId}/assets/${sourceId}/original.jpg`,originalName:'a.jpg',displayName:'a',normalizedDisplayName:'a',format:'jpeg',mimeType:'image/jpeg',lifecycleStatus:'READY',annotation:null,renditions,width:1000,height:1000};
  const operation={id:'op',ownerId,sourceMode:'PHOTO',targetMode:'MATERIAL',sourceIds:[sourceId],status:'COPYING',plan:[{sourceId,targetId,revision:2,rowVersion:1,sourceKey:source.originalObjectKey,targetKey:`users/${ownerId}/assets/${targetId}/original.jpg`,size:'1',renditions:plan}]};
  const copies:string[][]=[];const created:Record<string,unknown>[]=[];let jobs:Array<{kind:string;processorVersion:string}>=[];let published:unknown[]=[];
  const tx={
    $queryRaw:async()=>[],
    eagleLibraryTransfer:{findUnique:async()=>operation,findUniqueOrThrow:async()=>operation,update:async()=>operation},
    eagleAsset:{findMany:async()=>[source],create:async({data}:{data:Record<string,unknown>})=>{created.push(data);return data;},updateMany:async()=>({count:1})},
    eagleAssetRendition:{createMany:async({data}:{data:unknown[]})=>{published=data;}},
    eagleAssetProcessingJob:{createMany:async({data}:{data:typeof jobs})=>{jobs=data;}},
  };
  const db={...tx,$transaction:async(fn:(tx:unknown)=>unknown)=>fn(tx)};
  const service=new EagleLibraryTransferService(db as never,{copyObject:async(a:string,b:string)=>{copies.push([a,b]);},headObject:async()=>({ContentLength:1})} as never,'PHOTO');
  await service.send(ownerId,{operationId:'op',assetIds:[sourceId]},false);
  assert.equal(copies.length,4);
  assert.equal(created[0]!.lifecycleStatus,'READY');
  assert.equal(published.length,3);
  assert.ok(!jobs.some(j=>j.kind==='GENERATE_RENDITIONS'&&j.processorVersion==='rendition-v2'));
});
