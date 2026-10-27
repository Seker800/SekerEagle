import {test} from 'node:test';
import assert from 'node:assert/strict';
import {FACE_MODEL_VERSION,cosineSimilarity,validateFaceResult} from './face-inference';
test('stateless face computation preserves the model contract without loading database runtime',()=>{
  assert.equal(FACE_MODEL_VERSION,'yunet-2023mar-sface-2021dec-v1');
  assert.deepEqual(validateFaceResult({version:FACE_MODEL_VERSION,faces:[]}),[]);
  assert.equal(cosineSimilarity([1,0],[0,1]),0);
  assert.equal(Object.keys(require.cache).some((path)=>path.includes('/@prisma/')),false);
  assert.equal(Object.keys(require.cache).some((path)=>path.includes('/library-persistence/')),false);
});
