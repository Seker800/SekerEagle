# DeepSeek 独立审核

- 状态：report_received
- 提交范围：`d0ad3b6d941bfe2b1c1b6dbaefff8a6c134b3d40..9e6bf367af898dab863ae1c975614872f208af34`
- 完成时间（UTC）：2026-10-31T13:15:15.124809+00:00
- 本地审查记录：`/Users/seker/seker-workspace/SekerEagle/.git/deepseek-reviews/9e6bf367af89-wn89hgsz`

报告仅针对上述提交，是独立建议，不是推送门禁，也不代表当前工作区已通过审核。

# 独立审查报告：文档发布范围 `d0ad3b6d..9e6bf367`

## 1. 审查范围与方法

- 只读审查固定快照；本次范围仅改 `docs/architecture.md`、`docs/current-runtime.md`、新增 `docs/production-main-release-2026-10-31.md`，没有任何运行代码差异。
- 交叉核对了需求相关的实现记录：`deletion-ux-local-2026-10-31.md`、`send-publication-2026-10-31.md`、`search-query-2026-10-31.md`、`browse-background-efficiency-2026-10-31.md`、`photo-people-review.md`、`asset-operation-efficiency-2026-10-31.md`、`production-release-2026-10-31.md`。
- 为核对文档声明，静态阅读了迁移 69、70、71、`asset-operation-executor.ts`、`eagle-trash.ts`、人物确认排序与网页撤销调用链，未运行命令、未构建、未连接生产、未读取原工作区。
- 限制：快照没有 Git 历史、生产访问、NAS 维护目录或 CI 产物；因此本文只能判断文档内部一致性和代码可证实的部分，**不把运行声明当作已验证**。

## 2. 结论摘要

未发现本次文档改动本身引入代码回归的证据；architecture 中本日条目的“候选→已上线”状态，与对应代码、迁移 69–71 和上轮发布记录基本一致。

需要主代理关注的是**回退边界**和**验收表述**，不是新的运行时代码缺陷：

- 回退段落只禁止“仅降级网页”，没有禁止“只回退 API”；如果只回退 API，新版网页的撤销会缺路由。
- 回退后 migration 71 的“回收站任务收尾”语义没有说明和实测；旧 API 恢复时是否重排 `ASSET_TRASHED` 任务需要验证。
- “600 次媒体读取”比源证据说得更强，容易与“历史采样不算生产吞吐”的约定冲突。
- 人物排序摘要与 architecture 及代码的两级排序不一致，容易让后续维护者误读。
- 发布记录的部署顺序与用户要求的“迁移 → 兼容 Mac worker → operations/API/web”没有明确对应。

## 3. 问题清单

### 3.1 [中] 回退边界未禁止“只回退 API”，新版网页撤销会返回 404

**文件与行号**

- `docs/production-main-release-2026-10-31.md:34`
- `docs/current-runtime.md:5`

**触发条件与证据**

- 文档写的是“若回退 API／网页……不能仅降级网页”，但没有对称地禁止“只回退 API、保留新版网页”。
- 新版网页的撤销按钮调用 `POST /api/eagle/operations/:id/undo`：`apps/web/src/lib/asset-operations-api.ts:33-35`；`apps/web/src/components/eagle/useAssetOperationActions.ts:24-45` 在非 pending 的 404 上会直接抛错。
- 该路由和 `undoOfId` 关系是本次新增：`apps/api/src/eagle/eagle.controller.ts:161-169`；`apps/api/prisma/migrations/20261031120000_asset_operation_undo/migration.sql:1-10`。
- 上一版 API 为 `all-main-22ac5261c53d`，文档明确只有 68 项迁移（`docs/current-runtime.md:17`），本次才 68→71。因此上一版 API 不应被假定具备该撤销路由。

**实际影响**

回退时若只更换 API 镜像、保留新版网页，用户点击“撤销删除”会得到 404/失败；即时删除的补偿链路不可用。不会造成数据损坏，但会直接破坏本次发布的关键交互，且用户可能误以为删除不可撤销。

**修复方向**

在回退段明确写成：**API 与网页必须作为同一源码代成对回退；若必须单独回退 API，只能回退到包含 `undoOfId` 与 `/operations/:id/undo` 的兼容版本**。回退后至少验证 `GET operations` 返回 `undoOf`、`POST undo` 不 404。

**待验证**

上述结论基于静态代码和“上一版 68 项迁移”的文档记录；应以实际回退镜像核对旧 API 的真实路由。

---

### 3.2 [中／待验证] 回退后 migration 71 的 trash→restore 任务语义没有覆盖

**文件与行号**

- `docs/production-main-release-2026-10-31.md:34`
- `apps/api/prisma/migrations/20261031140000_trash_media_jobs/migration.sql:5-28`
- `apps/api/src/eagle/eagle-trash.ts:41-56`
- `docs/browse-background-efficiency-2026-10-31.md:14,26`

**触发条件与证据**

- migration 71 的触发器会把删除转移时 `PENDING`／`PROCESSING` 的非 `PURGE_ASSET` 任务改成 `COMPLETED + ASSET_TRASHED`，并递增 `leaseVersion`。
- 当前唯一的重排逻辑在 `setEagleTrash(..., restore=true)`：只把 `status='COMPLETED'`、`lastError='ASSET_TRASHED'`、当前 `assetRevision` 的任务改回 `PENDING`。
- 如果按文档回退到 pre-71 API+网页，数据库触发器仍是新的，而旧 API 的恢复路径是否包含同样的重排逻辑没有证据；文档只要求保留新 worker/operations，没有说明 API 恢复路径的兼容性。

**实际影响**

回退后恢复一个“删除时还有未完成媒体任务”的资源，可能出现两种结果：

- 旧 API 不重排：资源恢复了，但预览／向量等派生任务永远停在 `COMPLETED + ASSET_TRASHED`，表现为静默缺派生结果；
- 旧 API 重排全部完成项：会重复处理本来成功的工作，造成额外计算。

前者是结果正确性问题，后者是成本问题；目前无法从快照判定是哪一种。

**修复方向**

- 用实际回退 API 镜像做一次最小回归：删除一个存在 `PENDING` 媒体任务的资源 → 回退 API → 恢复 → 检查任务是否重新进入 `PENDING`。
- 若旧 API 不会重排，应在回退段明确“旧 API 恢复不能复用”，保留具备新恢复逻辑的 API，或回退前把该路径纳入兼容补丁。
- 若旧 API 会重排全部完成项，则应在文档中注明这是回退后的额外计算，而不是功能损坏。

**待验证**

`docs/browse-background-efficiency-2026-10-31.md:26` 说“恢复继续使用共用 `mediaRequeueData`”，这暗示旧恢复路径可能已经会重排；但无法确认它是否按 `ASSET_TRASHED` 精确筛选。此结论需用回退镜像实测，不能仅凭静态阅读下结论。

---

### 3.3 [低] “600 次媒体读取”与源证据的说法不一致

**文件与行号**

- `docs/production-main-release-2026-10-31.md:26`
- `docs/browse-background-efficiency-2026-10-31.md:59`

**触发条件与证据**

- 发布记录写的是“12 次登录、800 次认证读取与 600 次媒体读取无 429”。
- 但源记录写的是“600 次媒体路由访问（**不存在资源应返回 404，非真实媒体吞吐测试**）”。
- 两者的“无 429”结论本身一致，但发布记录把“不存在资源的媒体路由访问”写成了“媒体读取”，删掉了关键限定。

**实际影响**

读者可能把 600 次访问当成真实媒体读取／吞吐验收，与用户要求的“不要把历史性能采样当实时生产吞吐保证”相冲突；也会让后续审计误判验收覆盖范围。

**修复方向**

改成与源记录一致的表述，例如：“600 次媒体路由访问（不存在资源预期 404，非真实媒体吞吐）无 429”；保留“无 429”的限流结论即可。

---

### 3.4 [低] 人物排序摘要与 architecture／代码的两级顺序不一致

**文件与行号**

- `docs/production-main-release-2026-10-31.md:16`
- `docs/architecture.md:25`
- `apps/api/src/photos/photo-person-review.ts:80-81,94,96`
- `apps/api/src/photos/photo-person-review-evidence.ts:75-86`

**触发条件与证据**

- 发布记录写的是“最终使用**相似度、可信度和照片数量**排序及自动分轮遍历”。
- architecture 写的是“按照片数量、检测可信度和人脸相似度安排人工确认顺序……每轮内部按证据、可信度和照片量排序”。
- 代码实际是两级：
  - 锚点先按 `photos DESC, confidence DESC, id` 分轮（`photo-person-review.ts:80-81`）；
  - 每个锚点的后续近邻按 `distance ASC, photos DESC, confidence DESC` 取候选（`:94`）；
  - 批内再用 `0.8*similarity + 0.1*confidence + 0.1*volume` 排序（`photo-person-review-evidence.ts:75-86`）。
- 发布记录只写了批内的相似度权重顺序，没有写“先按照片量／置信度分轮选锚点”，容易被读成全局相似度优先。

**实际影响**

不会改变当前运行结果；但后续维护者若以发布记录为唯一依据，可能误以为应按固定相似度全局排序，或重新引入阈值截断，和用户“排序而非硬截断”的要求产生偏差。

**修复方向**

把发布记录改成两级表述，例如：“先按照片量与检测置信度分轮选择锚点；每轮内按人脸相似度、可信度和两组照片量排序，自动遍历后续近邻，不按阈值丢弃可比较人物。”这样与 architecture 和代码一致。

---

### 3.5 [低] 发布记录没有明确写出“迁移 → 兼容 Mac worker → operations/API/web”的实际顺序

**文件与行号**

- `docs/production-main-release-2026-10-31.md:8-10`
- `docs/architecture.md:31`
- `docs/asset-operation-efficiency-2026-10-31.md:67`
- `docs/current-runtime.md:19`

**触发条件与证据**

- 发布记录的“实际发布”按 API/operations/网页 → Mac worker → 数据库迁移 68→71 排列；这是事实清单，但没有说明执行顺序。
- 用户要求的是“迁移先于兼容 Mac 业务 worker，然后独立 operations/API/web”。
- architecture 只写“新 worker 完整排空旧进程后先行部署，才能启用接管 API”；asset-operation 记录写的是“先备份并部署迁移，再更新 worker，最后更新 API、operations 和网页”；上一轮 current-runtime 也写过“先迁移、交接兼容 worker，再启用 operations/API/网页”。

**实际影响**

若后续维护者把“实际发布”的条目顺序当成部署顺序，可能先切 API/网页再切 worker，违反发送接管与撤销协议的兼容前置条件。文档本身不是运行手册，但这是安全关键顺序，值得在发布记录中留一行明确顺序。

**修复方向**

在“实际发布”开头补一句即可：“执行顺序为迁移 68→71 → Mac 旧进程排空并切换不可变 worker → operations/API/web；NAS 媒体 worker 全程停止。”不必重写全部条目。

---

## 4. 已核查且未发现问题的点

- **迁移数量与分类**：`apps/api/prisma/migrations` 下确有 71 个迁移目录；第 69／70／71 项分别为撤销关系、发送轮转、回收站媒体任务收尾，与发布记录“68→71”一致。
- **独立 operations，不在 API 起业务定时器**：`startExecutor()` 只在 `apps/api/src/asset-operation-executor.ts:71` 调用；HTTP 装配不启动该轮询，符合 `docs/library-sharing-gate.md:248` 和发布记录“没有新增 API 后台定时执行器”的说法。
- **主搜索精确 vs 样例预览 ANN**：`apps/api/src/eagle/eagle-search-preview.ts:12,26` 明确只有样例预览使用 `hnsw.*`；主搜索仍走精确路径，与文档一致。
- **人物确认不以置信度／相似度硬阈值丢弃可比较项**：`photo-person-review.ts:54` 注释和查询没有 confidence/similarity cutoff；`qualifyPersonReviewPairs` 只校验合法向量与证据，不做阈值过滤，方向与用户要求一致。
- **首页隐私开关**：`apps/web/src/components/eagle/SekerEaglePage.test.tsx:1811-1849` 对两种模式 × 隐私开／关断言首页没有隐私按钮／开关；architecture `:45` 也明确只在账号页授权。代码层没有发现回归。
- **文档链接与状态翻转**：三份文档互相引用路径存在；本日各条“已上线”与对应代码／迁移的存在性一致，未发现“文档说上线、代码没有”的情况。

## 5. 待验证与记录缺口

以下不是已证实缺陷，但在本次快照内无法验证，主代理不应把它们当作已通过：

- **数量与引用**：40 个本地／远端业务引用、17 个工作区提交、17 个 Dependabot 提案、40/17 的计数口径。快照没有 Git 历史、refs 或 PR 数据。
- **生产状态**：`integrated-d0ad3b6d941b` 镜像摘要、API/operations/web healthy 与零重启、Mac worker PID 81038 与心跳、用户暂停／时段、计算修订 66、三节点 READY、NAS 媒体 worker 停止状态。
- **切换证据**：`maintenance/main-release-20261031/images.json` 的实际追加、旧镜像覆盖、Compose 登记、网关配置、867670548 字节备份的 SHA 与完整解析。
- **验收数字**：整仓 CI、71 项迁移的实际应用、隔离历史升级／完整恢复、API 成品镜像、真实 S3 的 8 项／32 对象、生产 Chrome 的 14 条导航与删除／撤销／发送、12/800/600 高频访问、入口 gzip 539454→168472、APK 哈希与 Range。
- **DeepSeek 代码 push 审查**：发布记录称已启动旧 main→运行源码的审查；当前 `docs/deepseek-reviews/` 只看到更早范围的报告，没有 `d0ad3b6` 的报告。文档只写“已启动”，没有声称通过，因此不构成“冒充通过”，但启动事实本身无法从快照确认。
- **其他记录缺口**：发布记录未像上一轮那样明确写“未触碰 SekerChat”；也未把“首页无隐私开关”列入本次生产 Chrome 验收清单。代码单测和 architecture 都能支持这两项，但没有证据表明本次合并后重新做了生产复验。建议各补一行，不需要扩大审查范围。

## 6. 总结

本次只改文档，没有代码差异；architecture 的本日状态翻转和独立 operations、精确搜索、人物排序等声明，大体能和代码及迁移对上。真正需要补的是**回退边界**：API 和网页必须成对回退，且回退前要用旧 API 实测回收站恢复，否则要么撤销 404，要么静默丢失恢复后的派生任务；另外把“600 次媒体读取”和人物两级排序的表述写准即可。

一句话：文档方向没问题，别把“只回退 API”当成安全操作，回退前先实测旧 API 的撤销和回收站恢复，再把验收措辞收紧；生产上的镜像、PID、备份和测试数字在这个快照里都核不了，不能当已验收。
