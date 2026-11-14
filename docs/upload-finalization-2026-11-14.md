# 上传校验异步化与有界内存（2026-11-14）

## 背景与结论

2026-11-14 晚间手机批量上传期间，生产 API（`sekereagle/api:map-delete-snapshot-d5fd0e8f91d2`，群晖 `sekereagle-nas-staging-api-1`）匿名内存涨到 2GiB cgroup 上限，内核在 22:10:49 杀死 node 进程，容器自动重启；网关同期出现 78 次 504。排查结论：

- 不是本次镜像回归：新旧镜像 RootFS 前 32 层完全相同，仅多一条地图触发器迁移；上一版 `viewer-cover` 镜像在 21:25 已经发生过同样的 OOM。
- 不是 Prisma／PostgreSQL：OOM 时数据库 28 个 idle 连接、无长查询，杀死的是 node 的 anon-rss（1.93–2.03GiB），不是页缓存。
- 直接原因是上传完成时在 API 进程内同步检查原图：`EagleUploadInspectionService` 把 S3 对象流直接交给 sharp，sharp 对 stream 输入先缓冲整份文件（约 2× 压缩体积）；本机同路径实测 111MP PNG 单次峰值 710–785MB。批量上传时与 768MiB V8 堆叠加，打穿 2GiB 容器。

本轮改动把上传校验从 HTTP 请求移到独立 operations 进程的持久队列，并让检查本身只用有界内存。

## 设计

### 1. `complete` 只受理，不校验

`POST /api/{photos,eagle}/uploads/:id/complete`：

- 合并 multipart（S3），把会话写为 `ASSEMBLED`；
- 在同一数据库事务中 upsert `UploadFinalizationJob`（`PENDING`，`availableAt=now`）并发 `pg_notify('eagle_asset_operations', libraryMode)`；
- 返回 `202 { uploadSessionId, status: 'ASSEMBLED' }`；
- 已 `COMPLETED` 的重试仍返回 `assetId` 与 `duplicate`；已 `PROCESSING` 的任务不会被重复入队；`FINALIZING` 会话返回进行中状态。
- HTTP 进程不再读原图、不再解码、不再发布资源。

### 2. operations 消费持久队列

`UploadFinalizationExecutor` 只在独立 operations 宿主启动：

- 用 `FOR UPDATE SKIP LOCKED` 领取 `PENDING` 任务；`PROCESSING` 超过 5 分钟的租约可被接管（崩溃恢复）；
- 调用原有的 `EagleUploadService.recoverUploadSession()`，复用原上传发布事务、隐私锁、查重策略、媒体任务入队与 `EagleImportsService.finalizeUpload`；
- 成功写 `COMPLETED`；可重试失败按 5 秒起、最长 5 分钟的退避回到 `PENDING`；会话达到 10 次仍失败则任务 `FAILED`；
- operations 已有的 60 秒恢复循环保留为兜底（处理没有任务的旧会话）；`eagle_asset_operations` 通知到达时立即唤醒任务消费者，5 秒轮询仅作降级路径。
- 会话被 `ABORT` 时删除对应任务；终态任务由维护任务按 30 天保留期清理，任务中心历史有界。

### 3. 检查只用有界内存

`EagleUploadInspectionService` 的普通图片分支改为：

1. 边流式读取 S3 对象、边算 SHA-256、边写入容器内临时文件（固定大小 chunk）；
2. 对临时文件调用 `sharp(file, { limitInputPixels }).metadata()`，只读 header；
3. `finally` 删除临时目录。

HEIC／RAW／视频原本就是临时文件路径，保持不变。并发预算仍为进程内一次一个检查；临时目录位于容器 overlay 盘，最多同时一个文件。

本机同代码路径实测（macOS sharp 0.35.5，`--max-old-space-size=768`）：

| 样本                           | 原 stream 进 sharp                 | 临时文件 + header |
| ------------------------------ | ---------------------------------- | ----------------- |
| 111MP PNG（11662×9533，334MB） | 峰值 RSS 710–785MB，external 639MB | 峰值 RSS 104MB    |
| 50MP JPEG（34MB，q90）         | 峰值 133MB                         | 104MB             |

### 4. 客户端

- 网页／桌面：`complete` 返回无 `assetId` 时显示“校验中”，每秒轮询 `GET /uploads/:id`，直到 `COMPLETED`（读取资源）或 `FAILED/ABORTED`（显示错误）；已受理的会话不会在失败时被客户端 DELETE。
- 安卓：`MultipartTransport` 在 complete 后轮询会话状态；120 秒内未完成则按可重试错误结束本轮，下次自动接续；终态失败写入现有失败文件检查点。
- 任务中心：既有 `UPLOADS` 分组（“上传文件入库”）直接读取 `UploadFinalizationJob`，不需要新表或新 UI 分组。

## 端到端成本（一次上传完成）

| 阶段            | SQL／事务                                                | S3                                                     | 前端                               |
| --------------- | -------------------------------------------------------- | ------------------------------------------------------ | ---------------------------------- |
| `complete` 受理 | 1 事务：会话更新 + 任务 upsert + NOTIFY；另 1 次会话读取 | 1 次 CompleteMultipartUpload（已存在对象时 HEAD 兜底） | 1 次 POST                          |
| operations 领取 | 1 次 `UPDATE … RETURNING` + 1 次会话读取                 | 0                                                      | 0                                  |
| 检查            | 0（仅临时文件与 header 读取）                            | 1 次 HEAD + 1 次 GET（流式）                           | 0                                  |
| 发布            | 原发布事务（与同步路径相同） + 1 次任务更新              | 0                                                      | 0                                  |
| 客户端等待      | 每秒 1 次会话 GET，直到终态                              | 0                                                      | 完成后 1 次资源读取 + 1 次列表失效 |

以上为代码路径推算；发布前以 `test:library-integration` 的真实数据库计数和固定测试图库实测为准，不把推算当生产 p95。临时文件为单文件、有界大小（受上传声明大小与现有媒体上限约束），不新增用户操作数量上限。

## 客户端并发与背压

网页导入队列保持原有的 2 路上传、安卓传输池保持 3 路；每个上传槽要等自己的会话完成校验后才释放，因此 operations 的校验队列繁忙时，客户端会自然降速而不是继续堆积未校验对象。校验在 operations 进程内一次一个，不随客户端并发放大内存。浏览器采集插件与 Eagle 导入插件同样按会话轮询，不各自建立并行检查。

## 队列索引与数据访问

`UploadFinalizationJob` 沿用初始迁移已有的两个索引：`(status, availableAt, createdAt)` 与 `(status, lockedAt)`。领取查询对两个状态分支使用 BitmapOr，`FOR UPDATE SKIP LOCKED` 只锁一行。真实 PostgreSQL 120,000 条 `COMPLETED` 历史下，空闲领取实测 **4–5 个共享块**（预算 <64），计划走两个索引而非顺序扫描；测试见 `scripts/testing/upload-finalization-queue.test.mjs`。

## 本机与真实数据库验证（2026-11-14）

- API 单元测试、Web 全量单元测试、安卓 JVM 单测、浏览器采集 56 项、Eagle 导入 41 项全部通过。
- `npm run test:architecture` 42 项通过；全仓 `lint`、`typecheck`、`build`、`format:check`、`oss:check` 通过。
- 真实 PostgreSQL 队列测试 2/2 通过：领取、退避、10 次终态、5 分钟租约接管、ABORT 清理；120,000 条 `COMPLETED` 历史下空闲领取 **4–5 个共享块**（预算 <64），计划走两个既有索引。
- 完整 `npm run test:library-integration` 通过（含历史升级与完整数据库恢复）；新增队列测试已注册在其中。
- 尚未执行：`test:api-image`、固定测试图库真实大文件批次、真实手机批量上传、生产低峰部署。

## 兼容与风险

- 旧版安卓客户端在 `complete` 后没有 assetId 时会按可重试错误处理，下一次重试读取会话，最终 `COMPLETED` 后成功；不会丢文件，但会短暂显示失败／重试。发布时应同步更新客户端。
- 资源出现时间从“complete 返回即存在”变为“后台校验完成后存在”，通常几秒；任务中心与会话状态是唯一事实来源。
- operations 是单实例；租约接管覆盖进程崩溃。多实例部署时 `SKIP LOCKED` 与租约仍然有效，但检查并发预算为进程内，部署多实例需另评估。
- 临时文件在进程崩溃后可能残留；容器重建会清除，现有 HEIC／RAW／视频路径同样如此。后续可在 operations 启动时增加按前缀清理，本轮未加。

## 验证要求

1. `npm run ci:check`（架构、lint、typecheck、unit、build、契约、格式、OSS）。
2. `npm run test:library-integration`：真实 PostgreSQL 的上传受理、任务领取、发布、失败重试、租约接管与 SQL 计数。
3. `npm run test:api-image -- <tag>`：成品镜像独立启动、迁移与 readiness。
4. 固定测试图库上传大 PNG（约 100MP）、20–40MB JPEG、HEIC、MP4：任务中心显示排队／进行，API 容器内存保持平稳，operations 峰值有界。
5. 安卓实机与网页／桌面各跑一次批量上传，确认“校验中”与失败提示；旧客户端兼容路径单独验证。
6. 低峰发布后按已知大文件批次复测 30 分钟，记录 API／operations 内存与 504 数量。
