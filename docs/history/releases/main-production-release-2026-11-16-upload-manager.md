# 2026年11月16日上传前查重与上传管理器生产发布

## 范围与版本

- 运行源码：`c4d26c7ed08565a0924a4c69981b6e417e0d0fc5`。
- Web：`sekereagle/web:upload-manager-c4d26c7e`
- API／operations／library-reader 保持 `sekereagle/api:upload-parallel-811ead5b` 未重建；数据库仍为 98 项迁移、待应用 0，schema 未变；对象存储、网关、协调器、中继、Mac 业务执行器均未改。

本批只改网页端：

- 上传前由浏览器计算 SHA-256，并用现有 `check-content-batch` 批量查询；命中已有内容时直接标记“重复跳过”，不再上传。超过 64MiB 的文件跳过预检、依赖服务器去重；哈希或查询失败时继续上传。
- 计算出的 SHA-256 同时作为 `contentSha256` 传给 initiate，服务器入库时核对内容。
- 上传窗口重做：总进度、速度与剩余时间、成功／重复跳过／失败／等待分类、暂停／继续（文件边界生效）、一键重试全部失败、单项状态与错误、列表折叠。
- 服务器发布事务的 SHA-256 去重保持不变，仍是最终权威。

## 构建与验收

- Web 镜像以 `linux/amd64` 构建，label `org.opencontainers.image.revision=c4d26c7e…`；镜像内 `index.html` 与本地生产构建均为 `26655c6257ea3e7aa915cf58f69c17df6c32f6693ead362481ae4ef4ffee3c6c`。
- 镜像载入 NAS 后再次核对架构与 revision；发布脚本验证 Compose 只改 web 镜像，其余服务配置逐项一致。
- Web 全量 1193 项测试、lint、typecheck、构建与架构检查通过。

## 数据安全与备份

- 发布前一致性备份：936,418,551 字节，SHA-256 `38b43f31620dfa97dfecfb1eb9117fa0875809a8c34196f7fec599c33fa1e59e`，`pg_restore --list` 完整解析。
- 发布前后计数严格相等：MATERIAL 64,862／PHOTO 58,589（合计 123,451）、回收站 12,032、编辑草稿 176；用户任务策略与处理设置逐项一致；schema 前后一致。
- 只正常停止并替换 web 容器；API、operations、library-reader、postgres、MinIO、gateway、协调器、中继容器 ID 全部未变。网关未停止、未 reload。
- 切换瞬间 gateway 日志出现一次 `web could not be resolved`，属容器停止到新容器注册之间的短暂 DNS 窗口；新 web 启动后公网恢复 200，后续无重复错误。

## 验证结果

- Web 容器 healthy、0 重启，镜像为 `sekereagle/web:upload-manager-c4d26c7e`；其余四个应用与基础设施容器保持原身份。
- 公网首页 200、`/api/health` 200、`/api/health/ready` 200；匿名 `POST /api/eagle/uploads/status-batch` 仍为 401。
- 线上 `index.html` 哈希与镜像、本地构建完全一致；线上资源包含“已暂停，正在上传的”“重试全部失败”“重复跳过”等新界面文案。
- 切换后 web／gateway 日志未发现持续 error／fatal／unhandled。

## 回退

NAS 私有 `maintenance/upload-manager-c4d26c7e/` 保存服务快照、原 Compose 链、`images.json`、`rollback.json`、`migration-plan.json`、`active.json`、数据库备份与归档索引。回退时读取 `maintenance/processing-upgrade-20261023/release-compose.json` 的 command，追加本目录 `images.json` 与 `rollback.json`，执行 `up -d --no-deps web`。回退镜像为 `sekereagle/web:upload-parallel-811ead5b`。本次无数据库变更，回退不涉及恢复。

## 限制

- 未做登录后的生产浏览器交互（无生产账号凭据）；新上传窗口与预检按组件、队列和 API 测试验收，生产只核验静态资源、容器健康与匿名鉴权。
- 预检上限 64MiB 是浏览器内存边界，超过上限的文件直接上传并由服务器去重；未在真实大批照片上测量哈希耗时。
- 服务器入库校验仍一次处理一份，未提高并发。
- 上述 64MiB 预检上限已由同日 [流式指纹修正](main-production-release-2026-11-16-upload-streamhash.md) 取消；当前运行版为 `sekereagle/web:upload-streamhash-38dd0da6`。
