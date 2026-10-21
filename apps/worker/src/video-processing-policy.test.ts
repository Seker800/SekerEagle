import assert from 'node:assert/strict';
import test from 'node:test';
import {
  videoProcessingStage,
  VIDEO_PLAYBACK_PROCESSOR_VERSION,
  videoTranscodingEnabled,
} from './video-processing-policy';
import { taskBlocksAssetReady } from './processing-policy';
test('paused transcoding still creates a poster and keeps playback explicitly deferred', () => {
  assert.equal(videoProcessingStage('GENERATE_THUMBNAIL', false), 'POSTER');
  assert.equal(videoProcessingStage('GENERATE_THUMBNAIL', true), 'FULL');
  assert.equal(videoProcessingStage('GENERATE_PREVIEW', true), 'PLAYBACK');
  assert.equal(videoTranscodingEnabled(undefined), true);
  assert.equal(videoTranscodingEnabled('false'), false);
  assert.throws(() => videoTranscodingEnabled('off'));
  assert.equal(taskBlocksAssetReady('GENERATE_PREVIEW', VIDEO_PLAYBACK_PROCESSOR_VERSION), false);
  assert.equal(taskBlocksAssetReady('GENERATE_PREVIEW', 'legacy'), true);
});

test('playback uses the background lane and reports terminal failure without hiding the poster', async()=>{
 const {processingLaneForKind,terminalAssetFailure}=await import('./processing-policy');
 assert.equal(processingLaneForKind('GENERATE_PREVIEW',VIDEO_PLAYBACK_PROCESSOR_VERSION),'BACKGROUND');
 assert.equal(processingLaneForKind('GENERATE_PREVIEW','legacy'),'INTERACTIVE');
 assert.deepEqual(terminalAssetFailure('GENERATE_PREVIEW',VIDEO_PLAYBACK_PROCESSOR_VERSION,'ffmpeg failed'),{mediaErrorCode:'VIDEO_PLAYBACK_FAILED'});
 assert.deepEqual(terminalAssetFailure('GENERATE_THUMBNAIL','v1','invalid'),{lifecycleStatus:'FAILED',mediaErrorCode:'invalid'});
 assert.equal(terminalAssetFailure('GENERATE_EMBEDDING','v1','failed'),null);
});
