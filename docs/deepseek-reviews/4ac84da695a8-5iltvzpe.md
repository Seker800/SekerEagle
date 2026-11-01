# DeepSeek 独立审核

- 状态：report_received
- 提交范围：`af2c7384c0650089ad2e10de462a6bcb23418b65..4ac84da695a8fbfcc7b29c832d4e45819b2b7999`
- 完成时间（UTC）：2026-10-31T07:38:19.023631+00:00
- 本地审查记录：`/Users/seker/seker-workspace/SekerEagle/.git/deepseek-reviews/4ac84da695a8-5iltvzpe`

报告仅针对上述提交，是独立建议，不是推送门禁，也不代表当前工作区已通过审核。

# 独立审查结论（只读快照，未运行命令）

## 审查范围与限制
审查了固定范围 `af2c7384..4ac84da6` 的快照，并额外读取了 `eagle-trash.ts`、`live-photo-projection.ts`、`thumbnailLoadService.ts`、`eagle-workspace-cache.ts`、`apps/api/Dockerfile`、`deploy/gateway/nginx.conf`、`scripts/deploy-nas.mjs`、lockfile 等上下文。未运行任何命令，因此提示中“ci:check / test:api-image --storage-check 已通过”按待核验声明处理；未核验真实 NAS/生产库、Android 客户端和 Dependabot 分支。Dependabot 大版本提议未混入本范围（package.json 仅新增 `start:operations`）。

## 问题清单

### 1.【高 · 待验证】独立 operations 进程可能在启动时崩溃：`reflect-metadata` 晚于装饰器模块加载
- 位置：`apps/api/src/asset-operation-executor.ts:1-2`。
- 机制：tsconfig 为 commonjs，TS 按源码顺序 require；第 1 行先加载 `eagle-duplicates.service`，其传递依赖在模块求值时应用 `@Injectable()`（如 `PrismaService`），Nest 装饰器直接调用 `Reflect.defineMetadata`，Node 22 原生 `Reflect` 没有该方法，而 `@nestjs/common/config/swagger` 在 lockfile 中都只把 `reflect-metadata` 列为 peerDependency。
- 影响：执行器不写 ready 文件，API 只入队不执行，发送/删除/查重永久排队；`api-image-smoke.mjs` 的执行器就绪检查会超时。仓库其他入口（`main.ts`、`bootstrap-admin.ts`、`maintenance/local-copy.ts`）都把这个 import 放第一行，本文件是唯一反例。
- 这与“最终镜像独立执行器验收通过”的声明直接矛盾，请务必复跑 `node apps/api/dist/asset-operation-executor.js` 确认；若实际能启动，说明有未声明的传递性 polyfill，也应把 import 置顶。
- 修复：将 `import 'reflect-metadata';` 移到文件第一行。

### 2.【中】查重结果多页刷新会用旧 `revision` 请求第 2 页，清理后自动/手动刷新可能持续 409
- 位置：`apps/web/src/components/eagle/EagleDuplicates.tsx:82-91`（`getNextPageParam` 把上一页 revision 固化进 pageParam；`refetchResults` 125 行、`refresh` 187 行）+ `apps/api/src/eagle/eagle-duplicates.service.ts:56-61`（每一页都强校验 revision）。
- 触发：结果超过 1 页（6 万库/100+ 组时必然），期间清理或后台扫描改变了结果，随后自动刷新、点“刷新结果”或“加载更多组”。
- 证据：React Query v5 的 infinite refetch 按已存 `pageParams` 逐页重取（本快照无 node_modules，标待验证）；第 1 页无 revision 会成功并拿到新 revision，第 2 页仍用旧 revision → 409，整个 refetch 失败并保留旧 pageParams，后续刷新重复失败，直到 query GC。现有 `EagleDuplicates.test.tsx` 的刷新测试让 mock 忽略 revision，覆盖不到该路径。
- 影响：文档承诺的“完成后自动按新游标更新已加载结果页”在真实多页结果上失效，用户刷新不动。不丢数据。
- 修复：服务端只对第一页/`allExact` 确认强制 revision，续页不强制；或客户端刷新时丢弃已加载页、从第 1 页重新拉取；并补一条真实 revision 的多页集成测试。

### 3.【低】查重写路由未纳入长超时 location，隐私锁等待可超过网关 15s
- 位置：`deploy/gateway/nginx.conf:73-84`（仅 operations/retry/send 放宽到 150s）与 `:86-94`（其余 `/api/` 15s）；`eagle-duplicates.service.ts:108/145/172/297/427`（事务 30s/45s）。
- 触发：发送发布会持有 owner 隐私锁（代码注释称最长 30s）时，查重 list/members/scan/cleanup/ignore 超过 15s 代理期限。
- 影响：网关 504 而 API 事务可能继续提交；稳定 operationId 使重试幂等，不丢数据，但用户会看到“报错了其实已在跑”。
- 修复：把 duplicates POST 纳入长超时 location，或把服务端事务超时收敛到网关预算内并记录。

### 4.【低】准入期 `FAILED/NOT_FOUND` 项重试无法恢复，甚至误报 `ASSET_CHANGED`
- 位置：`apps/api/src/eagle/eagle-asset-operations.service.ts:357-364`（`assetIds:[id]`、`snapshots:[]`）、`430-438`（retry 改回 PENDING）、`730-771`（`ids` 取自 snapshots，current 取自 assetIds，两者强等）。
- 触发：TRASH 选集中某项因私密不可见在准入时记为 NOT_FOUND；之后解锁隐私/改为公开，再点“重试失败项”。
- 影响：`checkSnapshots([])` 通过，resolve 返回该 id 后与空 ids 比较必然冲突 → `ASSET_CHANGED`，永远无法完成；若仍不可见则 `ASSET_UNAVAILABLE`。重试承诺失效，不丢数据。
- 修复：对无快照的准入失败项执行时以 `entry.assetIds` 为期望集合，或重试时重建快照，或显式跳过并给出准确文案。

### 5.【中 · 部署风险】旧 Mac worker 无 `storageTransferredOut` 保护，顺序跳过会删掉接管目标的原件
- 位置：`apps/worker/src/asset-purge.ts:42-51`（保护只在新 worker）+ `deploy/mac/docker-compose.yml:154-193`（operations 随 compose 默认启动，无 worker 版本门禁）。
- 触发：new API/operations 已产生 HANDOFF，而旧版本 worker 仍在运行。
- 证据：旧 Prisma client 不 select 未知列，`storageTransferredOut` 为 undefined，旧 worker 会把退役源的 `originalObjectKey`（与目标共享）写入删除 outbox；`assertDeletionKey` 只校验 owner 前缀，拦不住。此后目标阅读该 key 404。
- 影响：违反“不丢数据”，当前唯一防线是人工部署顺序；代码/迁移/健康检查均无检测。
- 修复：加部署门禁/版本心跳检查，或在 outbox 消费前用 SQL 校验该 key 是否仍被另一个 `storageTransferredOut=false` 的 active 资源引用；若只靠流程，应把“旧 worker 已排空”标为阻断性前置条件并给出可观测检查。

## 未发现明确问题的方面
- HANDOFF 所有权/退休/outbox：发布事务内完成源退役、目标创建、源派生行删除；部分唯一索引 + CHECK 约束拒绝双 active owner；`prepareAssetPurge` 与 maintenance 过期对 HANDOFF 不登记源字节删除；旧 COPY 计划仍走复制且幂等不变。未发现新代码路径删除目标接管字节。
- 租约/回执：`beginMediaPublication` 同时校验 owner/mode/mediaRevision/leaseVersion；`MediaOutputAttempt` 先登记 outbox 再 PUT，发布事务内消费意图，失败只提前原意图，不确定提交后不重建删除；晚到旧执行者写自己的随机目录，不能覆盖目标。
- 队列领取：三车道（SEND/METADATA/SCAN）、advisory lock + RUNNING 计数 + leaseVersion、SEND 4 路并发、SKIPPED 不阻塞有效项、回执与发布同事务；扫描不占发送/回收车道。
- 隐私与 owner：查重入口按 ownerId + libraryMode + includePrivate 限定，私密组不混组，跨 owner 404，注入 ownerId 被全局校验拒绝，执行时再次校验版本/私密/租约/实况组件。
- 导航：显式目的地清除智能文件夹范围；`useDebouncedValue` resetKey 立即提交输入；慢请求用绝对定位反馈；进度只标 stale、不裁剪分页。未发现列表被重置或滚动被清空的确定问题。
- 部署装配：operations 复用 API 镜像、独立连接池、无 JWT/模型 env；NAS 生成器映射到 api 镜像、测试库、无 API 密钥；网关正则引号化。

**一句话总结**：HANDOFF、outbox/租约、owner/隐私隔离和导航主体没有发现明确的数据破坏路径；但独立执行器入口的 `reflect-metadata` 顺序有启动即崩的实质风险（且与“镜像验收通过”矛盾，必须复跑），查重多页刷新会因旧 revision 反复 409，另外旧 worker 误删接管原件只能靠人工部署顺序兜底——这三处建议优先核实。
