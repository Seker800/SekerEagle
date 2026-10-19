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
9. 全部通过后先持久化发布意图，原子替换 `current`，立即持久化最后成功时间与校验证据；之后清理旧副本。清理失败只显示待重试，不推翻备份成功。发布响应丢失时按已验证的 `current` 与持久化意图对账。

每次计划备份会完整读取并传输当时的数据。普通目录方案不依赖 restic 的块级去重。
本次取消加密的转换例外：直接在群晖内解密现有仓库，不重新读取或传输生产素材。
转换保留原备份时间、源冻结时间和已通过的数据库恢复证据，不把格式转换冒充为新的数据备份。

脚本在停止服务前持久化暂停意图。异常时恢复服务；独立 launchd 每分钟检查进程，
中断或超时后先终止专用导出进程，再恢复写入。未校验的新目录不会覆盖当前成功副本。
恢复检查容器使用专用 label；创建命令超时也会按容器 ID 清理。旧版无 label 容器只有在镜像、离线网络、测试数据库和只读 dump 挂载全部一致时才能自动清理，否则要求人工核对。
接收异常只删除本次新建目录；中断后的 generation 按持久化意图用 `discard` 清理，禁止删除 current 或未知所有权目录。清理在空间检查前重试；后台每六小时重试失败的清理。NAS 进程锁防止接收和清理并发。
`generations/` 下未知条目会原子移动到 `quarantine/`，保留内容并显示管理员提示；不会跟随链接或删除未知内容。隔离内容仍占空间，管理员核对后自行处理。

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

恢复自动备份前，优先使用当前仓库受版本控制的备份脚本，执行 `backup:install`。NAS 上的脚本仅作灾难恢复证据，使用前需要审核版本，不能直接覆盖当前代码。

## SSH 主机身份

所有 SSH（包括上传工具、传输、迁移）显式设置 `StrictHostKeyChecking=yes`、`BatchMode=yes`、`ProxyCommand=none` 和 `ProxyJump=none`，并固定 `Hostname=192.168.31.146`、`User=seker`、`Port=22`、`HostKeyAlias=192.168.31.146`；用相同选项的 `ssh -G` 校验目标与安全策略。新机器必须先通过 NAS 控制台或可信管理渠道核对主机公钥并写入 known_hosts；不得使用 `StrictHostKeyChecking=no` 或未经核验的 `ssh-keyscan` 结果自动信任。

2026-10-19 本机 known_hosts 的已登记指纹（本次仅离线读取，未重新通过 NAS 控制台认证）：

- ED25519：`SHA256:7E/h1y57XO5S1HnNbmJVSXOiDNlJXXkR+BpJc7U2OKs`
- ECDSA：`SHA256:i0rXib9Blmb67wKoqp4e8khzEjxfXfx8IDIV6luIxRU`

主机重装或换钥匙时，先通过可信渠道确认变更再更新登记；不要为了让备份通过而关闭校验。

## 从旧 restic state 迁移

这是一次显式维护操作，正常安装不会删除旧备份或凭据。当前机器已经转换完成，无需重复执行。以下命令由维护者在确需升级旧机器时运行；本次代码验证没有执行这些操作。

1. 停止旧备份调度，确认没有运行中的备份与暂停服务。保留旧 state 和仓库；从私有 state 读取 `lastSnapshotId` 的完整 64 位十六进制值，设为下面的 `SNAPSHOT`。不要用“最新快照”猜测身份。
2. 用强制主机校验的 SSH 将当前仓库 `scripts/backup/plain_nas.py` 上传到专用根目录 `tools/plain_nas.py`（工具文件权限 600，根和 tools 权限 700）。确认根所有权标记。NAS 必须已有可信的 `tools/restic-linux-amd64`；若需补装，核验官方发布校验和后再安装，不从未知地址下载可执行文件。
3. 在 NAS 上通过可信私有输入准备 `.conversion-password`（600）。它只用于读取旧仓库，`convert` 完成或失败都会移除，不要把密码写入命令行、源码或文档。确保有完整副本空间。
4. 在 NAS 的专用根目录执行（以实际完整快照 ID 替换 `SNAPSHOT`；`set -e` 保证失败后不发布）：

   ```sh
   set -e
   cd /volume1/homes/seker/sekereagle-backup
   python3 tools/plain_nas.py convert "$SNAPSHOT"
   python3 tools/plain_nas.py verify "$SNAPSHOT"
   python3 tools/plain_nas.py publish "$SNAPSHOT"
   ```

   中断后重试前，可用 `python3 tools/plain_nas.py discard "$SNAPSHOT"` 删除同一 ID 的受标记半成品；它拒绝删除已发布的 current。已发布则直接继续下一步。未知目录不能用此命令删除。

5. 在 Mac 当前仓库运行 `npm run backup:migrate`。命令加锁，要求 current 精确对应旧 state 的快照，重新做 NAS 磁盘校验，下载 dump 与元数据并核对清单哈希，在隔离数据库恢复成功后才写入 `plain-directory-v1`。保留原最后成功时间、冻结时间和计划，不把转换记为新备份。
6. 成功 state 落盘后才执行 NAS `retire`：删除受保护的旧加密仓库、转换密码/缓存与旧 restic 工具，并清理 Mac 专用备份目录的 `repository-password` 和旧工具。若 retire 失败，state 保留 `retirementPending`，再次运行 `backup:migrate` 仅重试退役，不重复转换或修改成功时间。最后运行 `npm run backup:install` 安装现行调度。

`retire` 单独运行虽要求已校验的 current，但不会替代 Mac 隔离恢复检查，正常迁移必须按上述顺序完成。`.local/`、`.runtime/`、`.venv/` 及其嵌套目录始终排除于 Docker context；CI 用无真实数据的哨兵文件验证 Docker 本身的排除行为。Python 备份测试已经纳入 `npm test` 与 CI。
