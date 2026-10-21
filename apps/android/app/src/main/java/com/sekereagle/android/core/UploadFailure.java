package com.sekereagle.android.core;

import java.io.IOException;

/** HTTP origin is part of error semantics: object signatures are not API credentials. */
public class UploadFailure extends IOException {
  public enum Endpoint {
    API,
    SIGNED_PART
  }

  public final int status;
  public final Endpoint endpoint;

  public UploadFailure(int status, Endpoint endpoint) {
    super(
        endpoint == Endpoint.SIGNED_PART
            ? "分片传输未完成（HTTP " + status + "），将重新获取上传地址后重试"
            : status == 401
                ? "登录或备份授权已失效，请重新登录并启用备份"
                : status == 403 ? "当前备份授权或服务策略不允许此请求，请检查权限" : "服务请求失败（HTTP " + status + "）");
    this.status = status;
    this.endpoint = endpoint;
  }

  public boolean invalidatesCredential() {
    return endpoint == Endpoint.API && status == 401;
  }

  public boolean permanent() {
    return endpoint == Endpoint.API
        && (status == 400 || status == 413 || status == 415 || status == 422);
  }

  public boolean renewSignature() {
    return endpoint == Endpoint.SIGNED_PART
        && (status == 400 || status == 401 || status == 403 || status == 404 || status == 410);
  }
}
