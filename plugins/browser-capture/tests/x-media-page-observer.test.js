import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

test('sanitizes X API responses into bitrate-sorted MP4 media records', async () => {
  const messages = [];
  const payload = {
    data: {
      tweet_results: {
        result: {
          rest_id: '1234567890',
          legacy: {
            extended_entities: {
              media: [
                {
                  video_info: {
                    variants: [
                      {
                        content_type: 'application/x-mpegURL',
                        url: 'https://video.twimg.com/list.m3u8',
                      },
                      {
                        content_type: 'video/mp4',
                        bitrate: 256000,
                        url: 'https://video.twimg.com/low.mp4',
                      },
                      {
                        content_type: 'video/mp4',
                        bitrate: 2176000,
                        url: 'https://video.twimg.com/high.mp4',
                      },
                    ],
                  },
                },
              ],
            },
          },
        },
      },
    },
  };
  const response = {
    url: 'https://x.com/i/api/graphql/query/TweetDetail',
    headers: { get: () => 'application/json' },
    clone: () => ({ json: async () => payload }),
  };
  const pageWindow = {
    fetch: async () => response,
    postMessage: (message, origin) => messages.push({ message, origin }),
  };
  const source = await readFile(
    new URL('../src/x-media-page-observer.js', import.meta.url),
    'utf8',
  );
  vm.runInNewContext(source, {
    URL,
    WeakSet,
    Object,
    Array,
    Number,
    String,
    Promise,
    location: { href: 'https://x.com/home', origin: 'https://x.com' },
    window: pageWindow,
  });

  assert.equal(await pageWindow.fetch('https://x.com/i/api/graphql/query/TweetDetail'), response);
  await Promise.resolve();
  await Promise.resolve();
  assert.deepEqual(JSON.parse(JSON.stringify(messages)), [
    {
      origin: 'https://x.com',
      message: {
        type: 'sekereagle:x-media',
        tweetId: '1234567890',
        mediaGroups: [
          [
            { url: 'https://video.twimg.com/high.mp4', bitrate: 2176000 },
            { url: 'https://video.twimg.com/low.mp4', bitrate: 256000 },
          ],
        ],
      },
    },
  ]);
});
