# 多机计算与 Agent 控制

## 边界与现状

群晖的 EagleAssetProcessingJob 始终是唯一业务队列。compute-coordinator 只维护宿主登记、短期容量策略及最近 200 条变更审计，不记录照片身份，不创建业务任务，不领取数据库租约、不持有数据库或对象存储凭据。API／worker 向协调服务发送已授权任务的有界输入字节，结果仍由原 worker 校验和发布。照片／素材、owner、私密、当前版本、依赖、时段、暂停、公平与租约守卫原样保留。

本轮实现向量、图片和人脸三个执行契约。图片复用原本地渲染／RAW／元数据处理函数；支持基础预览、缩略图及原有图片分析计算。视频、切片、编辑成片和物理清理继续在 NAS 原通道；没有宣称已接入 NVENC／VideoToolbox。向量保持单张协议，未未经实测扩大批量。新增算法或不兼容模型仍需更新节点软件；日常节点登记、排空、限流、恢复与切换已验证能力无需更新图库版本。

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

运行中通过 `main.mjs enroll <私有登记文件>` 登记节点，文件为 `{ "expectedRevision": 版本, "node": 节点 }`。本机管理 URL 来自 EAGLE_COMPUTE_ADMIN_URL，默认 http://127.0.0.1:11436；远程 NAS 应先使用已核对主机指纹的 SSH loopback 隧道。已有节点必须先停止接单且 inFlight 为零才能重新登记。verified=true 是完成独立验证后的运维登记声明，不由健康响应自动授予。登记容量和模型兼容验证属于显式运维，MCP 不暴露登记或凭据接口。

当前会话未加载新 MCP 时，可使用 `node apps/compute-coordinator/control.mjs status` 或 `policy <私有策略文件>`；客户端配置默认为 `.runtime/compute-control-client.json`，仅含 loopback baseUrl 和私有 adminTokenFile 路径，权限要求同私有状态。

Agent 使用独立 `node apps/compute-coordinator/mcp.mjs`，只提供 compute_status 与 compute_set_policy。先读版本，再提交策略；并发旧版本变更返回 409。策略包含 enabled、concurrency、operations、durationSeconds 和 reason，持续 60 秒至 7 天，到期恢复登记基线；禁用和缩容不取消已开始计算。状态、审计和配置经原子替换持久化，服务重启后保留。暂停整个图库仍使用原任务策略，临时节点排空不能替代用户的长期暂停。

## Windows 接入顺序

1. SSH 密钥登录后运行 `scripts/compute/windows-preflight.ps1`，检查真实 CPU／内存／驱动／WSL。
2. 在 WSL2 的独立 Linux 文件系统内准备 CUDA 与模型服务。固定模型修订、预处理、1024 维 MRL 和归一化。CUDA 健康声明 accelerator=cuda，不能伪造 metal=true。
3. 使用独立合成／公开样本验证文字与图片向量、最差样本差异及检索排名；不能仅凭平均余弦阈值批准混用。尚未完成验证时保持 verified=false、enabled=false；未验证节点拒绝任何启用策略，MCP 不能修改验证标记。
4. 测定单张吞吐、峰值显存和小批量表现，批准保守 maxConcurrent。当前协调协议仍单张请求，不把批量试验当成已发布能力。
5. 经私有运维文件登记节点，再由 Agent 逐步启用、观察和回退。无需更改图库代码或把业务数据库开放给 Windows。
6. 如启用媒体执行器，先准备 ExifTool、FFmpeg、libheif、RAW Python 依赖和可选人脸固定模型，先设置 EAGLE_COMPUTE_NODE_TOKEN_FILE（私有 token 文件）和 EAGLE_COMPUTE_NODE_BIND（经核对的私网 IPv4），再运行 setup-linux-media.sh；脚本检查 heif-info 与解码器等实际依赖。WSL 网络转发与 Windows 防火墙仅允许本 NAS 访问节点端口，接通 SSH 后实测 NAS 到 WSL 的认证健康链路，未验证不能启用。进程不需要数据库或 S3 配置；不得直接运行 worker main.js。

## 验证与发布

测试使用 loopback 合成服务及独立数据库，禁止拿固定安卓图库或现用照片做回归。新代码的测试、构建、架构检查和 DeepSeek 审查证据保存在本机 .omx/artifacts/compute-fleet-20261026。当前源码并不自动代表生产已启用；生产切换必须核对 worker 的协调协议兼容版本，并单独追加 compute-routing.yml，原地址覆盖文件作为回退。本轮已合并现用人物扫描版本及其任务守卫，不回退最新生产逻辑。

Mac MLX 默认缓存预算 4 GiB，上限配置 8 GiB，健康接口报告 active／cache／peak；这是 allocator 缓存预算，不是整个模型进程内存上限，也不承诺立即释放系统历史 swap。正在运行的服务必须正常重启后才加载该设置。

管理 loopback 通道假定本机用户可信，跨机只通过已有主机指纹校验的 SSH 隧道，不将管理 HTTP 暴露公网或多用户不可信环境。对同一账号内已可读取私有文件的恶意程序，不将 bearer 接口当作额外隔离边界；需要多用户本地隔离时，应改用受权限保护的 Unix socket 或带服务身份验证的 TLS。

远端图片响应使用 SEI1 二进制信封：最多 1 MiB 的 JSON 元数据，加经偏移／长度校验的二进制片段，总体不超过 256 MiB，单片不超过 128 MiB；不把高分辨率 WebP／动态视频变成 base64 JSON，也不改变像素或编码规格。worker 为 NAS、远端媒体和向量共享 1536 MiB 的在途预留预算，重图片与大回传按保守成本预留，只有轻任务可继续重叠；不足时通过原租约守卫回到短暂等待并退还本次尝试，按资源 FIFO 让出后续接单以免大任务被持续的小任务饿死，不转成坏图失败。预算是吞吐准入估计，不冒充解码器 RSS 硬上限；既有容器 2 GiB 限额继续生效。
