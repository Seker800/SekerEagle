import { describe, expect, it } from 'vitest';
import { resolveObjectUploadUrl } from './object-upload-url';

describe('resolveObjectUploadUrl', () => {
  const signedUrl =
    'http://localhost:8180/sekereagle-assets/users/user-1/original.jpg?partNumber=1&X-Amz-Signature=signed';

  it('routes a loopback-signed upload through the LAN gateway serving the browser', () => {
    expect(resolveObjectUploadUrl(signedUrl, 'http://192.168.1.10:8180')).toBe(
      'http://192.168.1.10:8180/sekereagle-assets/users/user-1/original.jpg?partNumber=1&X-Amz-Signature=signed',
    );
  });

  it('routes a loopback-signed upload through the current HTTPS gateway', () => {
    expect(resolveObjectUploadUrl(signedUrl, 'https://eagle.example.com')).toBe(
      'https://eagle.example.com/sekereagle-assets/users/user-1/original.jpg?partNumber=1&X-Amz-Signature=signed',
    );
  });

  it('keeps an upload URL that already belongs to the current gateway', () => {
    expect(resolveObjectUploadUrl(signedUrl, 'http://localhost:8180')).toBe(signedUrl);
  });

  it('rejects an upload URL controlled by another non-loopback origin', () => {
    expect(() =>
      resolveObjectUploadUrl(
        'https://objects.attacker.example/sekereagle-assets/file?X-Amz-Signature=signed',
        'https://eagle.example.com',
      ),
    ).toThrow('对象存储上传地址不属于当前 SekerEagle。');
  });

  it.each([
    'http://localhost:8180/not-the-object-route?X-Amz-Signature=signed',
    'http://localhost:8180/sekereagle-assets/file',
    'ftp://localhost/sekereagle-assets/file?X-Amz-Signature=signed',
    'http://user:password@localhost:8180/sekereagle-assets/file?X-Amz-Signature=signed',
  ])('rejects an invalid server-provided upload URL: %s', (value) => {
    expect(() => resolveObjectUploadUrl(value, 'http://192.168.1.10:8180')).toThrow(
      '服务端返回了无效的对象存储上传地址。',
    );
  });
});
