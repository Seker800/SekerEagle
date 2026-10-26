import { test } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import sharp from 'sharp';
import { createRemoteMediaServer, RemoteMediaClient } from './remote-media';
test('real HTTP media execution validates auth and returns identical bounded renditions',async t=>{
 const server=createRemoteMediaServer('test-media-token',1);server.listen(0,'127.0.0.1');await once(server,'listening');t.after(()=>{server.closeAllConnections();server.close();});
 const address=server.address();if(!address||typeof address==='string')throw new Error('address');
 const base=`http://127.0.0.1:${address.port}`;
 assert.equal((await fetch(base+'/healthz')).status,401);
 const health=await(await fetch(base+'/healthz',{headers:{authorization:'Bearer test-media-token'}})).json() as {operations:string[]};assert.ok(health.operations.includes('image'));
 const bytes=await sharp({create:{width:48,height:32,channels:3,background:'#123abc'}}).jpeg().toBuffer();
 const client=new RemoteMediaClient(base,'test-media-token');
 const result=await client.image((async function*(){yield bytes;})(),{assetMimeType:'image/jpeg',sourceMimeType:'image/jpeg',kind:'GENERATE_RENDITIONS',mode:'PHOTO',detailsOnly:false,verifiesOriginalHash:true});
 assert.equal(result.result.rendered?.length,3);assert.ok(result.sha256);
});
