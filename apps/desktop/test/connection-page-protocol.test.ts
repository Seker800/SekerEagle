import { describe, expect, it } from 'vitest';
import {
  connectionPageAsset,
  isConnectionPageUrl,
} from '../src/main/connection-page-protocol';

describe('desktop connection page protocol', () => {
  it('recognizes the exact custom-scheme document URL without relying on URL.origin', () => {
    expect(isConnectionPageUrl('sekereagle-app://connection/')).toBe(true);
    expect(isConnectionPageUrl('sekereagle-app://other/')).toBe(false);
    expect(isConnectionPageUrl('sekereagle-app://connection/connection.js')).toBe(false);
    expect(isConnectionPageUrl('https://connection/')).toBe(false);
  });

  it('serves only the three packaged connection-page assets', () => {
    expect(connectionPageAsset('sekereagle-app://connection/')).toMatchObject({ file: 'index.html' });
    expect(connectionPageAsset('sekereagle-app://connection/connection.js')).toMatchObject({
      file: 'connection.js',
    });
    expect(connectionPageAsset('sekereagle-app://connection/connection.css')).toMatchObject({
      file: 'connection.css',
    });
    expect(connectionPageAsset('sekereagle-app://connection/unknown')).toBeNull();
    expect(connectionPageAsset('sekereagle-app://other/')).toBeNull();
  });
});
