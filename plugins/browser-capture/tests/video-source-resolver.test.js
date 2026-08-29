import assert from 'node:assert/strict';
import test from 'node:test';
import {
  resolveVideoSourceTarget,
  resolveVideoSourceTargetAsync,
} from '../src/video-source-resolver.js';

test('resolves ordinary MP4 video sources before a temporary blob fallback', () => {
  const video = {
    tagName: 'VIDEO',
    currentSrc: 'blob:https://example.com/player',
    src: 'blob:https://example.com/player',
    poster: '/poster.jpg',
    getAttribute: () => null,
    querySelectorAll: () => [
      { src: 'https://cdn.example.com/movie.webm', type: 'video/webm' },
      { src: 'https://cdn.example.com/movie.mp4', type: 'video/mp4' },
    ],
  };

  assert.deepEqual(resolveVideoSourceTarget(video, 'https://example.com/watch'), {
    mediaType: 'video',
    sourceUrl: 'blob:https://example.com/player',
    sourceCandidates: ['blob:https://example.com/player', 'https://cdn.example.com/movie.mp4'],
    posterUrl: 'https://example.com/poster.jpg',
    altText: '',
  });
});

test('matches X resource timing URLs to the clicked video and prefers the largest MP4', () => {
  const video = {
    tagName: 'VIDEO',
    currentSrc: 'blob:https://x.com/player',
    poster: 'https://pbs.twimg.com/amplify_video_thumb/2093064821046390785/img/preview.jpg',
    getAttribute: () => null,
    querySelectorAll: () => [],
  };
  const observed = [
    'https://video.twimg.com/amplify_video/other/vid/avc1/1920x1080/wrong.mp4',
    'https://video.twimg.com/amplify_video/2093064821046390785/vid/avc1/640x360/low.mp4?tag=21',
    'https://evil.example/amplify_video/2093064821046390785/vid/avc1/3840x2160/evil.mp4',
    'https://video.twimg.com/amplify_video/2093064821046390785/vid/avc1/1280x720/high.mp4?tag=21',
  ];

  assert.deepEqual(resolveVideoSourceTarget(video, 'https://x.com/user/status/1', observed), {
    mediaType: 'video',
    sourceUrl:
      'https://video.twimg.com/amplify_video/2093064821046390785/vid/avc1/1280x720/high.mp4?tag=21',
    sourceCandidates: [
      'https://video.twimg.com/amplify_video/2093064821046390785/vid/avc1/1280x720/high.mp4?tag=21',
      'https://video.twimg.com/amplify_video/2093064821046390785/vid/avc1/640x360/low.mp4?tag=21',
      'blob:https://x.com/player',
    ],
    posterUrl: 'https://pbs.twimg.com/amplify_video_thumb/2093064821046390785/img/preview.jpg',
    altText: '',
  });
});

test('matches the clicked X post and media index to API video variants', () => {
  const first = { contains: () => false };
  const second = { contains: (element) => element === video };
  const article = {
    querySelector: () => ({ href: 'https://x.com/seker/status/1234567890' }),
    querySelectorAll: () => [first, second],
  };
  const video = {
    tagName: 'VIDEO',
    currentSrc: 'blob:https://x.com/player',
    getAttribute: () => null,
    querySelectorAll: () => [],
    closest: (selector) => (selector === 'article' ? article : null),
  };
  const records = [
    {
      tweetId: '1234567890',
      mediaGroups: [
        [],
        [
          { url: 'https://video.twimg.com/ext_tw_video/1/vid/640x360/low.mp4', bitrate: 256000 },
          { url: 'https://video.twimg.com/ext_tw_video/1/vid/1280x720/high.mp4', bitrate: 2176000 },
        ],
      ],
    },
  ];

  const target = resolveVideoSourceTarget(video, 'https://x.com/home', [], records);
  assert.equal(target.sourceUrl, 'https://video.twimg.com/ext_tw_video/1/vid/1280x720/high.mp4');
  assert.deepEqual(target.sourceCandidates.slice(0, 2), [
    'https://video.twimg.com/ext_tw_video/1/vid/1280x720/high.mp4',
    'https://video.twimg.com/ext_tw_video/1/vid/640x360/low.mp4',
  ]);
});

test('reads the signed Xiaohongshu MP4 from JSON-LD and rejects lookalike CDN hosts', () => {
  const scripts = [
    {
      textContent: JSON.stringify({
        '@type': 'VideoObject',
        name: '纽北不养闲人',
        contentUrl: 'https://sns-video-v3.xhscdn.com/stream/video.mp4?sign=secret&t=123',
      }),
    },
    {
      textContent: JSON.stringify({
        '@type': 'VideoObject',
        name: '伪造视频',
        contentUrl: 'https://xhscdn.com.evil.example/video.mp4',
      }),
    },
  ];
  const video = {
    tagName: 'VIDEO',
    currentSrc: 'blob:https://www.xiaohongshu.com/player',
    ownerDocument: { querySelectorAll: () => scripts },
    getAttribute: () => null,
    querySelectorAll: () => [],
  };

  assert.deepEqual(
    resolveVideoSourceTarget(video, 'https://www.xiaohongshu.com/explore/6a720432000000003300f8d7'),
    {
      mediaType: 'video',
      sourceUrl: 'https://sns-video-v3.xhscdn.com/stream/video.mp4?sign=secret&t=123',
      sourceCandidates: [
        'https://sns-video-v3.xhscdn.com/stream/video.mp4?sign=secret&t=123',
        'blob:https://www.xiaohongshu.com/player',
      ],
      posterUrl: null,
      altText: '纽北不养闲人',
    },
  );
});

test('does not treat a poster-only player as a video when no MP4 source is known', () => {
  const video = {
    tagName: 'VIDEO',
    currentSrc: '',
    poster: '/poster.jpg',
    getAttribute: () => null,
    querySelectorAll: () => [],
  };
  assert.equal(resolveVideoSourceTarget(video, 'https://example.com/watch'), null);
});

test('loads Xiaohongshu note details and prefers a supported high-quality stream', async () => {
  const noteId = '6a720432000000003300f8d7';
  const video = {
    tagName: 'VIDEO',
    poster: 'https://sns-webpic-qc.xhscdn.com/poster',
    getAttribute: () => null,
    closest: () => ({ href: `https://www.xiaohongshu.com/explore/${noteId}?xsec_token=abc` }),
  };
  const detailMap = {
    [noteId]: {
      note: {
        title: '赛道视频',
        video: {
          media: {
            stream: {
              EF7: [
                { masterUrl: 'https://sns-video.xhscdn.com/hevc-stream', videoCodec: 'h265' },
                { masterUrl: 'https://sns-video.xhscdn.com/avc-stream', videoCodec: 'h264' },
              ],
              h264: [{ masterUrl: 'https://sns-video.xhscdn.com/fallback.mp4' }],
            },
          },
        },
      },
    },
  };
  const fetchImpl = async () => ({
    ok: true,
    text: async () =>
      `<script>window.__INITIAL_STATE__={"noteDetailMap":${JSON.stringify(detailMap)},"serverRequestInfo":{}}</script>`,
  });

  const target = await resolveVideoSourceTargetAsync(
    video,
    `https://www.xiaohongshu.com/explore/${noteId}`,
    null,
    fetchImpl,
  );
  assert.equal(target.sourceUrl, 'https://sns-video.xhscdn.com/avc-stream');
  assert.deepEqual(target.sourceCandidates, [
    'https://sns-video.xhscdn.com/avc-stream',
    'https://sns-video.xhscdn.com/fallback.mp4',
  ]);
  assert.equal(target.altText, '赛道视频');
});
