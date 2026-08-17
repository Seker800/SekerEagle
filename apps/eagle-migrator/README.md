# Eagle 一次性本机迁移器

这个命令行工具面向一次性的大图库迁移。Eagle 负责导出一个不可变快照，本机迁移器负责校验、上传、暂停恢复和逐项记账；SekerEagle 服务端仍负责认证、owner 隔离、对象提交与最终幂等性。

它不会直接写 PostgreSQL 或 MinIO，也不会读取或持久化 SekerChat 数据。PAT 只能通过 `SEKEREAGLE_PAT` 环境变量提供，不接受命令行参数，也不会写入 journal。

HTTP 只允许连接 `localhost` 或 loopback；连接远程 SekerEagle 时必须使用 HTTPS，避免 PAT 明文传输。

## 在真实图库到位前准备

```bash
npm install
npm run build --workspace @sekereagle/eagle-migrator
npm run test --workspace @sekereagle/eagle-migrator
npm --prefix plugins/eagle-importer test
```

启动 SekerEagle，并在网页中创建包含 `import:read`、`import:write`、`asset:write` 的 PAT。涉及数据库或导入环境前先执行：

```bash
npm run db:guard
npm run compose:config
```

## 冻结并导出 Eagle 快照

1. 把完整的 Eagle `.library` 目录复制到 Mac 本机；保留原始副本，不要边迁移边修改图库。
2. 用 Eagle 打开这份本机副本，载入 `plugins/eagle-importer`。
3. 点击“导出迁移快照”。快照保存在插件用户数据目录的 `migration-snapshots` 下。
4. 快照导出完成后不要编辑 `snapshot.json`、`items.ndjson` 或定义文件，也不要移动图库内原文件。

## 预检与小样本试跑

以下示例先构建，再运行命令。PAT 用无回显方式读入，避免进入 shell history：

```bash
npm run build --workspace @sekereagle/eagle-migrator
read -s SEKEREAGLE_PAT
export SEKEREAGLE_PAT

node apps/eagle-migrator/dist/main.js inventory /绝对路径/迁移快照
node apps/eagle-migrator/dist/main.js doctor /绝对路径/迁移快照 --server http://localhost:8180
node apps/eagle-migrator/dist/main.js run /绝对路径/迁移快照 --server http://localhost:8180 --concurrency 4
```

第一次不要直接跑 6 万张。先用 20–100 张覆盖 JPEG、PNG、GIF、视频、重复文件、中文名、标签、文件夹和已删除记录的小图库，确认网页内容、元数据和重复处理都正确。

## 暂停、恢复与核验

按一次 Ctrl+C 会进入安全暂停；已完成分片和本地逐项状态会保留。不要连续强杀进程。恢复和状态查询命令为：

```bash
node apps/eagle-migrator/dist/main.js status /绝对路径/迁移快照
node apps/eagle-migrator/dist/main.js resume /绝对路径/迁移快照 --server http://localhost:8180 --concurrency 4
node apps/eagle-migrator/dist/main.js verify /绝对路径/迁移快照 --server http://localhost:8180
```

默认 journal 位于 `~/.local/share/sekereagle/migrations/<migrationId>/journal.sqlite`，权限为 `0600`。可以用 `--state /绝对路径` 指定位置；同一快照必须一直复用同一 state 目录。journal 与快照身份不一致时工具会拒绝继续。

只有满足以下条件后才开始 6 万张全量：小样本无结构性错误；暂停/恢复至少演练一次；`verify` 与网页抽查一致；服务端数据库和对象存储已有可恢复备份。全量先用并发 `4`，根据服务端 CPU、磁盘、MinIO 与错误率再决定是否提高，不应把 `16` 当默认值。

## 命令边界

- `inventory`：只校验并展示快照清单，不连接服务端。
- `doctor`：校验整个快照、源文件可读性和路径边界，并检查服务端连通性、PAT 身份及 `import:read`。`import:write`、`asset:write` 由后续小样本试跑实际验证。
- `run` / `resume`：使用同一套幂等迁移流程；重复执行不会绕过服务端校验。
- `status`：只读本地 journal，不需要 PAT。
- `verify`：用保留的服务端 run ID 收敛并输出最终逐项状态。

快照校验会读取全部清单和源文件路径。对 6 万张图库这一步本身可能较慢，这是为了在长时间上传前暴露缺文件、越界路径、symlink 和被篡改清单。
