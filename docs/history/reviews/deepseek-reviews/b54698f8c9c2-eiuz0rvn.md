# DeepSeek 独立审核

- 状态：report_received
- 提交范围：`ee749555fcd8f22e2536d036c7c5adc437aa0958..b54698f8c9c2d768a7e50c7ea7b5ecee3073c940`
- 完成时间（UTC）：2026-11-02T14:13:30.658686+00:00
- 本地审查记录：`/Users/seker/seker-workspace/SekerEagle/.git/deepseek-reviews/b54698f8c9c2-eiuz0rvn`

报告仅针对上述提交，是独立建议，不是推送门禁，也不代表当前工作区已通过审核。

下面是我对这组固定提交（`ee749555…b54698f8`）的独立只读审查结果。我自行读取了快照中的命令队列、迁移、读缓存、桌面缓存、搜索/筛选与相关测试；没有运行任何命令、测试、`EXPLAIN` 或部署。历史 review 原文我按约定只当作归档，没有采信其中结论。

# 代码审查报告（独立建议，非推送门禁）

## 结论

命令化改造的主链路（受理不拿业务锁、独立执行器、租约/取消/终态、PHOTO 注册器与共享编排分离）方向正确，未发现阻断级的数据丢失、越权或跨 owner 泄露问题。但有 **3 个值得在推送前处理的实际问题**（桌面缓存被整账号清空、批量成片请求体上限未生效、照片组扫描在大库上会撞默认事务超时），另有 2 个低风险/待确认项。

---

## 问题 1（中高｜桌面缓存回归，可证实）

**位置**
- `apps/web/src/components/eagle/asset-operation-refresh.ts:200-213`（`if (privacyChanged) await getDesktopCacheBridge()?.clearCache()`）
- `apps/web/src/components/eagle/asset-operation-refresh.ts:332-402`（`refreshLoadedFacts` 对**全部已加载 id** 反复 `invalidateDesktopAssets(batch)`）
- `apps/web/src/lib/desktop-cache.ts:1-7`、`apps/desktop/src/main/main.ts:437-442`、`apps/desktop/src/utility/cache/cache-engine.ts:279-288`

**触发条件与证据**
- `PRIVACY_COMMAND_TYPES` 包含 `ASSET_TAGS`（`asset-operation-refresh.ts:26-39`），而收藏/加标签走的正是 `ASSET_TAGS`（`EagleFavoriteButton.tsx:37`）。任何 PHOTO/MATERIAL 的标签命令终态都会命中 `:212` 的 `clearCache()`。
- `clearCache` → `desktop:clear-cache` → `removeAccountCache(..., namespaces)` → `clearNamespace` 对 MATERIAL+PHOTO **两个命名空间整库删除**（`cache-engine.ts:286-288`）。这不是“撤回受影响资源”，而是清空账号磁盘缓存。
- 同一终态还会让 `refreshLoadedFacts` 取回**所有已加载页**（含 12 页×N 张）的事实，然后在 `:401` 对每 100 个 id 调一次 `invalidateDesktopAssets`，即每张已加载资源都执行 `desktop:invalidate-asset` → `invalidateAsset` 删除该资源的缩略图/预览图文件（`cache-engine.ts:279-284`）。对一次“改 1 张照片的评分”也会发生（`ASSET_UPDATE` 也会走 `refreshLoadedFacts`）。
- 这与本轮自己的成本口径矛盾：`docs/background-admission-2026-11-02.md` 写“终态资源事实为 `ceil(受**影响**且已加载资源数/100)` 次 HTTP”，`docs/client-cache-list-reuse-2026-11-02.md` 写“写操作 新增 1 次失效 IPC”。实现实际是“全部已加载”逐张失效 + 可能的整账号清空。
- 额外副作用：`LibraryMediaSnapshot.invalidateAsset` 会 `generation++`（`library-media-snapshot.ts:41-45`），而 `read()` 在 generation 变化时直接抛错（`:71-72`、`:85`）。用户在同一次命令完成期间滚动/筛选触发的列表读取可能被中止并以 IPC 错误冒到页面（随后重试，但会出现一次失败/重载）。

**实际影响**
加一次标签/收藏/评分，就会删掉当前已加载窗口的磁盘派生图；标签类命令还会清空整个账号（两个模式）的 10GiB 级缓存，随后浏览需要重新下载图片正文，而不是 0.1.9 设计的 `LOCAL` 复用。直接削弱了本轮“列表驱动磁盘复用”的收益，属于功能级性能回归。

**修复方向**
只对“实际发生变化的 receipt 资源”做失效（receipt 已含 assetId；事实回读后比较 `mediaRevision/isPrivate/updatedAt` 再决定是否失效），并删除 `clearCache()` 的整账号清空；若必须处理“隐私标签影响未加载资源”的窗口，应让命令回执/摘要返回 `privacyChanged`（旧同步路径就有 `privacyChangedAssetCount`），或只清受影响模式相关的证据，而不是每次标签写都全清。另建议把 `LibraryMediaSnapshot.invalidateAsset` 的 generation 栅栏改为“只栅栏该 asset 的投影”，避免并发列表读取被整批中止。

---

## 问题 2（中｜批量成片请求体上限未生效，可证实于代码路径）

**位置**
- `apps/api/src/eagle/eagle-edit-request-body.ts:8-13`（判断用 `req.path`）
- 相关 DTO：`apps/api/src/eagle/eagle-batch-edit.ts:57-62`（`lut` `@MaxLength(4500000)`，`preservedLuts` 逐表最大约 4.39MB）

**触发条件与证据**
- 单张编辑与批量成片共用一个 `app.use(/^\/api\/(eagle|photos)\/assets\/(?:uuid|batch)\/edit-renders$/, ...)`。Express 的 `app.use(path, fn)` 会把已匹配的前缀从 `req.url` 中裁掉（挂载路径保留在 `req.baseUrl`），所以处理器里的 `req.path` 是 `/`，`:11` 的 `/\/assets\/batch\/edit-renders\/?$/` 永远不匹配。
- 结果是批量成片**始终用 `parse`（5mb）**，`parseBatch`（`EAGLE_OPERATION_BODY_LIMIT`，默认 32mb）成为死代码。最大 65³ LUT 的 base64 约 4.39MB，再叠加一个 `preservedLuts` 或普通 JSON 字段就超过 5mb；文档却声明批量成片复用 32MB 边界。
- 现有测试只覆盖 `assets/batch/edit-render-context`（走 operation parser，`eagle-operation-request-body.test.ts` 新增用例），没有一条 >5MB 的 `/assets/batch/edit-renders` 用例；单测 `eagle-batch-edit.test.ts` 也不经过 HTTP 解析器，因此该回归不会被 CI 发现。

**实际影响**
合法的大 LUT 批量套用（尤其多张目标各自保留不同 LUT 的 `preservedLuts`）会在 admission 前被 body-parser 以 413 拒绝（或让客户端收到非 JSON 的解析错误），与 DTO 允许的 4.5MB LUT 设计和文档的 32MB 说法不一致。

**修复方向**
用 `req.originalUrl`（或在挂载时分别为单张/批量注册两个中间件）决定解析器，并补一条 >5MB 的批量请求测试。说明：我没有运行 API（快照无 `node_modules`），但这是 Express `use` 的既有语义，建议在实际启动的 API 上补测确认。

---

## 问题 3（中/低中｜照片组全库扫描会撞默认事务超时；大库上重试同样失败）

**位置**
- `apps/api/src/photos/photo-management.service.ts:542-598`（`rows` 已无 `take: 2000`；`:553` `this.prisma.$transaction(async tx => ...)` 未传 `timeout`；`:562-595` 每个 suggestion 一次 `findUnique` + `create` + `createMany`）
- 调用入口：`apps/api/src/photos/photo-management.controller.ts:254-255` → `PHOTO_GROUPS_SCAN`；执行：`apps/api/src/photos/photo-library-commands.ts:96-98`

**触发条件与证据**
- 移除 2000 行上限后，`rows` 是全库 `EaglePhotoMetadata`；每个建议组在**同一个交互事务**里做 2–3 次数据库往返，事务没有显式 `timeout`，Prisma 7 交互事务默认 5s。
- 一个 6 万张、按连拍/相似聚类的图库可能有数千到上万个建议组（即便重复扫描时只做存在的 `findUnique`，也是每组一次往返）。超过约 5s 即抛 `P2028`；`publishMetadataBatch`/`failItems` 会把它映射为 `TRANSACTION_TIMEOUT`，整笔事务回滚，用户重试仍会再次超时。
- 同一仓库的同类全库扫描已有显式长超时先例：`packages/library-persistence/src/photo-face-scan.ts:54`（`{ maxWait: 5000, timeout: 630000 }`）。本轮的测试（`photo-batch-selection.test.ts` 1201 张、`photo-command-admission.test.ts` 全 mock）没有覆盖大库照片组扫描。
- 另：`suggestPhotoGroups` 在内存中对全库排序，内层窗口是 10 分钟；同一时刻窗口内的极端分布会退化，移除 2000 上限后不再有上界（此点为待验证的极端分布风险）。
- 可及性说明：在本快照的 `apps/web/src` 中没有找到 `scanPhotoGroups` 的调用点（只有 API 定义与命令标题），因此影响主要限于直接调用 API/自动化的场景；但它仍是本次主动移除上限的代码路径。

**实际影响**
大图库上 `PHOTO_GROUPS_SCAN` 会稳定失败并回滚（无数据损坏），重复重试无意义；失败信息只显示为事务超时。

**修复方向**
给该事务显式 `timeout`（与 face scan 一致），并把“已存在检查 + 插入”改成集合式写入（利用 `sourceKey` 唯一约束 `createMany(skipDuplicates)`，避免每组 N+1），或把照片组扫描拆成可续做的操作子项；同时补一条较大建议组数量的真实数据库回归。

---

## 问题 4（低｜私密授权与“公开资源命令”不必要耦合，待产品确认）

**位置**
- `apps/api/src/eagle/eagle-asset-operations.service.ts:538-542`（`const isPrivate = principal.canViewPrivate`）
- `apps/api/src/eagle/eagle-duplicates.service.ts:423-431`（清理同样传 `principal.canViewPrivate`）

**触发条件与证据**
`isPrivate` 只取决于“当前是否持有私密可见授权”，不取决于本次操作是否真的涉及私密资源；而 `deleteMany(TRASH/SEND/RESTORE)` 的既有 `enqueue` 是**仅在选中行含私密时才标记**（`eagle-asset-operations.service.ts:902-921`）。因此：私密视图开着时对**公开照片**排队一个标签/评分/清理，操作会带 `isPrivate=true` 和 `privateUntil=授权过期时间`。

**实际影响**
- 授权到期后执行 → `assertPrivateGrant` 抛 `PRIVATE_LOCKED`，本来只涉及公开资源的任务失败；
- 用户在任务中心关闭“显示私密内容”后，该操作在 `list(includePrivate=false)` 中被隐藏，`retry` 也会 404，无法查看失败原因或重试。
这不是数据/权限越界，但把一个“公开资源任务”变成了依赖临时授权可见性的任务。

**修复方向**
在 `enqueueCommand` 的资源存在性查询中同时取 `isPrivate`，仅当选中资源含私密（或 domain `admit` 返回涉及私密对象）时标记 `isPrivate`；否则按普通操作处理。若这是刻意的保守策略，建议在文档中写明“持有私密视图时受理的所有命令都视为私密操作”的副作用。

---

## 问题 5（低｜仓库内 Android 客户端的读后写竞态）

**位置**
- `apps/api/src/eagle/eagle.controller.ts:830-844`（`batch/manual-tags` 202）、`:650-672`（batch trash/restore 202）
- `apps/android/app/src/main/kotlin/com/sekereagle/android/NativeGalleryRepository.kt:299-312`
- `apps/android/app/src/main/kotlin/com/sekereagle/android/NativeGalleryViewModel.kt:1039-1047`（收藏：`setFavorite` 后立即 `detail` 并覆盖列表项）、`:1135-1149`（批量改后立即 `refresh()` 并提示“已完成”）

**触发条件与证据**
Android 客户端仍按“写完成即已提交”的假设工作：它忽略 202 回执，随后立刻读取详情/列表。命令真正执行在独立 operations 进程，读取很可能发生在提交之前，于是收藏图标/标签/回收状态会回退到旧值，而界面已提示完成。

**实际影响**
仅影响仓库内 Android 客户端（不在本轮网页/桌面验收范围，Android 测试也不在 `ci:check` 内）。不影响数据正确性，属于兼容性/体验回归；与“21 个工作区全部核对”的发布叙述值得一起说明。

**修复方向**
要么让 Android 适配 202（轮询 operations 或读取回执后等待终态），要么对这批旧端点保留同步兼容（例如内部等待完成再返回），并在发布说明中明确该客户端需要同步更新。

---

## 已检查且未发现明确问题的部分

- **受理不拿业务锁**：`enqueueCommand` 只做非锁定作用域读取、advisory 幂等锁、持久化 + `pg_notify`；`prepare`（仅 `ASSET_UPDATE`）不获取隐私锁；执行期 `assertActor` 才复核主体/私密/租约，顺序为 operation → 隐私 advisory → item，取消与展开同序，未发现取消后复活子任务的路径。
- **取消/租约/终态**：`OperationCancelledError→CANCELLED`、SEND 保留已领取复制、`retry` 只重置 FAILED 并清停止意图、`splitLibraryCommand` 在业务事务回滚后按资源隔离，与新增单测/真实库测试方向一致。
- **迁移**：新列默认值、三个语义表各自的 INSERT/UPDATE/DELETE 语句级触发器、`COPY`/旧版本混合部署下 `sources=[]` 会走完整重读而非静默丢更新；`RETURNING revision,enabled` 与行锁保证提交序。
- **搜索**：日期排序两条 SQL 的 `WHERE/ORDER BY/LIMIT` 与 `(date,id)` 游标一致；`colorCandidateWhere` 删除空 `OR` 分支、清理空 `AND` 分支在布尔语义上是等价/超集，不会收窄候选。
- **日期筛选**：纯日期 `BETWEEN` 含完整结束日、反向区间与显式时间戳端点正确；`CAPTURED_AT` 仅 PHOTO 且读取既有 `capturedAt`。
- **桌面媒体隔离**：模式化 namespace/cache identity、v1 仅代表 MATERIAL、CORS 只允许当前连接 origin、CSP 未放宽 eval/远端脚本、白名单只读路径（拒绝原图/穿越/任意 URL）、证据按 deployment/owner/mode/asset/rendition/字节/内容类型匹配，未发现跨模式或跨账号复用。
- **LUT 共享**：`commandPayload` 每操作一份、worker 只投影所选表并校验 owner/mode/recipe/parts，`preservedLuts` 缺失时失败关闭而不是替换默认滤镜。
- **契约**：202 与 `openapi.json`/生成类型一致；请求体解析器覆盖了本轮新增的批量入口（除问题 2 的那一处）。

## 检查范围与限制

- 只读审查了给定固定范围的入口源码、迁移、测试与相关文档；未运行 lint/typecheck/单测/真实 Electron/数据库或 `EXPLAIN`，未访问生产 NAS、备份或 Windows 原机；因此“生产已验收/备份 SHA/Windows 原生拖放”等只能当作者声明，我不对其作确认。
- 快照无 `node_modules`，问题 2 的 Express 挂载语义无法在本机运行复核，结论基于 `app.use(path,fn)` 的既有行为，建议用一条 >5MB 的批量请求在实际启动的 API 上确认。
- 未发现网页端 `scanPhotoGroups`/`createPhotoGroup` 的调用点，故问题 3 的现网影响取决于是否有 API/自动化客户端使用该端点。
- Android 不在本轮“网页+桌面”默认验收范围，问题 5 仅作为仓库内客户端回归提示。

**大白话**：方向是对的，命令队列和权限/取消逻辑没查出硬伤；但“每次标签/评分就把桌面缓存整窗口逐张删掉、标签命令还整账号清空”和“批量成片 >5MB 其实仍被 5MB 拦下”是两处值得马上修的实际回归，照片组扫描在大库上也会因默认 5 秒事务超时反复失败；另两点（私密授权耦合、Android 读后写）建议确认后处理，不阻塞推送判断。
