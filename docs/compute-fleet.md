# 多机计算与 Agent 控制

> **2026/10/29 09:23 最新核验**：两机共用视频兼容修复已逐机上线，媒体bundle SHA256 `aedf3d98cfdad692ad29d74af7a35a5548912d4dae12e617e6b1be2115f1b0c0`（源f90f2cb9）；Python/模型/驱动不改。Windows四媒体共享8、Mac四媒体共享6/宿主7、Metal原预留保持，最终修订66均READY/在途0，两媒体已回登记基线。147张人脸扫描+39段视频共186项从原失败队列实际完成并入库；23长视频用户明确忽略，不再重试，不为满载制造重复任务；7坏原件及6依赖保留，4旧标签失败已被后来成功索引取代。三份独立报告、最终双机实际完整视频验收及实库不变/完成证据在私有failed-task-audit-20261029，详细交接见current-runtime，动态状态见检查点failureRecovery。原唯一业务执行器仍Mac PID22931，NAS业务worker保持停止，巡检PAUSED不恢复。回退先停接单确认实际0，再恢复同节点原bundle/原服务；不要执行旧未批准自动控制器。

> **2026/10/29 08:32 失败任务逐项诊断完成**：实际图库226条失败记录全部核验，其中147张人脸在原分辨率下逐张推理通过、37段短视频完整远端转码和接收校验通过，可按现有环境补跑；23段大视频逐段完整试算均触1GiB输出硬限并截断83.776–348.224秒，同一大文件Windows对照仍拒绝；另1段无效空音轨、1段时间戳／音视频时长不兼容。6份JPEG图像数据截断、1份NEF原始数据损坏，与存档SHA全部相符；6项颜色仅被上述JPEG上游失败阻塞。4条标签旧FAILED实际对应2个后来已有ACTIVE索引的标签，无需为旧记录重复计算，原类别手动暂停保留。
>
> 只读查询与隔离试算没有改变224条媒体失败记录的状态／尝试／租约版本，没有发布诊断产物、覆盖原件或重排历史任务；另一个账户2条冒烟样本单列。诊断进程和临时大文件已清理。暂时为本地两路视频预留的名额已恢复：**修订62，Windows媒体8、Mac媒体6且四能力、Metal3／交互预留1**，三节点READY；Mac业务进程及现用镜像保持，半小时巡检仍PAUSED。传输／模型／驱动／数据库未变，未改生产代码。证据及226项人类可读清单在私有 `.omx/artifacts/failed-task-audit-20261029/`，动态状态仍读检查点和compute_status。

> **2026-10-29 05:28 +0800 业务执行进程已迁至 Mac（覆盖以下历史快照）**：Windows／Mac 原生媒体继续处理 image、pyramid、video、faces；Metal 向量只走 Mac。原群晖唯一业务 worker（领取、续租、人物归类、校验、发布及原地图维护）现由 Mac 原生 LaunchAgent 接管。程序来自最新正式镜像 `sekereagle/worker:unified-fedfa7f11b60`，SHA `sha256:d569dd3b3204811971f3b8a5af0abe7f2aedbdb36a4f2ee6650769d13b5444dc`；616个运行文件逐一SHA一致，锁文件与Node22.22.3一致，无重建混入其他聊天代码。数据库和对象存储保留NAS，API/web仍unified，其他容器身份与启动状态保持。
>
> NAS原主worker正常排空exit0后停止。完整Compose链末尾新增 `maintenance/business-worker-mac-20261029/mac-worker-placement.json`，NAS worker设 `restart:no`、`deploy.replicas:0`，避免后续整体up重新启动。Mac常驻 `com.sekereagle.business-worker` 和 `com.sekereagle.business-worker-relay`，gui/501；私有目录 `.runtime/business-worker`、不可变版本 `releases/worker-d569dd3b3204`，环境／证书不提交。新业务身份 `worker-a25ec7fe-c346-4168-af0f-b7a90ac3324b` 已在原NAS数据库写入新鲜心跳，正式任务中心双模式ONLINE/modelIssue为空。媒体修订57仍为Windows八路、Mac六路／宿主七，Metal交互预留保持。
>
> 可信业务角色与无状态媒体执行器分离：只有原业务角色持有必要DB/S3/执行凭据，无JWT或浏览器秘密。客户端三个接口只监听loopback，专用双向证书接入原NAS固定服务；执行代理不暴露admin，原数据库密码、S3签名及执行令牌仍必需。Docker发布会遮蔽来源，身份取决于mTLS；受信局域网仍有预认证连接耗尽的可用性风险。未开SSH转发、改路由/Wi-Fi/全局防火墙，未接触SekerChat。
>
> 现有效资源／版本的媒体PENDING和PROCESSING均0。这轮57,157个人脸子任务：完成56,515、失败147，另495因资源删除或旧版本不再执行。147是此前大图限制导致的本轮失败，尚未重试；旧视频等历史失败及MATERIAL标签手动暂停保留。没有可执行积压时空闲正常，没有制造空算、重复处理或新扫描；不宣称持续硬件满载。
>
> 新传输七项、lint/typecheck/build/架构检查及当前正式副本17项真实隔离库隐私／人工身份／租约／事务发布验收通过；五类生产执行API经实际NAS TLS链通过，证书／数据库密码／存储／执行认证反例通过。原迁移账本59项不变。DeepSeek传输报告收到并逐条核实；两个自动切换候选的恢复缺陷已记录，未执行、未批准作为无人值守工具。实际逐步观测排空、新PID/专属心跳、其他容器一致后持久接管，三份报告和取舍见私有 `.omx/artifacts/face-repair-20261028/business-worker-move/`。
>
> 后续worker升级必须更新Mac不可变程序和同依赖验收，不能只在NAS拉起worker。回退先通过launchd正常停止该Mac业务PID并确认子进程退出，再用私有NAS `manual-placement-state.json` 中原容器／重启策略恢复，核对ready、新鲜心跳及稳定运行；仅在完整链仍属本版本时恢复旧链。不要执行私有未批准自动控制器。半小时巡检仍PAUSED；动态状态读检查点及 `.runtime/business-worker/placement-state.json`。

> **2026-10-29 04:21 本批生产发布后核验**：API／web／worker统一发布 `unified-fedfa7f11b60` 后，约124秒窗口Windows媒体完成计数+127、Mac媒体+413，Mac向量完成真实文字查询+1，三个节点均READY；另131秒实库窗口人脸完成+581且无新增失败。两处窗口起止不同，不相加推算吞吐。原生代理及协调器未由本批换版，修订仍57；Windows已验证八路、Mac媒体六路及同宿主七名额／交互预留保持原样，未覆盖用户暂停、时段或模型／租约守卫。生产任务中心双模式ONLINE，现有人脸积压继续推进；向量、颜色等无待办时空闲是正常状态。证据见 `.omx/artifacts/unified-release-20261029/fleet-window.json`、`database-window.json` 与现用运行文档，本批没有宣称硬件满载。

> **2026-10-29 02:56 当前交接**：正式worker已为 `claim-8fcfb1bc`（在118fffcb三模块流水线上仅覆盖job-claim.js/map），独立报告已收到，原CAS保留，本地重叠领取避免同版本重复抢占；13项回归及全隔离库/镜像通过。API仍privacy-9e30be7、所有原生/协调器/存储不变，登记修订57。两分钟实测Windows平均0.55/峰值1、Mac平均0.42/峰值4在途，**仍未达到硬件满载**。
>
> 新确认瓶颈为NOTIFY提交全局锁：30次SQL采样85个COMMIT等object、24个等WALSync、最久2.04s，pg_locks classid1262/objid0；与[PostgreSQL 16 PreCommit_Notify](https://github.com/postgres/postgres/blob/REL_16_STABLE/src/backend/commands/async.c)的提交顺序锁相符。候选2c6ef68d只新增迁移，跳过不增加可执行任务的领取/正向续租广播，仍保留新增/重试/依赖/设置/回退租约通知及同步提交。RED/GREEN、全门禁/历史升级/恢复已过，NAS唯一待迁移项/目标守卫预检已过；**候选尚未应用，等独立审查，不能当作生效**。维护API镜像仅携带迁移，不含其他聊天代码；拟只迁移函数、不重启API/worker/PG/原生执行器。

> **2026-10-29 02:23 生产更新**：已正常排空上线 `worker:pipeline-118fffcb`，仅REMOTE并行领取、人脸有界批量回写三模块；独立审查两份报告均收到并逐条核实留档。其余容器/环境/挂载/限制未变，原链追加 `maintenance/pipeline-final-20261029/image.json`。Windows8/Mac6及宿主限额保持。实库尚余人脸29,494、处理中2、当前扫描FAILED147；首分钟完成67，仍未硬件满载。实际数据库并行领取争同一ID的租约更新，正在修复同进程重复CAS争抢；旧候选说明为历史状态。

> **2026-10-29 01:40 未发布候选说明**：当前生产仍是下述privacy-9e30be7及原生8/6/修订57。并行领取候选4f9f9fc的独立审查发现同批兄弟可能误清新内存等待，已实测复现并在49c102f修正，**旧候选从未上线、禁止部署**。最终候选118fffcb还补充REMOTE通知补唤醒，和有界人脸回写批次：每owner独立，最多8照片/总128脸、初始等待最多200ms、排队最多32项；仍逐照片执行原租约/版本/人工身份/隐私守卫，整组事务失败再逐项原事务隔离。无人脸仅跳过未使用的人物/纠错SELECT，状态与隐私写入保留。三项模块覆盖候选尚待最后独立审核后发布，当前不能声称两机满载；生产30秒基线Win CPU均值2.13%、Win平均0.48/Mac0.30在途证明供料仍是问题。两轮隔离完整门禁与真DB恢复已通过，新补唤醒的限定worker验收正在执行。

> **2026-10-29 00:47 当前生产核验（覆盖下文旧快照）**：已修复大预览人脸输入误报500导致整节点反复隔离。保留原分辨率、固定模型/阈值/向量，像素上限40M、编码字节20MiB/时间/线程/输出边界保留，已知坏图/超像素返回422，模型及基础设施故障不伪装输入错误。两机公开脸及全景兼容、4路边界和后续完整容量验证通过，DeepSeek独立报告已收到。
>
> 生产原生bundle SHA256为 `0f3e988ebf1df463df55b8394c717f50ce1d7b225b00761e4e221b93048ada7d`，Python SHA256为 `ff4fb54e6e86929f03843a09e41a3c9c59689009c7899da6fbe51a6ff87efc79`。**修订57：Windows四媒体共享8路/宿主8，Mac四媒体共享6路/宿主仍7，Metal3且交互预留1；同宿主后台总6守卫保持，GPU后台会与媒体竞争，不能承诺GPU独立另加2路。** Windows8/Mac6的40M人脸图、视频、切片、PHOTO图片、人脸、混合任务均真实隔离验证通过；Windows最低空闲约21.7GB，Mac事后memory_pressure系统可用82%、swap较前未增加，裸free页约17MB不是系统可用余量。源码允许最高16，仅是参数上界，fleet单节点上界8及登记实测上限仍生效，不能据此直接开16。MATERIAL图片仍受NAS worker单任务768MiB预算限制，不把代理资格冒充全链路14路。
>
> **NAS主worker本地PHOTO_FACE_PYTHON/MODEL_DIR/SCRIPT已持久置空，人脸只走两机**，完整Compose链保留 `maintenance/face-remote-only-20261029/remote-only.json`。worker/API现用 `sekereagle/{worker,api}:privacy-9e30be7`：仅基于各自原镜像覆盖已独立审查的library-persistence index.js/map，用既有id/实况索引替换单张投影的全分区OR扫描；同owner/PHOTO、实况同伴、空范围/全库范围、隐私锁、最终发布/版本语义不变，无新DDL/迁移/耐久性调整。API该模块与原worker完全相同，故同样最小覆盖，未发布其他聊天的API改动。web/协调器/PG/MinIO/gateway原容器不变，PG仍3GiB/memory+swap4GiB，Compose追加 `maintenance/privacy-supply-20261029/images.json`，原配置/镜像/回退在同目录。
>
> 目前照片仍真实处理中，持续硬件满载尚未达成。领取通道还有串行数据库等待，候选 `4f9f9fc` 仅为REMOTE_MEDIA并行领取名额、保持NAS/向量原行为和1536MiB内存/租约保护，**尚未上线**；候选镜像 `worker:parallel-4f9f9fc` 已在NAS无网只读环境通过14项pool测试，等待隔离全量门禁与独立审查后切换。用户其他聊天在改asset-operation，当前验证从生产基线5f2872d加本任务准确文件另建私有隔离副本，不能把他人的源码或失败混入本批发布。半小时巡检仍PAUSED；未改网络、模型/驱动、SekerChat、未重扫全库或重试历史FAILED。
>
> 本轮完整证据及三份已完成报告在私有 `.omx/artifacts/face-repair-20261028/`；动态进度/最后策略读私有检查点，不把此时间快照当实时值。

> **2026-10-28T23:25:28+08:00 故障复核（覆盖旧健康快照）**：用户反馈NAS高CPU、两机闲置。实测coordinator1.55%、worker12.88%、PostgreSQL261.73%；数据库占主要CPU，群晖仍执行业务领取／人物归类匹配／隐私与结果发布，并非仅转发。节点健康反复OFFLINE，而同容器直接认证GET两媒体均200/空闲；正常排空后重启原worker/coordinator，同容器/镜像/配置/挂载保留，未根治，不能当恢复完成。大量重试输入的READY默认预览为3464×1280（4,433,920像素），超过infer.py现有4,000,000像素上限；一张同尺寸纯色合成JPEG直连Mac媒体稳定复现POST faces=500/MEDIA_COMPUTATION_FAILED，同时GET health=200。原server把上游500隔离节点，worker记录REMOTE_MEDIA_REQUEST_REJECTED并重试，状态变化又使发现提示失效，形成查库/重试/离线循环。部分待办已尝试10–11次，故此前正常速度的ETA当前不可靠。根因在输入适配及单任务错误分类/节点隔离耦合；尚未修复，不放宽模型上限/质量、不批量重试历史FAILED、不更改用户暂停或网络。证据在私有`.omx/artifacts/health-flap-20261028/`，NAS`maintenance/health-flap-20261028/`保存重启快照。

> **21:46 接续实测**：本轮启动后 Windows 人脸计算239次、Mac228次，两机均持续接单；最近五分钟原数据库完成人物356项、无新增FAILED。worker同窗口日志平均端到端1787ms／中位1646ms，较修复前两进程采样4338／4572ms下降；任务组成与采样窗口不同，不把此数当受控吞吐倍数。PostgreSQL当次CPU32.16%、主worker41.70%，Windows单次CPU11%（修复前采样4%），这些瞬时值不代表长期平均或硬件满载。仍观察WALSync约0.30s、隐私发布锁等待约0.82s，接下来限制在写盘／发布，不能宣称两机已满载。待办人物46,417、处理中1为此刻快照；其他PENDING旧记录均来自已删除资源，未强制执行。

> **2026-10-28 21:40 当前核验（覆盖旧快照）**：供料与双机公平分配已发布。21:39:47 完成正常排空后切换，worker／compute-coordinator 镜像为 `sekereagle/{worker,compute-coordinator}:dispatch-a059ca7`，均基于原 6c 镜像，只覆盖已审查询模块 JS/map 与 fleet.mjs。API／web 仍 `nas-a48f8e07b1f47883e4ddc7d3a27808ca5d22bf9c`，PostgreSQL 原实例、3 GiB／memory+swap 4 GiB 保留；其他 API/web/PG/MinIO/gateway 容器身份、环境、挂载、限制未变，无数据库迁移、索引、JIT／耐久性或网络变更。
>
> 修订 **41** 已恢复两台媒体各 `image,pyramid,video,faces`、共享四名额，Mac 宿主七／Windows四及 Metal 交互预留原样，七天策略到期恢复相同已验证登记基线。新分配器在后台优先用空闲节点，空闲同伴轮换，有在途按同类操作耗时估计，交互保留延迟优先。原 `4642828` 待审逻辑现经第一份本轮有效独立报告覆盖并随最终镜像发布；下文“因QUOTA未上线”仅是旧阶段记录。生产启动后的首批计数 Windows 人脸12、Mac人脸13，已确认双机接单；重启会重置协调器计数，业务进度仍以原数据库为准。持续硬件满载尚未证明。
>
> 实测旧全库发现领取50项却探测约49,037条历史上传；查询现只在全库发现时物化最近24小时已完成上传事实，原 key/owner/模式/版本/依赖/暂停/时段/排序及租约CAS保持。已知最多50个ID的逐次复核仍走原唯一键关联，避免每次读取整个近期集合。**仅非空 BACKGROUND/HISTORY 提示上限120秒**；交互、近期、undefined及所有空提示仍30秒，耗尽即时重填，通知／策略失效保持。历史后台自然到期重试或过期租约可能等到窗口刷新（最长120秒），这是有界吞吐取舍，不冒充没有个体任务额外等待。每次使用提示仍完整验证当前业务守卫。
>
> 现在正常待办主要是人物，颜色只剩已删除资源旧记录，原片／视频专属进程此前已排空。已把重复的 `worker-faces`／`worker-colors` 同样正常排空停止，仅原主 worker 按双机合计容量供料，避免多份全库发现争抢 NAS；四个专属服务配置及回退保留，可在对应积压重新出现时启用，未暂停任务类别。主 worker 持续运行、原唯一业务队列未换；半小时自动巡检保持 **PAUSED**。未重试历史FAILED、重排全库或制造GPU空算。CUDA向量仍未经资格、未登记。
>
> 两轮全量隔离库历史升级／权限／私密／并发／50k／真实worker／完整恢复通过；全仓lint/typecheck/unit/build/architecture通过，审核修正后worker lint/typecheck/unit/build、17项selector及非空近期事实、50k访问量回归再次通过。NAS最终镜像SHA与本地产物一致，离线fleet22项通过。DeepSeek两份独立只读报告均收到：首轮指出长缓存交互延迟，已限制为历史后台；复审无阻断项，补强三个纯测试断言并重跑，生产模块指纹未变、无需第三轮。报告、后续测试差异及最终指纹均留档，不将 --check 的测试文件stale结果冒充通过。
>
> 完整Compose链仍从 NAS `maintenance/processing-upgrade-20261023/release-compose.json` 读取，已追加本轮 `maintenance/dispatch-supply-repair-20261028/images.json`。原state私有备份、旧链、各服务私有快照、排空／切换／回退计划／镜像日志在同一目录；回退须先排空，再用原兼容6c镜像，保留当前state且仅在完整链仍为本次版本时恢复旧链。私有本机证据 `.omx/artifacts/dispatch-repair-20261028/`，实时推进读检查点，旧快照不作当前状态。

> **2026-10-28 13:27 当前核验（覆盖下文旧快照）**：用户明确授权开启全部可执行后台工作，正式人物入口已成功提交 **57,157** 项，创建时间 04:32:39.457 UTC。不是仅开启节点：此前旧照片未进入人物队列，原 SQL 20 秒及首次 120 秒尝试超时回滚；现用 API/web 为 `a48f8e07b1f47883e4ddc7d3a27808ca5d22bf9c`，worker／协调器仍 `6c10813b4c7ab9e1fc3b2e8d372eb742f00a4f84`。人物扫描 SQL／事务／两条网关路由／客户端期限依次 600／630／660／690 秒，普通 API 15 秒、普通客户端 30 秒不变。正式扫描提交后仍见外层 504 提示，不声称全 HTTP 链已修复或返回 200；以原业务数据库确认成功，未重复发起全库扫描。
>
> 两机正式执行器与模型未变。当前节点策略修订 **40**：Windows 四共享名额具备 `image,pyramid,video,faces`，Mac 四共享名额暂用 `image,pyramid,video`，使当前重人物任务走 Windows、颜色／图片走 Mac，避免原跨操作 EWMA 持续偏向 Mac 人脸；Mac Metal 仍背景二、保留交互一，宿主上限 Mac 七／Windows 四。媒体热策略七天到期恢复登记基线，不覆盖类别暂停／时段／owner／版本／租约／质量。修订 39 期间 Mac 接脸明显多于 Windows，不能称均分。**半小时自动巡检仍 PAUSED，未擅自恢复。**
>
> 原有限时辅助领取改为标准 Compose 服务 `worker-faces` 与 `worker-colors`，同已发布 6c 镜像、同唯一业务队列、原租约及发布守卫；分别限人物与颜色，`restart: unless-stopped`，不再一小时到期。原主 worker 继续覆盖全部类别。详情队列已无积压；视频仅剩一项已删除资源旧任务，因此专属 `worker-details`／`worker-video` 已正常排空停止，配置／回退保留，未暂停任务类别。新进程初始连接池限制 2 引发 P2024，已恢复与原主 worker 完全一致的原 DATABASE_URL 并正常排空重启；不把旧错误藏掉。当前 faces 上限 768 MiB，colors 2 GiB；主 worker、PostgreSQL 容器及缓存保留，PG 仍 3 GiB／memory+swap 4 GiB，无重启、索引、JIT 全局配置或耐久性修改。
>
> 13:26:57 实库快照：人物 PENDING 54,487，颜色 14,773（先前核对其中 30 项资源已删除）；最近五分钟完成人物 **305**、颜色 **8**、新增 FAILED 零。剩余预览及向量各一项均已删除资源，原守卫正确阻止领取，不计为立即可执行 GPU 工作。修订 40 后 Windows HTTP 完成计数 28,474→28,945，Mac 媒体 27,047→27,054，均有实际产出；HTTP 计数不当业务落库数或利用率。**持续硬件满载仍未达成**，NAS 候选发现／回写仍限制供料。只读同快照 JIT 对比证明结果一致，但编译仅约 118 ms，不足以解释数秒差距，因此没有按猜测改全局数据库设置。CUDA 向量兼容仍未通过、未登记；不以无效计算制造 GPU 负载。
>
> 最终交付已通过全仓 lint／typecheck／unit／build、架构门禁、42 项客户端／共用契约，以及隔离库五万项扫描、权限／私密／幂等／并发、历史升级、真实 worker 和完整恢复验证。期限修正按现行 AGENTS 风险判断未单独触发外审；未改变认证／扫描 SQL／并发算法。先前调度候选 `4642828` 外审仍 QUOTA 失败，**未上线**。实机镜像内文件 SHA 与本地一致，保留网关既有签名 Host、原资源限制及无关服务。完整 Compose 命令从 NAS `maintenance/processing-upgrade-20261023/release-compose.json` 读取，保留所有现用覆盖；备份／回退分别在 `maintenance/face-scan-complete-20261028/`、`managed-compute-workers-20261028/`、`managed-pool-correction-20261028/`、`managed-compute-colors-20261028/`。动态进度与证据读私有检查点，不把此快照当实时状态。

> 2026-10-28 10:10 核验：用户要求继续给双机派活。热策略依次修订 36／37：Windows `image,video`，Mac `pyramid,faces,video`，两机仍各四共享名额、Mac宿主七、Windows四，六小时后回登记基线；向量仅 Mac。原六小时详情领取进程继续，新增同版 worker 的人脸／切片类别领取，六小时 TERM 后自然排空；未新增业务任务、重试历史 FAILED 或覆盖用户安排。共用现用领取器同守卫只读样本：人脸／切片各选四项，INTERACTIVE 视频零项，不能把全部视频积压当立即可执行。10:04:30–10:10:03 实库完成详情 35、颜色 144、人脸 88、切片 5，无新增 FAILED，最终采样详情两项 PROCESSING。NAS worker 合计约 808.5 MiB／2 GiB；并未达到持续满载。轮流派发候选文件 SHA 与前次一致、22 项 fleet 测试通过；隔约十九小时后仅一次 Harness 重试仍 QUOTA 失败，无有效报告，候选未上线且不再无依据重试。巡检仍 PAUSED。私有检查点 manualMoreDispatch 记录当前策略、进程、审查状态及窗口证据。

> 2026-10-28 10:00 核验：09:56 最近五分钟实库完成颜色 410、详情 1、视频 1、人脸 1，并非后台全停；当时仅颜色 1 项 PROCESSING。昨晚两个人工限时进程均正常退出 0，累计原片详情 284、人脸 1186。09:58:24 恢复相同已发布 worker 的独立详情类别领取，最长六小时后 TERM 停止新领取并自然排空，不恢复半小时自动巡检，不新增任务或重试历史 FAILED，不改变节点验证容量、用户暂停／时段及发布守卫。初次核验已有 10 项详情实库完成、2 项 PROCESSING，无辅助进程错误；NAS worker 约 517.5 MiB／2 GiB。当前三节点 READY，临时角色策略已到期回登记基线，两媒体各四能力／各四共享名额；向量仍仅 Mac。此为继续推进现有积压的有限运维安排，持久派发公平性／供料瓶颈尚未修复，不宣称满载。实时证据见私有检查点 detailsResume。

> 2026-10-27 22:29 核验：Windows 低负载属实，主要颜色计算平均约 13 ms，短时完成数不能代表持续利用。已用相同现用版本额外领取既有 `GENERATE_RENDITIONS`（原片详情／RAW）工作；两分钟限时进程完成并实库写回 8 项后正常退出 0，接续的一小时详情进程已完成 2 项，Mac 一小时人脸进程已完成 43 项，未见错误。这是手动有限运行，非恢复半小时自动巡检，无新业务排队、历史失败重试或容量扩张。Windows RAW 阶段 CPU 曾采到 28%，随后四次为 13/5/3/11%，NVENC 均为 0；不能宣称满载，也不能把系统 GPU 其他活动归因于 RAW。两一小时领取进程约 23:29 停止新领取并自然排空；节点策略仍约 23:23 到期回登记基线。NAS worker 合计约 532 MiB／2 GiB，PostgreSQL 同次约 240.9% CPU，数据供给／回写仍限制并行。私有证据见检查点 manualCpuSupply。

> 2026-10-27 22:20 补充：按用户即时派活授权，在现用 NAS worker 容器内启动同一已发布 worker 的临时人脸／视频领取进程，限时 600 秒，256 MiB heap，人脸本地执行配置清空；不改变双机各 4 的验证上限，超时发 TERM 后按原生命周期排空。原 worker 继续颜色和向量，自动巡检仍 PAUSED。14:14:55 UTC 后实库新增完成人脸 262、视频 9、颜色 201、向量 95、切片 1；这是窗口快照，不是完成全部积压或硬件满载。用户进一步要求两机一人一半：现用策略没有按数量五五分设置，待审轮换补丁仍未上线，不把两个相同并发额度冒充已对半分配。运行标识和私有证据见检查点 manualOneShot。

> 2026-10-27 22:01 核验：用户已要求暂停半小时自动巡检，`sekereagle-2` 状态已确认 PAUSED。图库后台和执行器继续运行；现有修订 35 的临时分工约 23:23 到期后恢复登记基线，不再自动续期。双机充分利用的目标尚未达成，下文巡检续期叙述为暂停前记录；实时证据见私有 `paused-summary-live.json`。

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

北京时间 21:23 巡检提前续期后的运行策略修订 35：Windows 临时接 `image,video`（图片、RAW、颜色与视频），Mac 媒体临时接 `pyramid,faces,video`，Mac Metal 继续向量。此前修订 28／29 临时开放 Mac image 共同接图片；观察后 Windows 的计算计数停在 10,784，后续约半小时没有新增接单，视频落库窗口从 139 降到 26，颜色从 1,433 增到 1,685。不同窗口的任务成本不完全相同，不能据此宣称精确吞吐倍数；没有可靠的整体收益且出现节点分配失衡，因此撤回 Mac image，恢复 Windows 图片／视频主力。保留已经验证的 Mac 图片能力为备用，不增加并发或重启服务。08:24–08:54 UTC 实际落库增加视频预览 160、向量 607、颜色 63，新增 FAILED 与超时租约均为零；Mac 媒体同期没有新增接单，而视频仍积压约 2,505 项，因此加入已验证 VideoToolbox 分担视频，未增加每台 4／Mac 宿主 7 的容量上限。核验材料在私有检查点及 `heartbeat-20261027T0853-*`，这些数量为时间窗口证据，不是实时剩余。两条媒体策略现为 2 小时，到期恢复原四能力基线；仍每 30 分钟巡检，按真实积压复核，在剩余不足 45 分钟时提前续期或调整，避免核验耗时期间意外恢复默认分工。仅延长有限策略的缓冲时间，不提高名额或改变用户处理时段。两台都已验证四媒体能力，表中的“备用”代表当前策略没有派该类任务，不是能力缺失。

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
