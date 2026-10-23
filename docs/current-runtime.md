# 现用运行状态与交接

核验时间：2026-10-23 15:03（北京时间）。这是当前部署快照，不是实时监控；修改运行位置、镜像、模型路由、处理开关或长期任务后，应更新本页并重新核验。安全边界以 [AGENTS](../AGENTS.md)、[架构北极星](architecture.md#north-star)为准。

## 接手先看这几件事

- **现用图库在群晖 SekerDesign（DS1522+，AMD64，8 GB）**，用户入口是 `https://yuntai.design:8181/`。Mac 旧图库服务及相关本地 Docker 存储已按用户要求退役，不要重新启动或重建来排查线上问题。
- **Mac 仍负责 2B 模型推理**。图库存储和浏览在群晖；图片语义搜索和新增图片向量依赖 Mac 的独立 MLX 服务。不要把“停用旧图库”理解成可以停止模型。
- **六个常驻服务加一个独立封面复制任务**是本轮已核验的处理结构。没有必要为了减少列表行数合并数据库、对象存储或 API。
- **本地 main、远程 Git、线上容器是不同状态**。本地已合入新刻度与缓存修复；用户最新要求暂不推送、不部署。不能仅看分支名判断线上是否有某项修改。
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

2026-10-23 15:03 快照：

| 位置               | 已核验版本                                                                           |
| ------------------ | ------------------------------------------------------------------------------------ |
| 本地 `main`        | `b8660ac`：已汇总刻度、来源日期、封面复用及缓存修复；本次文档提交将继续推进本地 main |
| 远程 `origin/main` | 上次 fetch 为 `40d1d5b`；读取远程状态前需重新 fetch                                  |
| NAS API 镜像       | `sekereagle/api:nas-eb9a0d8e8d9c1605343415bf7517a81194cf12ed`                        |
| NAS worker 镜像    | `sekereagle/worker:nas-5b745e575ac649cc5bc0073539ccc8d14ccc90b0`                     |
| NAS web 镜像       | `sekereagle/web:nas-390171a67588620bf679b76bbfd9e69b4869754e`                        |
| 独立封面容器       | 使用上述 worker 镜像，进程与生命周期独立                                             |

新年份刻度的密度分段、压缩空年份和统一年份交互已在本地 main，**尚未部署到群晖**。此前日期数据修复及缩略图缓存快路径已在线。用户当前要求先合并、不着急推送；不得将本次文档维护视为发布授权。

NAS 当前是分服务发布，不能假设所有服务来自同一提交。最近 worker／web 以既有镜像为基础更新编译产物，镜像 tag／revision 标记这次应用产物来源，并不意味着 API、依赖和数据库全部同时升级。没有为这次修复执行新 migration，也没有重新创建 Mac Docker 图库。

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
