# 进程与执行宿主（Process map）

> 状态：现行 | 核验日期：2026-11-16 | 对应提交：319c087a
>
> 本文说明“代码里的进程是什么、谁启动、谁更新”。**现网实际镜像、容器和 release 以
> [current-runtime](current-runtime.md) 为准**；本文不复制动态部署状态。

| 进程            | 代码入口                                           | 常见运行位置                                                                | 启动 / 更新                                                                                                          | 负责                                                           | 不负责                                       |
| --------------- | -------------------------------------------------- | --------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- | -------------------------------------------- |
| API             | `apps/api/src/main.ts`                             | Compose `api`                                                               | 构建 API 镜像；本地 `npm run start:dev --workspace @sekereagle/api`                                                  | 认证、owner／模式隔离、查询、上传受理、任务查询                | 不领取媒体任务、不跑后台轮询、不解码整份原图 |
| operations      | `apps/api/src/asset-operation-executor.ts`         | Compose `operations`，与 API 同一镜像、独立进程                             | `npm run start:operations --workspace @sekereagle/api`                                                               | 用户批量操作、上传终结、恢复、维护、查重                       | 不提供 HTTP；不执行媒体渲染                  |
| library-reader  | `apps/api/src/library-reader.ts`                   | Compose 叠加 `deploy/mac/docker-compose.library-reader.yml`                 | 同一 API 镜像，命令 `node apps/api/dist/library-reader.js`；内部端口 3001                                            | 可重建的内存读取投影；统计、人物数、筛选分页                   | 不拥有业务写入、不跑模型                     |
| business worker | `apps/worker/src/main.ts`                          | Compose `worker`，或 Mac launchd 的 `.runtime/business-worker/releases/...` | 构建 worker；Compose 由 `deploy:mac` 管理；Mac release 以 current-runtime 为准                                       | 领取持久媒体任务：缩略图、预览、颜色、金字塔、向量、人脸、清理 | 不改写已提交的业务事实；不提供 HTTP          |
| 计算协调器      | `apps/compute-coordinator/main.mjs`、`control.mjs` | 本机或独立协调器进程                                                        | `npm run start --workspace @sekereagle/compute-coordinator`；日常 `node apps/compute-coordinator/control.mjs status` | 节点登记、策略、任务分配                                       | 不保存图库事实、不拥有业务表                 |
| 远程媒体节点    | `apps/worker/src/compute-*`、人脸推理包            | Mac／Windows／NAS 等执行节点                                                | 按计算协调器策略领取；能力与版本由节点登记                                                                           | 有界媒体计算、人脸推理                                         | 不直接写业务终态；结果仍走发布协议           |
| gateway / web   | `deploy/mac/docker-compose.yml`、`apps/web`        | Compose `gateway`、`web`                                                    | `npm run deploy:mac`                                                                                                 | TLS 同源入口、静态网页                                         | 不承载业务规则                               |

## 两条最容易混的边界

1. **Compose `worker` ≠ 现网 Mac 业务执行器**。Compose 里的 `worker` 是容器化媒体 worker；
   现网 Mac 的业务执行器是 launchd 管理的不可变 release（`.runtime/business-worker/releases/...`）。
   `npm run deploy:mac` 只更新 Compose 服务，不能据此认为 Mac release 也更新了。
2. **operations ≠ library-reader**。operations 执行用户操作、上传终结、恢复和维护；
   library-reader 只提供可重建的读取投影。两者都不在 API 进程里，也都不互相替代。

## 后台归属规则

- API 只受理、认证、持久化意图和读取状态；耗时写入、扫描和渲染必须进独立进程／队列。
- operations 的领域服务在 API 模块中保持惰性；构造或模块生命周期不得自行启动业务定时器。
- worker 的任务种类、车道和处理器版本从 `library-core` 同一规则包导出；新增种类必须登记，
  不能只改 `main.ts`。
- 任何“后台”改动先回答：在哪个进程、谁领取、失败后如何恢复、是否会拉低前台 p95。

## 更新顺序

1. 确认目标进程和现用 release／镜像（current-runtime）。
2. 运行安全目标检查和备份；迁移先于应用切换，失败不自动降级数据库。
3. 只替换实际变化的服务；网页更新不需要重启数据库、MinIO 或独立封面容器。
4. 验收健康、真实页面、任务检查点和错误原因，再更新 current-runtime 的核验日期与证据。
