import assert from 'node:assert/strict';
import test from 'node:test';
import { EagleUploadService } from './eagle-upload.service';
import { ObjectStorageService } from '../storage/object-storage.service';

const owner='owner-a',id='session-a',sha='a'.repeat(64);
function fixture(overrides:Record<string,unknown>={}) {
  const session={id,uploaderId:owner,libraryMode:'PHOTO',originalName:'camera.raf',mimeType:'image/x-fuji-raf',size:12n,objectKey:'users/owner-a/assets/a/original.raf',status:'ASSEMBLED',eagleState:{expectedContentSha256:sha},...overrides};
  const calls:unknown[]=[];
  const prisma={uploadSession:{findFirst:async(q:unknown)=>{calls.push(q);return session;},count:async()=>0,updateMany:async()=>({count:1})}};
  const inspection={inspect:async()=>assert.fail('local copy must not decode or re-read the original')};
  const service=new EagleUploadService(prisma as never,{headObject:async()=>({ContentLength:12})} as never,{} as never,inspection as never,'PHOTO');
  Object.assign(service,{publishInspectedOriginal:async(...args:unknown[])=>{calls.push(args);return {assetId:'asset-a',duplicate:false};}});
  return {service,calls};
}
test('trusted local completion uses shared publication without media decoding',async()=>{
  const {service,calls}=fixture();
  await service.completeLocalCopy(owner,id,sha,[{partNumber:1,etag:'part'}]);
  const args=calls.at(-1) as unknown[];
  assert.deepEqual(args[2],{sha256:sha,format:'raf',width:null,height:null,durationMs:null});
  assert.deepEqual((calls[0] as {where:unknown}).where,{id,uploaderId:owner,status:{in:['INITIATED','ASSEMBLED','FAILED','COMPLETED']},libraryMode:'PHOTO'});
});
test('local completion rejects a changed original checksum',async()=>{
  const {service}=fixture();await assert.rejects(service.completeLocalCopy(owner,id,'b'.repeat(64),[{partNumber:1,etag:'part'}]),/校验/);
});
test('local completion rejects editing and replacement sessions',async()=>{
  for(const state of [{copySourceAssetId:'source'},{replacementAssetId:'source'}]){
    const {service}=fixture({eagleState:state});await assert.rejects(service.completeLocalCopy(owner,id,sha,[{partNumber:1,etag:'part'}]),/本地复制/);
  }
});
test('cross-owner or cross-mode session is not disclosed',async()=>{
  const service=new EagleUploadService({uploadSession:{findFirst:async()=>null,count:async()=>0}} as never,{} as never,{} as never,{} as never,'PHOTO');
  await assert.rejects(service.completeLocalCopy('other',id,sha,[]),/不存在/);
});
test('storage upload parts include ContentMD5 and preserve bytes',async()=>{
  let sent:unknown;
  const service=Object.assign(Object.create(ObjectStorageService.prototype) as ObjectStorageService,{bucket:'sekereagle-assets',client:{send:async(x:unknown)=>{sent=x;return {ETag:'etag'};}}});
  assert.equal(await service.uploadLocalPart('key','multipart',1,Buffer.from('abc')),'etag');
  assert.deepEqual((sent as {input:{Body:Buffer}}).input.Body,Buffer.from('abc'));
  assert.equal((sent as {input:{ContentMD5:string}}).input.ContentMD5,'kAFQmDzST7DWlj99KOF/cg==');
});
