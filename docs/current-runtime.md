# 现用运行状态与交接

核验时间：2026-10-24（北京时间，生产升级后）。这是当前部署快照，不是实时监控；修改运行位置、镜像、模型路由、处理开关或长期任务后，应更新本页并重新核验。安全边界以 [AGENTS](../AGENTS.md)、[架构北极星](architecture.md#north-star)为准。

## 2026-10-24 本机统一任务中心验收

统一任务中心仅在独立本机合成图库验收，入口 `http://[::1]:4191/__test/login`；没有推送或更新群晖应用镜像、数据库、处理开关、DSM 或 Mac 模型。原本机地图／统计工作台继续保留，任务中心使用独立 IPv6 loopback 来源，避免不同端口的测试图库相互覆盖 Cookie。运行身份从 `.omx/artifacts/task-center-workbench.json` 读取，不把此处的端口或进度当成实时存活证据。

支持后台时段、单类暂停／继续与优先、按类别重试，汇总媒体、索引、清理、上传、导入和审批。基础浏览、地图及必要清理继续自动维护；人工审批仍需显式同意。手机传输、宿主备份及独立封面维护未接入此处实时报告，界面明确说明，不能将页面计数当作现用封面任务进度。完整边界见 [后台工作与任务中心](background-work.md)。

完整工程检查、真实 PostgreSQL 的历史升级／完整恢复与任务中心回归通过；原语义文件夹数据库验收通过。网页任务中心覆盖率为 100% 行、95% 分支、100% 函数，服务覆盖率为 96.93% 行、91.13% 分支、100% 函数，任务租约为 100% 行、90% 分支、100% 函数。真实 HTTP 验证普通账号权限、Origin、严格 DTO 及模式隔离；浏览器验证双模式任务入口、安排隔离、模型离线等待、优先、暂停与继续。验收日志为 `.omx/artifacts/task-center-*`，最终界面为 `task-center-final.jpg`。本机仅含合成测试图片，临时环境可重建，不代表生产已经更新。

2026-10-24 本机 AI 标签生成退役验收：页面、设置／扫描／重试接口、上传建队和 Ollama 执行已移除；已有标签、关联及成功历史保留。完整工程门禁、双模式真实 HTTP、历史升级、退役租约与标签保留、完整恢复校验通过，日志见 `.omx/artifacts/retire-ai-*`，界面见 `task-center-retired-ai.jpg`。仅重建本机合成任务工作台，没有部署生产或改变 Mac 模型。

## 2026-10-24 自动更新重启与封面续传

DSM 日志显示 00:10:38 自动安装 DSM 7.3.2-86009 Update 5，00:10:47 更新完成，00:14:48 记录系统启动；系统 uptime 推算启动时间为 00:13:35。开关机计划列表为空，不能把本次更新重启说成定时开机。没有改动系统更新策略。

独立封面任务最后完整批次检查点为 20,500（00:10:39）。重启后 00:16 容器日志连续报无法连接 `postgres:5432`，有限重试耗尽后停止；数据库容器启动日志在 00:16:59。DSM 开机任务本次于 00:15:12–00:15:14 退出 1，旧配置没有保存输出，因此该任务具体失败步骤仍未确认，不能将依赖启动竞态推断成已取得其 traceback。

用户授权恢复并排查防复发。核对原清单 SHA256、数量及检查点计数，运行现用 API 的安全目标检查后，从原容器恢复；随后等当前批次正常退出，保存旧脚本，再原位更新只读挂载的 `preview_copy.py` 并启动同一个容器。未重建容器、卷、原片、清单或导入 journal。新版仅对数据库连接失败和明确临时连接错误每 30 秒重试，最多等待 10 分钟；身份／校验错误直接退出，失败不推进检查点。恢复验收时检查点已至 20,900，跳过数仍为 55，近期 stderr 为空；实时数量请重新读检查点。

`nas-startup.py` 增加 Docker 操作暂时失败的有界重试，健康探测短暂不可用时继续等待；项目身份、清单校验失败仍拒绝启动。DSM 中已填写同一份修复脚本及私有日志重定向（root、umask 077、`/var/log/sekereagle-startup.log`），保存正在等待用户完成 DSM 密码验证，**验证前不能认为开机修复已生效**。不得为验收直接再次重启 NAS。

用户在操作时确认执行原 `SekerEagle Docker Access` 任务，恢复 socket 的 administrators 组，SSH Docker inspect／start 已验证可用；任务仍保持原先禁用自动触发状态，不承诺该 SSH 权限跨重启保留。核心服务、Mac 模型、视频／8B／人脸处理策略不变。

验证：启动恢复 6 项、导入脚本 28 项单元测试通过，全工作区 lint、typecheck、build 通过；不为脚本修复部署应用镜像或数据库迁移。

## 当前恢复状态

2026-10-23 晚间，用户在群晖重启后授权恢复，并要求以后开机自动恢复。**六个常驻服务及独立封面复制容器已从原容器启动**，HTTPS readiness 返回 ready。清单哈希及下一批来源指纹核对通过，封面检查点已从 13,300 推进至 13,600，新增 300 张、无新增跳过；此数量为恢复验收快照，实时进度仍读检查点。

DSM 已启用 root 开机任务 `SekerEagle Startup`，内嵌仓库 [nas-startup.py](../scripts/nas-startup.py) 的完整内容，不调用用户可修改的外部脚本。任务等待 Docker，核验固定六个容器的 Compose 项目，按数据库／存储、API／web、gateway／worker 顺序启动并等待健康；随后验证封面清单与检查点，仅对未完成的原任务续传。已经运行的容器不会重启，已完成的历史导入不会启动。手动验收任务退出状态正常（0），未为验证再次重启 NAS。

此次保留容器原重启策略；**开机恢复由 DSM 任务补足**，不是把全部历史任务设为无限重试。SSH Docker 权限重置不影响 root 开机任务；旧 `SekerEagle Docker Access` 任务保持禁用，没有扩大 SSH 账号权限。Mac 模型和其他应用未改动。维护时若需跨重启保持停用，应先禁用 `SekerEagle Startup`，维护完成后重新启用。

## 接手先看这几件事

- **现用图库在群晖 SekerDesign（DS1522+，AMD64，8 GB）**，用户入口是 `https://yuntai.design:8181/`。Mac 旧图库服务及相关本地 Docker 存储已按用户要求退役，不要重新启动或重建来排查线上问题。
- **Mac 仍负责 2B 模型推理**。图库存储和浏览在群晖；图片语义搜索和新增图片向量依赖 Mac 的独立 MLX 服务。不要把“停用旧图库”理解成可以停止模型。
- **六个常驻服务加一个独立封面复制任务**是本轮已核验的处理结构。没有必要为了减少列表行数合并数据库、对象存储或 API。
- **本地 main、远程 Git、线上容器是不同状态**。用户于 2026-10-24 授权部署最新版本，语义智能文件夹、照片地图及此前新刻度和双向分页已部署。不能将此前“先不推送”的历史指令当作当前部署事实，也不能仅看分支名判断线上功能。
- 素材、照片采用各自独立的托管资源；群晖共享相册是一次性导入来源，不是外部目录图库。个人 Photos 空间不在本轮导入范围。

## 每个运行模块负责什么

| 模块          | 位置／标识                                      | 职责与依赖                                                                       |
| ------------- | ----------------------------------------------- | -------------------------------------------------------------------------------- |
| HTTPS 入口    | DSM 反向代理、现有域名及证书                    | 终止 TLS，转发到群晖网关；不是数据库或图片处理服务                               |
| gateway       | `sekereagle-nas-staging-gateway-1`              | 同源网页、API 和签名对象请求入口；NAS 局域网回源端口 8181                        |
| web           | `sekereagle-nas-staging-web-1`                  | 静态 React/Vite 网页；浏览器负责呈现、缩略图缓存和现有编辑器交互                 |
| API           | `sekereagle-nas-staging-api-1`                  | 认证、owner／模式隔离、图库查询、上传发布、任务管理；文字搜索向 Mac 请求向量     |
| PostgreSQL    | `sekereagle-nas-staging-postgres-1`             | 业务记录、摄影索引、任务、向量及查询索引，是业务事实源                           |
| MinIO         | `sekereagle-nas-staging-minio-1`                | 托管原片和派生图；写入必须走 S3 接口，不能直接向底层数据目录塞文件               |
| worker        | `sekereagle-nas-staging-worker-1`               | 领取可重试媒体任务；生成普通封面／预览、补读信息、调度图片向量并写回群晖         |
| 2B 模型       | Mac，`com.sekereagle.mlx-embedding`，端口 11435 | Qwen3-VL-Embedding-2B，固定模型修订及 1024 维空间；提供带认证的文字／图片推理    |
| 独立封面复制  | NAS，`sekereagle-cover-copy-20261023`           | 从共享相册既有 JPEG 派生缓存复制到本应用 MinIO，发布当前版本封面，保留逐批检查点 |
| 8B 标签／人脸 | 可选模型及 worker 任务                          | 当前处理配置未领取这些任务；不因更新应用顺便启用                                 |

Docker 项目仍叫 `sekereagle-nas-staging`，数据库仍叫 `sekereagle_test`，桶为 `sekereagle-assets`。这是初次恢复沿用的名称，**里面是现用用户数据，不是可随意重置的测试实例**。数据库及 S3 地址在应用配置中使用 Compose 服务名；不得为方便诊断改成 NAS IP 或连接受保护的外部系统。

代码职责地图见 [维护者指南](maintainer-guide.md#目录地图)；此处补充当前运维入口：

| 代码入口                                                       | 用途                                                                     |
| -------------------------------------------------------------- | ------------------------------------------------------------------------ |
| `apps/worker/src/main.ts`、`processing-policy.ts`              | 共用媒体任务领取和处理策略                                               |
| `apps/worker/src/image-publication.ts`                         | 普通渲染与复用封面的共用发布事务，检查 owner、模式、版本、租约及私密边界 |
| `apps/worker/src/synology-preview-pilot.ts`、`cached-image.ts` | 受信任、有界的来源校验及 JPEG 缓存复用适配器；不是普通客户端 API         |
| `apps/worker/src/source-timeline.ts`                           | 基于冻结来源证据的有界日期维护，不扫描外部图库                           |
| `scripts/synology-import/preview_copy.py`                      | 独立封面进程、批次检查点及清单指纹校验                                   |
| `scripts/synology-import/`                                     | 历史原片导入及 journal；继续操作前读该目录 README，不另起重复导入        |
| `apps/web/src/components/photos/`                              | 照片时间线、日期索引、刻度的位置映射与呈现                               |
| `apps/web/src/components/media/loading/`                       | 有界缩略图加载／缓存；与共用卡片一起避免回看时排队闪空白                 |

## 当前后台处理策略

本次直接检查了 worker 容器的以下非秘密配置：

```dotenv
EAGLE_PROCESSING_JOB_KINDS=GENERATE_RENDITIONS,GENERATE_THUMBNAIL,GENERATE_PREVIEW,PROBE_MEDIA,GENERATE_EMBEDDING
EAGLE_BACKGROUND_PROCESSING_ENABLED=true
EAGLE_VIDEO_TRANSCODING_ENABLED=false
EAGLE_INTERACTIVE_CONCURRENCY=1
NODE_OPTIONS=--max-old-space-size=512
```

普通 worker 的容器内存上限为 2 GiB。当前优先封面和 2B 向量；完整视频转码暂停，任务保留；人脸、8B 标签、调色板和深层金字塔不在当前领取白名单中。标签中心构建也受此处理配置限制。任务存在不等于已执行，队列暂停不等于删除。

图片向量使用已托管的适用派生图作为输入，NAS 向 Mac 发送图片数据，Mac 返回向量，NAS 负责业务发布；不是把整套原片图库搬回 Mac。文字语义搜索同样调用 Mac。Mac 关机／模型断连时，已有封面浏览不依赖它，内容搜索会降级，新向量任务不能正常完成。不能在未验证前承诺断连后所有任务无限自动重试。

### 独立封面任务

冻结清单包含 53,403 项图片，按修正后的图库日期从新到旧处理。视频仍走普通 worker 封面流程。本轮复用说明与边界见 [群晖预览复用](nas-preview-reuse.md)。

- 原片及共享相册目录只读；可用缓存复制为 SekerEagle 自己的独立对象，浏览不长期依赖群晖缓存目录。
- 逐项复核账号、PHOTO、SHA 和媒体版本；已有当前版本封面跳过，来源变动、失效缓存或不兼容项记录原因。
- 容器内存上限 768 MiB，无额外交换，重启策略 `on-failure:3`。它独立于普通 worker、API 和网页，不依赖 Mac 保持连接。
- 网页／API／普通 worker 更新不直接停止该容器；数据库、MinIO、Docker 或 NAS 重启可能让它失败。恢复时核对同一清单及检查点，不能假设无限自动恢复。
- `offset` 是已检查项数，`COPIED` 才是新增封面，`ALREADY_READY` 是已有封面，`SKIPPED` 要看原因。不能把 offset 当成全部复制成功，也不能只凭容器存活判断仍有进展。
- 清单哈希与检查点绑定。不要修改清单后复用旧 offset，不要删除状态目录后全量重跑；批次中断可能重复检查该批，已发布版本的幂等检查避免重复发布。
- RAW 高清编辑派生及动态组件通过 `photo-source-details-v1` 后续任务补齐；静态封面可浏览不代表 RAW 编辑源或动态播放已完成。

NAS 私有状态位于安装目录下：

```text
/volume1/homes/seker/sekereagle-staging/
  shared-import/state/journal.sqlite
  maintenance/processing-upgrade-20261023/release-compose.json
  maintenance/photo-timeline-repair-20261023/
    manifest.json
    before-dates.json
    cover-manifest.json
    cover-state/progress.json
    cover-state/results.jsonl
    runtime-release.json
    runtime-override.yml
```

journal 和清单包含私人文件信息，只保存在私有目录，不提交内容或复制进日志。`before-dates.json` 是日期回填前的维护快照，不是完整数据库备份。原片导入、拒绝补入与封面复制是不同任务；封面清单不能证明整个共享空间的原片都已入库。原片完成情况须查原 journal／最终报告，不能重新启动旧导入容器来猜。

本次日期维护按冻结证据检查 63,802 项、更新 62,813 项 chronologicalAt；原始 SHA、对象、创建／添加时间不变。排序优先可靠摄影日期，无此信息时使用已记录的来源日期，最后才回退添加时间；不把来源文件日期冒充 EXIF。首页、分段和全库日期索引共用 chronologicalAt。

## 代码与已部署版本

2026-10-24 生产升级验收快照：

| 位置               | 已核验版本                                                                                      |
| ------------------ | ----------------------------------------------------------------------------------------------- |
| 本地 `main`        | 发布代码 `2b6bcb2`，运行文档提交会继续推进 main                                                 |
| 远程 `origin/main` | 发布代码已推送；实时提交请重新 fetch 核验                                                       |
| NAS API 镜像       | `sekereagle/api:nas-2b6bcb271fec2ad390358dd857e7e11c35529c94`                                   |
| NAS worker 镜像    | `sekereagle/worker:nas-2b6bcb271fec2ad390358dd857e7e11c35529c94`                                |
| NAS web 镜像       | `sekereagle/web:nas-2b6bcb271fec2ad390358dd857e7e11c35529c94`                                   |
| 数据库迁移         | `20261023150000_semantic_smart_folders`，已完成迁移共 40 项                                     |
| 独立封面容器       | 继续使用 `sekereagle/worker:nas-5b745e575ac649cc5bc0073539ccc8d14ccc90b0`，原容器及生命周期独立 |

语义智能文件夹、照片地图与离线地名能力已部署，此前年份刻度、双向分页、日期修复和缩略图缓存保留。语义文件夹保存 2B 查询向量和匹配快照，普通条件实时筛选；新增图片向量发布时增量维护。详情见 [语义智能文件夹](semantic-smart-folders.md)。

镜像在群晖以对应既有 Linux AMD64 镜像为基础替换编译产物及共享包，原生依赖保留，Prisma 客户端在 Linux 镜像内重新生成；镜像 revision 表示应用产物来源。没有重建 Mac 图库，没有改变模型路由、视频／8B／人脸策略或 DSM 开机任务的待确认状态。

### 本次发布证据与回滚

NAS 私有 `maintenance/semantic-release-20261024/` 保存升级前 PostgreSQL 自定义归档（533,617,557 字节）、SHA256、可读归档目录、原服务配置摘要、镜像构建／迁移日志、回滚覆盖与 `runtime-release.json`。归档含私人业务与认证数据，禁止提交。没有执行数据库恢复、seed 或全量导入，没有重写原片与派生对象。

首次迁移检查发现打包的迁移子目录权限过严，应用账号无法读取，未执行结构变更；已修正 API／worker 镜像中的公共代码目录权限，并以应用账号逐一读取全部 40 项迁移文件验证。随后成功执行唯一新增迁移，记录从 39 项增至 40 项。新结构为附加表、索引和版本维护触发器。

现用完整 Compose 参数保存在 `maintenance/processing-upgrade-20261023/release-compose.json` 的 `command`，已追加 `maintenance/semantic-release-20261024/runtime-override.yml`。普通 worker 等当前任务正常结束后再替换；仅重建 API、worker、web。数据库、MinIO、网关和独立封面容器身份不变，网关仅重新载入路由；三项应用服务的环境摘要、挂载、内存、账号和重启策略与发布前一致。应用回滚使用本次 `rollback.yml` 覆盖旧镜像并保留新增结构，不自动恢复数据库；回滚前仍须核对完整参数链和当前任务。

验证：完整 `npm run ci:check` 通过，包括 lint、类型检查、单元测试、构建、架构与契约门禁；智能文件夹及照片地图的隔离真实 PostgreSQL 集成验收通过。语义模块覆盖率为 100% 行、93.27% 分支、100% 函数。修复并验证 worker 镜像共享规则依赖、数据库时钟调度及快照身份隔离问题。

生产验收：三个新应用镜像运行正常且健康；完整 HTTPS 首页与 readiness 成功，线上 HTML 与本地构建逐字节一致；未认证智能文件夹请求返回 401。通过生产服务内部调用现用 Mac 2B 路由，语义预览返回 READY 和 12 项预览；全库地图返回有效聚合，智能文件夹列表可读取。此为服务端真实链路验收，本次没有已登录生产浏览器交互验收，也没有创建测试文件夹或用户资源。独立封面检查点从 22,400 推进至 23,500／53,403，清单哈希不变、重启次数仍为 0；此为验收快照，不代表全库封面完成。

## 接手时如何核验，如何更新

1. 先读本页、AGENTS 和架构；确认用户要求的是讨论、代码、推送还是部署。
2. 用 `git status`、本地与远程提交记录分别确认代码；用 NAS `docker inspect` 的指定字段核对镜像、运行状态、健康和资源限制，不输出整个 Env 或展开后的 Compose 配置。
3. 通过已有 SSH 配置 `SekerDesign` 进入 NAS，Docker 为 `/usr/local/bin/docker`。安装目录如上；当前完整 Compose 参数列表保存在私有 `release-compose.json` 的 `command` 字段中，读取后先检查目标和覆盖文件，不盲目执行不明命令。
4. 保留现有搜索、HTTPS、格式兼容、导入优先、内存预算、处理白名单和 runtime override。只用基础 compose 重建可能丢失模型路由或处理策略。初始安装生成器不是现用更新器；不能重跑恢复、seed 或 minio-init 来更新程序。
5. 先运行安全目标检查，验证 owner marker、Compose 目标及备份，再对确实变化的服务发布。网页更新不需要重启存储和独立封面容器；涉及 migration 必须另行评估正在运行的维护任务。
6. 验收服务健康、真实页面、任务检查点前进及错误原因；成功后同步本页的版本和核验时间。只改文档无需运行图库导入或数据库测试。

只读状态示例（在 NAS 执行，不读取凭据）：

```sh
/usr/local/bin/docker inspect --format '{{.Config.Image}} {{.State.Status}}' sekereagle-nas-staging-web-1
/usr/local/bin/docker inspect --format '{{.State.Status}}' sekereagle-cover-copy-20261023
cat /volume1/homes/seker/sekereagle-staging/maintenance/photo-timeline-repair-20261023/cover-state/progress.json
```

维护清理时，灰色容器可能是已完成的 migration、恢复、盘点或历史导入。核对退出结果、状态保存和挂载后再决定移除；不要按名字批量删除，不删除数据库卷、MinIO 卷、原片或仍需续传的 journal。容器清理和图库删除必须分开处理。

## 文档职责与后续交接

- 本页记录**现用部署事实和接手顺序**；`architecture.md` 记录长期设计边界。
- `nas-staging.md` 保留**初始恢复和 HTTPS 配置历史**；`operations-runbook.md` 用于新建本机运行环境。
- `maintainer-guide.md` 记录**代码目录和开发门禁**；`nas-preview-reuse.md` 记录封面复用实现、验收及限制。
- 实时数量、速度、任务错误以运行检查点和队列为准，不在本页维护跳动的百分比。运行文档不包含密码、令牌、私钥或用户照片内容，也不自动授权下一次部署／删除。

## 2026-10-23 磁盘波动排查

用户授权自主诊断并仅保留有验证收益的优化。本轮只读采样和三分钟普通 worker 暂停对照后，恢复原配置；没有推送、部署新镜像或提高并发。

- 采样时 NAS MemAvailable 约 3.5 GiB，25 秒内仅发生一页 swap-in、无 swap-out，不能将历史 swap 占用当作本轮持续内存耗尽。
- 独立封面任务最近 500 项中位耗时约 1.34 秒；只读抽查三张缓存，三档 JPEG 合计约 0.4–0.5 MB，加载／校验约 32–39 毫秒，ExifTool 约 150–166 毫秒。动态信息检查有 1.7 秒个例，说明单文件阶段耗时会随内容变化，不能把磁盘曲线当作纯顺序复制测速。
- 暂停普通 worker 三分钟，独立复制仍持续进行；对照前最近 200 项的中位耗时 1.30 秒，对照期间完成批次为 1.57 秒。样本不同且有批次交叠，不能作严格因果测速；至少未获得“停掉 worker 明显加速”的证据，因此恢复 worker，而不是长期暂停向量和正常封面处理。
- 一次数据库活动快照未发现锁等待，backend fsync 累计为零；这些单点数据不能排除间歇等待，也不能证明检查点就是波动原因。不得据此关闭 fsync、同步提交、完整性检查或权限隔离。
- 本轮决定保持当前独立进程及单路发布。每项仍含来源指纹、格式／方向校验、摄影信息读取、三个 S3 对象写入和业务事务，批次检查点每 100 项落盘。没有发现传输重启循环或内存抖动的证据；平滑曲线不是性能验收标准。

对照汇总保存在 NAS 私有维护目录的 `io-comparison-20261023.json`，不含照片内容或凭据。最终状态应核对普通 worker 未暂停、健康正常、独立封面检查点继续前进。过期缓存记录为 `CACHE_STALE`，保留正常生成路径，不强行复用过期封面。

## 2026-10-23 晚间生产升级

用户明确授权“弄好之后一起更新生产环境”。部署 API／web 代码 `120e6bb`，包含本地已合并的刻度改版及定位后双向滚动修复。worker 代码与已部署版本一致，未重建；数据库、MinIO、网关和独立封面容器均保留原容器身份，网关仅重新载入路由。没有数据库结构迁移或依赖更新。

发布前在 NAS 私有 `maintenance/bidirectional-release-20261023/` 保存完整 PostgreSQL 自定义归档（528,010,640 字节），校验 SHA256 及 pg_restore 归档目录；没有在现用数据库上执行恢复。该目录另存发布前镜像／Compose 清单、回滚覆盖、构建日志和 `runtime-release.json`。此归档含私人业务与认证数据，禁止提交。原片与派生对象不因本次应用升级重写，历史备份继续保留。

现用完整 Compose 参数仍从 `maintenance/processing-upgrade-20261023/release-compose.json` 的 `command` 读取，已追加本次 `bidirectional-release-20261023/runtime-override.yml`；不可只沿用旧 timeline override，否则会退回旧网页。两个新镜像均在群晖以已有对应镜像为基础替换编译产物构建，没有重新创建本机 Docker 图库。

验证：网页 650 项测试通过；API 322 项通过、1 项条件测试跳过；lint、类型检查、构建、共用架构及契约检查通过。锚点 hook 为 100% 行覆盖、86.66% 分支覆盖。API／web 健康与完整 HTTPS 首页、健康接口通过；真实已登录页面点击 2017 年 6 月刻度，向上补页显示 7 月、8 月，再向下回到 6 月，最后恢复最新照片。老照片未完成的封面仍显示处理中，不因分页修复宣称全库封面已完成。独立封面任务检查点持续推进，重启次数未增加。

## 2026-10-23 关机准备与恢复

先停止 gateway、API 和 web 以阻止新写入，再给独立封面进程和 worker 发送正常停止信号，等待当前批次／任务完成；两者退出码为 0 后，依次停止 MinIO、PostgreSQL 并执行 sync。没有删除容器、卷、文件或任务，没有修改重启策略。PostgreSQL 日志包含正常关停完成记录。

最终封面检查点：`offset=13300`、`total=53403`，其中 `COPIED=12253`、`ALREADY_READY=1041`、`SKIPPED=6`；`complete=false`，不是全库完成。已核对清单 SHA256 与检查点 manifestHash 一致、计数之和等于 offset。该数量仅代表此次关停断点，后续恢复后的实时进度仍读原检查点。NAS 私有 `maintenance/shutdown-20261023/` 保存停止前服务身份／镜像／重启策略、停止前后检查点及 `shutdown-result.json`。

原关停时常驻服务策略为 unless-stopped，封面任务为 on-failure:3，显式手动停止后未自动恢复。随后用户授权新增上述 DSM 开机任务，补足开机恢复。恢复只启动原容器，沿用当前镜像、配置和卷，不重建安装目录，不执行恢复、migration、seed 或全量导入。

恢复顺序：

1. 启动既有 `sekereagle-nas-staging-postgres-1` 和 `sekereagle-nas-staging-minio-1`，等待各自健康检查通过，核对原卷和部署身份。
2. 启动既有 API、web、gateway，验证 HTTPS 访问及登录，保留全部现用覆盖配置；若发生容器丢失或需要重建，改用本页记录的完整 Compose 参数链，而不是基础模板。
3. 核对 Mac 2B 服务路由和鉴权，再启动普通 worker；保留现有任务白名单及视频／8B／人脸暂停配置。
4. 核对原 `cover-manifest.json` 与 `cover-state/progress.json` 的哈希和断点，启动 `sekereagle-cover-copy-20261023`；从原检查点继续，不运行旧 launch 脚本重新生成清单，不另起第二个写同一状态目录的进程。
5. 观察检查点推进和新增错误，更新本页临时关停状态。未获用户恢复授权时，保持本次停止状态。

### 开机任务维护与验收

开机任务源文件为 `scripts/nas-startup.py`；修改后需在 DSM 任务设置同步其内嵌内容并重新验收，仓库提交不会自动更新 DSM。任务等待依赖有时间上限，异常以非零退出，不反复创建容器、不重做安装。当前配置仅用于本页固定部署和封面清单；更换容器名称、项目或清单时应同步审查脚本，不通过放宽身份或清单校验恢复。

`python3 -m unittest discover -s scripts -p test_nas_startup.py` 覆盖固定启动顺序、依赖失败阻断、错误项目拒绝、已完成任务跳过及检查点／清单校验，并纳入根测试命令。DSM 的实际运行结果为 0，HTTPS 健康恢复，封面检查点继续推进。没有做 NAS 再次重启测试；本次实测覆盖开机任务的相同执行入口和当前正常依赖。

本次运维脚本修改已通过 lint、全工作区类型检查与构建；新增 4 项启动恢复单元测试通过，文档／包配置格式及 Git 空白检查通过。没有更新生产应用镜像或数据库结构。

## 2026-10-24 本机照片统计验收环境

本轮按用户授权新建隔离照片测试工作台，入口 `http://127.0.0.1:4188/__test/login`；在照片模式「智能整理」下面打开「照片统计」。它不是已退役的 Mac 旧图库，也不连接群晖数据库作为开发目标。独立临时 PostgreSQL／MinIO 容器名以 `sekereagle-photo-workbench-` 开头，数据库为 `sekereagle_test`，桶为 `sekereagle-assets`，均仅绑定 loopback；API、worker 和网关由测试脚本持有，模型地址指向本机不可用端口以避免调用现用模型。

群晖仅只读抽取 27 张原始 JPEG 和必要摄影样本信息到本机私有目录，再经过本地上传及 worker 提取；工作台额外含 4 张合成照片。未复制线上用户凭据、未恢复完整数据库，现用群晖服务和任务未改变。浏览器、HTTP、真实数据库和工程门禁的范围见 [照片统计](photo-statistics.md)。该环境使用临时存储，不承诺重启后保留；进程、容器和运行位置从 `.omx/artifacts/photo-workbench.json` 重新核对，不把文档记录当实时状态。

同日统计呈现已更新为低饱和紧凑布局，去除常驻滑块和排名横向滚动。后续按用户反馈增加默认总量聚合、年／月平滑曲线和单曲线悬浮提示；本机 API 与网页需要更新，测试工作台复用已有私有照片样本重建验证。群晖部署和真实图库不变。

## 2026-10-24 本机照片地图视觉验收

同一隔离工作台更新为 Dark 2D 风格离线分层底图与 Apple 式真实照片缩略图标记。API 增加受账号、PHOTO、私密可见性与当前版本约束的批量封面预览；本地 API／web 已更新，已有 27 张私有样本和 4 张合成照片重新导入临时存储验证，没有重新读取群晖。生产镜像、Mac 模型和现用后台任务保持原状态。本轮仍只在 `127.0.0.1:4188` 验收，不代表已发布生产。

运行身份继续从 `.omx/artifacts/photo-workbench.json` 读取；日志位于 `.omx/artifacts/apple-map-workbench.log`，地图 SQL 隔离回归位于 `apple-map-integration.log`。底图改为独立自托管 PMTiles：`.local/maps/data/basemap.pmtiles` 保存全球 z0–7 和中国及周边 z8–14 的公开地理数据，来源日期、范围和 SHA-256 在同目录 `sources.json`；工作台按同源 Range 读取，不外发查看区域。照片标记缩小至 52px，减少提前合并，API 查询缩放上限同步提升至 16，近景网格最高 level 20，仍维持 1024 个理论网格预算。设计范围与地理精度见 [照片地图](photo-map.md)。

本轮最终核验：全工作区 CI 门禁通过，地图 SQL 回归包含 16 级视口、level 20 的成员访问、私密／模式／版本隔离；密集页面测试保留 48 个独立位置。实际工作台含 31 张照片，其中 19 张带位置，真实样本集中少量拍摄地点，不应把该样本数量当作生产图库的显示上限。浏览器核对区域展开、近景街道、真实缩略图和选片；日志使用 `map-density-final-*`，底图来源和归档校验使用 `map-china-download.log`、`map-archive-verify.log`。

## 2026-10-24 照片统计周周期修订

按最新用户反馈，本地 API／web 默认同步为按相机、按周显示，提供最近 1／3／5 个日历年与所有时长（最新默认最近 3 年、按月），保留自定义日期和年／月切换。周一为周起点，周中日期范围不计入范围外照片；悬浮框跟随指针，浏览器实测 160×42px。工作台复用原有 27 张私有照片样本和 4 张合成照片重新导入，未重新连接群晖；地图归档保留。进程／容器从 `.omx/artifacts/photo-workbench.json` 核验，当前轮工作台日志为 `statistics-week-workbench.log`。

完整 `npm run ci:check` 通过，网页 696 项、API 341 项通过（1 项既有条件跳过）；统计聚焦测试为 API 8 项、网页及日期／曲线 20 项。真实 PostgreSQL 验证周跨年、周中范围、补零和原有 owner／模式／私密／版本隔离。浏览器核对四档范围、年／月／周切换、默认相机曲线与小型提示，实际鼠标命中仅显示一条设备数据。证据位于 `.omx/artifacts/statistics-week-*`，截图为 `statistics-week-final.png`。本轮未推送或部署生产，群晖图库和后台任务不变。

同日后续默认值已改为「最近 3 年＋按月＋按相机」。页面首次请求即携带最近三年的起止日期，日期输入框与按钮同源初始化；API 默认粒度同步为 month。工作台复用原有样本重建，最新本地日志为 `statistics-defaults-workbench.log`；真实数据库回归与工程核验为 `statistics-defaults-*`，未重新读取群晖或部署生产。

## 2026-10-24 本机整理审批与操作记录

原“智能整理”入口改为“整理审批”。Agent 只提交补充位置、发送到素材和移入回收站申请，浏览器手动同意才执行；支持批量排除与部分结果。新增不可覆盖的操作流水，撤销保留原记录并检查资源和实况配对组件版本；跨库发送采用固定幂等操作标识，失败只允许人工续传。

本轮只更新独立本机工作台，不更新群晖镜像或现用数据库。工作台复用已有 27 张本机私有样本缓存与 4 张合成图片；演示开关仅为合成图片提交三份申请，不会自动同意。运行身份从 `.omx/artifacts/photo-workbench.json` 读取，当前日志为 `approvals-workbench.log`；工程／真实数据库回归证据为 `approvals-history-*`，包含历史结构升级与完整数据库恢复。操作记录在真实部署中持久保存；当前工作台属于可重建临时环境，重建会重置演示记录。

最终本机验收：完整工程检查通过；真实 PostgreSQL 96 项通过，含历史升级与完整恢复校验。浏览器仅对合成图片执行位置部分批准与撤销、发送到素材、移入回收站与撤销，实际记录保留执行和撤销时间；原有私有样本未审批或变更。截图为 `approvals-history-final.png`。
