import assert from 'node:assert/strict';
import test from 'node:test';
import { refreshSourceTimeline } from './source-timeline';
const item = { assetId:'d8fb6228-3a17-4f12-8f63-6777899939ad',sha256:'a'.repeat(64),mediaRevision:0,sourceDate:'2020-05-13T05:17:40.000Z',dateSource:'CreateDate' };
test('timeline repair is bounded and fenced by owner, PHOTO, original hash, revision and capture inheritance', async () => {
 let query: { text:string; values:unknown[] } | undefined;
 const db = { $queryRaw: (q:typeof query) => {query=q;return Promise.resolve([{id:item.assetId}]);} };
 const rows=await refreshSourceTimeline(db as never,'owner',[item]);
 assert.equal(rows.length,1);
 for(const clause of ['"ownerId"','\'PHOTO\'','"sha256"','"mediaRevision"','"deletedAt" IS NULL','"captureMetadataInherited"','"capturedAt"','"chronologicalAt"']) assert.ok(query!.text.includes(clause),clause);
 assert.ok(query!.values.includes('owner'));
 assert.match(query!.text,/COALESCE/);
 assert.match(query!.text,/IS DISTINCT FROM/);
 assert.doesNotMatch(query!.text,/SET[^;]*"libraryAddedAt"\s*=/);
});
test('invalid, duplicate or oversized repair evidence fails before database access', async () => {
 const db={ $queryRaw:()=>{throw Error('UNEXPECTED_WRITE');} };
 for(const items of [[],Array.from({length:1001},()=>item),[item,item],[{...item,sourceDate:'bad'}],[{...item,dateSource:'ImportTime'}],[{...item,sha256:'bad'}]]) await assert.rejects(refreshSourceTimeline(db as never,'owner',items));
});

test('a bounded thousand-row date batch reduces NAS commit overhead', async () => {
 const rows=Array.from({length:1000},(_,i)=>({...item,assetId:`d8fb6228-3a17-4f12-8f63-${String(i).padStart(12,'0')}`}));
 let calls=0; await refreshSourceTimeline({$queryRaw:()=>{calls++;return Promise.resolve([]);}} as never,'owner',rows); assert.equal(calls,1);
});
