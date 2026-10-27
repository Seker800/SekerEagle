# 多机计算与 Agent 控制

## 2026-10-27 当前接单表

| 工作                                   | Mac                                       | Windows                       | 当前分配                                       |
| -------------------------------------- | ----------------------------------------- | ----------------------------- | ---------------------------------------------- |
| 图片预览／缩略图、RAW 浏览与详情       | CPU，Sharp 4 线程                         | CPU，Sharp 6／RAW 原生 6 线程 | Windows 主力，Mac 已验证备用                   |
| 颜色分析                               | CPU                                       | CPU                           | Windows 主力，复用原处理实现                   |
| 大图切片                               | CPU                                       | CPU                           | Mac 主力，SEA1 流式回传；Windows 已验证备用    |
| 已授权的人脸任务                       | CPU，固定 YuNet／SFace                    | CPU，同一固定模型             | Mac 主力；仅处理已授权队列，Windows 已验证备用 |
| 视频预览／播放副本                     | VideoToolbox                              | RTX 3090 NVENC                | Windows NVENC 与 Mac VideoToolbox 共同处理     |
| 搜图向量                               | Metal GPU，后台 2／实际接收 3，保留交互 1 | CUDA 尚未通过兼容验收         | 继续只由 Mac 生成现有向量                      |
| 领取、续租、校验、数据库与对象存储发布 | NAS                                       | NAS                           | 唯一业务队列和全部业务守卫保留                 |

北京时间 16:55 巡检后的运行策略修订 23：Windows 临时接 `image,video`（图片、RAW、颜色与视频），Mac 媒体临时接 `pyramid,faces,video`，Mac Metal 继续向量。08:24–08:54 UTC 实际落库增加视频预览 160、向量 607、颜色 63，新增 FAILED 与超时租约均为零；Mac 媒体同期没有新增接单，而视频仍积压约 2,505 项，因此加入已验证 VideoToolbox 分担视频，未增加每台 4／Mac 宿主 7 的容量上限。核验材料在私有检查点及 `heartbeat-20261027T0853-*`，这些数量为时间窗口证据，不是实时剩余。两条媒体策略为 1 小时，到期恢复原四能力基线；每 30 分钟巡检按真实积压复核、续期或调整。两台都已验证四媒体能力，表中的“备用”代表当前策略没有派该类任务，不是能力缺失。

原调度器用跨操作的全局耗时比较，Windows 长视频会把图片分配一并压低。候选修正 `4642828db5a6a6fe3208e0d8a5d27a45ee585271` 已通过本地 39 项与真实 NAS 镜像 22 项测试，但 DeepSeek Harness 报 `QUOTA: Insufficient Balance`，没有最终独立报告，**尚未发布**。现用协调器仍为 6c10813，不能把已构建候选镜像当成已上线；恢复审查额度后完成外审与独立调度器切换，不静默退回仅自审。上述热分工不改代码、数据或用户处理安排，后台继续进行。

两台媒体节点分别共享 **4 个在途任务名额**，不是每种任务各 4 个；协调器按已验证能力、健康、宿主空位及观测耗时选择节点。Mac 的 `mac-mlx` 与 `mac-media` 同属 `hostId=mac`、宿主总上限 7；Windows 为 `hostId=windows`、上限 4。运行修订 18 的三节点基线均已启用；临时 GPU 恢复策略到期仍回启用基线，实时状态以后读 MCP，不把这个修订快照当当前值。日常启停／限流／调整已登记能力无需发布图库。当前会话若仍缓存旧 MCP 的三操作参数表，新 video／pyramid 策略用下文 `control.mjs` 私有文件热调，不删掉原策略里的新能力迁就旧参数表。

NAS API／worker／web／协调器已统一发布 `6c10813b4c7ab9e1fc3b2e8d372eb742f00a4f84` 兼容五类操作。两台正式 11437 媒体节点使用相同 bundle SHA256 `ddc917bd7d24a0d4bc08ce09b0a20bdaf3ee0301520f1d4122141a3b6ac3aa11`。Mac 独立 LaunchAgent，Windows 原生 S4U／Limited 开机任务；必须保留完整 `../python/`、固定模型和私有 tmp／凭据。Windows 启动器使用自身目录，保留必要 PowerShell／媒体路径，临时目录 ACL 只允许当前 SID 继承。新执行凭据至少 16 字符，现用为独立随机长凭据；不含 DB／S3 信息。

最终 bundle 两机各 24 组真实格式输出、四视频与四混合操作并发通过；普通图像像素一致、Windows RAW 最低 PSNR 约 75.9 dB；12MP 切片全部 74 张逐像素一致，视频 SSIM Mac 0.997391／Windows 0.998712，人脸公开样本跨平台向量／框一致。SEA1 源改为惰性流工厂，响应传输阶段中断的当前流关闭、后续文件不提前打开，两机真实临时目录清理验证通过。渲染阶段仍允许已开工的计算完成，保留实际名额到结束；不能把响应中断测试冒充立即 kill 渲染。视频总传输期限为 60 分钟，覆盖上传、探测、30 分钟编码硬限及回传；共享 Node HTTP 传输不受内置 fetch 的额外五分钟等待头限制。

NAS worker 仍为 2 GiB／1536 MiB 全局在途预算。PHOTO 浏览包在生产和接收两端限制 32 MiB，预留 128 MiB；MATERIAL／详情保留 256 MiB／768 MiB，颜色 64 MiB、人脸远端 64 MiB、流式切片／视频 128 MiB。旧版一律按 768 MiB 的保守预留不再阻挡大宗照片与向量并行。预算是准入估计，不冒充 RSS 硬上限；不能为满载越过版本／租约／暂停／时段。

实机还发现 NAS 数据库回写是供料限制：原 PostgreSQL 容器仅 1.5 GiB，向量表约 654 MiB、索引约 973 MiB，曾见向量更新 IO 等待约 7 秒。NAS 当时可用内存约 4.5 GiB，已只热调该现用实例至 3 GiB、内存与 swap 合计上限 4 GiB，原容器／镜像／挂载／凭据／健康不变，没有重启或改 schema、索引、同步提交语义。完整 Compose 链追加私有 `postgres-cache.yml` 持久化。不能把两台节点空闲一律归因于线程少，也不能把一次低 GPU 百分比当成没有 NVENC 工作。旧镜像回退前必须先排空并把已登记四媒体操作恢复为 legacy image／faces；旧协调器不认识含新操作的 state，禁止直接配旧镜像或覆盖较新的策略。

资格服务不承接生产任务；最终验收后清理 11439 候选进程，CUDA 资格服务保持不登记且停用，固定权重保留。生产复制结果与动态进度见 current-runtime 和检查点；不自动重导入、全库扫描或重试历史 FAILED。编辑成片、物理清理仍走 NAS 原通道，本次待处理队列没有据此宣称所有类型均已远端化。

## 边界与现状

群晖的 EagleAssetProcessingJob 始终是唯一业务队列。compute-coordinator 只维护宿主登记、短期容量策略及最近 200 条变更审计，不记录照片身份，不创建业务任务，不领取数据库租约、不持有数据库或对象存储凭据。API／worker 向协调服务发送已授权任务的有界输入字节，结果仍由原 worker 校验和发布。照片／素材、owner、私密、当前版本、依赖、时段、暂停、公平与租约守卫原样保留。

当前实现向量、图片、人脸、切片与视频五个执行契约。图片复用原本地渲染／RAW／元数据处理函数，视频复用共用硬件编码配方；编辑成片和物理清理继续在 NAS 原通道。向量保持单张协议，未未经实测扩大批量。新增算法或不兼容模型仍需更新节点软件；日常节点登记、排空、限流、恢复与切换已验证能力无需更新图库版本。

## 数据流

1. worker 从原队列领取，续租并验证当前资源；所有发布仍留在 NAS。
2. 协调服务根据健康、已验证能力、可用名额和观测耗时选择节点；没有额外积压队列。
3. 节点只接收图片字节及受限处理配方，不接收 URL、数据库信息或任意文件路径／命令。
4. worker 验证响应规格、源字节哈希、向量契约或人脸模型版本，继续原发布事务。

NAS、向量、远端媒体是独立有界通道。远端任务失联不会退回本机并突破 NAS 上限。登记节点的 maxConcurrent 是实测后批准的硬上限，reserveInteractive 保留搜索名额；Agent 不能提高硬上限或开启未经登记的能力。同一物理主机的不同端点必须登记相同 hostId、hostMaxConcurrent；主机总名额与搜索保留名额同时约束所有端点。拒绝重复 URL、同一 IP 伪分组和不一致主机上限。不能分别算出无限容量。

## 运行与管理

协调服务是独立 Node.js 22 进程，`apps/compute-coordinator/main.mjs serve`。NAS 附加文件为 `deploy/nas/compute-coordinator.yml`；必须追加至 current-runtime 记录的完整 Compose 参数链。主机管理端口仅绑定 loopback，worker 通过原 Compose 网络访问。state 目录和两个凭据文件必须属于服务运行 UID，目录 0700、文件 0600；拒绝符号链接和非私有文件。运行镜像无需 npm 包或数据库。

- `EAGLE_COMPUTE_STATE_DIR`：私有持久目录；state.json 包含节点执行凭据，须纳入管理员备份，不能提交。
- `EAGLE_COMPUTE_EXECUTION_TOKEN_FILE`：原模型执行凭据的私有副本，允许健康与计算。
- `EAGLE_COMPUTE_ADMIN_TOKEN_FILE`：独立随机管理凭据，只在本机／NAS 的受限管理通道使用。
- `EAGLE_COMPUTE_BIND` 默认 127.0.0.1；容器内使用 0.0.0.0，宿主映射仍为 loopback。
- `EAGLE_COMPUTE_PORT` 默认 11436。

首次通过 `main.mjs init <私有登记文件>` 创建状态。登记文件为 `{ "nodes": [...] }`；节点字段为 id、name、url、token、accelerator、operations、maxConcurrent、reserveInteractive、verified、enabled，以及同机多端点必填的 hostId、hostMaxConcurrent。URL 仅允许有显式端口的私网／loopback IPv4 字面地址，禁止受保护的旧 NAS 地址、凭据、路径及重定向。仅连接本项目计算服务，不能把其他服务登记为计算端点。

运行中通过 `main.mjs enroll <私有登记文件>` 登记节点，文件为 `{ "expectedRevision": 版本, "node": 节点 }`。本机管理 URL 来自 EAGLE_COMPUTE_ADMIN_URL，默认 http://127.0.0.1:11436；现用 NAS 通过下述 SSH 命令桥接管理（该 NAS 已禁用 TCP 端口转发），连接时严格核对主机指纹。已有节点必须先停止接单，确认旧端点健康的实际 capacity.inFlight 与宿主 hostInFlight 都为零后才能重新登记；不能只凭本地请求计数为零就换 URL。verified=true 是完成独立验证后的运维登记声明，不由健康响应自动授予。登记容量和模型兼容验证属于显式运维，MCP 不暴露登记或凭据接口。

现用 Mac 运行独立 `ssh-bridge.mjs`（设置 EAGLE_COMPUTE_SSH_TARGET 为已核对的 NAS SSH 别名、EAGLE_COMPUTE_ADMIN_TOKEN_FILE 为私有本地凭据文件）。它仅监听 loopback 11436，校验本地管理凭据后，通过固定的 SSH 命令和 stdin 向本项目协调容器转发三个管理端点；请求内容不进入 shell 参数，NAS 管理凭据在容器内部读取，不经 stdout 返回。每次请求有时限、字节和两项在途上限。无需启用 NAS 全局端口转发。输入接收和 SSH 分段各有时限；管理写请求若超时，其提交状态未知，必须先重读 revision／当前策略，不能盲目重试。MCP 仍只暴露 status／set_policy，登记仍为运维接口。现用部署若已采用运行文档记录的生成覆盖文件，不重复叠加模板 Compose 文件。

当前会话未加载新 MCP 时，可使用 `node apps/compute-coordinator/control.mjs status` 或 `policy <私有策略文件>`；客户端配置默认为 `.runtime/compute-control-client.json`，仅含 loopback baseUrl 和私有 adminTokenFile 路径，权限要求同私有状态。

Agent 使用独立 `node apps/compute-coordinator/mcp.mjs`，只提供 compute_status 与 compute_set_policy。先读版本，再提交策略；并发旧版本变更返回 409。策略包含 enabled、concurrency、operations、durationSeconds 和 reason，持续 60 秒至 7 天，到期恢复登记基线；禁用和缩容不取消已开始计算。状态、审计和配置经原子替换持久化，服务重启后保留。暂停整个图库仍使用原任务策略，临时节点排空不能替代用户的长期暂停。

## Windows 接入顺序

1. SSH 密钥登录后运行 `scripts/compute/windows-preflight.ps1`，检查真实 CPU／内存／驱动／WSL。
2. 现用 Windows 采用独立原生 Python／CUDA 环境，无需 WSL 或重启；其他新主机选择原生或独立 Linux 环境后准备固定模型服务。固定模型修订、预处理、1024 维 MRL 和归一化。CUDA 健康声明 accelerator=cuda，并报告真实 capacity.limit／inFlight；协调器重启后必须实际观察到 idle 才开始接单。不能伪造 metal=true。
3. 使用独立合成／公开样本验证文字与图片向量、最差样本差异及检索排名；不能仅凭平均余弦阈值批准混用。尚未完成验证时保持 verified=false、enabled=false；未验证节点拒绝任何启用策略，MCP 不能修改验证标记。
4. 测定单张吞吐、峰值显存和小批量表现，批准保守 maxConcurrent。当前协调协议仍单张请求，不把批量试验当成已发布能力。
5. 经私有运维文件登记节点，再由 Agent 逐步启用、观察和回退。无需更改图库代码或把业务数据库开放给 Windows。
6. 如启用媒体执行器，先准备 ExifTool、FFmpeg、libheif、RAW Python 依赖和可选固定人脸模型，并设置私有 token 文件与已核对的私网绑定地址。Linux 才使用 setup-linux-media.sh；现用 Windows 原生启动器、S4U 任务与依赖位置以 current-runtime 为准，不能套 Linux 脚本或为了接单安装 WSL。实际认证健康、解码／编码和输出验收通过后才登记，防火墙仅允许 NAS 与管理 Mac。执行进程不需要数据库或 S3 配置；不得直接运行 worker main.js。

## 验证与发布

测试使用 loopback 合成服务及独立数据库，禁止拿固定安卓图库或现用照片做回归。新代码的测试、构建、架构检查和 DeepSeek 审查证据保存在本机 .omx/artifacts/compute-fleet-20261026。当前源码并不自动代表生产已启用；生产切换必须核对 worker 的协调协议兼容版本，并单独追加 compute-routing.yml，原地址覆盖文件作为回退。本轮已合并现用人物扫描版本及其任务守卫，不回退最新生产逻辑。

Mac MLX 默认缓存预算 4 GiB，上限配置 8 GiB，健康接口报告 active／cache／peak；这是 allocator 缓存预算，不是整个模型进程内存上限，也不承诺立即释放系统历史 swap。正在运行的服务必须正常重启后才加载该设置。

管理 loopback 通道假定本机用户可信，跨机只通过已有主机指纹校验的 SSH 隧道，不将管理 HTTP 暴露公网或多用户不可信环境。对同一账号内已可读取私有文件的恶意程序，不将 bearer 接口当作额外隔离边界；需要多用户本地隔离时，应改用受权限保护的 Unix socket 或带服务身份验证的 TLS。

远端图片响应使用 SEI1 二进制信封：最多 1 MiB 的 JSON 元数据，加经偏移／长度校验的二进制片段，总体不超过 256 MiB，单片不超过 128 MiB；不把高分辨率 WebP／动态视频变成 base64 JSON，也不改变像素或编码规格。worker 为 NAS、远端媒体和向量共享 1536 MiB 的在途预留预算，重图片与大回传按保守成本预留，只有轻任务可继续重叠；不足时通过原租约守卫回到短暂等待并退还本次尝试，按资源 FIFO 让出后续接单以免大任务被持续的小任务饿死，不转成坏图失败。预算是吞吐准入估计，不冒充解码器 RSS 硬上限；既有容器 2 GiB 限额继续生效。
