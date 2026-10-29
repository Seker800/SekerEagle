# SekerEagle 开发规则

## 接手现用系统

- 诊断、部署、重启或清理前，先读 `docs/current-runtime.md`；它记录现用群晖部署、Mac 模型依赖、独立任务及状态核验方式。历史安装手册不代表当前运行状态。
- 本地提交、远程分支、线上镜像分别核对；用户要求暂不推送／部署时继续遵守，不因合并到 main 自动发布。
- 改变部署、处理开关、长期任务或模型位置后，同步更新现用运行文档的核验日期与证据；动态进度从检查点读取，不把文档快照当实时值。

## 产品边界

- 开始产品设计或代码修改前，先读 `docs/architecture.md` 的 North star；素材／照片双模式的确定边界与执行计划分别见该文档和 `docs/photo-management-plan.md`。
- 素材与照片采用导入托管、业务完全隔离的双模式；不得引入双重归属或群晖外部目录图库；仅用户显式「发送到」可跨模式移动，必须创建独立目标资源并在成功后移除源模式可见项，亦不得仅用前端过滤实现隔离。
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

## 默认使用端与验收范围

- 用户默认使用网页端和桌面端。未特别说明时，产品设计、功能修复、交互与验收均以这两端为准，不默认转向手机端。
- 只有用户明确提到手机、安卓或移动端时，才将对应移动端列为本次范围；下方安卓固定图库约定仅在安卓任务中适用，不改变默认使用端。

## 安卓交互测试默认环境

- 人工／模拟器交互验收默认使用固定测试图库 <http://localhost:49813>，先读[安卓固定测试图库](docs/android-test-lab.md)；使用 `npm run android:lab:preview` 恢复预览，不为每次界面演示新建临时环境。
- 入口不可用时先运行 `npm run android:lab:status`，按固定图库文档恢复原服务；不得通过换端口、新建测试库或删除持久卷替代故障修复。
- 固定测试数据、账号、用户手工修改与 `.local/android-lab`、持久卷须保留；启动／更新不得重置或重新铺数据，也不得为让验收通过而回填用户删除的资源或覆盖修改。自动化回归继续隔离，不能以固定库为测试目标，结束后恢复固定预览。

## 多机计算调度

- 日常查看／调整计算节点先读 `docs/compute-fleet.md`。使用专用 MCP 的 `compute_status`／`compute_set_policy`；当前会话尚未加载 MCP 时，可用 `node apps/compute-coordinator/control.mjs status` 和 `policy <私有策略文件>`，不要输出凭据或用修改源码代替日常分工。
- 先读取当前修订，再提交有期限且不超过已验证容量的策略。节点停止接单不等于图库暂停；不能覆盖用户的类别暂停、时段、owner／模式或版本／租约守卫。
- 新节点、驱动、模型或能力先隔离验证再登记；不能靠伪造 Metal 状态、降低输入规格或跳过向量兼容验证接入。
