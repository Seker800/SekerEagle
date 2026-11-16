# 接手入口（Start here）

> 状态：现行 | 核验日期：2026-11-16 | 对应提交：93b5d583
>
> 这份文档只回答三个问题：现在跑什么、先读什么、第一条命令是什么。具体设计边界见
> [architecture](architecture.md)，现用部署事实见 [current-runtime](current-runtime.md)。

SekerEagle 是**多用户、自托管**的素材与照片管理工具。每个账号由认证主体推导 `ownerId`，
数据按 owner 隔离，跨 owner 访问返回 404；账号由管理员创建，不对外公开注册。默认使用端是
网页和桌面。

## 先读这 5 份

1. [`AGENTS.md`](../AGENTS.md)：红线、数据安全、提交与验收规则。
2. [product-frame.md](product-frame.md)：产品定位、优先级和“不做什么”。
3. [architecture.md](architecture.md)：只读 North star、能力归属和 Invariants。
4. [current-runtime.md](current-runtime.md)：现用部署、核验命令和回退位置。
5. [operations-runbook.md](operations-runbook.md)：从新环境启动、诊断和停止。

需要查词时看 [glossary.md](glossary.md)；查进程、路由和刷新入口时看
[process-map.md](process-map.md)、[route-map.md](route-map.md)、[refresh-map.md](refresh-map.md)。

## 五类进程

| 进程                 | 代码入口                                           | 启动 / 更新                                                                    | 负责什么                                                                   | 不负责什么                          |
| -------------------- | -------------------------------------------------- | ------------------------------------------------------------------------------ | -------------------------------------------------------------------------- | ----------------------------------- |
| API                  | `apps/api/src/main.ts`                             | Compose `api`；本地 `npm run start:dev --workspace @sekereagle/api`            | 认证、owner／模式隔离、查询、上传受理、任务查询                            | 不执行后台轮询、不领取媒体任务      |
| operations           | `apps/api/src/asset-operation-executor.ts`         | Compose `operations`；`npm run start:operations --workspace @sekereagle/api`   | 用户批量操作、上传终结、恢复、维护、查重；同一文件还装配上传恢复／维护宿主 | 不提供 HTTP 接口                    |
| library-reader       | `apps/api/src/library-reader.ts`                   | Compose 叠加文件 `deploy/mac/docker-compose.library-reader.yml`；内部端口 3001 | 可重建的内存读取投影、统计／人物数／筛选分页                               | 不拥有业务写入或模型推理            |
| 业务 worker          | `apps/worker/src/main.ts`                          | Compose `worker`，或 Mac launchd 的 `.runtime/business-worker/releases/...`    | 领取持久媒体任务：缩略图、预览、颜色、金字塔、向量、人脸、清理             | 不改写已提交的业务事实；不提供 HTTP |
| 计算协调器／媒体节点 | `apps/compute-coordinator/main.mjs`、`control.mjs` | `npm run start --workspace @sekereagle/compute-coordinator`                    | 计算节点登记、策略、远程媒体／人脸执行                                     | 不保存图库数据、不拥有业务表        |

**不要混淆**：Compose 里的 `worker` 服务与现网 Mac launchd 的业务执行器不是同一个东西。
现网实际跑哪一个、镜像和 release 是什么，以 [current-runtime](current-runtime.md) 为准；
进程职责和启停方式见 [process-map](process-map.md)。

## 三条阅读路径

- **产品／交互**：`product-frame` → `architecture` 的「前端工作区」→ `route-map` → `refresh-map`。
- **后端**：`architecture` 的「能力归属」「进程与写入」「Invariants」→ `library-sharing-gate`
  → `background-work` → `performance-budget`。
- **前端**：`route-map` → `refresh-map` → `eagle-workspace-cache.ts` → `SekerEaglePage.tsx`
  及其周边 hook。

## 第一条命令

已有 `.env` 时不要重跑 `env:create`；完整环境变量说明见 [environment-model](environment-model.md)。

```sh
npm ci
npm run db:generate
npm run env:create
npm run deploy:mac:check
npm run deploy:mac
```

只想在本机跑源码：

```sh
npm run start:dev --workspace @sekereagle/api
npm run dev --workspace @sekereagle/web
```

## 验证

```sh
npm run smoke:auth
npm run smoke:eagle
npm run ci:check          # 完整门禁：lint、typecheck、test、build、contracts、架构
```

真实数据库与 MinIO 测试用 `npm run test:library-integration`；测试范围和额外依赖见
[testing.md](testing.md)。不要用单元测试冒充真实数据库或生产验收。

## 改代码前先确认

- 写操作走控制器 → `EagleAssetOperationService` 的 operations 队列，不要直接调用
  `EagleService` 的写方法。
- `/eagle` 是 MATERIAL，`/photos` 是 PHOTO；路由映射见 [route-map](route-map.md)。
- 新增进程、能力或任务种类时，同步更新本页的进程表、`library-capabilities.ts` 和
  `docs/library-sharing-gate.md` 的边界说明。
