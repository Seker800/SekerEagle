import assert from 'node:assert/strict';
import test from 'node:test';
import { inspectJpegLivePhoto } from './live-photo';

test('static JPEG inspection reads a bounded header, never the full original', async () => {
  const requests: number[][] = [];
  const result = await inspectJpegLivePhoto(30_000_000, async (start, length) => {
    requests.push([start,length]); const bytes=Buffer.alloc(length); bytes[0]=255; bytes[1]=216; return bytes;
  });
  assert.deepEqual(requests, [[0,1024*1024]]);
  assert.equal(result.motion,null);
});

test('motion JPEG reads only the header and validated video range', async () => {
  const requests: number[][]=[];
  const motion=Buffer.alloc(20,7);
  const result=await inspectJpegLivePhoto(30_000_000, async (start,length)=>{
    requests.push([start,length]);
    if(start) return motion;
    const header=Buffer.alloc(length); header[0]=255; header[1]=216;
    header.write('<x GCamera:MicroVideo="1" GCamera:MicroVideoOffset="20"/>',2); return header;
  },async bytes=>{assert.deepEqual(bytes,motion);return {data:Buffer.from('video'),width:32,height:24};});
  assert.deepEqual(requests,[[0,1024*1024],[29_999_980,20]]);
  assert.equal(result.motion?.width,32);
});

test('invalid offsets never trigger a video read, short reads and storage errors fail for retry', async () => {
  let reads=0;
  await inspectJpegLivePhoto(100,async (_start,length)=>{ reads++; const head=Buffer.alloc(length);head[0]=255;head[1]=216;head.write('<x GCamera:MicroVideo="1" GCamera:MicroVideoOffset="999"/>',2);return head; });
  assert.equal(reads,1);
  await assert.rejects(()=>inspectJpegLivePhoto(100,async()=>Buffer.alloc(2)),/RANGE_LENGTH/);
  await assert.rejects(()=>inspectJpegLivePhoto(100,async()=>{throw new Error('offline');}),/offline/);
});
