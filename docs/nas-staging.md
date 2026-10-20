# 群晖独立测试部署

目标设备：SekerDesign，DS1522+，AMD64，8 GB 内存。第一阶段只恢复独立测试实例；Mac 正式服务不切换、不停机，现有群晖备份不覆盖。

## 配置来源与边界

`node scripts/deploy-nas.mjs NEW_DIRECTORY COMMIT_SHA` 从 Mac 的共用服务定义生成群晖配置，而不是另建一套应用。输出目录必须不存在；凭据重新生成，以 0600 保存，不复用备份中的生产凭据。输出目录及镜像归入忽略的 `.local`，不可提交。

- 独立 Compose 项目 `sekereagle-nas-staging`，数据库 `sekereagle_test`，对象桶 `sekereagle-assets`；卷使用项目作用域，不复用 Mac 卷或群晖备份目录。
- 仅网关发布到群晖局域网地址的 8181 端口；数据库、MinIO、API 不发布端口。签名上传的主机名与网关保持一致。
- 规范地址保留 `http://localhost:8181`，遵循 API 既有 HTTPS／loopback 校验；用户实际访问群晖局域网地址，沿用既有同源局域网访问规则。网关的上传回源 Host 固定为 `localhost:8181`，不放宽 API 安全规则。
- 应用镜像在 Mac 构建为 `linux/amd64`；群晖只载入并运行，不在 NAS 编译。标签固定到源代码提交。
- MinIO 与 mc 的旧版官方容器仓库已拒绝下载；NAS 使用 `deploy/nas` 的 Dockerfile 从官方对应版本的固定 commit 构建，附带许可证和来源标签，使用 AMD64 v1 指令集及非 root 用户。构建命令分别为 `docker build --platform linux/amd64 -f deploy/nas/minio.Dockerfile -t sekereagle/minio:nas-20250422 .` 与 `docker build --platform linux/amd64 -f deploy/nas/mc.Dockerfile -t sekereagle/mc:nas-20250416 .`。不改用第三方镜像，也不升级存储数据格式。
- 后台 worker 默认不启动，避免备份中的队列突然重跑。恢复和校验完成后，单独审查队列与 Mac 推理服务路由，再启用 `processing` profile。初始阶段可验证浏览、筛选、原有媒体、登录；新增照片的派生处理、AI 与编辑成片处理尚未验收。
- 不挂载私人 LUT。LUT 仍保存在用户浏览器内，不随图库迁移。

## 恢复顺序

必须先核对备份 `current` 指向、owner marker、manifest 哈希与每个文件 SHA256；校验只读，不调用会重写 `verified.json` 的旧校验命令。记录备份日期、对象数量与字节数。

确认新项目不存在、目标端口空闲，再启动 postgres 和 minio。数据库只允许空的 `sekereagle_test`；先执行共用安全目标检查，再以 `pg_restore --no-owner --no-acl` 恢复；不要执行旧 `globals.sql`，不要覆盖现有数据库。

对象存储必须是这个新项目中的空桶。备份目录只读挂载到 API 工具容器的 `/restore`，使用 `scripts/backup/restore-objects.mjs` 校验并还原对象及 HTTP 元数据。该工具遇到非空桶会拒绝恢复；中断后不可直接重复执行，也不可删除未经确认的卷。

恢复旧快照后，以当前代码运行带安全检查的数据库迁移，再启动 API、web、gateway。验收健康检查、真实登录、两种模式资源数、缩略图和大图、重启后的持久性，之后才考虑后台处理与正式切换。

群晖共享文件夹可能继承 DSM ACL，导致解包后的文件权限与 tar 中的 POSIX 模式不同。解包后显式将新安装目录设为 0700，`.env` 设为 0600；给容器只读挂载的 `minio-init.sh`、`minio-app-policy.json`、`nginx.conf` 设为 0644。不要仅依赖 umask 或将目录放开给所有人。

大图库恢复可用 `RESTORE_CONCURRENCY=4`（允许 1–8，默认仍为 1）。池会限制活动文件和上传数，遇到首个失败停止分配任务、等待已开始的写入结束后报错；每 1000 个对象输出进度。恢复进程使用独立工具容器，建议内存上限 2 GB，备份目录只读挂载并以备份所有者 UID 读取；不能对非空桶直接重跑。正式恢复前已在 NAS 上完成四对象实测，验证内容、HTTP 元数据、并发恢复及拒绝覆盖非空桶，测试对象随后逐项清理。

## 当前准备记录

2026-10-20 已通过固定主机身份的 SSH 确认备份：644206 个对象，78293967382 字节，校验时间 2026-10-18 08:14:42 UTC。旧快照不包含其后新增数据；正式切换前必须另做最后同步计划。

2026-10-20 已再次只读校验全量备份：644206 个对象及部署文件的 SHA256 全部通过，没有重写原备份证据。独立测试数据库已还原并完成 35 个迁移；对象存储恢复由独立后台容器执行，最终完成状态须以恢复退出码、最终数量与实际访问验证为准。

原 SSH 用户能读取备份，但无 Docker socket 权限，且不能免密 sudo。本次通过用户已登录的 DSM 管理界面创建禁用自动触发的一次性 root 任务，由用户自行完成密码验证后，将 Docker socket 的组设为现有 administrators 组；socket 保持 0660，不向普通用户开放。已验证 SSH 能操作 Docker。Container Manager 重启可能重置 socket 组，需要重新由管理员授权；这不等于为 SSH 配置免密 sudo。
