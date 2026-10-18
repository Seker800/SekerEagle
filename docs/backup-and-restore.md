# 完整数据备份与恢复

## 备份方式与位置

独立脚本 `scripts/backup/backup.py` 负责定时备份，应用只显示管理员可见的状态。
备份内容直接保存为群晖上的普通文件，不使用备份文件加密，也不需要恢复密码。
SSH 只负责传输与登录认证；SSH 登录凭据和备份文件解密密码是不同的事情。

- 群晖：`SekerDesign`，固定校验 `seker@192.168.31.146:22` 与主机名 `SEKER_DESIGN`。
- 根目录：`/volume1/homes/seker/sekereagle-backup`，由专用所有权标记保护。
- 当前成功副本：根目录内的 `current`，指向 `generations/` 中一个已经校验完成的普通目录。
- 每两周周六北京时间 01:00；下一次 2026-10-24，之后 11-07、11-21。
- Mac 已登录且 Docker 可用时执行；错过时间会补做，失败六小时后重试。
- 成功后只保留一个普通文件副本；更新期间旧副本保留到新副本通过校验。
- 不访问 YuntaiDesign、SekerChat、其他共享目录或其他 Docker 项目。

普通目录直接包含数据库导出、对象文件、对象 HTTP 元数据清单、部署环境与源代码。
拥有该目录读取权限的人可以读取内容；目录与文件权限限制为备份账号访问。
单版本不能撤销已经覆盖进下一次成功备份的误删或损坏。

## 一致性与发布

1. 检查 SSH 身份、NAS 所有权标记、可用空间与 Eagle 容器身份，并执行数据目标安全检查。
2. 停止 gateway、API 和 worker；PostgreSQL 与 MinIO 保持在线。源读取期间图库暂时不可用。
3. 完整导出 `sekereagle` 数据库、全局角色、部署配置、服务镜像标识与源代码。
4. 从 `sekereagle-assets` 导出全部对象，包括原文件、预览、缩略图、瓦片和临时对象，并保存应用使用的 HTTP 元数据。
5. 用流式 tar 经 SSH 写入群晖新的独立目录，不在 Mac 暂存全部素材。导出容器使用 `--log-driver=none` 和只读根文件系统。
6. 接收端拒绝路径穿越、链接、重复或缺失条目，并核对完整 SHA-256 清单；发送进程或接收进程失败均不发布。
7. 源读取结束后恢复 Eagle；群晖在本地重新读取普通文件做完整磁盘校验，不把素材传回 Mac。
8. 用本机已有数据库导出，在无网络、无生产卷的临时 `sekereagle_test` 中完整恢复并核对记录数。
9. 全部通过后原子替换 `current` 指针，再清理其他受标记保护的副本，更新最后成功时间。

每次计划备份会完整读取并传输当时的数据。普通目录方案不依赖 restic 的块级去重。
本次取消加密的转换例外：直接在群晖内解密现有仓库，不重新读取或传输生产素材。
转换保留原备份时间、源冻结时间和已通过的数据库恢复证据，不把格式转换冒充为新的数据备份。

脚本在停止服务前持久化暂停意图。异常时恢复服务；独立 launchd 每分钟检查进程，
中断或超时后先终止专用导出进程，再恢复写入。未校验的新目录不会覆盖当前成功副本。

## 本机操作与状态

```sh
npm run backup:install
npm run backup:now
npm run backup:test
```

安装不会自动执行全量备份，也不会创建恢复密码或安装加密备份工具。
运行状态与私有日志保存在 `.local/backup/`，公开状态投影保存在 `.runtime/backup-status/`。
管理员在「个人账号 → 备份」查看最后成功时间、最近执行结果、下次计划和目标。
应用没有发起备份、修改 SSH 目标或读取备份凭据的接口。

## 恢复普通文件备份

无需 restic、恢复密码或额外解密操作。普通图片可直接从 `current/objects/` 复制读取。
`database.dump` 是 PostgreSQL 的标准导出格式，数据库内容需要通过 `pg_restore` 导入。

1. 在新机器准备隔离环境和足够磁盘，参考 `current/deployment.json` 中的镜像版本。
2. 读取 `current/verified.json`、`manifest.json`，按清单对文件做 SHA-256 与大小核对。
3. `source.tar.gz` 保存原备份时的源代码与锁文件；`deployment.env` 包含配置与机密，应保持私有。
4. 数据库和对象服务只能位于 loopback 或独立 Compose 网络；测试恢复只用 `sekereagle_test`，正式新实例用 `sekereagle`。
5. 先执行目标安全检查，再用 `pg_restore --no-owner --no-acl` 恢复到空数据库；必要时审核 `globals.sql` 后重建角色。
6. 创建空的 `sekereagle-assets` bucket，将 `current` 只读挂载到 API 镜像的 `/restore`，运行 `node scripts/backup/restore-objects.mjs` 恢复对象与 HTTP 元数据。
7. 验证登录、标签、文件夹、原文件下载、预览与向量功能，确认完整后切换入口。

原子切换与普通文件校验的实现保存在根目录的 `tools/plain_nas.py`；当前主机协调脚本也同步保存在 `tools/host_backup.py`。
历史 `source.tar.gz` 中可能保留转换前的备份脚本，不应重新安装其中已经废弃的加密备份方案。

恢复自动备份前，应将群晖 `tools/host_backup.py` 复制为工程的 `scripts/backup/backup.py`，并将 `tools/plain_nas.py` 放入同目录，再执行 `backup:install`。
