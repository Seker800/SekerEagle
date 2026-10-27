const http = require('node:http');
const https = require('node:https');
const { Readable } = require('node:stream');
const { pipeline } = require('node:stream/promises');

// Long-running media work sends headers only after rendering. Use the caller's
// total deadline without fetch's independent five-minute headers/body timers.
function streamFetch(url, { method = 'GET', headers = {}, body, signal } = {}) {
  const target = new globalThis.URL(url);
  if (!['http:', 'https:'].includes(target.protocol) || target.username || target.password)
    return Promise.reject(new Error('INVALID_MEDIA_TRANSPORT_URL'));
  return new Promise((resolve, reject) => {
    const request = (target.protocol === 'https:' ? https : http).request(
      target,
      { method, headers, signal, maxHeaderSize: 16384 },
      (incoming) => {
        try {
          if (incoming.statusCode >= 300 && incoming.statusCode < 400) {
            incoming.destroy();
            reject(new Error('MEDIA_REDIRECT_FORBIDDEN'));
            return;
          }
          if ([204, 205, 304].includes(incoming.statusCode)) incoming.resume();
          const responseHeaders = new globalThis.Headers();
          for (const [name, value] of Object.entries(incoming.headers)) {
            if (Array.isArray(value)) for (const part of value) responseHeaders.append(name, part);
            else if (value !== undefined) responseHeaders.set(name, value);
          }
          resolve(
            new globalThis.Response(
              [204, 205, 304].includes(incoming.statusCode) ? null : Readable.toWeb(incoming),
              {
                status: incoming.statusCode,
                headers: responseHeaders,
              },
            ),
          );
        } catch (error) {
          incoming.destroy();
          reject(error);
        }
      },
    );
    request.on('error', reject);
    if (body) pipeline(body, request).catch(reject);
    else request.end();
  });
}
// Upload (15m), probe/poster (4m), encode (30m), and bounded transfer headroom.
const MEDIA_VIDEO_REQUEST_TIMEOUT_MS = 60 * 60 * 1000;
module.exports = { streamFetch, MEDIA_VIDEO_REQUEST_TIMEOUT_MS };
