export const MEDIA_VIDEO_REQUEST_TIMEOUT_MS: number;
import type { Readable } from 'node:stream';
export function streamFetch(
  url: string,
  options?: {
    method?: string;
    headers?: Record<string, string>;
    body?: Readable;
    signal?: AbortSignal;
  },
): Promise<Response>;
