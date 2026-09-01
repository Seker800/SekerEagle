# 维护者接手指南

这份文档是接手 SekerEagle 的入口。它说明项目为什么存在、哪些边界不能破坏，以及日常
维护应从哪里开始。具体操作仍以链接的架构、运行和发布文档为准。

## 十分钟了解项目

SekerEagle 是独立、自托管、多用户隔离的个人素材库。PostgreSQL 保存业务事实，MinIO
保存对象，NestJS API 承载业务规则，可重试 worker 生成缩略图、预览、颜色和切片等派生
资源。React Web、Eagle 导入器和浏览器采集插件只通过同源 gateway 访问 API。Apple
Silicon 上可以启用独立的 MLX HTTP sidecar，生成本地多模态向量和人工标签建议；也可以
通过本机 Ollama 的 Qwen3-VL 8B Instruct 生成具体名词标签。两类 AI 能力默认都不运行。

当前项目处于 `0.1.x` 早期公开阶段。macOS + Apple Silicon 是完整验证路径；Linux/x64
尚不在完整支持矩阵内。API 和数据模型在次版本中仍可能变化，生产升级前必须备份。

先阅读：

1. [`architecture.md`](architecture.md)：北极星、依赖方向和核心不变量。
2. [`adr/0001-independent-runtime.md`](adr/0001-independent-runtime.md)：为什么必须使用独立运行时和空库重导。
3. [`operations-runbook.md`](operations-runbook.md)：启动、诊断和停止方式。
4. [`environment-model.md`](environment-model.md)：环境变量与安全目标。
5. [`../AGENTS.md`](../AGENTS.md)：本仓库的强制开发规则。
6. [`internationalization.md`](internationalization.md)：中英文词典、隐藏切换方式和错误本地化边界。

## 不能破坏的边界

- SekerEagle 不连接、迁移、修改或删除 SekerChat 的数据库、MinIO、Cookie、secrets 或用户数据。
- `ownerId` 只从认证主体推导，任何请求 DTO 都不能接受 `ownerId`。
- 跨 owner 访问返回 404，不泄露资源是否存在。
- 开发数据库名只能是 `sekereagle` 或 `sekereagle_test`；数据库和对象存储 host 只能是 loopback 或 Compose 服务名。
- 数据库名包含 `sekerchat`、目标包含 `192.168.31.89` 或 bucket 不符合 `sekereagle-` 前缀时必须 fail closed。
- migration、seed、测试和导入前必须经过安全目标检查。
- 不提交 `.env`、真实凭据、用户素材、数据库 dump、模型权重或运行日志。
- 不直接暴露 PostgreSQL、MinIO、API、MLX sidecar 或 Ollama；宿主机入口只能经过
  gateway。若 Docker Desktop 访问 Ollama 需要非 loopback 监听，必须由主机防火墙阻止
  局域网和公网访问其端口。

改动认证、上传、对象存储或 API 时，必须补充对应的安全测试。遇到“先临时绕过安全检查”
的方案应停止实现，重新设计边界。

## 目录地图

| 目录                         | 职责                                     | 常见改动入口                                    |
| ---------------------------- | ---------------------------------------- | ----------------------------------------------- |
| `apps/api`                   | NestJS API、认证、Prisma、素材与导入领域 | `src/eagle`、`src/auth`、`prisma/schema.prisma` |
| `apps/worker`                | 可重试媒体任务和对象存储派生资源         | `src/main.ts` 与媒体策略模块                    |
| `apps/web`                   | React/Vite 用户界面                      | `src/components/eagle`、`src/lib/eagle-api.ts`  |
| `apps/eagle-migrator`        | 独立 Eagle library/backup 导入 CLI       | `src/runner.ts`、journal 与 snapshot            |
| `packages/config`            | 运行时配置与安全目标校验                 | `src/index.ts`                                  |
| `packages/contracts`         | OpenAPI 生成契约                         | `openapi.json`、`src/generated/openapi.ts`      |
| `packages/eagle-filter-core` | API、Web 共用的筛选规则                  | `src/index.ts`                                  |
| `packages/vector-core`       | 向量校验、聚类和标签建议算法             | `src/index.ts`                                  |
| `plugins/eagle-importer`     | Eagle 桌面端导入插件                     | `js/` 与 `tests/`                               |
| `plugins/browser-capture`    | 浏览器采集扩展                           | `src/` 与 `tests/`                              |
| `services/mlx-embedding`     | 独立 GPLv3 MLX embedding sidecar         | `app/`、`tests/`、`pyproject.toml`              |
| `deploy/mac`                 | 本机 Compose 部署                        | `docker-compose.yml`                            |
| `scripts`                    | 安全门禁、生成、smoke、性能和维护脚本    | 先确认脚本是否已有对应流程                      |

依赖方向应保持为“适配器 → 应用服务 → 领域规则与窄端口 → 基础设施实现”。不要让领域
规则反向依赖 Controller、React、Prisma 或 MinIO 细节。

## 开发工作流

首次准备：

```sh
npm ci
npm run db:generate
npm run env:create
```

提交前的完整门禁：

```sh
npm run ci:check
npm run mlx:test
```

`ci:check` 已覆盖 lint、typecheck、unit test、build、格式检查和开源准备检查。只改非 MLX
组件时可以先运行受影响 workspace 的测试缩短反馈周期，但合并里程碑前仍要运行完整门禁。

常见命令：

```sh
npm run compose:config          # 检查 Compose 配置
npm run contracts:check         # 重新生成并检查 OpenAPI 契约
npm run smoke:auth              # 认证 smoke
npm run smoke:eagle             # 素材库 smoke
npm run performance:library:100k
npm run performance:media-memory
```

提交类型使用中文：`新增`、`修复`、`重构`、`清理`、`文档`。贡献者按
[`CONTRIBUTING.md`](../CONTRIBUTING.md) 使用 DCO sign-off。维护流程可以创建本地提交，
但不应自动 push。

## Schema、API 与生成文件

修改 Prisma schema 时：

1. 先确认目标数据库通过 `npm run db:guard`。
2. schema 与 migration 一起提交；不要修改已经发布的 migration。
3. migration 尽量 additive，保证旧 API、worker 和 Web 可以按文档顺序滚动升级。
4. 补 schema contract、owner 隔离和受影响服务测试。

修改 Controller、DTO 或 OpenAPI 装饰器后运行 `npm run contracts:check`。以下文件是生成物，
不应手工维护：

- `packages/contracts/openapi.json`
- `packages/contracts/src/generated/openapi.ts`

依赖版本变化必须同时提交对应 lockfile。不要在没有审查许可证边界的情况下加入新依赖、
模型或二进制产物。

## 媒体、任务与恢复原则

- PostgreSQL 是业务事实源，对象存储与任务状态通过幂等、可重试状态机最终收敛。
- worker 崩溃不能改变已提交的素材事实，也不能依赖内存状态才能恢复。
- 图库和大图预览不直接解码原图；修改预览、缩略图或金字塔策略前阅读
  [`media-memory-operations.md`](media-memory-operations.md)。
- 影响十万级图库查询、索引或前端窗口化时，阅读并重新验证
  [`performance-100k-library.md`](performance-100k-library.md)。
- 清理任务必须有界、可恢复，并明确区分业务记录、派生对象和原始素材。

## 部署、备份与发布

本机部署、管理员创建、MLX 健康检查和停止命令见
[`operations-runbook.md`](operations-runbook.md)。`docker compose down` 默认保留 volume；
不得把 `-v` 当作普通停止步骤。

发布前：

1. 按 [`open-source-release-checklist.md`](open-source-release-checklist.md) 完成权属、安全、可复现和发布检查。
2. 验证空库安装、管理员登录、上传、重启恢复以及数据库/对象存储备份恢复。
3. 更新 [`../CHANGELOG.md`](../CHANGELOG.md)，统一版本号并生成实际发布物的 SBOM。
4. 保留根目录 Apache-2.0 与 MLX sidecar GPL-3.0-only 的边界及第三方 notices。
5. 使用正常的分支或 tag 推送；不要使用 `git push --mirror` 或 `git push --all` 发布本地工具 refs。

## 来源与许可证

SekerEagle 从维护者拥有的 SekerChat 实现中干净复制并独立演进，详细边界见
[`provenance.md`](provenance.md) 和 [`extraction-inventory.json`](extraction-inventory.json)。项目由
维护者主导开发，部分代码使用 AI 工具辅助生成和审查；来源审计未发现已知的未经许可
第三方源码拷贝。

除 `services/mlx-embedding` 外，项目代码按 Apache-2.0 发布。MLX sidecar 因直接使用
GPLv3 依赖而按 GPL-3.0-only 单独发布。依赖、模型与二进制边界见
[`../THIRD_PARTY_NOTICES.md`](../THIRD_PARTY_NOTICES.md)。新增依赖时应检查直接依赖、传递
依赖和最终发布物，而不是只看 package manifest。

## 已知限制

- 当前完整支持路径是 macOS + Apple Silicon；Linux/x64 尚未完成产品级验证。
- MLX 向量与 Ollama 自动标签依赖宿主服务、本机模型和 Metal，不是所有部署的必选能力。
- 项目仍处于 `0.1.x`，API 和数据模型可能在次版本变化。
- 公开互联网部署、托管 SaaS、多节点高可用和跨地域恢复不属于当前验证范围。
- 发布负责人仍需对实际发布 artifact、模型权重和商店插件包分别做许可证与隐私检查。

## 交接检查表

交接前由现任维护者和接任者共同确认：

- [ ] 接任者能从空库完成启动、创建管理员、登录、上传和重启恢复。
- [ ] 接任者理解 owner 隔离、404 语义和 SekerChat 隔离红线。
- [ ] `npm run ci:check` 与 `npm run mlx:test` 在受支持环境通过。
- [ ] GitHub 分支保护、安全扫描、漏洞私密报告和发布权限已交接。
- [ ] 生产数据库、对象存储、域名、证书、备份和恢复责任人明确。
- [ ] 当前版本、未发布变更、已知限制和回滚方式已记录。
- [ ] 凭据通过安全渠道重新签发，不通过仓库、Issue、聊天记录或旧 `.env` 交接。
- [ ] 下一阶段目标、明确不做的事项和需要重新评审的架构决策已记录。

若实现与本文冲突，先判断是否违反架构不变量。属于行为变化时，应在同一个变更中更新
代码、测试、ADR/架构文档和本指南，避免文档成为历史快照。
