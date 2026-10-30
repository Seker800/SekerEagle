# SekerEagle 效率检查（2026-10-29）

> 后续逐项复核与本地修复见 [2026-10-30 效率清单复核](performance-verification-2026-10-30.md)。本报告保留原始调查；其中历史状态、估算及建议不等于已确认缺陷或已上线修复。

> 范围：网页端与桌面端（默认使用端）、API、worker／后台处理、PostgreSQL、网关与部署配置。
> 方法：源码只读审计 + 本机固定测试图库实测 + 生产历史实测数据（`docs/current-runtime.md`、`docs/performance-100k-library.md`）。
> 边界：没有改代码、没有部署、没有在固定测试图库上造数或提交写操作；所有本机测量均为只读 GET 与数据库统计视图。
> 本报告不把估算当成实测：带“估算”的条目需按各节验证方式复测。

## 0. 结论摘要

**整体判断**：数据模型和主要读取路径的设计是健康的（keyset 游标、快照地图、预签名直传、缩略图 LRU + 背压、租约 CAS）。100k 素材的列表 p95 有文档实测 7.7–37.9 ms。真正拉低效率的不是“某条 SQL 慢”，而是四类系统性浪费：

1. **传输层没有压缩、首屏只有一个 1.2 MB 的包**：首屏 1.38 MB 未压缩（gzip 后 411 KB），登录页也要先付全部图库代码。
2. **空闲时机器一直在忙**：本机 144 资源的测试图库在无人操作时仍有 **9.3 次事务/秒、24 次索引扫描/秒**，主要来自 API 每 500 ms 的操作队列轮询和 worker 的领取/调度子查询。这不是“业务量”，是空转。
3. **后台供料自限**：候选发现一次约 2.0 s（生产实测），加上“内存等待 1 秒后重排 + 每次重排发 NOTIFY”的放大回路、按最坏界预留的 768/1400 MiB，导致“节点空闲、NAS 数据库很忙、两机没吃满”。
4. **少数用户操作仍是同步长事务**：发送到另一库、清空回收站、删标签触发的全库隐私重算，会占用 15 s 网关超时窗口并持有 advisory lock。

**单项收益最大的五项**（只按收益排序，不代表先后顺序）：

| #   | 动作                                                              | 预期收益                                    | 风险                 |
| --- | ----------------------------------------------------------------- | ------------------------------------------- | -------------------- |
| 1   | 网关与 web 容器开 gzip（含 wasm、JSON）                           | 首屏 −966 KB，列表 JSON −88%，地图资源 −70% | 极低，配置改动       |
| 2   | 登录页懒加载图库主界面 + 地图/编辑器依赖                          | 未认证首屏 −0.78 MB                         | 低，需 Suspense 边界 |
| 3   | 掐掉后台“1 s 重排 + NOTIFY”放大回路（等待类退避 5–30 s 且不广播） | 空转 drain 与全局提交锁等待大幅下降         | 低，行为参数         |
| 4   | 空闲轮询降频（操作队列 500 ms→2–5 s 退避、auth/me 改事件驱动）    | 空载事务约 −50–70%                          | 低                   |
| 5   | 候选发现加 `priorityAt` 排序索引（或先取有界窗口再排序）          | 单次发现 2.0 s → 目标 <100 ms               | 中，需迁移与回放验证 |

---

## 1. 实测基线（本机固定测试图库）

环境：<http://localhost:49813>，`sekereagle_test`，144 项资源／504 条媒体任务，PostgreSQL 16 与 MinIO 在本机 Docker；API 与 worker 为当前构建产物。数据量小，**延迟只代表固定开销，不代表 10 万库**；空闲负载和字节数则与数据量无关，可以直接参考。

### 1.1 前端产物（2026-10-29 构建）

| 产物                   |              原始 |             gzip | 首屏           |
| ---------------------- | ----------------: | ---------------: | -------------- |
| 入口 JS `index-*.js`   |       1,200,265 B |        373,747 B | 是             |
| 入口 CSS `index-*.css` |         177,496 B |         36,736 B | 是（阻塞渲染） |
| **首屏合计**           |   **1,377,761 B** |    **410,483 B** | —              |
| OpenSeadragon          |         350,313 B |         88,068 B | 否（动态）     |
| protomaps 底图         |         127,344 B |         36,341 B | 否（动态）     |
| 照片编辑器 + CSS       | 54,739 + 29,133 B | 17,603 + 5,667 B | 否（lazy）     |
| Photon wasm            |       1,880,773 B |        670,460 B | 否（worker）   |

入口 JS 的模块归因（sourcemap 逐模块统计，未压缩源码字节）：
`react-dom 611 KB`、**`leaflet 440 KB`**、`i18n 文案 192 KB（en-US 98 + zh-CN 94）`、`fflate 89 KB`、`i18next 82 KB`、**`exifr 74 KB`**、`@tabler/icons 50 KB`、`fast-png 34 KB`、`photo-render-core 33 KB`。
即：地图、EXIF 解析、照片渲染管线和两种语言，都在登录页的同一个包里。

### 1.2 API 计时（本机，5 次中位）

| 请求                                  | 状态 |   中位耗时 | 原始体积 | gzip 后 |
| ------------------------------------- | ---: | ---------: | -------: | ------: |
| `GET /api/eagle/assets?limit=40`      |  200 |    14.2 ms |  67.5 KB |  8.0 KB |
| `GET /api/photos/assets?limit=40`     |  200 |    12.8 ms |  82.5 KB |  8.8 KB |
| `GET /api/eagle/assets/:id`（详情）   |  200 |     8.9 ms |   1.9 KB |  0.8 KB |
| `GET /api/eagle/tags`                 |  200 |     6.6 ms |   1.8 KB |       — |
| `GET /api/eagle/tasks`（任务中心）    |  200 |     7.1 ms |   1.3 KB |  0.5 KB |
| `GET /api/photos/photography/map?...` |  200 | 8.2–8.6 ms |   4.0 KB |  1.2 KB |

关键事实：**所有响应都没有 `Content-Encoding`**；列表每项约 1.7 KB，其中 817 B 是 3 条 rendition 元数据、232 B 是标签。gzip 能把它压到 8 KB（−88%）。

### 1.3 空闲数据库负载（60 秒采样，无用户操作）

| 指标         |                            数值 |
| ------------ | ------------------------------: |
| 事务提交     |    559 次/分钟（**9.3 次/秒**） |
| 索引扫描     |   1,453 次/分钟（**24 次/秒**） |
| 缓存命中率   |                            100% |
| 4 天累计事务 | 1,627,831（144 项资源的测试库） |

按表归因（45 秒采样）：`EagleAssetOperationItem +716`（约 16 次/秒）、`EagleProcessingSetting +360`（约 8 次/秒）、`EagleMediaJob +184`（约 4 次/秒）。
这与代码完全对得上：API 的操作队列每 500 ms 跑 SEND/METADATA 两条通道、每条一个事务；worker 的领取/唤醒查询里又对设置与策略表做子查询。**图库没人用的时候，数据库仍在为轮询工作。**

### 1.4 生产历史实测（来自文档，非本次测量）

- 10 万素材列表 p95：默认 7.72 ms、90k 深游标 20.23 ms、名称搜索 37.91 ms、Lab 颜色筛选 81.81 ms（`docs/performance-100k-library.md`）。
- 候选发现一次约 **2.0 秒**、概览一次约 **1.0 秒**（`docs/current-runtime.md`，2026-10-26 生产诊断）。
- PostgreSQL CPU 曾达 164–261%，WALSync 等待 0.24–2.04 s；NOTIFY 全局提交序锁被确认为写路径瓶颈（`docs/current-runtime.md`）。
- worker 实测 RSS 517–808 MiB／2 GiB；RAW 峰值 1.71 GiB（同上）。

---

## 2. 加载效率

### [P0] 2.1 未认证首屏就下载并解析整个应用

`apps/web/src/App.tsx:10` 静态 import `SekerEaglePage`，`main.tsx:4` 静态 import `App`；`SekerEaglePage` 又静态引入地图、统计、标签、任务中心、批量编辑等全部工作区。因此登录表单第一帧要等 1.2 MB JS（未压缩）解析完。

- 影响：10 Mbps 下约 +1.0 s 传输，中端机再 +0.4–0.6 s 解析/编译；这是用户看到登录框之前的固定成本。
- 修复：`SekerEaglePage`、`AccountHome`、`PhotoPrivatePeopleSettings` 改为 `lazy()`，用现有 loading 骨架做 `Suspense` 回退；登录成功后 `requestIdleCallback` 预热主界面。登录页载荷可降到约 0.43 MB。
- 验证：禁用缓存，未登录状态记录 `transferred`；改后应只剩一个约 430 KB 的 chunk。

### [P0] 2.2 全链路没有文本压缩

`apps/web/nginx.conf` 与 `deploy/gateway/nginx.conf` 都没有 `gzip` 指令；API 没有 `compression` 中间件（`apps/api/src/main.ts` 只有 cookieParser 与 ValidationPipe）。实测带 `Accept-Encoding: gzip` 请求仍是 1,200,222 B 原样返回。

- 影响：首屏多传 966 KB（2.6×）；列表 JSON 多传 88%；`photon_rs_bg.wasm` 首次打开编辑器多传 1.21 MB；地图底图（land geojson 1.26 MB、cities 0.84 MB）同样未压缩。
- 修复：web 容器 `gzip on; gzip_comp_level 5; gzip_min_length 1024; gzip_vary on; gzip_types text/css application/javascript application/json application/geo+json application/wasm image/svg+xml;`。网关对 `/api/` 加同样配置（`gzip_proxied any`），或给 API 加 `compression` 并跳过 `image/*`、`video/*` 与 `Range` 请求。注意 `/api/` 当前是 `proxy_buffering off`，若在网关压缩 JSON，建议改成 `proxy_buffering on`（媒体仍走 `/media/`，不受影响）。
- 验证：`curl -sI -H 'Accept-Encoding: gzip' .../assets/index-*.js | grep -i content-encoding`。

### [P1] 2.3 首屏里的“永远用不到”的依赖

| 依赖                         | 体积（未压缩） | 实际使用时机                                      |
| ---------------------------- | -------------: | ------------------------------------------------- |
| leaflet                      |     147 KB min | 仅「照片 → 地图」                                 |
| exifr                        |      70 KB min | 仅编辑器读取 EXIF；首屏只用 `formatPhotoMetadata` |
| 双语言文案                   |         104 KB | 运行期只用一种，切换语言是整页 reload             |
| fast-png + photo-render-core |          24 KB | 仅批量编辑/编辑器                                 |
| 其他工作区 section           |        ≈215 KB | 仅对应 `libraryView`                              |

- 修复：`PhotoMap` 动态 import；`photo-editor-metadata.ts` 里把 `parse` 改成 `await import('exifr')`；i18n 按当前 locale 动态加载另一语言（或至少把 en-US 拆 chunk）；`EagleBatchPhotoEdit` lazy；按 section 懒加载 `EagleTaskCenter`、`EagleVectorWorkspace`、`EagleTagPage`、`PhotoStatistics`。
- 预期：入口从 1.2 MB 降到 ≈0.75–0.8 MB，登录页降到 ≈0.43 MB。

### [P1] 2.4 七个独立请求被串在列表请求之后

`SekerEaglePage.tsx:503-515` 用 `secondaryReady = assetsQuery.isFetched` 作为标签、标签组、智能文件夹、向量概览、库计数、两个模式操作队列的 `enabled` 条件。这些请求与列表没有数据依赖，却要多等一个 RTT。

- 影响：局域网 +5–10 ms；4G/远程 +120–600 ms 才能渲染侧栏与筛选计数。
- 修复：把 `enabled` 改为只依赖认证就绪（或列表 error 时不再重发），让它们与 `/assets` 并行。

### [P2] 2.5 稳态轮询偏密

- `useAssetOperations.ts:40-45`：空闲 10 s、有任务 1.5 s，两个模式各一条 → 空闲 12 次/分钟。
- `useEagleLibraryCount.ts:19-21`：30 s 一次 `COUNT(*)`，只为一个导航徽标。
- `App.tsx:101`：`/api/auth/me` 每 30 s（断网 5 s）。
- `useEagleReferenceData.ts` 的标签/标签组/智能文件夹没有 `staleTime`，默认每次窗口聚焦都重取。

合计一个打开的标签页空闲约 16 次/分钟、8 小时约 7,700 次，全部落到同一台 NAS。建议：操作队列空闲分支 10 s→60 s；库计数改为变更时 `invalidateQueries`；`main.tsx` 的 `QueryClient` 加默认 `staleTime: 60s`、`refetchOnWindowFocus: false`；`auth/me` 改为 `visibilitychange`/`focus` 驱动。

### [P2] 2.6 缩略图与查看器

- `EagleAssetThumbnail.tsx:309` 的 `<img>` 没有 `decoding="async"` / `fetchPriority`；滚动时解码在合成关键路径上。
- overscan 为 `max(1200, viewportHeight*2)`（`SekerEaglePage.tsx:769`），900 px 视口会预取约 44 张，而可见区约 12–16 张；首屏图片流量约为需要的 3 倍。
- OpenSeadragon 350 KB 只在首次双击预览时下载（`EagleImageViewer.tsx:104`），首次打开大图有额外白屏；建议首屏空闲后预取，卡片 hover 时预热。
- 做得好：blob + 引用计数 LRU（512 项/128 MB）、in-flight 去重、AbortController、429 冷却、失败按 rendition 降级并指数退避；大图只用预览 rendition，≥4096 px 才升级金字塔。

### [P2] 2.7 渲染

- 滚动每帧把 `scrollTop` 放在 2,875 行的 `SekerEaglePage` 顶层 state（`:309,362,2014`），整页（含约 44 张卡片）一起 diff。建议把滚动状态下移到网格组件，卡片 `memo` + 事件委托。
- 任一实体更新都会让 `loadedAssets` 重算 → 布局三趟 O(n) → 重建虚拟化 bucket（`:603-609,733-771`）。有处理中素材时每 10 s 一次；已加载 1 万条时单次约 80–150 ms，10 万条时约 0.5–1 s。建议按 id 增量更新卡片，不整页重排。

---

## 3. 操作效率（点击 → API → 数据库）

### [P1] 3.1 每个认证请求 2 条会话 SQL

`session-token.service.ts:127-140`：每次请求 `User.findUnique` + `RefreshToken.findFirst`。缩略图与切片也走同一个 guard，一屏 30 张图 = 60 条会话查询。

- 修复：进程内缓存 `(userId, sessionFamilyId, authVersion)` 5–10 s，注销/改密主动失效；或媒体路由用短时签名 URL。
- 验证：`pg_stat_statements` 里 `FROM "User" WHERE "id"` 的 calls 应等于页面请求数，加缓存后应远小于。

### [P1] 3.2 详情页 12+ 次串行往返

`eagle.service.ts:838-848` 的 `assetInclude`（`:125-145`）包含 photoMetadata、photoLocation、renditions、manualTagLinks、tag、photoFaces、person、annotation、aiTagLinks、aiTag、colorAnalyses、swatches。Prisma 默认 `relationLoadStrategy=query`，每个关系一条 SQL 且串行。

- 修复：启用 `relationJoins` 预览特性，或拆成 3 条并行查询（主表+EXIF/位置、标签、AI+色板+人脸），或把 AI 标签/色板改成侧栏展开时再取。
- 验证：`DEBUG=prisma:query` 数一次详情的 SQL 条数。

### [P1] 3.3 标签列表无上限，且每个标签带一次过滤计数

`eagle.service.ts:1150-1180`：`findMany` 没有 `take`，`_count.assetLinks` 带 `asset.deletedAt`/私密过滤。成本约等于该 owner 的全部标签链接数，而不是标签数；从 Eagle 导入留下数千标签时，标签面板会明显卡顿。AI 标签列表同构（`:1429-1458`）。

- 修复：`take ≤ 500` + 游标；`assetCount` 物化到标签行或快照表，或只在 `includeCounts=true` 时计算。

### [P1] 3.4 颜色筛选每翻一页跑两条全表 COUNT

`eagle.service.ts:345-371`：`colorCoverage` 挂在列表接口上，一条是 owner 全部图片素材数（与筛选无关），一条是已完成颜色分析数。10 万行估算 30–80 ms ×2，每滚一页付一次。

- 修复：只在首屏（无 cursor）计算，或移到独立接口并缓存 60 s。

### [P0] 3.5 语义搜索排序绕开 HNSW；结构化筛选把全库 ID 塞进 SQL 参数

两处叠加：

1. `eagle-image-search.service.ts:106-148` 的语义分支是 `UNION ALL` 后 `GROUP BY`、外层再 `ORDER BY tier, similarity`，没有 `ORDER BY embedding <=> $vec LIMIT k`，规划器无法使用 `EagleAssetEmbedding_hnsw_idx`（该索引确实存在，见 `20260819001000_vector_tag_suggestions/migration.sql:58`）。结果是每次对 owner 全量 embedding 做精确余弦计算。
2. `eagle.service.ts:547-554`：只要同时带任一结构化筛选（标签/评分/格式/日期），就先 `findMany` 把该 owner 命中的**全部 id** 读进 Node，再作为单个数组参数传给 `AND asset.id = ANY($1::text[])`（`eagle-image-search.service.ts:94-96`）。10 万素材约 3.6 MB 参数，候选批次循环里反复绑定。

- 影响：画面搜索 + 任一筛选是唯一会在 10 万库变成“秒级”的读路径；智能文件夹预览用的是 `ORDER BY embedding <=> vec LIMIT 100`，能用 HNSW，说明索引没问题，是排序写法的问题。
- 修复：语义召回改成真 top-k（`ORDER BY embedding <=> $vec LIMIT ...`）后与名称/标签 tier 归并；结构化筛选编译成子查询下推，删掉 `eligibleAssetIds` 通路。
- 验证：`EXPLAIN (ANALYZE, BUFFERS)` 应出现 `Index Scan using EagleAssetEmbedding_hnsw_idx`，而不是 `Seq Scan`。

### [P1] 3.6 “发送到另一库”在请求内复制对象并跑 30 s 长事务

`eagle.controller.ts:122-127` 同步调用 `transfers.send`；`eagle-library-transfer.service.ts:245-267` 逐项 `copyObject` + `headObject`（内部并发 4），随后在同一事务里逐项 `create`/`createMany`（`:296-460`），事务 `timeout: 30000`（`:477`）。单次上限 100 张、每张 1–17 个对象。

- 影响：100 张约 3–15 s 的 S3 往返留在 HTTP 请求里；网关 `/api/` 是 15 s（`deploy/gateway/nginx.conf:55`），超时返回 504，用户会重复点。事务期间持有 asset 行锁与两个模式的 privacy advisory lock，同 owner 的写操作排队。
- 修复：入口只入队（复用现成的 `EagleAssetOperationService`），由后台执行；事务内改 `createMany` 批量；先复制、后短事务发布。
- 验证：`curl -w '%{time_total}'` 发 100 张；`pg_stat_activity` 看事务时长与 `wait_event='advisory'`。

### [P1] 3.7 清空回收站不分批

`eagle.service.ts:1113-1147`：一条 `UPDATE ... RETURNING` 更新全部已删素材，然后一次性 `createMany` 生成 PURGE 作业，再 `updateMany ... id IN (全部 id)`。5 万张时 = 5 万行更新 + 5 万行插入 + 一条 5 万元素 IN，全部在一个默认 5 s 的事务里。

- 修复：分页（500–1000/批）或改成一条 `INSERT ... SELECT`，把 `purgeAfter` 排期交给后台作业。

### [P1] 3.8 删标签/改隐私规则触发全库 UPDATE

`eagle.service.ts:1313-1317` 在删除标签后调用 `syncAssetPrivacy(tx, ownerId, undefined, mode)`；`packages/library-persistence/src/index.ts:63-84` 在 `assetIds === undefined` 时对该 owner 全部素材做两条带 EXISTS 的 UPDATE，并 `rowVersion + 1`。

- 影响：10 万库删一个标签要对全部素材做两条带 EXISTS 的扫描（即使没有一行需要改）；如果该标签是私密标签，实际写入的是所有带该标签的行（可达成千上万），这些行的 `rowVersion + 1` 会让客户端缓存失效并在下次列表全量重拉，`EagleAsset` 上的 16 个索引也要同步维护。整个过程持有 privacy advisory lock，上传 finalize、打标签、回收写入排队。
- 修复：只重算“曾受该标签影响”的素材（先取 `tagId` 的 assetIds 再传 `assetIds`）；人物私密只传该人物的 face assetIds；确实要全量时改成后台作业。

### [P1] 3.9 任务中心的“未扫描人物”是全库 EXISTS 扫描，且每 10 s 轮询

`task-center-query.ts:80-84` 在 PHOTO/ACTIVE 分支拼入 `unscannedPhotoFacesSql`（`photo-face-scan.ts:8-23`：遍历全部 READY 照片 + 2 个 EXISTS）。前端 `EagleProcessingPage.tsx:129-135`、`EagleVectorWorkspace.tsx:140-146` 每 10 s 刷新。

- 影响：10 万照片库每次 150–400 ms（估算），每分钟 6 次，与用户是否看图无关，并与翻页争 CPU。
- 修复：把计数物化成快照（像地图那样由 worker 写），overview 只读快照；轮询先降到 30 s。

### [P2] 3.10 其他操作路径

- 照片 Agent 列表 N+1：`photo-agent.service.ts:243-252` 每个任务 2 条查询（count + suggestions），默认 50 条 → 101 次串行往返。
- 摄影统计：`photo-statistics.service.ts:77-100` 先 `MATERIALIZED` 全库照片再过滤日期/相机，过滤无法下推；10 万照片估算 200–500 ms，建议把日期与相机条件下推进 `scoped` 并加 30–60 s 缓存。
- 时间线按天聚合：`eagle-asset-timeline.ts:20-31` 的谓词是 `isPrivate=false`，而索引 `(ownerId, libraryMode, deletedAt, libraryAddedAt, id)` 不含 `isPrivate`，无法 index-only；可复用已有的 `(ownerId, libraryMode, isPrivate, deletedAt, libraryAddedAt, id)` 索引。
- 网格缩略图：媒体响应是 `private, no-cache` + ETag（`eagle.controller.ts:342,413`），二次访问仍要 304 回源；因为缩略图 URL 绑定 rendition id/mediaRevision，实际不可变，可给派生图短 TTL（如 5 分钟、瓦片 1 天），隐私撤销靠短 TTL 与版本守卫。
- 网关 `/api/` 15 s 超时对所有读接口一视同仁（地图、统计、智能文件夹全库读在弱 PG 上可能超时），建议给读密集型 location 放宽到 60–120 s，并避免幂等 GET 自动重试。

### [P1] 3.11 操作队列每 500 ms 开两个事务（实测的主要空转来源）

`eagle-asset-operations.service.ts:63-68` 每 500 ms `tick()`；`:491-495` 同时跑 SEND 与 METADATA 两条通道；`:359-374` 每条通道开一个事务、取 `pg_advisory_xact_lock('asset-operations:<mode>')`、`count` 再 `findFirst`。两条通道锁键相同，互相串行；每个模式一份实例（eagle + photo 两个 module）。

- 实测：`EagleAssetOperationItem` 索引扫描约 **16 次/秒**，与代码推算的 2 通道 × 2 次/秒 × 约 4 条语句吻合。
- 修复优先级最高（改动小）：无 PENDING 时指数退避到 2–5 s；先用无锁 `EXISTS` 探测再进事务；两条通道锁键加 lane 名；长期可迁到 worker 或单 leader。
- 验证：空载 10 分钟看 `pg_stat_database.xact_commit` 增量应明显下降。

### 做得好的地方

- 列表是真正的 keyset 游标（`eagle-cursor.ts`），不带 total，滚动不触发 `COUNT(*)`；索引 `(ownerId, libraryMode, deletedAt, libraryAddedAt|chronologicalAt, id)` 与排序完全匹配。
- 列表关系是 5–6 条批量 `IN`，不是逐项 N+1；live-photo 也是 groupBy。
- 上传是预签名分片直传 MinIO（`eagle-upload.service.ts:196-210`），API 不中转字节；finalize 流式哈希 + sharp 流式解码，有字节上限。
- 地图只读快照与 cell，成员用 `(chronologicalAt, assetId)` 元组游标 + `LIMIT 61`，打开地图不扫原始摄影事实。
- 隐私可见性用 JWT cookie 判定，不查库；跨 owner 统一 404。
- 批量标签写按 100 条 `createMany({skipDuplicates})`；回收站用 `updateMany` + 状态机。

---

## 4. 后台处理

### 4.1 空闲也在全量领取

`main.ts:1675` 的 `photoMapTimer` 每 15 s 强制 `wakeNow()`；`job-wakeup.ts:66-69` 又把“睡到下一个到期时间”夹到最多 30 s（`FALLBACK_POLL_MS`）。每轮 `drainAndScheduleWork` = `propagateFailedDependencies`（递归 UPDATE）+ `poll()`（最多 3 个 lane 的 50 行候选 + 设置查询）+ `nextQueueWakeAt`（全队列 wake 聚合 + 全表 settings）。

- 本机实测：空闲 `EagleMediaJob` 约 4 次索引扫描/秒、设置表约 8 次/秒。
- 建议：地图改为 dirty 驱动（有变化才 wake）；去掉 15 s 的强制唤醒；`propagateFailedDependencies` 只在 `failJob` 终态或 ≥60 s 低频执行；fallback 与“按到期时间睡”分开，别让 30 s 上限覆盖夜间休眠。

### [P0] 4.2 “等待容量/内存 → 1 秒后重排 → NOTIFY → 全量 drain”放大回路

`main.ts:1196-1202`（远端不可用）与 `main.ts:1345-1350`（内存等待）都用 `mediaWaitData(attempts, 1000, ...)`：`attempts-1`、`availableAt=now+1s`、状态回 PENDING。PENDING 转换会触发 `pg_notify`（`20261026010000_media_candidate_wakeups/migration.sql:5-24`），worker 收到后 `wakeNow()` 再跑一整轮 drain。

- 影响：远端正忙时每槽每秒可产生一次 503 → 1 s 后重排 → 通知 → 全量重扫。14 路饱和时最多约 14 次重排/秒；NOTIFY 又在提交点取全局锁（生产实测 85 个 COMMIT 等 object、最久 2.04 s）。这正是历史“失败-重试-离线”循环的自持机制。
- 修复：等待类退避改成 5 s 起、指数到 30 s（或按当前 in-flight 算下一次可用时间）；等待类 PENDING 不广播（只让定时器兜底）；远端不可用时先看节点剩余名额再决定是否领取。
- 验证：把远端压到 1 路灌 20 个任务，统计 drain/秒、`EagleMediaJob` UPDATE/秒、`pg_stat_database.xact_commit` 与 `pg_stat_activity` 的 `wait_event='object'`。

### [P1] 4.3 候选发现无法用索引排序

`scheduled-media-candidates.ts:51-99`：`ORDER BY (kind='RENDER_EDITED_COPY') DESC, (freshness>=now()-24h) DESC, CASE ... END DESC, priority DESC, availableAt, createdAt, id`，其中 freshness 是 `GREATEST(a.libraryAddedAt, current_upload.completedAt)`，还带 `taskRunnableSql` 的策略/时段子查询。现有 `(status, lane, availableAt)` 只能做过滤，排序要在内存里做。生产实测一次约 2.0 s（`docs/current-runtime.md`）。

- 修复：新增可排序的 `priorityAt` 列（写入时计算 freshness/CASE 结果）并建 `(lane, status, priorityAt DESC, id)` 覆盖索引；或先用 `availableAt` 取有界窗口（如 200–500 条）再在窗口内做复杂排序。
- 验证：`EXPLAIN (ANALYZE, BUFFERS)` 看是否还有 external merge；目标 `mean_exec_time < 100 ms`。

### [P1] 4.4 内存预算按最坏界预留，且等待是全局闸门

`media-resource-budget.ts:7` 在途预算 1536 MiB；`mediaMemoryMiB`：照片详情（`photo-source-details-v1`）768 MiB，NAS 上其余任务 1400 MiB，远端照片 128 MiB，人脸 64/384 MiB。`media-resource-pool.ts:108-117` 只要 `memoryWaits` 里有任意一个等待，其他资源也进不来。

- 影响：1536 MiB 下照片详情最多 2 路并发（而远端有 14 路）；一个 768 MiB 的等待会挡住 128 MiB 的小任务；实测 worker RSS 只有 517–808 MiB，说明预留是保守的最坏界，不是期望值。这也解释了“节点空闲、供料不足”。
- 修复：等待按资源独立排队（不要全局 return）；用每任务 `rssAfterMiB`/`processMaxRssMiB` 日志统计 p95 后重新标定（例如照片详情 320–384 MiB），保留安全余量；必要时对小任务做软超卖。
- 验证：用 20–30 个真实任务采样峰值 RSS，再压测 2/4 路并发看 cgroup `memory.peak`。

### [P1] 4.5 远端并发按“登记容量总和”而不是剩余容量

`main.ts:182-194` 计算远端并发时把各节点 `concurrency` 相加，没有减去 `inFlight`；`compute-runtime.ts` 里已经有 `inFlight` 却没用上。协调器的单次 5xx/429 就隔离节点（`server.mjs:184-195`），客户端断开也走隔离（`:239-240`），而 worker 15 s 才刷新 runtime（`main.ts:1626`）。

- 影响：半饱和时超额领取 → 503 → 1 s 重排回路；一次大图超时或客户端断开就可能把节点标成离线，直到下一轮刷新（约 15 s）；健康反复 OFFLINE 的历史现象与此一致。
- 修复：`limit = Σ max(0, concurrency − inFlight)`；连续 N 次失败才隔离；客户端断开不计入节点失败；刷新间隔降到 3–5 s。

### [P1] 4.6 发布事务内的全量分组扫描与 owner 级串行

`image-publication.ts:131-134` 在发布事务里做 500 行分组扫描；`photo-grouping.ts` 持有 owner advisory lock。连续导入 N 张 = N 次 500 行扫描 + N 个串行发布事务，把远端并行抹平。

- 建议：分组扫描移出发布事务（或用增量维护），owner 锁按资源分片；至少把 500 行窗口缩小到本次变更涉及的时间窗。

### [P1] 4.7 人脸回写的内存与 N+1

`photo-faces.ts:86-90,107-117` 每资产载入最多 1 万个人物原型（Float[] 512 维 ≈ 4 KB/人 ≈ 40 MB），批 8 个资产 ≈ 320 MB 堆；而 `docs/current-runtime.md:493` 记录 worker `--max-old-space-size=512`。另有每张脸 `findUnique + create` 的 N+1（`face-publication-batcher.ts:44`）。

- 建议：原型按 tag 缓存并设上限/流式比较；N+1 改批量 upsert；确认现用 Mac worker 的堆上限与批大小匹配。

### [P2] 4.8 其他后台成本

- 金字塔逐 tile `readFile` + `PutObject`（`main.ts:1132-1147`）：8000 px 约 300+ tile，20 ms/tile ⇒ 6–10 s/任务；可并发 4 路上传（与已有发送通道上限一致）。
- 智能文件夹每 5 s 跑 `reconcile`（jsonb 扫描）+ `runSmartFolderBuildStep`（policy/schedule 子查询 + UPDATE），无任务时也执行（`main.ts:1670`，`smart-folder-build.ts:33-91`）；建议空闲退避到 30–60 s 或由通知唤醒。
- 心跳 15 s 一次跨机 readiness + capabilities upsert（`main.ts:1626`）：可降到 30 s，并相应放宽任务中心判定窗口。
- 协调器 5 s 探所有节点、2 s 超时（`compute-coordinator/main.mjs:39-47`）：节点多时是常驻跨机流量，可降到 15 s。

### 做得好的地方

- NOTIFY 只作为“提示”，每次领取仍完整复核 owner/模式/版本/依赖/暂停/时段并用租约 CAS；20261028 迁移已跳过 claim 与正向续租的广播（这是对的，需确认生产账本已应用）。
- 写回是单事务 + 租约 CAS，不是逐项 commit；人脸有 200 ms/8 条的有界批处理。
- Sharp cache 64 MiB、concurrency 1；金字塔/视频走 SEA1 流到临时目录，源直接 pipeline 进 sharp。
- 协调器有 EWMA、宿主上限、交互预留、空闲优先；worker lane 轮转保持公平。

---

## 5. 数据库与索引

### 5.1 读取索引覆盖总体良好

- 默认列表、深游标、评分/格式、标签 ALL、Lab 颜色都有对应复合/部分索引；`docs/performance-100k-library.md` 的 10 万实测 p95 7.7–81.8 ms 与之一致。
- 名称搜索有 GIN trigram 索引（`schema.prisma:446-447`），`EagleManualTag`/`EagleAiTag` 也有。
- 地图读快照，成员 keyset；任务候选有 `(status, lane, availableAt)`、`(dependsOnJobId, status)`、`(ownerId, libraryMode, status, kind, processorVersion)`。

### 5.2 结构性成本

- **写放大**：`EagleAsset` 16 个索引（含 2 个 GIN trigram、部分索引），`EagleAssetColorSwatch` 5 个索引且每素材 5 行；隐私状态翻转、批量打标签或替换原图时，被改动的每一行都要同时维护这些索引。10 万库批量更新时这是主要 WAL 来源。
- **未覆盖的谓词**：`EaglePhotoMetadata.cameraModel/lensModel`、`EagleAssetAnnotation.description` 没有 trigram 索引，`CONTAINS/NOT_CONTAINS` 与相机/镜头筛选会走全扫或关联子查询（`eagle-filter-query.ts:92-115,197-216`）。
- **时间线 index-only 失效**：谓词含 `isPrivate`，但排序索引不含它（见 3.10）。
- **标签计数**：`_count` 每次沿链接表展开，没有物化计数（见 3.3）。
- **智能文件夹分页**：`GROUP BY` 后再做 `(similarity, assetId)` 比较，无法下推（`eagle-smart-folder-ranking.ts:21-38`）；建议在构建快照时物化 similarity 并建 `(snapshotId, similarity, assetId)` 索引。
- **触发器**：`library_mode_immutable` 是 `BEFORE UPDATE OF "libraryMode"`，正常更新不触发（不是问题）；`notify_sekereagle_worker_wakeup` 是 `AFTER INSERT OR UPDATE`，对状态/租约变化发通知，是 4.2 的放大器。
- **表增长**：`EagleMediaJobEvent` 每次状态转换一行，10 万素材 × 多个任务会到百万级；现有 10 分钟维护只删 30 天前已完成媒体任务（每轮 ≤1 万），事件表需要同样的保留策略。

### 5.3 执行计划建议（在隔离库跑，不要在生产）

```sql
-- 1) 候选发现
EXPLAIN (ANALYZE, BUFFERS)
SELECT job.* FROM "EagleMediaJob" job JOIN "EagleAsset" a ON ...
WHERE job.lane='BACKGROUND' AND (job.status='PENDING' OR (job.status='PROCESSING' AND job."lockedAt"<now()-interval '15 minutes'))
ORDER BY ... LIMIT 50;

-- 2) 语义搜索
EXPLAIN (ANALYZE, BUFFERS)
WITH ... UNION ALL ... GROUP BY ... ORDER BY tier, similarity LIMIT 40;
-- 期望出现 EagleAssetEmbedding_hnsw_idx；若出现 Seq Scan 即确认 3.5

-- 3) 未扫描人物
EXPLAIN (ANALYZE, BUFFERS) <unscannedPhotoFacesSql>;
-- 期望 < 100 ms；当前应为全库半连接

-- 4) 颜色覆盖度
EXPLAIN (ANALYZE, BUFFERS) SELECT count(*) FROM "EagleAsset" WHERE ownerId=... AND "deletedAt" IS NULL AND "mimeType" LIKE 'image/%';
```

### 5.4 连接池

`PrismaService` 直接 `new PrismaClient()`（`prisma.service.ts:5-13`），`DATABASE_URL` 没有 `connection_limit`。默认约为“核数×2+1”，API/worker 各一份，连接数随宿主漂移，也无法在慢查询打满时调小。建议 API `connection_limit=10`、worker `connection_limit=8`、`pool_timeout=10`，再用 `pg_stat_activity` 核对。

---

## 6. 运行时与部署

以下生产数值来自文档历史快照，**需要以现用私有 compose 与 `docker inspect` 核实**。

### [P1] 6.1 PostgreSQL 3 GiB 没有对应调参

仓库 compose 的 postgres 服务只有镜像、env、`shm_size: 512m`、healthcheck、`mem_limit`，没有 `command`/`postgresql.conf`。PG16 默认 `shared_buffers=128MB`、`work_mem=4MB`、`maintenance_work_mem=64MB`、`max_wal_size=1GB`。如果现用链也没有覆盖，3 GiB 大部分只是页缓存，排序/聚合仍走临时文件，与历史 `DataFileRead 7s` 一致。建议：

```
command: >
  postgres -c shared_buffers=768MB -c effective_cache_size=2GB
  -c work_mem=16MB -c maintenance_work_mem=256MB
  -c max_wal_size=4GB -c min_wal_size=1GB -c wal_compression=zstd
  -c checkpoint_completion_target=0.9 -c log_min_duration_statement=500
```

保留 `synchronous_commit=on`、`full_page_writes=on`。

### [P1] 6.2 没有 CPU 配额，PG 与媒体等权竞争

compose 只有 `mem_limit`，没有 `cpus`/`cpu_shares`。DS1522+ 是 2C/4T，历史采样 PG 164–261%、worker 41.7%，两者会互相挤。建议 PG `cpus: 2.0`、API `cpus: 1.0`、worker `cpus: 2.0`（NAS 内核不支持 `pids_limit`，不要写）。

### [P1] 6.3 上游没有 keepalive

`deploy/gateway/nginx.conf` 三个 upstream 只有 `zone` + `resolve`，location 里也没有 `proxy_set_header Connection ""`。一屏 50–100 张缩略图 = 50–100 条新 TCP。建议 upstream 加 `keepalive 32`、`keepalive_requests 1000`，location 加 `proxy_set_header Connection ""`。

### [P1] 6.4 对象存储代理保留默认缓冲

`/sekereagle-assets/` 只改了 Host，没有 `proxy_request_buffering off`/`proxy_buffering off`。上传分片与下载会先在网关临时目录（NAS 卷）落盘一次，多一次写+读，正好压在已有磁盘瓶颈上。建议该 location 关闭请求/响应缓冲。

### [P2] 6.5 镜像与健康检查

- 运行镜像复制整个 `node_modules`（含 devDependencies：typescript、eslint、vitest），体积与拉取/扫描成本偏高；建议 `npm ci --omit=dev` 后再复制，Prisma client 在该阶段重新 generate。
- API 健康检查每 10 s 起一个 `node -e fetch`，worker 每 15 s 起一个 node 进程；2 核 NAS 上每天约 1.4 万次短命 node。建议 interval 30 s、`start_period` 120–180 s，或用轻量探针。
- API/gateway 没有 `stop_grace_period`（默认 10 s），部署/重启会掐断进行中的下载与上传分片；建议 30 s，并保持先排空再切换。
- `worker` 在此 compose 是 `mem_limit: 6g`，与文档记录的 2 GiB／Mac 原生运行不一致；部署前先核对现用资源，不要用仓库默认值覆盖。

### [P2] 6.6 单点与观测

- gateway/API/worker 都是单实例：任一重启即全站 502；API 本身无状态，可以先扩 2 副本（但要先把 API 内的 500 ms 操作队列轮询做成单 leader，见 3.11）。
- 没有请求耗时、慢查询、队列深度、GC 指标。目前“加载慢”只能靠 SSH 采样区分网络/DB/主线程。最小集：网关 `$request_time/$upstream_response_time`、API `/metrics`（prom-client）+ Prisma 慢查询、PG `pg_stat_statements` + `log_min_duration_statement=500`、worker 把已有的 `elapsedMs/rssBefore/rssAfter` 转成指标。

---

## 7. 会让你觉得“变慢”的因素清单

| 因素                  | 现状                             | 什么时候会明显                                                  | 观察信号                                      |
| --------------------- | -------------------------------- | --------------------------------------------------------------- | --------------------------------------------- |
| 图库规模 10 万→100 万 | 10 万已验证；百万未验证          | 颜色覆盖度 COUNT、标签 `_count`、未扫描人物、时间线聚合线性变慢 | 列表 p95、PG `seq_scan`、`pg_stat_statements` |
| 无文本压缩            | 全链路无 gzip                    | 远程/手机/弱网首屏                                              | 首屏 transferred、LCP                         |
| 首屏单包 1.2 MB       | 登录页即加载全部                 | 每次冷启动                                                      | JS 传输/解析时间                              |
| 空闲轮询密度          | API 9.3 tx/s + worker 24 idx/s   | 7×24 常驻，多标签页翻倍                                         | `xact_commit`、空闲 CPU                       |
| 候选发现 2 s/次       | 全队列排序                       | 积压 5 万+、冷窗口连续领取                                      | `mean_exec_time`、领取间隔                    |
| 内存预留过保守        | 768/1400 MiB vs 实测 500–800 MiB | 照片详情、RAW 并发                                              | 在途数、RSS、等待原因                         |
| 1 s 重排 + NOTIFY     | 远端 503/内存等待时              | 节点半饱和、健康抖动                                            | drain/秒、`wait_event=object`                 |
| NAS HDD + WAL fsync   | 数据/WAL/对象同盘                | 导入、备份、checkpoint 叠加                                     | `WALSync`、`iostat await`                     |
| 隐私全库重算          | 删标签/改规则                    | 大库 + 并发写                                                   | advisory 等待、rowVersion 更新量              |
| 同步长写              | 发送 100 张、清空回收站          | 15 s 网关超时                                                   | 504、事务时长                                 |
| 会话校验 2 SQL/请求   | 每张缩略图都付                   | 快速滚动、多图网格                                              | `User`/`RefreshToken` calls                   |
| 远端隔离策略          | 单次 5xx 即隔离（至下轮刷新）    | 大图/超时/客户端断开                                            | 节点 OFFLINE 次数                             |
| 备份                  | 全量、停写覆盖传输               | 842 MB 级备份窗口                                               | 备份时长、5xx                                 |
| 单实例                | API/worker/gateway 各一          | 发布、OOM、崩溃                                                 | 重启次数、502                                 |

---

## 8. 全部修复项（扁平清单，无先后依赖）

**加载与传输**

1. web 容器 + 网关开 gzip（含 `application/json`、`application/wasm`、`application/geo+json`）。
2. 登录页懒加载 `SekerEaglePage`，idle 预热主界面。
3. `PhotoMap`、`exifr`、`EagleBatchPhotoEdit` 改动态 import。
4. i18n 只加载当前语言（或把另一语言拆 chunk）。
5. 首屏 7 个独立请求（标签/标签组/智能文件夹/向量概览/计数/两个操作队列）与列表并行，不要等 `assetsQuery.isFetched`。
6. 删掉首屏不需要的轮询：库计数改变更时失效、operations 空闲 60 s、`auth/me` 改 visibility/focus 驱动。
7. `QueryClient` 加默认 `staleTime 60 s`、`refetchOnWindowFocus: false`、`retry` 上限。
8. 缩略图 `<img>` 加 `decoding="async"` 与 `fetchPriority`；overscan 从 `max(1200, vh*2)` 降到 `vh*0.75`。
9. 首屏空闲后预取 OSD，卡片 hover 预热预览；卡片 `memo` + 事件委托，滚动状态下移到网格组件。
10. 实体更新（processing 轮询）不要触发整页重排，按 id 增量更新卡片。

**API 与操作**

11. 会话校验加 5–10 s 进程内缓存（按 userId/sessionFamilyId/authVersion）。
12. 详情页关系查询合并：开 `relationJoins`，或拆 3 条并行查询，或把 AI 标签/色板改成懒加载。
13. 标签列表加 `take` + 游标；`assetCount` 物化，或只在 `includeCounts` 时计算。
14. 颜色 `colorCoverage` 只在首屏算或独立接口 + 60 s 缓存。
15. 语义搜索改 HNSW top-k；结构化筛选编译成子查询下推，删掉 `eligibleAssetIds` 全库 ID 数组。
16. 发送到另一库改入队 + 后台执行；事务内改 `createMany`。
17. 清空回收站分批（500–1000/批）或单条 `INSERT ... SELECT`。
18. 隐私重算按受影响素材收窄（传 `assetIds`），人物私密只传该人物的 face assetIds。
19. 任务中心未扫描人物改快照计数；overview 轮询降到 30 s。
20. 照片 Agent 列表 N+1 改一次 `groupBy`/批量 suggestions。
21. 摄影统计把日期/相机条件下推进 `scoped`，加 30–60 s 缓存。
22. 时间线让谓词匹配已有 `(ownerId, libraryMode, isPrivate, deletedAt, ...)` 索引，争取 index-only。
23. 媒体派生图给短 TTL（5 分钟，瓦片 1 天），保留 `Vary: Authorization` 与版本守卫。
24. 操作队列空闲退避 2–5 s；两 lane 锁键区分；进事务前先无锁 `EXISTS`。
25. 网关读密集型 location 放宽到 60–120 s，避免全库读被 15 s 掐断。

**后台处理**

26. 等待类重排改 5/10/30 s 指数退避，且等待类 PENDING 不广播。
27. 候选发现加 `priorityAt` + `(lane, status, priorityAt DESC, id)` 覆盖索引，或先取有界窗口再排序。
28. 内存等待按资源独立排队，不要全局 `return`；用 `rssAfterMiB/processMaxRssMiB` 的 p95 重标定 768/1400 MiB。
29. 远端并发改成 `Σ max(0, concurrency − inFlight)`；连续 N 次失败才隔离，客户端断开不隔离，runtime 刷新降到 3–5 s。
30. 地图改成 dirty 驱动，去掉 15 s 强制 `wakeNow`；`propagateFailedDependencies` 只在终态或 ≥60 s 执行。
31. 智能文件夹 5 s 轮询改通知驱动/空闲退避；心跳 15 s→30 s；coordinator 5 s→15 s。
32. 发布事务里的 500 行分组扫描移出事务或缩窗；人脸原型加缓存/上限，N+1 改批量 upsert；金字塔 tile 并发上传。
33. 观测：网关 `$request_time`、API `/metrics` + Prisma 慢查询、PG `pg_stat_statements`、worker 现有 elapsedMs/RSS 转指标。

**数据库与部署**

34. PG 显式调参（`shared_buffers`、`work_mem`、`effective_cache_size`、`max_wal_size`、`checkpoint_completion_target`、`log_min_duration_statement`），保留同步提交。
35. 给 `EaglePhotoMetadata(cameraModel/lensModel)`、`EagleAssetAnnotation(description)` 加 trigram 索引。
36. 智能文件夹分页物化 similarity + `(snapshotId, similarity, assetId)` 索引。
37. `DATABASE_URL` 显式 `connection_limit/pool_timeout`（API、worker 分开）。
38. 给容器加 `cpus`；PG 禁止 swap 或 `mem_swappiness: 0`（先核实宿主余量）。
39. 网关 upstream 加 `keepalive`；`/sekereagle-assets/` 关缓冲；SPA 回退加 `Cache-Control: no-cache`。
40. 运行镜像 `npm ci --omit=dev`；健康检查降频并加 `start_period`；API/gateway 加 `stop_grace_period`。
41. 核对 `20261028184500` 通知迁移是否已在生产账本；未应用则只迁移函数。
42. 复核生产私有 compose 的 PG/worker 资源与仓库默认值漂移。

验证口径：首屏 ≤450 KB、空闲 `xact_commit` 下降 ≥50%、候选发现 <100 ms、远端饱和时 drain/秒下降一个数量级。

---

## 9. 持续度量（建议固化为门禁）

- 前端：首屏 transferred、LCP、请求数、长任务；每次发布跑一次带缓存的冷/热对比。
- API：每路由 p50/p95、每请求 SQL 数、响应字节（压缩前后）。
- 数据库：`pg_stat_statements` TopN（total_exec_time）、`seq_scan` 增量、`xact_commit` 空闲基线、锁等待。
- 后台：队列深度（按 lane/kind）、领取成功率、等待重排率、drain 次数/分钟、单任务 `elapsedMs` 与峰值 RSS、每节点 in-flight 与 503 率。
- 部署：容器重启/OOM 计数、磁盘使用、备份时长与 RPO。

---

## 10. 边界与待核实

- 本机测量基于 144 项资源的固定测试库，不代表生产数据分布；延迟结论只用于固定开销与字节数。
- 生产现用 compose 链是私有 `maintenance/*/release-compose.json`，仓库内 `deploy/mac/docker-compose.yml` 与生产可能漂移（worker 6g vs 2 GiB、PG 2g vs 3 GiB）。第 6 节参数在改前必须 `docker inspect`/`SHOW` 核对。
- `20261028184500_media_claim_notify_contention` 是否已在生产账本生效，文档中存在“尚未应用”与“已经存在”两种表述，需查 `_prisma_migrations` 确认；未生效则 4.2 的放大更严重。
- 估算值（详情 12 条 SQL 的开销、未扫描人物 150–400 ms、统计 200–500 ms、10 万已加载时重排 0.5–1 s）需在隔离库或真实数据上按各节验证方式复测后再作为验收门槛。
