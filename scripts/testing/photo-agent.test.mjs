import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, test } from 'node:test';
import { PrismaClient } from '@prisma/client';
import { assertSafeRuntimeTarget } from '../../packages/config/dist/index.js';
import { PhotoAgentService } from '../../apps/api/dist/photos/photo-agent.service.js';
import { EagleService } from '../../apps/api/dist/eagle/eagle.service.js';
assertSafeRuntimeTarget({databaseUrl:process.env.DATABASE_URL??'',s3Endpoint:process.env.S3_ENDPOINT??'',s3Bucket:process.env.S3_BUCKET??''});
assert.equal(new URL(process.env.DATABASE_URL).pathname,'/sekereagle_test');
const prisma=new PrismaClient();after(()=>prisma.$disconnect());
const city={id:'cn-zj-hangzhou',name:'杭州市',country:'中国',region:'浙江省',latitude:30.25,longitude:120.15};
async function fixture() {
 const ownerId=randomUUID();
 await prisma.user.create({data:{id:ownerId,email:`${ownerId}@example.invalid`,passwordHash:'test-only'}});
 const add=(libraryMode='PHOTO',more={})=>prisma.eagleAsset.create({data:{ownerId,libraryMode,originalName:'Screenshot_2026.png',displayName:'sample',normalizedDisplayName:'sample',mimeType:'image/png',format:'png',byteSize:1,originalObjectKey:`test/${randomUUID()}`,lifecycleStatus:'READY',...more}});
 const a=await add(),b=await add(),c=await add();
 for(const [asset,minute,gps] of [[a,0,false],[b,-5,true],[c,5,true]]) await prisma.eaglePhotoMetadata.create({data:{ownerId,assetId:asset.id,assetRevision:0,processorVersion:'test',capturedAt:new Date(Date.parse('2026-10-01T10:00:00Z')+minute*60000),captureTimeZoneKnown:true,...(gps?{latitude:30.25,longitude:120.15}:{})}});
 const service=new PhotoAgentService(prisma,{prepare:async()=>({status:'UNAVAILABLE',spaceId:'test'})});
 const photos=new EagleService(prisma,undefined,'PHOTO');
 const task=async(kind='CITY')=>service.createTask(ownerId,{kind,assetIds:[a.id,b.id,c.id]},false);
 const proposal=async(t,more={})=>service.propose(ownerId,t.id,{assetId:a.id,evidenceIds:t.kind==='CITY'?[b.id,c.id]:[],visualReviewed:true,rationale:'已核对画面与本次拍摄证据。',...(t.kind==='CITY'?{city}:{}),...more},false);
 return {ownerId,add,a,b,c,service,photos,task,proposal};
}
test('photo tasks freeze only visible owned PHOTO resources and paginate without leaking',async()=>{
 const f=await fixture(),other=await fixture();
 const material=await f.add('MATERIAL'),hidden=await f.add('PHOTO',{isPrivate:true});
 for(const asset of [material,hidden,other.a]) await assert.rejects(f.service.createTask(f.ownerId,{kind:'CITY',assetIds:[f.a.id,asset.id]},false),/不存在/);
 const task=await f.task();
 await assert.rejects(f.service.detail(other.ownerId,task.id,false),/不存在/);
 const page=await f.service.photos(f.ownerId,{limit:2},false);
 assert.equal(page.items.length,2);assert.ok(page.next);
 assert.ok(page.items.every(a=>![hidden.id,material.id].includes(a.id)));
 const next=await f.service.photos(f.ownerId,{limit:2,after:page.next},false);
 assert.ok(next.items.every(a=>!page.items.some(x=>x.id===a.id)));
 await prisma.eagleAsset.update({where:{id:f.b.id},data:{isPrivate:true}});
 await assert.rejects(f.service.detail(f.ownerId,task.id,false),/不存在/);
 assert.equal((await f.service.tasks(f.ownerId,{limit:20},false)).items.length,0);
});
test('city proposal, confirmation, shared asset projection, city filtering and undo preserve original GPS',async()=>{
 const f=await fixture(),t=await f.task();
 const candidates=await f.service.infer(f.ownerId,t.id,{cities:[city],offsetSeconds:0},false);
 assert.equal(candidates.candidates.length,1);
 const p=await f.proposal(t);
 assert.equal((await f.proposal(t)).id,p.id,'proposal retry is idempotent');
 await f.service.review(f.ownerId,t.id,p.id,{action:'ACCEPT'},false);
 await f.service.review(f.ownerId,t.id,p.id,{action:'ACCEPT'},false);
 const location=await prisma.eaglePhotoLocation.findUniqueOrThrow({where:{assetId:f.a.id}});
 assert.equal(location.cityId,city.id);assert.equal(location.source,'INFERRED');
 assert.equal((await prisma.eaglePhotoMetadata.findUniqueOrThrow({where:{assetId:f.a.id}})).latitude,null);
 const asset=await f.photos.getAsset(f.ownerId,f.a.id);
 assert.equal(asset.photoLocation.name,city.name);
 const result=await f.photos.listAssets(f.ownerId,{limit:20,rules:JSON.stringify({version:2,conditions:[{id:'city',match:'ALL',result:'MATCH',rules:[{id:'r',field:'CITY',operator:'EQUALS',value:city.name}]}]})});
 assert.deepEqual(result.items.map(a=>a.id),[f.a.id]);
 await f.service.undo(f.ownerId,t.id,p.id,false);await f.service.undo(f.ownerId,t.id,p.id,false);
 assert.equal(await prisma.eaglePhotoLocation.count({where:{assetId:f.a.id}}),0);
});
test('non-photo human decisions, trash, undo and cancellation are durable and idempotent',async()=>{
 const f=await fixture(),t=await f.task('NON_PHOTO');
 const p=await f.proposal(t);await f.service.review(f.ownerId,t.id,p.id,{action:'REJECT'},false);
 const again=await f.task('NON_PHOTO');await assert.rejects(f.proposal(again),/人工保留/);
 const g=await fixture(),gt=await g.task('NON_PHOTO'),gp=await g.proposal(gt);
 await g.service.review(g.ownerId,gt.id,gp.id,{action:'ACCEPT'},false);
 const after=await prisma.eagleAsset.findUniqueOrThrow({where:{id:g.a.id}});assert.ok(after.deletedAt);assert.equal(after.rowVersion,2);
 await g.service.review(g.ownerId,gt.id,gp.id,{action:'ACCEPT'},false);
 assert.equal((await prisma.eagleAsset.findUniqueOrThrow({where:{id:g.a.id}})).rowVersion,2);
 await g.service.cancel(g.ownerId,gt.id,false);
 await g.service.undo(g.ownerId,gt.id,gp.id,false);
 assert.equal((await prisma.eagleAsset.findUniqueOrThrow({where:{id:g.a.id}})).deletedAt,null);
});
test('stale target, evidence, expired plan, cancellation and revoked visibility cannot apply',async()=>{
 for(const variant of ['target','evidence','expired','cancelled','private']) {
  const f=await fixture(),t=await f.task(),p=await f.proposal(t);
  if(variant==='target'||variant==='evidence') await prisma.eagleAsset.update({where:{id:variant==='target'?f.a.id:f.b.id},data:{rowVersion:{increment:1}}});
  if(variant==='expired') await prisma.eaglePhotoAgentTask.update({where:{id:t.id},data:{expiresAt:new Date(0)}});
  if(variant==='cancelled') await f.service.cancel(f.ownerId,t.id,false);
  if(variant==='private') await prisma.eagleAsset.update({where:{id:f.a.id},data:{isPrivate:true}});
  await assert.rejects(f.service.review(f.ownerId,t.id,p.id,{action:'ACCEPT'},false));
  assert.equal(await prisma.eaglePhotoLocation.count({where:{ownerId:f.ownerId}}),0,variant);
 }
});
test('undo cannot overwrite later edits, and replacement invalidates accepted location',async()=>{
 const f=await fixture(),t=await f.task(),p=await f.proposal(t);await f.service.review(f.ownerId,t.id,p.id,{action:'ACCEPT'},false);
 await prisma.eagleAsset.update({where:{id:f.a.id},data:{rowVersion:{increment:1}}});
 await assert.rejects(f.service.undo(f.ownerId,t.id,p.id,false),/已变化/);
 await prisma.eagleAsset.update({where:{id:f.a.id},data:{mediaRevision:{increment:1}}});
 assert.equal(await prisma.eaglePhotoLocation.count({where:{assetId:f.a.id}}),0);
});
test('model unavailable reports filename-only candidates and never creates verdicts',async()=>{
 const f=await fixture(),t=await f.task('NON_PHOTO');
 const result=await f.service.scores(f.ownerId,t.id,'screenshot',false);
 assert.equal(result.status,'UNAVAILABLE');assert.ok(result.items.every(a=>a.filenameSignals.includes('SCREENSHOT_NAME')));
 assert.equal((await f.service.detail(f.ownerId,t.id,false)).suggestions.length,0);
 await assert.rejects(f.proposal(t,{visualReviewed:false}),/查看照片/);
});
test('database scope constraints reject cross-owner, mode and invalid city coordinates',async()=>{
 const f=await fixture(),other=await fixture(),t=await f.task();
 await assert.rejects(prisma.eaglePhotoAgentTask.update({where:{id:t.id},data:{libraryMode:'MATERIAL'}}));
 await assert.rejects(prisma.eaglePhotoAgentSuggestion.create({data:{ownerId:other.ownerId,taskId:t.id,assetId:other.a.id,assetRevision:0,assetRowVersion:1,kind:'CITY',value:{},evidence:[],rationale:'invalid scope'}}));
 await assert.rejects(prisma.eaglePhotoLocation.create({data:{ownerId:f.ownerId,assetId:f.a.id,assetRevision:0,cityId:'invalid',name:'invalid',country:'x',region:'x',latitude:91,longitude:0,suggestionId:randomUUID()}}));
});
test('real HTTP rejects PAT review and cross-scope requests but permits photo-scoped reads and proposals',async()=>{
 const defaults={NODE_ENV:'test',PORT:'3000',CANONICAL_ORIGIN:'http://localhost:8180',JWT_ACCESS_SECRET:'isolated-photo-agent-signing-key-over-32-characters',ACCESS_TOKEN_TTL_SECONDS:'900',REFRESH_TOKEN_TTL_SECONDS:'2592000',S3_PUBLIC_ENDPOINT:'http://localhost:8180',S3_REGION:'us-east-1',S3_ACCESS_KEY_ID:'isolated-test-only',S3_SECRET_ACCESS_KEY:'isolated-test-only'};
 for(const [key,value]of Object.entries(defaults))process.env[key]??=value;
 const {NestFactory}=await import('@nestjs/core');const {ValidationPipe}=await import('@nestjs/common');const {default:cookieParser}=await import('cookie-parser');const {AppModule}=await import('../../apps/api/dist/app.module.js');const {PatService}=await import('../../apps/api/dist/auth/pat.service.js');const {SessionTokenService}=await import('../../apps/api/dist/auth/session-token.service.js');const {ACCESS_COOKIE_NAME}=await import('../../apps/api/dist/auth/auth.constants.js');
 const app=await NestFactory.create(AppModule,{logger:false});app.setGlobalPrefix('api');app.use(cookieParser());app.useGlobalPipes(new ValidationPipe({transform:true,whitelist:true,forbidNonWhitelisted:true}));
 try {
  await app.listen(0,'127.0.0.1');const base=await app.getUrl(),f=await fixture(),t=await f.task(),p=await f.proposal(t);
  const pat=await app.get(PatService).create(f.ownerId,'test-photo-agent',['photo:read','photo:suggest']);
  const read=await app.get(PatService).create(f.ownerId,'test-read',['photo:read']);
  const auth={authorization:`Bearer ${pat.token}`,'content-type':'application/json'};
  assert.equal((await fetch(`${base}/api/photos/agent/photos`)).status,401);
  assert.equal((await fetch(`${base}/api/photos/agent/photos`,{headers:auth})).status,200);
  assert.equal((await fetch(`${base}/api/photos/agent/photos?ownerId=x`,{headers:auth})).status,400);
  for(const path of [`tasks/${t.id}/cancel`,`tasks/${t.id}/suggestions/${p.id}/review`,`tasks/${t.id}/suggestions/${p.id}/undo`]) assert.equal((await fetch(`${base}/api/photos/agent/${path}`,{method:'POST',headers:auth,body:JSON.stringify({action:'ACCEPT'})})).status,403);
  assert.equal((await fetch(`${base}/api/photos/agent/tasks`,{method:'POST',headers:{...auth,authorization:`Bearer ${read.token}`},body:JSON.stringify({kind:'CITY',assetIds:[f.a.id]})})).status,403);
  const user=await prisma.user.findUniqueOrThrow({where:{id:f.ownerId}}),session=await app.get(SessionTokenService).createSession(user);
  const response=await fetch(`${base}/api/photos/agent/tasks/${t.id}/suggestions/${p.id}/review`,{method:'POST',headers:{cookie:`${ACCESS_COOKIE_NAME}=${session.accessToken}`,'content-type':'application/json',origin:'http://localhost:8180'},body:JSON.stringify({action:'ACCEPT'})});
  assert.equal(response.status,201,await response.text());
 } finally {await app.close();}
});
