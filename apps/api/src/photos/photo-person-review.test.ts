import assert from 'node:assert/strict';
import test from 'node:test';
import { PhotoManagementService } from './photo-management.service';

test('person merge refuses a stale review before moving any faces', async () => {
  let writes = 0;
  const tx = {
    $queryRaw:async()=>[], $executeRaw: async () => 0,
    eaglePhotoPerson: {
      findFirst: async ({ where }: { where: { id: string } }) => ({
        id: where.id,
        rowVersion: 2,
        marksAssetsPrivate: false,
      }),
      update: async () => {
        writes++;
        return {};
      },
    },
    eaglePhotoFace: {
      updateMany: async () => {
        writes++;
      },
    },
  };
  const service = new PhotoManagementService({
    $transaction: async (fn: (tx: unknown) => unknown) => fn(tx),
  } as never);
  await assert.rejects(
    service.mergePeople('owner', 'source', 'target', false, { source: 1, target: 1 }),
    /变化/,
  );
  assert.equal(writes, 0);
});

test('a different-person answer fences both identities against concurrent stale confirmation',async()=>{
 const {PhotoPersonReviewService}=await import('./photo-person-review.service');
 const changed:string[]=[];
 const tx={$queryRaw:async()=>[], $executeRaw:async()=>0,eaglePhotoPerson:{findFirst:async({where}:{where:{id:string}})=>({id:where.id,rowVersion:1}),updateMany:async({where}:{where:{id:{in:string[]}}})=>{changed.push(...where.id.in);return{count:2};}},eaglePhotoPersonSeparation:{findUnique:async()=>null,createMany:async()=>({count:1})}};
 const service=new PhotoPersonReviewService({$transaction:async(fn:(value:unknown)=>unknown)=>fn(tx)} as never,{} as never);
 await service.decide('owner',false,{firstId:'a',secondId:'b',firstVersion:1,secondVersion:1,decision:'DIFFERENT'});
 assert.deepEqual(changed.sort(),['a','b']);
});
