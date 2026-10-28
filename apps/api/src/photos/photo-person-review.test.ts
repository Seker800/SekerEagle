import assert from 'node:assert/strict';
import test from 'node:test';
import { PhotoManagementService } from './photo-management.service';

test('person merge refuses a stale review before moving any faces', async () => {
  let writes=0;
  const tx={ $executeRaw:async()=>0,eaglePhotoPerson:{findFirst:async({where}:{where:{id:string}})=>({id:where.id,rowVersion:2,marksAssetsPrivate:false}),update:async()=>{writes++;return{};}},eaglePhotoFace:{updateMany:async()=>{writes++;}}};
  const service=new PhotoManagementService({$transaction:async(fn:(tx:unknown)=>unknown)=>fn(tx)} as never);
  await assert.rejects(service.mergePeople('owner','source','target',false,{source:1,target:1}),/变化/);
  assert.equal(writes,0);
});
