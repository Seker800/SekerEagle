# DeepSeek 独立审核

- 状态：report_received
- 提交范围：`c83842b15c979cbaecc81a17a5c064ca84be59b3..b0423ca614f334c95e48c65dd8d052acbdce6f55`
- 完成时间（UTC）：2026-11-02T01:24:33.473523+00:00
- 本地审查记录：`/Users/seker/seker-workspace/SekerEagle/.git/deepseek-reviews/b0423ca614f3-yiczm2dg`

报告仅针对上述提交，是独立建议，不是推送门禁，也不代表当前工作区已通过审核。

# 独立代码审查报告（固定快照 `c83842b1..b0423ca6`）

## 一、审查范围与限制

- 只读审查给定快照中的业务改动、测试、迁移、部署配置与相关知识文档；未运行命令、未执行测试、未启动镜像、未连接生产或真实图库。
- 重点核对了：条件查重（`sameVisual`、元数据分组、子组/签名/清理）、独立 `library-reader`（内存索引、协议、语义与统计扩展）、Prisma 7 适配层、Nest 12/TS 7 工具链、MLX/CUDA 依赖及查重前端。
- 无法从快照验证：真实 6 万项数据库回归、最终镜像启动/迁移/读取、生产 Chrome/Electron、MLX 新旧向量一致性、CUDA 资格；这些按调用者声明处理。调用者已说明完整 runner 末尾因未传入现用 `ffprobe` 路径退出，故该轮“同一计算验收”不应记作代码已验证通过。
- 以下是建议，不是推送门禁。

---

## 二、发现的问题

### 1. 【中】条件查重（SIMILAR）清理仍按“完全重复”执行标签/评分合并，UI 未披露，属于实际数据改动

**文件与行号**

- `apps/api/src/eagle/eagle-duplicates.service.ts:556-566`：`items` 的每个清理项都写死 `exact: true`。
- 同文件 `:651-690`：`if (snapshot.exact)` 内会把被清理项的独有手工标签复制到保留项、把保留项评分提升为组内最高值，并 `rowVersion+1`、`syncAssetPrivacy`。
- `apps/api/src/eagle/eagle-duplicate-cleanup.ts:19`、`:101-122`：批量清理路径同样以 `snapshot.exact` 为前提执行评分合并。
- `packages/library-core/src/duplicates.ts:251-259`：新的 `findVisualDuplicateGroups` 已明确把“缩放、压缩、跨格式、编辑版本、疑似连拍”等非同一内容放入 SIMILAR。
- `apps/web/src/components/eagle/EagleDuplicates.tsx:459-469`：确认框只在 `kind === 'EXACT'` 时说明“独有标签和最高评分会合并”；SIMILAR 只提示“不保证内容完全一致”。

**触发条件**

- 在“按条件查找”中清理任意 SIMILAR 组（包括 `sameVisual` 触发的画面组，以及 `sameVisual=false` 时仅按名称/时间/尺寸/格式/大小形成的元数据组），再确认清理。

**实际影响**

- 两张只是“画面相近”或“同名同尺寸”的不同照片，其手工标签会被复制到保留项，保留项评分会被改成组内最高分，`rowVersion` 也会变化。
- UI 对 SIMILAR 没有说明这一行为，与“完全重复项的独有标签和最高评分会合并到保留项”的产品文案不一致，也与用户“不搞多余操作”的要求相悖；可能把不属于保留照片的标签/评分带过去。

**修复方向**

- `items` 中的 `exact` 改为 `plan.group.kind === 'EXACT'`（或为条件清理单独设置“不合并”的路径）；这样 `executeCleanupItem` 与 `applyOrdinaryDuplicateCleanupBatch` 都会跳过合并。
- 若产品确实希望对某些条件组也合并，必须在确认框中按 `kind` 明确说明并单独验收，而不是复用完全重复的语义。

---

### 2. 【中】已加载多页时，“刷新结果”和扫描完成后的自动刷新仍会用旧 revision 请求第 2 页，形成 409 死循环

**文件与行号**

- `apps/web/src/components/eagle/EagleDuplicates.tsx:110-116`：`getNextPageParam` 把 `revision` 固化进下一页的 `pageParam`。
- 同文件 `:187-195`：扫描进入终态后 `invalidateQueries` 会让无限查询按既有 `pageParams` 重新逐页请求。
- 同文件 `:347-352`：新“刷新结果”按钮直接 `results.refetch()`，没有重置分页参数。
- `apps/api/src/eagle/eagle-duplicates.service.ts:70-71`：只要请求带 `revision` 且与当前计算结果不一致就抛 409。

**触发条件**

1. 已加载查重结果至少 2 页；
2. 期间结果发生变化（重新扫描、素材改名、媒体版本变化、忽略状态变化等都会改变 revision）；
3. 点击“刷新结果”，或扫描完成/清理完成触发自动失效重取。

**证据与影响**

- React Query v5 对已加载的 infinite query 会按已有 `pageParams` 逐页重放；第 1 页成功并返回新 revision，但第 2 页仍携带旧 revision，服务端直接 409，整个查询进入错误态。错误区的“重试”继续调用同一个 `refresh()`，`pageParams` 不变，无法自愈；用户只能关闭重开或等缓存过期，而关闭重开在 `staleTime` 内仍可能复用旧页参数。
- 现有新增测试只覆盖单页刷新；没有“2 页 + revision 变化 + 刷新/自动失效”的回归。此前独立审查已报告过同类问题，本快照中前端分页参数与服务端逐页强校验仍然存在。
- 这直接削弱了“查重结果可刷新”的体验，尤其 6 万项库通常不止一页。

**修复方向**

- 刷新/自动失效时对该 infinite query 执行 `resetQueries`（或只拉第 1 页后用 `setQueryData` 重置 pages），不要对多页结果直接 `refetch()`。
- 或者服务端只在第一页/显式确认时强校验 revision，续页只依赖 cursor 与逐组成员校验。
- 补一条真实多页回归：加载 2 页 → revision 变化 → 刷新/扫描终态失效，断言最终数据为新结果且不进入 409。

---

### 3. 【中】独立 `color-search` 验证脚本的 Prisma 适配器没有使用它自己创建的隔离数据库，可能在错误库上跑并留下 6 万条数据

**文件与行号**

- `scripts/testing/color-search.mjs:52-62`：在随机端口创建临时 PostgreSQL，并把隔离 URL 放在局部 `env.DATABASE_URL`，安全目标检查也校验这条 URL。
- 同文件 `:77-94`：迁移命令使用 `env`（临时库）；但 `new PrismaClient({ adapter: observePrismaAdapter(...) })` 没有把 `env.DATABASE_URL` 传给适配器，仍使用 `datasourceUrl: env.DATABASE_URL`。
- `scripts/testing/database-query-probe.mjs:5-6`：`observePrismaAdapter(observe, connectionString)` 未传 `connectionString` 时会调用 `createPrismaAdapter()`，由 `packages/library-persistence/src/database-adapter.ts:4-6` 回落到 `process.env.DATABASE_URL`。
- `scripts/testing/color-search.mjs:364-374`、`:396-401`：写入 6 万条固定 ID 的 `EagleAsset` / `EagleAssetColorAnalysis` / `EagleAssetColorSwatch`；脚本的 `finally` 只断开连接和停止临时容器，没有删除这些行。

**触发条件**

- 运行 `npm run test:color-search`，且 shell/CI 的 `process.env.DATABASE_URL` 指向 `sekereagle` 或别的 `sekereagle_test`。

**实际影响**

- 适配器实际连接的库与脚本创建、迁移、做安全校验的临时库不是同一个：测试可能在空库/旧库上直接失败，也可能在开发库上写入 6 万条测试素材并永久残留；`S3Requests`、分页、6 万项规模等结论不再对应脚本所称的隔离夹具。
- 这里不是生产运行路径，但属于本推送引入的测试可信度与数据安全问题；现有 `ci:check` 不包含该脚本，因此不会被默认门禁发现。

**修复方向**

- 改为 `adapter: observePrismaAdapter(fn, env.DATABASE_URL)`，并去掉或校验 `datasourceUrl`；确保 `assertSafeRuntimeTarget` 校验的就是适配器实际使用的连接串。
- 在该脚本的 `finally` 中清理本 owner 的测试素材，或确认它只允许 `_test` 数据库。

---

### 4. 【低】画面组内“每个新指纹与所有代表指纹逐一比较”在大量不同指纹的近似组上可能退化为 O(k²)

**文件与行号**

- `packages/library-core/src/duplicates.ts:195`、`:217-231`：`representatives` 保存组内所有已接受的不同指纹，新候选要与每个代表做 `duplicateHashDistance` + 48 维颜色 RMS 比较。
- `packages/library-core/src/visual-duplicate-review.test.ts:59-62`：6 万项测试只使用完全相同 fingerprint，代表数始终为 1，没有覆盖“6 万条各不相同但两两相近”的最坏情况。

**触发条件**

- 一个画面组内存在大量不同的 precursor/压缩/截帧指纹，且它们两两都满足阈值。旧的 reference-star 分组只与锚点比较；新逻辑为保证“条件筛掉锚点后仍两两有效”增加了代表集合，复杂度由 O(n) 变为 O(k²)。

**实际影响**

- 对于较大的连拍/导出变体组，单次扫描可能耗时明显增加；当前没有基准或超时边界证明最坏情况可接受。6 万项测试的“60k 同指纹”不构成此场景的证据。

**修复方向**

- 至少补一条“数百/数千个不同但相近 fingerprint”的基准或上限验证；若实际会出现大组，考虑用代表指纹的量化/分桶或限制比较集合，而不是无条件对全部代表逐对比较。

（严重程度取决于真实库中不同指纹的大组规模，本次只读无法判定，标为待验证。）

---

### 5. 【低】`kind=EXACT` 直接返回未过滤状态，切换分类后隐藏面板中残留的 `maxBytes` / `protectEdits` 会被静默忽略

**文件与行号**

- `apps/api/src/eagle/eagle-duplicate-filters.ts:67`：`if (input.kind === 'EXACT') return state;`，不再应用任何 `filters`。
- `apps/web/src/components/eagle/EagleDuplicates.tsx:50-56`、`:506-511`：切换分类只清理选择/展开状态，不清空 `filters`。
- 同文件 `:537`：`kind === 'EXACT'` 时筛选面板被隐藏，用户无法在 EXACT 页签看到或清除这些仍保留的筛选值。
- 旧实现会在读取时对 EXACT 组应用 `sameName/sameBytes/maxBytes/protectEdits` 等条件；新实现完全忽略。

**触发条件**

- 在“按条件查找”中设置大小上限或编辑保护，然后切到“完全重复”。

**实际影响**

- 列表请求仍携带 `maxBytes`/`protectEdits`，但结果被完整返回；用户看不到筛选控件，也没有“还原默认条件”入口，容易误以为筛选仍生效。是否允许 EXACT 独立于筛选是产品选择，但当前“保留筛选值又静默忽略”的状态不一致。

**修复方向**

- 切到 EXACT 时清空或明确禁用这些筛选值；或对 EXACT 仍应用 `maxBytes`/`protectEdits` 这类“范围限制”，仅让 `sameVisual`/画面条件不参与。至少补一条对应行为测试。

---

### 6. 【低】`kind` 缺省或为 `ALL` 时仍会把“完全重复成员被 SIMILAR 覆盖”的组从完全重复视图移除

**文件与行号**

- `apps/api/src/eagle/eagle-duplicate-filters.ts:139-154`：`!input.kind || input.kind === 'ALL'` 时，用 SIMILAR 组的 `assetIds` 裁掉 EXACT 组成员；成员不足 2 的 EXACT 组直接被 `splice` 删除。
- `apps/api/src/eagle/eagle-duplicates.service.ts:107-112`：`exactGroups` / `similarGroups` 基于被裁剪后的 `state.groups` 计算。

**触发条件**

- 旧客户端或任何不传 `kind` 的调用方请求列表；或显式 `kind=ALL`。

**实际影响**

- 新网页的 EXACT 页签使用 `kind=EXACT`，可正确独立保留完全重复；但无 kind 的兼容路径会把被视觉组完全覆盖的 EXACT 组从 `groups` 和 `exactGroups` 中移除。对仍缓存旧网页/旧桌面 bundle 的用户，“完全重复”可能消失。新前端已无 ALL 页签，故定为低，但属于“完全重复独立保留”在兼容路径上的不完整。

**修复方向**

- 在 ALL 视图保留 EXACT 组，不要用 SIMILAR 成员裁剪；或明确下掉无 kind 的兼容语义并返回错误。至少补一条无 kind 的回归，确认产品预期。

---

### 7. 【低】测试缺口

- 没有覆盖 **SIMILAR 清理是否合并标签/评分**（对应问题 1）；现有清理测试只断言组和回收站结果。
- 没有覆盖 **多页加载 + revision 变化后的刷新/自动刷新**（对应问题 2）；`EagleDuplicates.test.tsx` 的刷新用例只有单页。
- 没有覆盖 **`sameVisual` 未传时的默认值**、**EXACT 带 `maxBytes/protectEdits`** 的 API 行为。
- `color-search` 不在 `ci:check`/`test:library-integration` 内，问题 3 不会被默认门禁发现；若它只是手工脚本，应在文档中写明必须设置独立 `DATABASE_URL`，或改成自包含。
- 画面组“多不同指纹”的最坏情况没有基准（对应问题 4）。

---

## 三、已核对且未发现明确问题的部分

- **需求主路径**：`sameVisual` 已是显式 DTO/契约字段；未勾选尺寸时，视觉分组 key 不再包含 `format/width/height`，元数据 SQL 也不再按尺寸分组；各条件按交集形成子组（`partitionDuplicateMembers` 与 SQL `GROUP BY` 均按勾选字段分组，缺失值不参与相等）。
- **完全重复独立**：EXACT 视图使用 `kind=EXACT` 时直接读取实时哈希组，`readDuplicateReview` 不再用 SIMILAR 成员裁剪 EXACT；新前端有独立“完全重复”页签。
- **跨 owner/私密/回收站**：`readMetadataDuplicateGroups`、视觉成员查询、清理执行均带 `ownerId`/`libraryMode`、私密过滤、`deletedAt`/`purgeAfter`/`storageTransferredOut`、MOTION 排除（元数据路径）等守卫；`cleanup` 重新计算组并按签名/版本校验。
- **签名与忽略**：条件子组、成员查看、忽略/恢复、清理都会按同一条件上下文重算签名；忽略使用 `dismissalSignature`（媒体版本），清理使用 `signature`（媒体版本 + 行版本），未发现扩大范围或跨组重叠的路径。
- **内存读取主路径**：`readMemoryPage`/`readMemoryPage` 仅在 where 能唯一确定 owner/mode 且排序为日期+id 时启用；返回后仍用原 SQL 谓词与投影从数据库验证当前页；颜色、语义、统计、人物计数均有 SQL 回退。
- **Prisma 7 适配**：API、worker、维护脚本、测试脚本统一使用 `createPrismaAdapter`；目标库/主机白名单与 `assertSafeRuntimeTarget` 一致；`isDatabaseBusy` 同时识别旧的 `meta.code` 和新的 `driverAdapterError.cause`；数据库参数预算降为 32766 并在批量路径保留内部自动分批。
- **Nest 12 / TS 7 工具链**：`typecheck` 显式使用 `typescript-native`，构建仍显式使用 `typescript@5.9.3`；没有用 `force`/`legacy-peer-deps`/忽略类型错误。`package-lock` 中 Nest 12 配套版本与声明一致。
- **MLX/CUDA**：MLX `pyproject.toml`/`uv.lock` 版本一致，固定模型/维度未见变化；CUDA 仅更新 requirements，未在图中登记为可用节点，符合“未取得资格不得登记”。
- **独立 `library-reader` 边界**：只在显式入口启动，API 不启动后台轮询；HTTP 协议有 token 鉴权、请求体上限、超时与 `cache-control:no-store`；Compose 叠加层不发布端口。
- **查重与现行刷新边界**：新增的 reader 未接管现有 `findSearchAssets` 的权限/投影；`readSmartFolderPage` 在内存结果缺失时完整回退 SQL；`ordinaryMembersPossible` 的保守证明与回退测试与文档方向一致。

---

## 四、总体建议

1. 优先修正 **SIMILAR 清理仍按 EXACT 合并标签/评分**（问题 1），这是本推送语义变化直接带来的用户数据改动，且未在界面披露。
2. 修正 **多页刷新 409**（问题 2），否则 6 万项库上“刷新结果/扫描完成自动更新”在最常见的结果变化场景下仍可能失效。
3. 修正 **color-search 适配器连接目标**（问题 3），避免该验证在错误库上运行并残留 6 万条数据；这关系测试证据的可信度，不应被“脚本通过”掩盖。
4. 其余为低风险或待产品确认项：画面组最坏复杂度、EXACT 与残留筛选值、无 kind 兼容路径、以及对应测试补齐。

**大白话总结**：条件查重的主体是对的——画面条件变成可选、未勾选尺寸不再隐藏参与、各条件按交集分组、完全重复视图独立保留，内存读取和 Prisma 适配也基本自洽；但清理 SIMILAR 时仍套用了完全重复的“合并标签、提高评分、刷新 rowVersion”，界面却没说明，这是本次最需要先改的实际数据改动。其次是多页刷新仍会被旧 revision 打成 409，以及 color-search 验证脚本实际连错了数据库、可能在错误库上留下 6 万条测试数据。其余是性能和兼容性小口子，建议顺手补测试，不构成推送阻断。
