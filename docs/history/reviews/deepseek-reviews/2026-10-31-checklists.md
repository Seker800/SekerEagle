# 2026-10-31 独立审查问题汇总与修复核对清单

> 历史核对快照，以下状态对应所列基线，不代表当前待办或发布门禁。2026-11-01 复核仅修订 D1 为误报，其余条目未经本轮逐项重验，不能据旧 ❌ 推断现状。原始独立报告保持原文。

- 来源：`docs/deepseek-reviews/` 下今天（本地时间 10-31）落地的 7 份独立审查报告，共 **28 条**问题（含 1 条含 3 个子项）
- 核对基线：`main` @ `edf680c5`（16:31）＋ 工作区未提交改动（27 个文件，+1504/−346）
- 核对方式：逐条静态检索/阅读当前代码与文档；**未运行测试、未连生产、未跑设备**
- 状态图例：`✅ 已修` / `🟡 部分` / `🔧 进行中（未提交）` / `❌ 未修` / `❓ 待核验`

---

## 一、R1 `d8a4d8cf`（00:58）安卓 2B 搜索／日期窗口

范围 `8fcd2265..d8a4d8cf`｜报告：[d8a4d8cf6866-_els8b5b.md](d8a4d8cf6866-_els8b5b.md)

| # | severity | 问题 | 状态 | 核对依据 |
|---|---|---|---|---|
| A1 | 高 | 稀疏/零命中搜索仍全库扫描，过网关 15s 变 504；无服务端时间预算、候选批次仍 250 | ❌ | `apps/api/src/eagle/eagle-image-search.service.ts:123` 仍无 deadline/窗口上限；`apps/api/src/eagle/eagle.service.ts:559` `candidateBatchSize = 250`；API 无全局 `statement_timeout` |
| A2 | 中 | 结构化筛选把整份合格 ID 物化成数组，每个日期窗口重复绑定 | ❌ | `eagle.service.ts:548` 仍 `hasStructuredFilters` → `eligibleAssetIds` 数组，`:569` 传入 `rankPage` |
| A3 | 中 | UNAVAILABLE 降级提示放在网格末尾、无 live region，长结果看不见也读不到 | ❌ | `NativeGalleryScreen.kt:363` 仍是 `items` 之后的尾部 `item(...)`，无 `liveRegion`/`role` |
| A4 | 低 | 三处测试/注释缺口：UNAVAILABLE+日期无结果级用例；安卓 mock 对任意查询返回同项；索引注释 "without heap visits" 不实 | ❌ | `apps/api/prisma/migrations/20261030160000_private_photo_search_order/migration.sql:3` 注释未改；`NativeSearchTest.kt` 未见按查询分支的 mock |

## 二、R2 `eb2425821277`（01:21）安卓智能文件夹多选发送

范围 `d8a4d8cf..eb2425821277`｜报告：[eb2425821277-4c0wn12l.md](eb2425821277-4c0wn12l.md)

| # | severity | 问题 | 状态 | 核对依据 |
|---|---|---|---|---|
| B1 | 中 | 提前离开进度页、操作在后台终态完成后，图库不刷新，源项卡片仍可见 | ❌ | `NativeGalleryViewModel.kt:852` 只在关闭传输页时 `refresh()`；发送受理后只 `invalidateInactiveLibrary()`（`:1101`） |
| B2 | 低 | 队列卡片无 queued/running 数量、无重试/取消入口；文档说法高于实现 | ❌ | `NativeTransferScreen.kt` 无排队/进行中计数与操作按钮；`apps/android/…/docs` 中 `docs/android-client.md:7` 仍写"进行中数量" |
| B3 | 低 | 设备测试 `await` 后立即断言"已完成 0/2"，存在时序 flaky；失败/取消路径无覆盖 | ❌ | `NativeReviewTest.kt:179` 仍是 `await` 后直接 `assertExists()` |
| B4 | 低 | 幂等键仅存内存，进程被杀换新 operationId；文档未限定"仅进程内" | ❌ | `docs/android-client.md:7` 仍写"未确认提交的重试复用操作编号"，无进程内限定 |

## 三、R3 `af2c7384c065`（01:29）安卓 0.9.13 发布文档

范围 `eb2425821277..af2c7384c065`｜报告：[af2c7384c065-r415o8yk.md](af2c7384c065-r415o8yk.md)

| # | severity | 问题 | 状态 | 核对依据 |
|---|---|---|---|---|
| C1 | 中 | "可覆盖安装、保留账号与缓存"缺签名证书摘要或实测证据 | ❌ | `docs/android-production-release-2026-10-31.md:11` 仍为直接断言，无 `apksigner` 证书 SHA-256 |
| C2 | 低 | 发布记录未写"未触及 SekerChat" | ❌ | 该记录全文无 SekerChat 表述 |
| C3 | 低 | `.sha256` 与 `latest.json` 实际内容未记录，校验文件名可能不匹配 | ❌ | `:8-9` 只有下载链接，无清单字段/校验行内容 |
| C4 | 低 | 发布物是可调试 debug 包，文档只写"调试签名" | ❌ | 无 `android:debuggable=true` 披露 |

## 四、R4 `4ac84da695a8`（15:38）整合代码审查

范围 `af2c7384c065..4ac84da695a8`｜报告：[4ac84da695a8-5iltvzpe.md](4ac84da695a8-5iltvzpe.md)

| # | severity | 问题 | 状态 | 核对依据 |
|---|---|---|---|---|
| D1 | 高（原报告） | 独立 operations 进程 `import 'reflect-metadata'` 晚于装饰器模块，可能启动即崩 | 误报 | 2026-11-01 核对锁定的 NestJS common 11.2.7，其入口已先 `require("reflect-metadata")`；仅凭执行器显式 import 的文本顺序不能成立该故障。原报告保留，不计入当前未修问题。 |
| D2 | 中 | 查重多页刷新沿用旧 `revision` 请求第 2 页，清理后可能持续 409 | ❌（部分缓解） | `apps/api/src/eagle/eagle-duplicates.service.ts:59` 仍逐页强校验；`EagleDuplicates.tsx:104` `getNextPageParam` 仍固化 revision；新增 `hiddenGroups` 本地隐藏只改变展示 |
| D3 | 低 | 查重写路由未纳入长超时 location，隐私锁等待可超网关 15s | ❌ | `deploy/gateway/nginx.conf:73` 长超时仅覆盖 `operations|retry|batch/send` |
| D4 | 低 | 准入期 `NOT_FOUND` 项重试必然误报 `ASSET_CHANGED`，无法恢复 | ❌ | `eagle-asset-operations.service.ts:563` 仍以 `snapshots: []` 落库，`:1010` 用空 `ids` 与解析结果比较 → 冲突 |
| D5 | 中 | 旧 Mac worker 无 `storageTransferredOut` 保护，会删掉接管目标共享的原件；无部署门禁 | ❌ | 保护只在 `apps/worker/src/asset-purge.ts:42`（新 worker）；`deploy/mac/docker-compose.yml` 无 worker 版本/心跳门禁，仍靠人工顺序 |

## 五、R5 `f536cef612d2`（16:06）生产发布记录（文档 push）

范围 `4ac84da695a8..f536cef612d2`｜报告：[f536cef612d2-88wntj48.md](f536cef612d2-88wntj48.md)

| # | severity | 问题 | 状态 | 核对依据 |
|---|---|---|---|---|
| E1 | 中 | Mac worker PID 倒挂（旧 17421 → 新 15629）未解释，无法判断"旧进程正常退出" | ❌ | `docs/current-runtime.md:3` 仍为 15629；同日条目 `:25`、`:29` 仍写 17421，无重启说明或 worker 心跳 |
| E2 | 低 | 新 web 镜像里安卓三文件的注入方式未记录，回滚段未覆盖 | ❌ | 发布记录只给下载链接，无复制/构建参数说明；回滚段未提 `/downloads` 三文件 |
| E3 | 低 | `test:api-image --storage-check` 缺镜像标签，按原文不可复现 | ❌ | `docs/production-release-2026-10-31.md:27` 原样 |
| E4 | 低 | `4ac84da6` 与 `22ac5261` 的父子关系表述互相矛盾 | ❌ | 同文件 `:8-9` 未改：仍把 `4ac84da6` 同时当"网关修订提交"和"之后还有网关变化"的基准 |

## 六、R6 `f4154139fe87`（16:22）删除结果自动同步

范围 `f536cef612d2..f4154139fe87`｜报告：[f4154139fe87-blzoqcoy.md](f4154139fe87-blzoqcoy.md)

| # | severity | 问题 | 状态 | 核对依据 |
|---|---|---|---|---|
| F1 | 高 | 并发在途读会让最后一次发布被跳过/取消且不补读，已删卡片留在列表且无手动入口 | 🔧 | `apps/web/src/components/eagle/asset-operation-refresh.ts` 已改为读 `/operations/:id/results` 回执并本地投影成员、不再重取列表页（未提交，含新增 API `results`）；行为与回归尚未验证 |
| F2 | 中 | 首次观察到的终态操作不触发刷新（重挂载/切模式，5 分钟 staleTime 内） | ❌ | `useAssetOperations.ts:112` 仍要求 `previous.current[index] !== undefined`，首个快照只建基线 |
| F3 | 低 | 失效 predicate 过宽：分页关系查询与刚删除资源详情也被重取 | 🟡 | `refreshMetadata` 已排除 `assets` 分页查询；`people/options`、facets、asset-detail 仍 `refetchType:'active'` |
| F4 | 低 | 旧成本记录仍写"用户主动加载更新"；遗留无引用 i18n 键 | ❌ | `docs/asset-operation-efficiency-2026-10-31.md:14,32` 原样；`apps/web/src/i18n/messages/zh-CN.ts:105-106`、`en-US.ts:109-111` 键仍在 |

## 七、R7 `ce2b0f14d573`（16:28）两份新验收文档

范围 `f4154139fe87..ce2b0f14d573`｜报告：[ce2b0f14d573-rpti8aku.md](ce2b0f14d573-rpti8aku.md)

| # | severity | 问题 | 状态 | 核对依据 |
|---|---|---|---|---|
| G1 | 低 | 架构北极星与旧成本记录仍写"本地候选/手动加载"，与现网行为冲突 | ❌ | `docs/architecture.md:21` 仍为"（本地候选）…尚未完成生产切换" |
| G2 | 中 | 多页删除的真实游标重取无回归；`performance-budget.md` "游标按新结果重建"与实现不符 | ❌ | `docs/performance-budget.md:61` 原样；新方案不再重取列表，该措辞需重写而非保留 |
| G3 | 低 | "完整 955 项"与"六项进度测试"的计数关系不清 | ❌ | `docs/deletion-auto-sync-2026-10-31.md:17` 原样 |

---

## 统计

| 状态 | 数量 | 条目 |
|---|---|---|
| ❌ 未修 | 26 | A1–A4、B1–B4、C1–C4、D1–D5、E1–E4、F2、F4、G1–G3 |
| 🟡 部分 | 1 | F3 |
| 🔧 进行中 | 1 | F1 |
| ✅ 已修 | 0 | — |

## 未修项按性质分组

- **可能导致错误而非变慢**：A1（504 长尾）、D1（执行器启动即崩）、D4（重试永久失败）、D5（误删接管原件）
- **可能让用户看到过期数据**：B1、D2、F2
- **文档与实现不一致（可复现性/交接风险）**：C1–C4、E1–E4、F4、G1、G3
- **测试证据缺口**：A4、B3、G2

## 核对限制

- 只做静态核对，未运行 lint/typecheck/unit/设备测试，因此"是否已修"是代码与文档现状判断，不等于行为已验证。
- 工作区存在 27 个未提交文件（`/operations/:id/results` 回执投影为主），F1/G2/D2 的最终结论需等该批改动提交并跑完回归后再定。
- R1–R3 三份报告针对 10-30 夜间的安卓与搜索改动，其涉及文件此后未被再次修改，故按原样判为未修。
