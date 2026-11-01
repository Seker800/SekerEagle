# DeepSeek 独立审核

- 状态：report_received
- 提交范围：`ce2b0f14d573b8d1418b45975724dea9a8e2f744..e5d6b3be8f4cb3c7d4c6c3cf12f0381443bec23b`
- 完成时间（UTC）：2026-10-31T10:33:33.971424+00:00
- 本地审查记录：`/Users/seker/seker-workspace/SekerEagle/.git/worktrees/SekerEagle8/deepseek-reviews/e5d6b3be8f4c-41z3b6pr`

报告仅针对上述提交，是独立建议，不是推送门禁，也不代表当前工作区已通过审核。

# 审查报告（只读）

审查对象：固定范围 `ce2b0f14d573b8d1418b45975724dea9a8e2f744..e5d6b3be8f4cb3c7d4c6c3cf12f0381443bec23b` 的快照。已逐条核对调用者给出的 diff 与快照内文件，内容一致。未运行测试、未重算 git diff、未查看镜像或生产环境。

## 结论

**未发现本次改动引入的可证实正确性缺陷。** 准入和最终分组这两处整库读取都已改为参数数量固定的 SQL；作用域、私密可见性、媒体／处理器版本守卫与改动前的 ORM 实现等价；没有新增数量上限、表结构、权限旁路或事务边界变化。生产故障路径（`scan` 准入）与后台分组路径均已被消除。

真正需要跟进的是测试盲点和发布溯源，都是低严重度，不构成阻止推送的理由。

## 一、已核对等价性、未发现问题的部分

1. **作用域等价**（`eagle-duplicate-candidates.ts:7-11`）
   - `NOT a."storageTransferredOut"` 与旧 `storageTransferredOut: false`：列 `BOOLEAN NOT NULL DEFAULT false`（`schema.prisma:409`），且 `storageTransferredOut=true` 必有 `deletedAt/purgeAfter/transferredAt`（`migrations/20261031080000_transfer_storage_ownership/migration.sql:2-10`），两种写法结果相同。
   - `deletedAt IS NULL`、`purgeAfter IS NULL` 与旧 `deletedAt: null / purgeAfter: null` 相等；`NOT a."isPrivate"` 与 `isPrivate: false` 在非空布尔列上相等；`a."libraryMode"=${libraryMode}::"LibraryMode"` 与 `ownerId` 均由认证主体推导，无 DTO 注入面。
   - `mimeType LIKE 'image/%'` 与旧 `startsWith: 'image/'` 等价（值内无通配符，大小写敏感一致）。
2. **版本守卫等价**
   - 旧准入用 JS `mediaRevision !== 或 processorVersion !==` 判缺失；`NOT EXISTS`（`candidates.ts:22-24`）对“无指纹／版本不符”同样判缺失，缺失时旧表达式因 `undefined !== number` 为真，语义一致。
   - 旧分组投影先读全量指纹再在 JS 判版本；新 `LEFT JOIN ... AND f."mediaRevision"=a."mediaRevision" AND f."processorVersion"=版本`（`candidates.ts:45-47`）在不匹配时把 `fingerprint` 置空，与旧的三元判断一致。
3. **空值／类型等价**
   - `byteSize`（bigint→`Number`）、`libraryAddedAt`（`Date`→`toISOString`）、`width/height/rating`（`Int?`）、`isPrivate`、`sha256` 均与旧 `candidateSelect` 映射一致；`CASE WHEN f."assetId" IS NULL THEN NULL ...` 对应旧 `null`。
   - `jsonb_build_object('colors',f.colors)` 返回 JSONB 嵌套对象，Prisma raw 会反序列化为 `{hash,colors:number[],contrast}`；现有两模式 `SIMILAR` 测试（`duplicates.test.mjs:242-249`）依赖该形状，若变成字符串会失败，说明该类型假设有测试覆盖。
   - 移除了 `candidateSelect` 中未被 `DuplicateCandidate` 或 `findDuplicateGroups` 使用的 `mimeType/lifecycleStatus`（`eagle-duplicate-model.ts`、`packages/library-core/src/duplicates.ts:7-19`），无下游引用。
4. **参数规模**
   - 两条新 SQL 各固定 4 个绑定参数（`candidates.ts:8-10,22-24,45-47`），不再随库大小增长；批量路径仍按 16 个 id 读（`eagle-duplicate-index.ts:86-95`）、准入按 500 项落库（`eagle-duplicates.service.ts:228-239`），60000 缺失时为 3750+1 项、8 次 INSERT，测试已断言 `weight=60001`（`duplicates.test.mjs:369-373,382-391`）。
5. **权限隔离**
   - `ownerId` 来自 `principal.sub`（`eagle-duplicates.service.ts:258-263`），`includePrivate` 取自已持久化操作标志（`eagle-duplicate-index.ts:21-26`），与旧实现一致；分组写入在 privacy 锁与 `assertActor` 之后（`index.ts:31-32,53`），`assertActor` 会重新校验账号与私密授权（`eagle-asset-operations.service.ts:556-582`）；分组删除按 owner／mode 收窄（`index.ts:33-39`）。未发现新增跨 owner 或私密泄漏路径。
6. **测试库隔离**：`ANALYZE` 只出现在测试文件（`duplicates.test.mjs:354,381`），该文件在导入时强制 `DATABASE_URL` 路径为 `/sekereagle_test`（`duplicates.test.mjs:15-20`），不进生产逻辑。快照中迁移目录确为 68 项，与文档“68项迁移保持”一致。

## 二、发现（均为低严重度，建议补测／补记录）

### 1. [低] 私密可见用户的“完整扫描→最终投影”路径没有完成态测试

- 位置：`scripts/testing/duplicates.test.mjs:302-326`（唯一的 `canViewPrivate: true` 扫描在 `322-324` 行被取消）；其余已完成扫描都用 `f.principal`（`canViewPrivate: false`，见 45 行），位置 242/253/367/382/440/543。
- 触发条件：若 `readDuplicateCandidates` 的 `includePrivate` 实参被误传为 `false`，或 `scope()` 被改成恒加 `AND NOT a."isPrivate"`，则私密近似组在最终投影中静默消失。
- 证据与影响：`scope()` 的 true 分支只被“准入”调用覆盖（取消前已执行缺失查询），**候选投影的私密路径从未执行**；且测试从没有直接查询 `EagleDuplicateGroup`，`list` 会独立过滤私密／删除不一致的组（`eagle-duplicate-read.ts:43-48`），因此显示层断言可能掩盖投影作用域漂移。不会越权（`list` 与清理都会再校验），后果是私密 SIMILAR 结果丢失或组表写入错误。
- 修复方向：加一条两模式（或单模式）测试：`canViewPrivate: true` 主体验两张私密近似的完整扫描并 drain，断言 `similarGroups` 包含该组；最好直接查 `EagleDuplicateGroup` 断言写入行的 owner／mode／`isPrivate` 与作用域。

### 2. [低] `processorVersion` 守卫在两个新 SQL 中都没有版本失配测试

- 位置：`eagle-duplicate-candidates.ts:24`（NOT EXISTS）与 `:47`（LEFT JOIN）；测试只出现当前版本字面量 `duplicates.test.mjs:377,537`，旧版本失效用例只改 `mediaRevision`（`:267-271`）。
- 触发条件：未来有人改动或误删 `processorVersion` 条件；或升级 `DUPLICATE_FINGERPRINT_VERSION` 后回归。
- 影响：丢 `NOT EXISTS` 的版本条件会让旧算法指纹永不重算（`coverage.indexed` 与扫描都静默为 0）；丢 `LEFT JOIN` 的版本条件会拿旧算法指纹生成 SIMILAR 组，而 `list` 只校验 `mediaRevision`（`eagle-duplicate-read.ts:44-47`），旧指纹组的错误视觉证据会直接展示并可被清理。现有测试只覆盖 `mediaRevision`，两种情况都能通过。
- 修复方向：造一条 `mediaRevision` 相同、`processorVersion` 为旧值的指纹，断言（a）扫描把它排为缺失并可重算，（b）重算前 `similarGroups` 为 0。测试中的版本字符串建议复用常量，避免 60k 测试与新版本升级脱节（当前硬编码在 `:378`）。

### 3. [低][待验证] 运行文档固定的源码提交不在本次审查范围内

- 位置：`docs/current-runtime.md:3`、`docs/duplicate-scan-hotfix-2026-10-31.md:28` 均写“运行源码固定 `089c53d4e46b...`”，镜像 `duplicate-scan-089c53d4e46b`；本次审查范围终点是 `e5d6b3be...`。
- 证据与影响：同文说明镜像是“基于现用 API 成品，仅替换四个查重模块的 12 个编译文件”。也就是说部署物不是从本次推送提交重新构建的，仓库内无法把成品镜像与本快照逐字节对应；若 12 个编译文件来自另一工作树（含未提交改动），线上行为可能与已审代码不同。文档中的健康状态、HTTPS 验收、容器身份等运营结论也属于不可由只读快照复现的证据。
- 修复方向：在运行文档记录本次实际推送提交 `e5d6b3be` 与镜像摘要／哈希清单，或从该提交重建镜像并重跑 `test:api-image` 验收；若确认 `089c53d4` 与 `e5d6b3be` 内容一致，补一句等价说明。此项需主代理或运维核实，不阻塞代码。

## 三、其他观察（当前不算缺陷，不建议本次扩大改动）

- 作用域谓词现在存在于四处：`eagle-duplicate-candidates.ts:7-11`、`eagle-duplicate-read.ts:19,26-27`、`eagle-duplicate-model.ts:35-48`、`eagle-duplicates.service.ts:43-52`。当前语义一致（`= false` 与 `NOT` 在非空布尔上等价），但同一特性内的重复定义只能靠评审保持一致，无测试断言其等价；本次修复把两条新读取集中到一个模块已算收敛，不建议为此重构。
- `buildProjection` 用 `PrismaService` 调 `readDuplicateCandidates`（`eagle-duplicate-index.ts:21-26`），候选读取不在分组写入事务内——这是改动前就有的行为（旧 `prisma.eagleAsset.findMany` 同样在事务外），不是本次回归；但函数签名写成 `Prisma.TransactionClient`，类型上不阻止“看似事务内、实际事务外”的误用。
- 准入仍在单个 45s 事务内把约 6 万行 ID 物化为 3751 个操作项（`eagle-duplicates.service.ts:258-281`），是剩余的 O(库大小) 耦合；在 6 万锚点内本地实测 690ms 可接受，但 NAS 上若逼近 45s 会以事务超时而非功能不可用暴露。文档已声明本地耗时不代表群晖性能，可接受。
- `docs/performance-budget.md` 的入队预算为“`POST /operations` p95 ≤ 500ms”，与本次 690ms 本地准入不是同一端点，文档也已注明是本地排队耗时；建议不要把它表述为满足该 500ms 预算，必要时在预算文档记一句口径。

## 四、检查范围与限制

- 只读审查：未运行测试、未重算覆盖率、未启动镜像、未访问生产；文档中的“15项测试通过／99.09% 行覆盖／60000 规模 RED→GREEN／HTTPS 与对象存储验收／容器 healthy 零重启”等均无法在此验证，属于**待验证的运营证据**。
- 依据调用者提供的 diff 与快照文件核对；未用 git 命令重算完整区间的差异。提供的 diff 未展示“历史发送夹具补 `transferredAt`”那一行，快照中该夹具（`duplicates.test.mjs:479-487`）确实已满足 CHECK 约束，但无法确认它是本范围新增还是基线已有。
- 未递归审查其他模块；上游 `findDuplicateGroups`、清理／回收、阈值、迁移、前端、队列均未发现本次误改。

**一句话总结：这次修复本身，我没有找到会推翻它的正确性问题——参数溢出在两个整库读取点都被真正消掉了，作用域和版本语义跟改前等价，权限没有放松。剩下的是补两条测试（私密投影、指纹版本失配）和把“线上跑的是哪个提交”的溯源记录对清楚；这两件事不影响推送，但“已上线验证”的说法不能由本次只读审查代替。**
