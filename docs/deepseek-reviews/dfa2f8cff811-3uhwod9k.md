# DeepSeek 独立审核

- 状态：report_received
- 提交范围：`653915e69803f06294439905a0aa7425c1332981..dfa2f8cff81192c4ef51137a5a8a48ae2268e313`
- 完成时间（UTC）：2026-11-03T02:41:19.286808+00:00
- 本地审查记录：`/Users/seker/seker-workspace/SekerEagle/.git/deepseek-reviews/dfa2f8cff811-3uhwod9k`

报告仅针对上述提交，是独立建议，不是推送门禁，也不代表当前工作区已通过审核。

# 独立审查报告：空闲巡检降频与上传清理索引（653915e..dfa2f8c）

## 结论

未发现会阻断本次推送的高危缺陷。改动范围与用户要求基本一致：只改健康巡检间隔/失败次数、只加一个并发部分索引迁移、补测试与运行文档，没有触碰业务源码、认证、任务策略或 SekerChat/百度。

需要主代理关注的、有证据的问题集中在三点：

1. 并发索引迁移**失败后的恢复路径**没有说明或工具支持（新增的、真实存在的运维风险）；
2. 健康巡检契约测试只断言“探针非空”，没有锁住“真实检测命令/超时”；
3. 少量性能结论措辞与启动等待预算问题（低severity，部分是“待验证”）。

---

## 问题清单

### [中低] 并发索引迁移失败会留下 INVALID 索引并阻断后续 migrate，部署脚本没有恢复动作

**文件/行号**
- `apps/api/prisma/migrations/20261103090000_upload_retired_cleanup_index/migration.sql:5-7`
- `scripts/deploy-mac.mjs:153`（先停 writers）、`:169-189`（等待 migrate，失败只停 migrate 容器）
- `docs/current-runtime.md:13`（回退只描述镜像与 Compose，未描述迁移失败恢复）

**触发条件**
`CREATE INDEX CONCURRENTLY` 构建期间失败或被中断：锁等待超时、NAS 重启、磁盘/内存不足、操作者取消 `migrate`、连接断开。此时 PostgreSQL 会留下同名 `INVALID` 索引，Prisma 在 `_prisma_migrations` 留下失败记录。

**证据**
- 迁移只有一条光秃秃的 `CREATE INDEX CONCURRENTLY`，没有 `IF NOT EXISTS`、没有同名前一步清理；并发建索引**不可重入**，同名索引已存在（即使 INVALID）会直接报错。
- `deployCompose` 在 `migrate` 之前已 `stop gateway api worker operations`；失败分支只 `docker stop` migrate 容器，不会清理索引，也不 `migrate resolve`。
- 现有回退文档只覆盖“镜像保留兼容索引”，没有迁移失败处理。

**实际影响**
失败后库/图库处于“writers 已停 + 迁移失败”状态；再次 `npm run deploy:mac` 会因 Prisma P3009（存在失败迁移）继续失败，必须人工进库 `DROP INDEX` + `prisma migrate resolve --rolled-back` 才能恢复。本次生产证据显示成功路径已跑通，但这只证明 happy path。

**修复方向**
在运行文档（或部署脚本）补一条明确恢复流程：`DROP INDEX CONCURRENTLY IF EXISTS "EagleUploadSessionState_retired_cleanup_idx";`（先确认是 INVALID）→ `prisma migrate resolve --rolled-back 20261103090000_upload_retired_cleanup_index` → 重跑。若希望工具化，可在 migrate 前加一个“同名的 INVALID 索引才删除”的幂等预检脚本。注意不要为了“可重入”把它改成事务内普通 `CREATE INDEX`，那会重新引入长锁；更合适的是补恢复路径而不是改语义。

> 说明：仓库里已有非 BEGIN/COMMIT 的迁移（如 `20261026020000_media_scheduler_cover_indexes`）且能正常 deploy，说明 Prisma 7 并未把所有迁移包在事务里；因此这里不是“CONCURRENTLY 不能跑”的问题，而是失败恢复问题。该判断基于仓库现状与调用者提供的“86 项迁移已完成”证据，未在本快照内实际执行验证。

---

### [低] 健康巡检契约测试没有锁住“真实检测命令/超时/启动宽限”，只断言非空

**文件/行号**
`scripts/deploy-nas.test.mjs:64-69`

**触发条件**
后续有人把某个探针改成 `CMD ['true']`，或删掉 `timeout`，或把 worker 的 `start_period` 去掉；测试仍然通过。

**证据**
```js
assert.equal(check.interval, '${SEKEREAGLE_HEALTHCHECK_INTERVAL:-60s}', name);
assert.equal(check.retries, 3, ...);
assert.ok(check.test.length > 0, ...);   // 只保证非空
assert.notEqual(check.disable, true, ...);
```
用户明确要求“保留全部真实检测命令”，但该测试无法防止命令被替换成恒真探针；`timeout` 和 `start_period` 也完全没被断言。

**实际影响**
“巡检降到 60s 但仍能发现故障”这个核心承诺，在当前测试里只覆盖了 interval/retries，没有覆盖“探针确实在检测真实依赖”。恒真探针会让 60s×3 的判定永远 healthy，且现有测试不会红。

**修复方向**
按服务断言具体命令（`pg_isready`、minio `wget/curl .../health/live`、api `fetch .../api/health/ready`、operations pid 文件、worker `worker-health.js --check`、web `wget --spider`、reader `fetch .../health`），并断言 `timeout` 与 worker 的 `start_period`。这是对本次需求最直接的回归保护，不是重构。

---

### [低] 性能结论的因果措辞略强，且一处读数主体不清

**文件/行号**
- `docs/performance-budget.md:5`
- `docs/current-runtime.md:3`

**触发条件**
读者把“Docker 每次健康探测完成会持久保存结果”当成已证实的机制；或把“读取平均 0.051 MB/s、该窗口物理读 0 字节”理解为互相矛盾。

**证据**
- 现场只抓到 dockerd 对 `.tmp-config.v2.json`/`.tmp-hostconfig.json` 的 `fsync`，没有证明“每个探针都会落盘”的因果链；不过 `48→6` 次/分钟与 Docker 进程写入 `0.834→0.095 MB/s`（约 8.8 倍）接近 8 倍，经验上强支持“探针落盘”是主因。文档已写了阵列/进程层级不可相加、短窗口、不承诺全天，所以 80.8% 这个数字本身不算夸大；偏强的是机制句。
- `current-runtime.md:3` 的“读取平均 0.051 MB/s，Docker进程写入0.095 MB/s、该窗口物理读0字节”没有写清“物理读 0”的主语（应为 dockerd 进程，而非阵列）。若读成阵列，会与 0.051 MB/s 的阵列读相矛盾；“均为阵列层计量”也加重了这层歧义。

**实际影响**
主要是证据表述问题，不改变“空闲写入显著下降”的结论；但会让后续审计误以为机制已直接证明，或误读读取量。

**修复方向**
把机制句改成实测推断，例如：“巡检结果落盘；Docker 进程写入从 0.834 降到 0.095 MB/s（约 8.8 倍），与探针次数 48→6（8 倍）方向一致”；并把“物理读 0 字节”明确写成“dockerd 进程物理读 0 字节”。`current-runtime.md:17` 已有的“读取不全部归因巡检”应保留并在最终段重复一次更稳妥。

---

### [低，待验证] `deploy:mac` 的服务健康等待固定 60 秒，与新默认巡检间隔相同

**文件/行号**
- `scripts/deploy-mac.mjs:137-148`（30 次 × 2s）、`:246-248`（对 web/worker 调用）
- `deploy/mac/docker-compose.yml:217-220`（worker interval 60s、start_period 60s）

**触发条件**
重建的 `web`/`worker` 首轮探针失败、第二次成功恰在 t≈60s，而 `up -d` 在 60s 探针前返回，且 `waitForServiceHealth` 的最后一次轮询早于该探针。`deploy:mac` 会以“did not become healthy”失败，尽管服务马上就会 healthy。

**证据**
`waitForServiceHealth` 的预算固定为 30×2s≈60s，没有读取 `SEKEREAGLE_HEALTHCHECK_INTERVAL`；新 interval 也是 60s。Docker 首次探针是立即执行的，所以正常启动通常不会命中；但 `worker` 有 `start_period: 60s`，若首次探针失败，第二次就是 60s，与轮询预算同量级。

**实际影响**
窄窗口的部署偶发失败，不是运行期故障。目前 `gateway` 依赖 api/web `service_healthy`，`up -d` 通常会被 api/web 的第二次探针拖到 ≥60s，worker 的 60s 探针多半已完成，所以我在快照内无法确认它实际会红——标注**待验证**。

**修复方向**
把等待预算与配置挂钩，例如 `max(60s, 3×interval + 30s)`；或改用 `docker compose up --wait`。若保持不变，至少加一个单测锁定“轮询预算不小于配置的 interval”，避免以后调大 interval 时把部署脚本调坏。

---

### [低，待验证] NAS 生产覆盖文件不在仓库内，无法确认 `SEKEREAGLE_HEALTHCHECK_INTERVAL` 在 NAS 上仍可覆盖

**文件/行号**
- `scripts/deploy-nas.mjs:120-135`（生成的 `.env` 只写固定 8 个键，不含该变量）
- `docs/current-runtime.md:15`（生产通过 NAS `maintenance/idle-io-20261103/health.json` 追加配置）
- `.env.example:36-38`

**触发条件**
运维在 NAS 上设置 `SEKEREAGLE_HEALTHCHECK_INTERVAL` 期望改变巡检频率；如果 `health.json` 里写死 `interval: 60s`，变量不会生效。

**证据**
仓库内 `deploy/mac/docker-compose.yml` 与 `deploy-nas.mjs` 的渲染都保留了 `${...:-60s}`，但生产实际链路用的是仓库外的 `health.json`；`prepareNasPackage` 生成的 `.env` 也不含该键（默认仍为 60s，所以不配置不会坏）。调用者证据说“新旧完整有效 Compose 除 healthcheck 外逐项相等”，但没有给出实际生效 Compose 里 interval 是插值还是字面量。

**实际影响**
默认 60s 不受影响；受影响的是“环境变量可调”这项要求在 NAS 生产上是否成立。属于需求完整性核验，不是运行故障。

**修复方向**
只读核对一次 NAS 生效 Compose 中该字段是否为 `${SEKEREAGLE_HEALTHCHECK_INTERVAL:-60s}`；若不是，把 `health.json` 改成插值形式，或在 `prepareNasPackage` 的 `.env` 中显式写入该键并在文档说明可编辑位置。

---

## 检查后未发现问题的部分

- **失败判定与启动语义**：`retries: 3` 即连续三次失败；稳态下下一次探针起算约 3 分钟标记，冷启动即故障约 2 分钟，文档“约三分钟”是合理近似。Docker 首探立即执行（`start_period` 只豁免失败计数），因此依赖链不会被额外拖满一个 interval 以上；NAS 启动脚本 `wait_for` 有 600s 预算，`deployCompose` 的 migrate 等待有 10 分钟预算，均不会被 60s 间隔压垮。
- **重启/策略保持**：7 个服务的 `test`、`timeout`、`start_period`、`restart`、`depends_on` 均未改；Docker 不会因 unhealthy 自动重启，实际重启仍走原 `restart` 策略。`operations` 的 `retries: 3`、worker 的 `start_period: 60s` 保持不变。
- **默认值覆盖**：`${SEKEREAGLE_HEALTHCHECK_INTERVAL:-60s}` 在未配置 `.env`、`create-local-env.mjs` 生成的 `.env`、`prepareNasPackage` 生成的 `.env` 下都得到 60s，不存在“缺变量导致 compose 启动失败”的问题；`.env.example` 有文档值，`compose:config` 可解析。
- **索引与查询语义**：`retiredObjectKeys.isEmpty=false` 与服务端 `recoverObjectCleanup` 的查询未变；部分索引只收录非空待清理键，不改变恢复/清理/回执流程，不清空历史、不建新队列。新索引只增不删，回退旧镜像仍兼容。仓库已有同类“部分索引只进 migration、不进 schema.prisma”的先例（`20261026020000_media_scheduler_cover_indexes/migration.sql:4`），因此这不是本次新引入的漂移模式；性能回归测试会在索引失效时以页数变红。
- **性能结论总体**：08:31（索引上线前）0.392 MB/s 与最终 0.386 MB/s 一致，Docker 进程写入 0.834→0.095 与探针 48→6 近似同比例，支持“写下降主要来自巡检降频”；文档已声明阵列/进程不可相加、短窗口、不承诺全天和硬盘休眠，并把 9 MB/s 的 `docker system df` 干扰单独列出、不藏样本。除上面机制措辞外，没有发现把结论夸大到“已消除全部空闲 I/O”的程度。
- **范围保持**：diff 未改 API/worker 业务源码、模型、依赖锁、认证或用户策略；未触碰百度容器与 SekerChat。

## 检查范围与限制

- 只读审查本快照（`.git/deepseek-reviews/.../snapshot`），未运行命令、未改文件、未调用其他代理；没有访问原工作区和 NAS 现场。
- 无法独立复核：生产镜像字节/依赖锁逐项一致、926340569 字节备份恢复、85→86 迁移 checksum、六容器实际状态、`md2` 读写原始样本、`docker system df` 进程身份；这些依赖调用者提供的运行证据。
- 无法在本机验证 Prisma 7.10.1 与目标 Docker 版本的运行时行为；相关结论以仓库现状和现有迁移能正常 deploy 的事实为限。
- NAS 生产实际 Compose 链位于仓库外 `maintenance/`，`health.json` 是否保留变量插值无法从快照确认（见最后一条问题）。

**一句话总结**：这次改动的功能方向、范围控制和测试证据总体靠得住，没有阻断性问题；真正需要补的是“并发索引建失败后怎么救”的可执行恢复步骤，以及把健康探针契约测试从“非空即通过”收紧到锁定真实命令，其余是性能表述和部署等待预算的小修。
