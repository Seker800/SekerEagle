# DeepSeek 独立审核

- 状态：report_received
- 提交范围：`d9b1643380eadcc8171fa1fc729ecca59dc80783..18ecd92719bf4c722d01418bacd50664a097c9cb`
- 完成时间（UTC）：2026-10-31T16:57:57.605720+00:00
- 本地审查记录：`/Users/seker/seker-workspace/SekerEagle/.git/deepseek-reviews/18ecd92719bf-e9g7aonh`

报告仅针对上述提交，是独立建议，不是推送门禁，也不代表当前工作区已通过审核。

# 独立代码审查报告（只读）

## 审查范围

已读：`AGENTS.md`、`docs/architecture.md`（North star）、`docs/product-frame.md`、`docs/performance-budget.md`、`docs/library-sharing-gate.md`，并逐一核对本提交范围内的全部改动文件，以及其上下文（operations 执行器 `asset-operation-executor.ts`、领取/重试/取消/失败路径、`eagle-duplicate-read.ts`、`eagle-duplicate-candidates.ts`、`eagle-duplicate-index.ts`、`eagle-duplicates.service.ts`、前端选择/清理状态机、DTO、生成契约、compose、nginx、相关测试）。

未运行命令、未跑测试、未改文件；因此所有"CI/内存/吞吐/真实库"结论只从源码与已提交产物推断。

---

## 高

### 1. 新增 DTO 字段未重新生成共享契约，`contracts:check` 必然失败

- 文件/行：
  - `apps/api/src/eagle/eagle-duplicates.dto.ts:55-61`（新增 `allVerified`、`signatures` 的 `@ApiProperty`）
  - `packages/contracts/openapi.json:8603-8622`（`DuplicateActionDto` 只有 `operationId/revision/allExact/groups`）
  - `packages/contracts/src/generated/openapi.ts:3845-3850`（同上）
  - `.github/workflows/ci.yml:28` + `package.json:38`（CI 在 `ci:check` 之后执行 `npm run contracts:check`，该脚本会重新生成并 `git diff --exit-code` 这两个文件）
- 触发条件：CI 执行 `contracts:check`；或任何消费者按 `openapi.json` 重新生成客户端。
- 证据：DTO 已带 `@ApiProperty` 的新字段，而两份生成物中完全没有 `allVerified`/`signatures`（grep 无匹配）。`openapi:generate` 会重新编译当前源码，生成结果必然多出这两个属性，`git diff --exit-code` 返回非零。
- 实际影响：推送后 CI 的红灯，且"共用客户端契约"落后于实际 API；与"已验证完整CI"的说法矛盾。
- 修复方向：在提交内运行 `npm run contracts:generate`，提交 `packages/contracts/openapi.json` 与 `packages/contracts/src/generated/openapi.ts`，再跑 `contracts:check`。

---

## 中

### 2. 用"像素组 id 集合"逐成员裁剪 EXACT 组，会把新导入的字节级重复从审查中隐藏

- 文件/行：`apps/api/src/eagle/eagle-duplicate-read.ts:90-93`
  ```ts
  const pixelIds = new Set(similar.flatMap((row) => row.assetIds));
  for (const original of exact) {
    const row = { ...original, assetIds: original.assetIds.filter((id) => !pixelIds.has(id)) };
    if (row.assetIds.length < 2) continue;
  ```
- 触发条件：库已完成一次扫描（`originalCheckCompleted=true`、`outdatedGroups=0`，因此前端不会自动重扫）；此后导入一份与既有资产 A 字节相同的 B，而 A 已属于某个已发布的 SIMILAR 像素组（例如 A 与 C 是元数据不同的同画面备份）。打开查重：
  - `exact` 查询实时按 sha256/byteSize/format/隐私分组得到 `[A,B]`；
  - `pixelIds` 来自已持久化的 `EagleDuplicateGroup`，只含 A、C；
  - 裁剪后 `[B]` 长度 <2 被丢弃；
  - B 又不在像素组里（扫描后才导入）。
- 证据：`exact` 是实时 SQL（22-29 行），`similar` 来自持久化组（40-50 行）；`findVerifiedPixelGroups` 的成员来自扫描时的 `readDuplicateCandidates`。因此新资产不会进入旧组。
- 实际影响：EXACT 分类会显示"没有完全重复的文件"，B 也不会被"每组保留一份"批量清理；违背 `docs/library-duplicates.md:7`"打开后立即显示已有文件哈希找到的完全重复项"的既有行为，用户必须手动"检查新内容"才会重新可见。不会误删，但会漏清理。
- 修复方向：只在 EXACT 组**整体**被像素组覆盖时才移除；或读时按当前指纹重算像素组后再合并；或对"与已发布像素组共享成员的 EXACT 组"触发一次投影重建。注意任何合并方案都要保持 `selectedIds` 不重叠（`eagle-duplicates.service.ts:403-405` 会直接报冲突）。

### 3. 任一 FAILED/CANCELLED 项让 `originalCheckCompleted` 永假，前端每次打开都会重新入队扫描

- 文件/行：
  - `apps/api/src/eagle/eagle-duplicate-read.ts:66-69`（要求同一操作内 `NOT EXISTS status<>'COMPLETED'`）
  - `apps/web/src/components/eagle/EagleDuplicates.tsx:195-214`（`originalCheckCompleted === false && coverage.total > 0` 即自动 `scan.mutate()`，`attemptedUpgrade` 仅在本次挂载内生效）
  - `apps/api/src/eagle/eagle-asset-operations.service.ts:718-732`（取消把 PENDING 改成 CANCELLED）
  - `apps/api/src/eagle/eagle-asset-operations.service.ts:1118-1165`（核验失败把项标为 FAILED）
- 触发条件：
  - 某份原件永久失败（`DUPLICATE_ORIGINAL_TOO_LARGE`、`HASH_MISMATCH`、超时、对象读取失败）；或
  - 用户点了"取消排队"，把 build/publish 置为 CANCELLED。
- 证据：`originalCheckCompleted` 要求该次扫描的所有项都 `COMPLETED`；FAILED/CANCELLED 都不满足。前端 effect 只在组件挂载期内去重，关闭再打开会重置 `attemptedUpgrade`，于是重新 `scan()`。`scan()` 在无 PENDING/RUNNING 项时会新建操作（`eagle-duplicates.service.ts:287-296`），再次尝试同一批失败原件。
- 实际影响：每个永久失败的原件会让每次打开查重窗口都触发一次全库扫描与一次原件重下载（60k 库的 `readMissingDuplicateFingerprints`/候选读取都重跑）；"取消排队"在关闭再打开后不生效。吞吐和体验都受影响，且 `originalCheckCompleted` 永远不为 true。
- 修复方向：给核验失败引入终态（如 `UNSUPPORTED` 一样写入 `pixelStatus`，或用单独 `blocked` 状态），让 `originalCheckCompleted` 忽略终态失败；自动重扫改为按算法版本/显式用户操作触发，或把取消视为终态；同时在 UI 上明确展示"这些原件未核验"。

### 4. 新的跨页 `signatures` 服务端路径没有任何服务级验证

- 文件/行：
  - `apps/api/src/eagle/eagle-duplicates.service.ts:367-373`（`input.signatures` 分支，主批量路径）
  - `apps/api/src/eagle/eagle-operation-request-body.test.ts:29-49`（5001 项测试用的是 `assetIds`，不是 `signatures`）
  - `apps/api/src/eagle/eagle-duplicates.test.ts:34-37`（只测了 1201 个 `signatures` 的 DTO 校验）
  - `scripts/testing/duplicates.test.mjs` 完全没有 `signatures`/跨页场景
- 触发条件：用户跨页勾选若干组并提交 `signatures`。
- 证据：集成测试只覆盖 `allVerified`（新测试）与旧的 `groups`/`allExact`；`signatures` 分支仅由前端 mock 测试覆盖，服务端的"每组保留 recommendedId、忽略组过滤、版本冲突、跨 owner 404、实况组件冻结"没有被真实数据库/执行器验证。同时"5001 组正文解析器"的验收实际只验证了 `assetIds` 载荷。
- 实际影响：这是本次需求的核心批量入口，回归时不会有测试拦截；也与"5001 组选中正文解析器与普通端点隔离"的验收描述不完全对应。
- 修复方向：补一条服务级测试：两个 `cursor` 页各取若干签名（含 1 个已忽略、1 个跨页、1 个过期 revision），断言每个签名恰好保留 `recommendedId`、回收站数量正确、无重叠冲突、失败项不误删；正文测试改用真实 `signatures` 载荷。

---

## 低

### 5. 新核验错误码在 UI 被折叠成"操作失败，请重试"，与"文案说真实原因/明确显示未核验"不一致

- 文件/行：
  - `apps/api/src/eagle/eagle-asset-operations.service.ts:1121-1129`（新增 `DUPLICATE_ORIGINAL_TOO_LARGE`/`HASH_MISMATCH`/`INVALID_DUPLICATE_ORIGINAL_BUDGET`）
  - `apps/web/src/components/eagle/EagleDuplicates.tsx:493-500`（只特判 `ASSET_CHANGED`，其余一律"操作失败，请重试。"）
- 触发条件：原件超过 `EAGLE_DUPLICATE_ORIGINAL_MAX_BYTES`、读取/核验超时、哈希不符。
- 证据：`failItems` 把真实 code 写进 `errorCode`，`summary` 也把它放进 `errors`，但前端没有映射；同时这类失败不会进入 `coverage.unsupportedOriginals`（该计数只统计已写入 `pixelProcessorVersion` 且状态非 VERIFIED 的行）。
- 实际影响：用户看到的是通用失败 + 重试按钮，不知道是体积/时延问题，重试也不会成功；与 `docs/product-frame.md` §6.6 及 `docs/performance-budget.md` 的"超预算明确显示未核验"不一致。
- 修复方向：为这三个 code 提供明确文案（"原图过大/读取超时，未纳入画面相同清理"），并把终态失败计入未核验展示；或按第 3 条把它们落成可展示的终态。

### 6. 确认文案只说"完全重复项"合并标签/评分，但像素相同的 SIMILAR 组现在也合并

- 文件/行：
  - `apps/api/src/eagle/eagle-duplicates.service.ts:456`（所有清理项 `exact: true`，SIMILAR 也走标签/评分合并与 `rowVersion` 自增）
  - `apps/web/src/components/eagle/EagleDuplicates.tsx:369-372`（提示只提"完全重复项的独有标签和最高评分"）
- 触发条件：清理"原图画面相同"组。
- 实际影响：用户以为只有字节完全相同的组会合并标签/评分，实际像素组也会合并，且会提高保留项评分、刷新其 `rowVersion`。属于用户可见的语义变化未同步说明。
- 修复方向：把文案改为"每组保留一项；被清理副本的独有标签和最高评分会合并到保留项"，或按 kind 分别说明。

### 7. 持久化分组未绑定 `DUPLICATE_PIXEL_VERSION`（未来维护风险）

- 文件/行：`apps/api/src/eagle/eagle-duplicate-read.ts:40-50`（只校验 `algorithmVersion` 与 `mediaRevision`），`packages/library-core/src/duplicates.ts:1-2`
- 触发条件：未来只提升 `DUPLICATE_PIXEL_VERSION`（例如升级 libvips 或改解码流程）而不提升 `DUPLICATE_GROUPING_VERSION`。
- 证据：组表只存 `algorithmVersion`，读路径不会检查生成该组时用的像素版本；在重扫完成 publish 之前，旧组仍会被当作有效证据参与清理。
- 实际影响：目前两版本同时首次发布，无触发条件；但后续若只升像素版本，可能按旧像素判定清理。属于设计约束，建议在文档/代码中明确"两者必须同时升"或在组表记录像素版本并在读时校验。

---

## 已核对并认为符合要求的部分

- 认证、owner 由 `principal.sub` 推导、DTO 拒绝 `ownerId`（`forbidNonWhitelisted` 测试）、跨 owner 走 `state.groups` 查找失败、私密/授权过期、租约/行版本/媒体版本冻结、回收站与撤销、标签评分合并在原事务内保留。
- 批量入口仍走独立 operations 执行器，无 API 定时任务；`withDuplicateOriginalSlot` 在单进程内跨 MATERIAL/PHOTO 共用，领取按 mode 串行，publish 排在 verify 之后（`ordinal` 顺序 + 单 lane），`originalCheckCompleted` 还要求无未完成项。
- 只接受单帧八位 JPEG/PNG；APNG 通过 chunk header、XMP MotionPhoto/MicroVideo、编辑副本、实况均保守排除；哈希不符/超预算 fail closed；像素摘要流式写入不收集数组。
- 清理会先校验 revision，每组至少保留一项，`allVerified`/`signatures` 都要求 revision；旧 `groups` 摘要保持不变（legacy replay 测试覆盖）。
- `.env.example`、mac/NAS compose（NAS 由 mac compose 渲染）与 `scripts/deploy-nas.test.mjs` 的环境变量/内存默认值一致；网关只给 `duplicates/cleanup` 单独放宽读超时；迁移为可空加列，无破坏性。

---

## 限制与待验证

- 未运行任何命令，因此"最终镜像 boot/内存 768MiB 足够、NAS 61MP 吞吐、真实库 5001 组、生产 UI"均未独立验证，只能依赖 `docs/performance-budget.md` 中标注为"待最终镜像与生产验收"的记录。
- APNG 测试只断言 `UNSUPPORTED`；若 `sharp.metadata().pages` 先行识别，`hasPngAnimation` 的 chunk 扫描分支可能未被实际执行（待验证）。
- `scripts/testing/photo-privacy.test.mjs` 修改了人物选项期望（`rowVersion`/`marksAssetsPrivate`），但本范围内没有对应源码改动；这更像修复此前的陈旧断言。是否应在本次提交内出现，无法从快照判定（待验证）。
- 未复验 `official` 生成物是否在其他分支/提交中补齐；就本快照而言缺失。
