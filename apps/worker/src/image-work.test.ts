import { test } from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import { processImageWork, encodeImageWork, decodeImageWork } from './image-work';
test('shared local and remote image work preserves exact outputs and bounds',async()=>{
 const bytes=await sharp({create:{width:40,height:30,channels:3,background:'#fed123'}}).jpeg().toBuffer();
 const work={assetMimeType:'image/jpeg',sourceMimeType:'image/jpeg',kind:'GENERATE_RENDITIONS',mode:'MATERIAL',detailsOnly:false,verifiesOriginalHash:true} as const;
 const result=await processImageWork((async function*(){yield bytes;})(),work);
 assert.equal(result.result.rendered?.length,3);assert.equal(result.sha256.length,64);
 const decoded=await decodeImageWork(encodeImageWork(result),work);
 assert.deepEqual(decoded,result);
 await assert.rejects(decodeImageWork(Buffer.from('{}'),work));
 const broken=JSON.parse(encodeImageWork(result).toString());broken.result.rendered[0].spec.variant='../../evil';
 await assert.rejects(decodeImageWork(Buffer.from(JSON.stringify(broken)),work));
});
