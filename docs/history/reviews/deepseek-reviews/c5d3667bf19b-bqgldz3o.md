# DeepSeek 独立审核

- 状态：report_received
- 提交范围：`648e05434fa82558be2e7b2fb294a245adf0742d..c5d3667bf19b41ba35454fc82c75232406658a13`
- 完成时间（UTC）：2026-11-01T01:45:53.665475+00:00
- 本地审查记录：`/Users/seker/seker-workspace/SekerEagle/.git/deepseek-reviews/c5d3667bf19b-bqgldz3o`

报告仅针对上述提交，是独立建议，不是推送门禁，也不代表当前工作区已通过审核。

# 独立只读审查报告：编辑保存修复与发布记录

## 一、审查范围与限制

- 只看固定提交范围 `648e0543..c5d3667b` 的差异及快照内相关上下文，重点覆盖上传发布事务、完成竞态、前端保存重试、错误码文案、环境变量与验收探针。
- 只读审查：未运行测试、未执行 SQL、未启动 API/镜像、未读取 `.omx` 验收物、未读取 NAS 私有 compose 或生产实时状态。任务描述中的 1200ms 响应、75 迁移、真实 S3/Chrome/Electron 验收、117 个 worker JS 一致、生产发布进度均**未由本次审查独立验证**。
- 安卓/原生编辑器不属于本次默认使用端范围；我只检查了共享 `PhotoEditor` 的行为是否影响 Web/桌面链路。

---

## 二、问题清单

### 1. 【中低】失败收尾写库未兜底，可能把具名 503 变成 500

**文件与行号**：`apps/api/src/eagle/eagle-upload.service.ts:700-722`（尤其 `704-717` 的 `updateMany` 与 `718-722` 的抛出）。

**触发条件与证据**：代码先把 `P2024`（连接池等待超时）列为 `temporarilyBusy`，但在抛出 `ServiceUnavailableException` 之前又执行了一次 `this.prisma.uploadSession.updateMany(...)`，且没有 try/catch。若原始错误就是 `P2024`，此时连接池已经耗尽，这条收尾写库很可能再次 `P2024`；原始错误和具名 503 都会被这次写库的异常覆盖。`eagle-upload-publication.test.ts:18-47` 的失败测试只使用了可正常返回的 mock `updateMany`，没有覆盖 `P2024`/连接不可用的收尾路径。该结论来自代码路径，**未在真实池耗尽环境复现，标注为待验证**。

**实际影响**：用户看到的是通用 500 而不是“图片已上传，保存暂时繁忙，请重试保存”，会话也不会被标记 `FAILED`，前端不会显示具名原因和重试入口。上传对象仍在、不丢数据，后台恢复仍可能最终发布，但本次修复的预期 UX 在该场景失效。

**修复方向**：把收尾写库改为 best-effort（`try/catch` 吞掉收尾错误，必要时用日志记录），无论收尾是否成功都抛出 `ServiceUnavailableException`；同时补一条 `P2024` 的单元测试。这样即使池耗尽，用户也能拿到稳定错误码。

---

### 2. 【低，机制待验证】`statement_timeout` 与 Prisma 事务 timeout 相同，探针无法证明服务端 SQL 被取消

**文件与行号**：`apps/api/src/eagle/eagle-upload.service.ts:409-412, 691`；`scripts/testing/upload-publication-probe.mjs:44-46, 79-95`。

**触发条件与证据**：事务内 `set_config('statement_timeout', budget, true)` 与 Prisma `$transaction(..., { timeout: budget })` 使用同一个数值。锁等待超过预算时，两者谁先触发并不确定。探针只断言响应耗时接近预算、返回 503、数据库没有新增副本，**没有观察 `pg_stat_activity` 或事务是否消失**；因此 1222–1226ms 的实测结果无法区分“PostgreSQL 57014 取消了 SQL”与“Prisma 客户端计时先到期、服务端锁等待仍在继续”。文档称“避免仅 Prisma 计时到期而仍无限等待锁”，这一关键收益尚未被该探针直接证明。

**实际影响**：用户侧仍然在预算附近拿到 503；但若 Prisma 计时先赢，服务端 `pg_advisory_xact_lock` 可能继续等待，锁/连接占用并未按预期释放。这与文档宣称的机制存在差距，属于**待验证**项，不是已确认的数据错误。

**修复方向**：让 statement_timeout 略小于 Prisma timeout（例如预算减 200–500ms），确保 SQL 取消是确定原因；或在探针返回 503 后查询 `pg_stat_activity`，确认没有该会话的等待事务，再宣称“取消 SQL”。

---

### 3. 【低】忙碌失败不再消耗次数后，现有 60 秒恢复服务会无限自动重试且对象永不进入清理

**文件与行号**：`apps/api/src/eagle/eagle-upload.service.ts:711-717`；`apps/api/src/eagle/eagle-upload-recovery.service.ts:66-82, 119-128`。

**触发条件与证据**：忙碌错误不递增 `finalizationAttempts`，而恢复服务每 60 秒筛选 `status in ('ASSEMBLED','FAILED')` 且 `finalizationAttempts < 10` 的会话自动重新发布；对象清理的终态分支只在 `finalizationAttempts >= 10` 时触发。若锁竞争或连接问题持续存在，同一会话会每分钟重试一次，每次都再做 HEAD + 检查 GET，且上传对象永远不会进入清理。

**实际影响**：这可能是符合“忙碌不消耗恢复次数、保留对象供重试”的有意设计；但它把原来 10 次后终止的行为改成无界自动重试，且文档只描述了“用户重试”，没有说明后台恢复也会自动发布。资源影响有限（每分钟一条会话），但没有测试覆盖恢复服务与该分支的交互。**标注为待确认设计意图**。

**修复方向**：确认是否接受无界自动恢复；若不接受，可让忙碌失败不进入自动恢复，或单独记录忙碌次数/退避；无论哪种，都建议在文档和测试中写明该交互。

---

### 4. 【低，待确认】CREATE_COPY 不再参与哈希互斥锁，普通去重导入的并发去重语义变窄

**文件与行号**：`apps/api/src/eagle/eagle-upload.service.ts:550-555`。

**触发条件与证据**：旧代码对所有非替换发布先取 `pg_advisory_xact_lock(owner:mode, sha256)`；新代码仅普通去重导入取该锁，显式 `CREATE_COPY` 跳过。普通导入的“查已存在 → 创建”仍在该锁内，但不再与编辑副本的创建串行。若普通导入的字节与正在发布的编辑成片完全相同，导入的查重可能看不到尚未提交（或刚提交但快照未读）的副本，从而多建一条重复资源。旧代码在该竞态下会先等待副本事务完成，再命中查重。

**实际影响**：仅影响“完全相同字节的普通导入与编辑副本并发”的窄窗口，结果是多一条重复记录，不丢数据、不越权、不泄露；文档只写了“显式 CREATE_COPY 不做哈希去重”，没有说明跨策略串行也被去掉。**属于可接受或需确认的行为变化**。

**修复方向**：若仍希望普通导入与编辑副本在查重上串行，保留 CREATE_COPY 的哈希锁（或把查重锁与去重策略解耦）；否则在文档中明确这是有意的行为变化即可。

---

### 5. 【低，测试缺口】跨进程 `claimed.count !== 1` 分支和事务预算 SQL 未被默认测试真实覆盖

**文件与行号**：`apps/api/src/eagle/eagle-upload.service.ts:326-336, 432-446`；`apps/api/src/eagle/eagle-upload-publication.test.ts:8-16, 142-158`；`scripts/testing/photo-workbench.mjs:602-611`。

**触发条件与证据**：

- 探针向同一个 API 进程并发发两个 complete 请求，但 `finalizeAssembled` 的进程内 `finalizations` Map 会把它们合并成同一个 Promise（`eagle-upload.service.ts:326-336`）。因此真实数据库从未走到“认领失败 → 读取已完成会话”的新分支；该分支只由 `eagle-upload-publication.test.ts` 用 mock 事务覆盖。
- `eagle-upload-publication.test.ts:8-16` 只断言 `$transaction` 的 `timeout` 选项；第一个测试的事务回调根本没有执行，因此没有任何默认测试断言 `set_config('statement_timeout', ...)` 这条关键 SQL。真实 SQL 取消只由 opt-in 的 `PHOTO_WORKBENCH_UPLOAD_PUBLICATION=1` 探针覆盖。
- `P2024`/`P2034` 的忙碌分类、以及 57014 情况下“不递增 `finalizationAttempts`”的断言在单元测试中缺失（57014 测试只断言异常类型）。
- 探针在 503 后没有断言 `failed.finalizationAttempts === 0`，而这是文档的核心承诺之一。

**实际影响**：若有人删掉 `set_config`、改动认领/COMPLETED 查询或把某类错误移出忙碌集合，默认测试套件仍可能通过；跨进程竞态修复和 SQL 预算主要依赖人工探针。

**修复方向**：补默认测试断言事务选项与 `$executeRaw` 的 SQL 内容；补 `P2024`/`P2034` 分类及 57014 下 attempts 不变的测试；探针中增加 `finalizationAttempts` 断言；如需证明跨进程竞态，可在探针里用第二个 Prisma 客户端/手动事务先认领会话并提交，制造真实的 `claimed.count === 0`。

---

### 6. 【低，测试脚本】探针的 `expectBusy` 阈值与持锁时长不一致，可能误报失败

**文件与行号**：`scripts/testing/upload-publication-probe.mjs:44-46`。

**触发条件与证据**：`const expectBusy = budget < 5000;` 而 `const holdMs = 6500;`。当 `EAGLE_UPLOAD_PUBLICATION_TIMEOUT_MS` 取 5000–6500（例如 6000，属于合理的调优值）时，API 会在预算处取消并返回 503，但探针因为 `budget < 5000` 为假而进入成功分支，断言 201，从而误报失败。预算正好 5000 时同样不一致。

**实际影响**：仅影响验收脚本的可信度；默认 30000 和文档中的 1200 两个取值不受影响。

**修复方向**：改为 `const expectBusy = budget < holdMs;`，或根据 `holdMs` 与预算的关系推导预期，而不是写死 5000。

---

## 三、已核对、未发现依据问题的部分

- **认领先于来源校验的重排**：隐私锁仍最先获取；`loadEditedCopySource` 的 owner/模式/未删除/`rowVersion` 校验完整保留；认领失败后的 COMPLETED 查询带 `uploaderId + libraryMode + status`，返回的是同一会话已提交的副本，未发现跨 owner/模式泄露或绕过版本校验。
- **忙碌回滚与重试链路**：`objectCleanupPending: false`、不递增 attempts 的实现与需求一致；前端 `pendingSaveRef` 复用同一 `File`，`eagle-api.ts` 的保留会话/分片复用逻辑保证不重建上传会话、不重传已成功分片；保存失败后按钮改为“重试保存”，加载失败仍“重新加载”，定位失败重试定位，现有 409 来源冲突路径仍隐藏重试按钮，未见误导性重试。
- **错误码与文案**：`UPLOAD_PUBLICATION_BUSY` 在中英文 `ERROR_CODE_MESSAGES` 中均有映射，两个 locale 文件键完全对齐；503 响应体只含稳定 code 与用户文案，未暴露 Prisma/SQL 细节。
- **部署与配置**：新环境变量有安全默认 30000，`.env.example` 与 `deploy/mac/docker-compose.yml` 已同步，API 服务确实使用该锚点；未新增迁移，未改动 worker 源码，未新增产品限额。
- **探针关键点**：持锁 SQL 的 `sekereagle:privacy:${ownerId}:${libraryMode}` 与 `lockOwnerPrivacyProjection` 一致；断言了一份副本、源图 sha/rowVersion 不变、owner/模式归属正确。

**其他限制**：仓库全量测试、架构/契约门禁、成品镜像与 worker 哈希一致性、真实大图 p95、生产发布及双端验证均未在本审查中独立复核；文档中的实测数字按调用者提供看待，不作为已证实结论。

---

## 四、一句话总结

总体修复方向正确：发布事务预算、认领失败返回已完成副本、忙碌不消耗恢复次数，以及前端按失败类型重试，未发现会丢数据或越权的明确缺陷。最值得处理的是错误收尾写库可能把具名 503 变成 500（问题 1），其次是 statement_timeout 与 Prisma 超时同值导致的机制未证实（问题 2），以及跨进程分支和 SQL 预算未被默认测试真实覆盖（问题 5）。
