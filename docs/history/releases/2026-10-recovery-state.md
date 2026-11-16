# 2026-10-23/24 恢复结构快照

> 状态：历史记录 | 归档日期：2026-11-16
>
> 这些小节来自原 `current-runtime.md`，描述 2026-10-23/24 的群晖恢复结构、模块表和
> 当时的镜像/迁移。它们不是当前状态；现用状态读 [current-runtime](../../current-runtime.md)。

---
## 当前恢复状态

2026-10-23 晚间，用户在群晖重启后授权恢复，并要求以后开机自动恢复。**六个常驻服务及独立封面复制容器已从原容器启动**，HTTPS readiness 返回 ready。清单哈希及下一批来源指纹核对通过，封面检查点已从 13,300 推进至 13,600，新增 300 张、无新增跳过；此数量为恢复验收快照，实时进度仍读检查点。

DSM 已启用 root 开机任务 `SekerEagle Startup`，内嵌仓库 [nas-startup.py](../../../scripts/nas-startup.py) 的完整内容，不调用用户可修改的外部脚本。任务等待 Docker，核验固定六个容器的 Compose 项目，按数据库／存储、API／web、gateway／worker 顺序启动并等待健康；随后验证封面清单与检查点，仅对未完成的原任务续传。已经运行的容器不会重启，已完成的历史导入不会启动。手动验收任务退出状态正常（0），未为验证再次重启 NAS。

此次保留容器原重启策略；**开机恢复由 DSM 任务补足**，不是把全部历史任务设为无限重试。SSH Docker 权限重置不影响 root 开机任务；旧 `SekerEagle Docker Access` 任务保持禁用，没有扩大 SSH 账号权限。Mac 模型和其他应用未改动。维护时若需跨重启保持停用，应先禁用 `SekerEagle Startup`，维护完成后重新启用。

## 接手先看这几件事

- **现用图库在群晖 SekerDesign（DS1522+，AMD64，8 GB）**，用户入口是 `https://yuntai.design:8181/`。Mac 旧图库服务及相关本地 Docker 存储已按用户要求退役，不要重新启动或重建来排查线上问题。
- **Mac 仍负责 2B 模型推理**。图库存储和浏览在群晖；图片语义搜索和新增图片向量依赖 Mac 的独立 MLX 服务。不要把“停用旧图库”理解成可以停止模型。
- **六个常驻服务加一个独立封面复制任务**是本轮已核验的处理结构。没有必要为了减少列表行数合并数据库、对象存储或 API。
- **本地 main、远程 Git、线上容器是不同状态**。用户于 2026-10-24 授权部署最新版本，语义智能文件夹、照片地图及此前新刻度和双向分页已部署。不能将此前“先不推送”的历史指令当作当前部署事实，也不能仅看分支名判断线上功能。
- 素材、照片采用各自独立的托管资源；群晖共享相册是一次性导入来源，不是外部目录图库。个人 Photos 空间不在本轮导入范围。

## 每个运行模块负责什么

| 模块         | 位置／标识                                      | 职责与依赖                                                                               |
| ------------ | ----------------------------------------------- | ---------------------------------------------------------------------------------------- |
| HTTPS 入口   | DSM 反向代理、现有域名及证书                    | 终止 TLS，转发到群晖网关；不是数据库或图片处理服务                                       |
| gateway      | `sekereagle-nas-staging-gateway-1`              | 同源网页、API 和签名对象请求入口；NAS 局域网回源端口 8181                                |
| web          | `sekereagle-nas-staging-web-1`                  | 静态 React/Vite 网页；浏览器负责呈现、缩略图缓存和现有编辑器交互                         |
| API          | `sekereagle-nas-staging-api-1`                  | 认证、owner／模式隔离、图库查询、上传发布、任务管理；文字搜索向 Mac 请求向量             |
| PostgreSQL   | `sekereagle-nas-staging-postgres-1`             | 业务记录、摄影索引、任务、向量及查询索引，是业务事实源                                   |
| MinIO        | `sekereagle-nas-staging-minio-1`                | 托管原片和派生图；写入必须走 S3 接口，不能直接向底层数据目录塞文件                       |
| worker       | `sekereagle-nas-staging-worker-1`               | 领取可重试媒体任务；生成普通封面／预览、补读信息、调度图片向量并写回群晖                 |
| 2B 模型      | Mac，`com.sekereagle.mlx-embedding`，端口 11435 | Qwen3-VL-Embedding-2B，固定模型修订及 1024 维空间；提供带认证的文字／图片推理            |
| 独立封面复制 | NAS，`sekereagle-cover-copy-20261023`           | 从共享相册既有 JPEG 派生缓存复制到本应用 MinIO，发布当前版本封面，保留逐批检查点         |
| 人脸识别     | 图库服务器的可选 YuNet／SFace 模型              | 已配置本地模型且媒体白名单已撤销；实际扫描任务与覆盖数见最新核验，旧版 8B 标签生成已退役 |

Docker 项目仍叫 `sekereagle-nas-staging`，数据库仍叫 `sekereagle_test`，桶为 `sekereagle-assets`。这是初次恢复沿用的名称，**里面是现用用户数据，不是可随意重置的测试实例**。数据库及 S3 地址在应用配置中使用 Compose 服务名；不得为方便诊断改成 NAS IP 或连接受保护的外部系统。

代码职责地图见 [维护者指南](../../maintainer-guide.md#目录地图)；此处补充当前运维入口：

| 代码入口                                                       | 用途                                                                     |
| -------------------------------------------------------------- | ------------------------------------------------------------------------ |
| `apps/worker/src/main.ts`、`processing-policy.ts`              | 共用媒体任务领取和处理策略                                               |
| `apps/worker/src/image-publication.ts`                         | 普通渲染与复用封面的共用发布事务，检查 owner、模式、版本、租约及私密边界 |
| `apps/worker/src/synology-preview-pilot.ts`、`cached-image.ts` | 受信任、有界的来源校验及 JPEG 缓存复用适配器；不是普通客户端 API         |
| `scripts/synology-import/preview_copy.py`                      | 独立封面进程、批次检查点及清单指纹校验                                   |
| `scripts/synology-import/`                                     | 历史原片导入及 journal；继续操作前读该目录 README，不另起重复导入        |
| `apps/web/src/components/photos/`                              | 照片时间线、日期索引、刻度的位置映射与呈现                               |
| `apps/web/src/components/media/loading/`                       | 有界缩略图加载／缓存；与共用卡片一起避免回看时排队闪空白                 |

## 当前后台处理策略

本次直接检查了 worker 容器的以下非秘密配置：

```dotenv
# EAGLE_PROCESSING_JOB_KINDS 未设置，全部现用媒体种类可领取
EAGLE_BACKGROUND_PROCESSING_ENABLED=true
EAGLE_VIDEO_TRANSCODING_ENABLED=true
EAGLE_INTERACTIVE_CONCURRENCY=1
EAGLE_EMBEDDING_CONCURRENCY=2
NODE_OPTIONS=--max-old-space-size=512
```

2026-10-26 发布前实时核验：普通 worker 内存上限为 2 GiB，NAS 一路、向量两张在途；视频、人脸、代表色与深层金字塔不受媒体种类白名单限制。API 与 worker 均已配置人物环境，实际 YuNet／SFace 权重已校验。旧版 8B 标签生成已退役；MATERIAL 标签索引仍保留原手动暂停。时段与任务暂停继续控制执行，能力启用不代表已经补排旧照片，队列暂停不等于删除。该配置在本轮部署中保留，动态状态从最新检查点读取。

图片向量使用已托管的适用派生图作为输入，NAS 向 Mac 发送图片数据，Mac 返回向量，NAS 负责业务发布；不是把整套原片图库搬回 Mac。文字语义搜索同样调用 Mac。Mac 关机／模型断连时，已有封面浏览不依赖它，内容搜索会降级；新向量任务等待服务恢复，不消耗业务重试预算。已保存查询向量的智能文件夹可继续使用已有数据，仍须满足原部署开关与时段。

### 独立封面任务

冻结清单包含 53,403 项图片，按修正后的图库日期从新到旧处理。视频仍走普通 worker 封面流程。本轮复用说明与边界见 [群晖预览复用](../../nas-preview-reuse.md)。

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

2026-10-24 本次生产升级验收快照（历史经过保留在后文）：

| 位置               | 已核验版本                                                                                      |
| ------------------ | ----------------------------------------------------------------------------------------------- |
| 本次发布提交       | 发布代码 `f32accd`，运行文档提交会继续推进 main                                                 |
| 远程 `origin/main` | 发布代码已推送；实时提交请重新 fetch 核验                                                       |
| NAS API 镜像       | `sekereagle/api:nas-f32accdfe96a58f071407e2b51c50a5ff87797af`                                   |
| NAS worker 镜像    | `sekereagle/worker:nas-f32accdfe96a58f071407e2b51c50a5ff87797af`                                |
| NAS web 镜像       | `sekereagle/web:nas-f32accdfe96a58f071407e2b51c50a5ff87797af`                                   |
| 数据库迁移         | `20261024150000_retire_ai_tag_generation`，已完成迁移共 47 项                                   |
| 独立封面容器       | 继续使用 `sekereagle/worker:nas-5b745e575ac649cc5bc0073539ccc8d14ccc90b0`，原容器及生命周期独立 |

语义智能文件夹、照片地图与离线地名能力已部署，此前年份刻度、双向分页、日期修复和缩略图缓存保留。语义文件夹保存 2B 查询向量和匹配快照，普通条件实时筛选；新增图片向量发布时增量维护。详情见 [语义智能文件夹](../../semantic-smart-folders.md)。

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

