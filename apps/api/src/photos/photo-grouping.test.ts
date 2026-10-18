import assert from 'node:assert/strict';
import test from 'node:test';
import { suggestPhotoGroups } from './photo-grouping';
test('grouping is conservative about missing dates and selects a clear reference without removing originals',()=>{
  const inputs=[{id:'a',capturedAt:new Date(10000),cameraModel:'camera',perceptualHash:'0000000000000000',sharpnessScore:1},{id:'b',capturedAt:new Date(11000),cameraModel:'camera',perceptualHash:'0000000000000001',sharpnessScore:8},{id:'c',capturedAt:null,cameraModel:'camera',perceptualHash:'0000000000000000',sharpnessScore:100}];
  const groups=suggestPhotoGroups(inputs);
  assert.equal(groups.length,1); assert.deepEqual(groups[0].assetIds,['a','b']); assert.equal(groups[0].bestAssetId,'b'); assert.equal(inputs.length,3);
});
