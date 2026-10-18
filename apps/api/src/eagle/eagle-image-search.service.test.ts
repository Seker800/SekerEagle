import assert from 'node:assert/strict';
import test from 'node:test';
import {EagleImageSearchService} from './eagle-image-search.service';
const space={id:'qwen3-vl-embedding-2b-1024-v1',model:'Qwen/Qwen3-VL-Embedding-2B',revision:'9f2f7e710d6d81056aa5c0a4f04764fec6bb7bda',dimensions:1024,normalized:true,instructionVersion:'image-retrieval-v1',preprocessingVersion:'preview-webp-v1'};
test('image search caches/coalesces text vectors and scopes them by owner and mode',async()=>{
 let calls=0;
 const service=new EagleImageSearchService({eagleEmbeddingSpace:{findUnique:async()=>space}} as never,{embedText:async()=>{calls++;return {embedding:Array.from({length:1024},(_,i)=>i===0?1:0),revision:space.revision};}} as never);
 await Promise.all([service.prepare('one','猫'),service.prepare('one','猫')]);
 assert.equal(calls,1);
 await service.prepare('two','猫');assert.equal(calls,2);
});
test('mismatched image space and unavailable model degrade explicitly without reembedding images',async()=>{
 let calls=0;
 const service=new EagleImageSearchService({eagleEmbeddingSpace:{findUnique:async()=>({...space,revision:'wrong'})}} as never,{embedText:async()=>{calls++;throw new Error('offline');}} as never);
 assert.equal((await service.prepare('one','猫')).status,'UNAVAILABLE');assert.equal(calls,0);
});
test('ranking queries current image embeddings and never traverses AI tag links',async()=>{
 let sql='';
 const service=new EagleImageSearchService({$queryRaw:async(query:unknown)=>{sql=JSON.stringify(query);return [{assetId:'one'}];}} as never,{} as never);
 const result=await service.rank('owner','猫',{status:'READY',spaceId:space.id,vector:'[1,0]'},0,40,false,false);
 assert.deepEqual(result,['one']);assert.match(sql,/EagleAssetEmbedding/);assert.match(sql,/assetRevision/);assert.match(sql,/mediaRevision/);assert.match(sql,/isCurrent/);assert.match(sql,/READY/);assert.match(sql,/libraryMode/);assert.match(sql,/isPrivate/);assert.doesNotMatch(sql,/EagleAssetAiTag|EagleAiTag/);
});
