# 2026年11月16日上传前查重流式指纹修正发布

## 范围与版本

- 运行源码：`38dd0da63d974f048b28a9ac70b9ea3daacc7eda`。
- Web：`sekereagle/web:upload-streamhash-38dd0da6`
- API／operations／library-reader 保持 `sekereagle/api:upload-parallel-811ead5b`；数据库仍 98 项迁移、schema 未变；存储、网关、协调器、中继、Mac 执行器未动。

此前的上传前查重对超过 64MiB 的文件跳过预检，理由是整文件缓冲区占内存；该取舍对高性能客户端过于保守。本批改为：

- 32MiB 及以下继续使用硬件加速的 WebCrypto 计算 SHA-256。
- 更大的照片、RAW 和视频按 4MiB 分块流式计算，使用已安装的 `@noble/hashes`；内存只与分块大小相关，不再按文件大小跳过。
- 所有文件大小都会参与上传前查重；服务器发布事务的 SHA-256 去重仍是最终权威。

## 构建与验收

- Web 镜像以 `linux/amd64` 构建，label revision `38dd0da6…`；镜像内 `index.html`、本地构建与公网返回体均为 `36f1c31044d09fc47d40452203e905471275eea039d30e41ae28ef9096bb81e0`。
- 线上资源包含流式哈希模块；完整 web 测试 1195 项（156 个文件）通过，lint、typecheck、构建与架构检查通过。

## 数据安全与备份

- 发布前一致性备份：936,418,743 字节，SHA-256 `1215340d0c6244a96a965569e1d47618f0401674d35242856a12e99dba23e175`，`pg_restore --list` 完整解析。
- 发布前后计数严格相等：MATERIAL 64,862／PHOTO 58,589（合计 123,451）、回收站 12,032、编辑草稿 176；用户任务策略与处理设置一致。
- 只正常替换 web 容器；API、operations、library-reader、postgres、MinIO、gateway、协调器、中继容器 ID 未变；网关未停止未 reload。

## 验证结果

- Web healthy、0 重启；公网首页与 `/api/health/ready` 200；线上与镜像、本地构建 `index.html` 一致。
- 切换后 web 日志未发现 error／fatal／unhandled。

## 回退

NAS 私有 `maintenance/upload-streamhash-38dd0da6/` 保存服务快照、原 Compose 链、`images.json`、`rollback.json`、`active.json`、数据库备份与归档索引。回退执行 `up -d --no-deps web`，回退镜像为 `sekereagle/web:upload-manager-c4d26c7e`。本次无数据库变更。

## 限制

- 未做登录后生产浏览器交互；分块哈希与大文件正确性由 Node 哈希对照测试覆盖。
- 未在真实大批 RAW／视频上测量 `@noble/hashes` 的浏览器吞吐；小文件仍走 WebCrypto，速度不受影响。
