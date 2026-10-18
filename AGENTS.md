# SekerEagle 开发规则

## 产品边界

- 开始产品设计或代码修改前，先读 `docs/architecture.md` 的 North star；素材／照片双模式的确定边界与执行计划分别见该文档和 `docs/photo-management-plan.md`。
- 素材与照片采用导入托管、业务完全隔离的双模式；不得引入双重归属、跨模式转换或群晖外部目录图库，亦不得仅用前端过滤实现隔离。
- 本仓库是独立的 SekerEagle，不依赖 SekerChat 运行时、数据库、MinIO、Cookie 或 secrets。
- SekerChat 是完全受保护的外部系统。不得从本仓库连接、迁移、修改或删除 SekerChat 数据。
- 所有用户资源必须由认证主体推导 ownerId；DTO 不接受 ownerId。
- 跨 owner 访问统一返回 404，不泄露资源是否存在。

## 数据安全

- 开发数据库名只能是 `sekereagle` 或 `sekereagle_test`。
- 数据库和对象存储 host 只能是 loopback 或 compose 服务名。
- 任何包含 `sekerchat` 的数据库名、`192.168.31.89` 或未知 bucket 必须 fail closed。
- migration、seed、test、import 前必须先运行安全目标检查。
- 禁止提交 `.env`、密码、token、access key 或 restic secrets。

## 工程要求

- Node.js 22、npm workspaces、NestJS、React/Vite、Prisma。
- 修改认证、上传、对象存储或 API 时必须补安全测试。
- 每个里程碑至少运行 lint、typecheck、unit test 和 build。
- 素材／照片通用能力变更必须通过 `npm run architecture:check` 与共用契约测试；不得通过新增照片版通用组件、覆盖通用 Controller 或替换共用 provider 绕过门禁。新增专属能力或调整装配边界时，先更新北极星与 `docs/library-sharing-gate.md` 的理由，再同步门禁及反例测试。
- 使用中文提交类型：`新增`、`修复`、`重构`、`清理`、`文档`。
- Agent 可自行判断并执行提交与 push，无需另行征求用户许可。
