const OBJECT_UPLOAD_PATH_PREFIX = '/sekereagle-assets/';

export function resolveObjectUploadUrl(uploadUrl: string, browserOrigin: string): string {
  const upload = new URL(uploadUrl);
  const gateway = new URL(browserOrigin);

  if (
    upload.username ||
    upload.password ||
    !isHttpProtocol(upload.protocol) ||
    !upload.pathname.startsWith(OBJECT_UPLOAD_PATH_PREFIX) ||
    !upload.searchParams.has('X-Amz-Signature')
  ) {
    throw new Error('服务端返回了无效的对象存储上传地址。');
  }
  if (
    gateway.username ||
    gateway.password ||
    !isHttpProtocol(gateway.protocol) ||
    gateway.pathname !== '/' ||
    gateway.search ||
    gateway.hash
  ) {
    throw new Error('当前 SekerEagle 网关地址无效。');
  }

  if (upload.origin !== gateway.origin) {
    if (!isLoopbackHostname(upload.hostname)) {
      throw new Error('对象存储上传地址不属于当前 SekerEagle。');
    }
    upload.protocol = gateway.protocol;
    upload.hostname = gateway.hostname;
    upload.port = gateway.port;
  }

  return upload.toString();
}

function isHttpProtocol(protocol: string): boolean {
  return protocol === 'http:' || protocol === 'https:';
}

function isLoopbackHostname(hostname: string): boolean {
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]';
}
