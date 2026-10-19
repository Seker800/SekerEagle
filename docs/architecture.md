# SekerEagle Architecture

## North star

SekerEagle 是独立的多用户图片管理系统，提供业务数据完全分开的「素材」与「照片」两个模式。素材模式延续现有素材管理用途；照片模式承载个人照片管理及摄影专属能力。用户通过模式切换进入对应的完整工作空间，而不是在同一图库中切换筛选条件。

两个模式复用底层实现：NestJS 持有业务规则，PostgreSQL 是业务事实源，MinIO 保存导入的原文件和派生媒体，worker 执行可重试媒体处理。浏览器和 Eagle 插件只通过同源 gateway 访问 API。复用基础设施和代码，不意味着共享业务资源、分类或可编辑状态。

### Materials and photos boundary

以下产品决策于 2026-10-18 确定，是后续设计和实现的约束；本节定义产品边界；代码实现与验证范围见实施计划及照片验收记录。

- 照片采用导入后由 SekerEagle 托管的路线，不建设群晖相册目录兼容、外部目录图库或双向文件同步。群晖备份属于独立的备份职责，不受此决策排除。
- 每项资源只属于素材或照片中的一个模式。不支持同一资源双重归属。2026-10-19 用户新增显式「发送到」移动入口：单选／多选右键将资源发送至另一模式，成功后原模式不再显示。创建新的目标资源、独立原文件和目标模式处理任务，原资源放入源回收站以保留可恢复性；不原地修改 libraryMode，不共享标签／分组／人物等关系。
- 相同文件分别导入两种模式时，形成独立资源；跨模式去重不得复用业务记录或导致编辑、替换、删除和恢复联动。
- 标签、标签分组、评分、智能分类、AI 分析结果、推荐、回收站及其他资源管理数据按模式隔离。同名标签可以在两种模式分别存在，不能建立跨模式资源关联。
- 所有资源读写、搜索、统计、分页、上传会话、导入幂等、批量操作和后台处理均须维护 owner 与模式边界。仅靠前端隐藏或过滤不构成隔离；跨模式按 ID 访问资源与跨 owner 访问一样返回 404。
- 模式在资源创建时确定并保持不可变。切换页面不能改变已经开始的上传、导入或处理任务的目标模式，也不能造成旧请求结果、选择状态或缓存串入另一模式。拖拽导入默认归属拖入时所在模式，发送操作是唯一显式跨模式资源创建入口。
- 通用资源管理能力在两个模式保持一致，通过共享应用服务和组件实现；不得复制两套完整系统，也不得在现有巨型页面或服务中持续堆积模式条件。
- 筛选只有一套共享字段目录、快捷筛选状态、规则编译与智能分类语义；摄影字段按模式扩展现有筛选器，不新增独立摄影筛选栏或并行状态。旧客户端摄影参数只在 API 边界转换为同一规则。
- 素材／照片切换放在左侧栏顶部，替换图标与 SekerEagle 品牌区域；不单独占用全宽顶栏。窄屏侧栏收起时仍保留该切换区。
- 照片的「照片时间线、地图、人物」入口统一位于左侧导航。相似照片组是图库的折叠展示：默认显示一张主图，打开后左右切换组内照片、设置主图；不得建立独立「照片组」主导航页。
- 照片首页采用等高横排、按原图比例排满每行的时间线，右侧贴边显示年份刻度，悬停显示年月，点击直接定位；这项 2026-10-19 用户修正替代此前沿用竖向瀑布流的约定。布局通过共享布局 hook 的通用 justified 策略实现，素材保持原竖向策略；缩略图卡片、缩放、虚拟化、查看器与管理操作仍共用，不建立第二套照片卡片。照片流按年月分段，以完整年月标题和分隔线区分；分段元数据由摄影适配层提供，共享横排布局统一预留标题高度、在分段边界换行，标题同样参与虚拟化，不另建图库或卡片。
- 时间刻度使用服务端按月聚合的全库索引与带 owner／模式作用域的分页游标，不能只索引已经加载的照片。按 chronologicalAt（拍摄时间缺失时为导入时间）排序；未筛选首页显示全库时间轴，搜索／筛选／智能分类时隐藏全库刻度，避免跳转到条件外的日期。固定高度时间轴的上下端点为当前可见图库实际最新／最早照片月份，按真实月份跨度定位，不添加无照片的首尾年份。年份标记按统一日历年边界定位，不随各年首张照片月份偏移；采用尺子式年大刻度／月小刻度；仅有照片的月份绘制刻度，空月份保持真实时间跨度并留白；悬停时附近刻度平滑放大并直接显示具体年月，不使用弹窗或月份面板；点击定位对应月份。照片流与刻度共用滚动容器，原生滚动条位于整个区域最右侧，刻度保持固定。
- 照片模式默认首页为按拍摄日期排列的时间线；无拍摄时间时回退至导入时间，在详情中明确标记。
- 照片模式的规划范围包括人脸识别与人物管理、GPS 地图展示、连拍／相似照片分组及清晰度选片建议、相机与镜头等摄影参数筛选。摄影能力与共用媒体、存储和任务能力保持明确依赖边界。
- 照片分组与选片建议是不同能力；分组保留成员原片，自动选片不等于自动删除。本轮不提供自动删除或覆盖原片；人物模型与保守分组规则通过独立摄影模块实现，具体默认值见照片验收记录。
- 现有资源与现有采集入口的兼容行为保留为素材模式；不得在升级时猜测或自动将现有图片重新归类为照片。

完整修改计划与待定事项见 [素材／照片双模式修改计划](photo-management-plan.md)。实施前须先完成计划中的模式隔离设计，不能跳过基础边界直接叠加摄影功能。

## Shared library architecture gate

素材与照片的通用页面、瀑布流、缩略图、查看器、上传与编辑流程使用同一装配入口；API 的照片通用 Controller 只继承素材 Controller，不覆盖方法，服务从同一 provider 注册表装配。`npm run architecture:check` 在 CI 最前执行，`npm test` 同时运行分叉反例、API 方法／服务身份和客户端请求契约检查。摄影扩展保留在工作区组合层与摄影模块中。规则、允许差异和变更流程见 [共用逻辑门禁](library-sharing-gate.md)。

## Viewer location navigation

大图查看器在复制图片左侧提供共享定位操作。返回当前模式的完整图库，清除搜索、规则与智能分类，按该模式默认日期顺序定位并选中图片；照片回到时间线，素材回到素材列表。服务端先验证目标 owner、模式、私密与回收状态，再用相同排序规则生成含附近图片的受作用域保护游标，不遍历全库。相似组成员定位到可见组封面，不修改主图；错误保留大图并允许重试。

## Image content editing

素材与照片共用一个图片内容编辑器、一份模式无关的编辑参数契约和同一服务端保存服务。裁剪坐标基于 EXIF 归正后的原图，之后翻转、旋转、调色；浏览器只解码派生预览，服务端在共用媒体预算内处理原图。保存创建当前 owner 与模式内的独立 PNG 资源，原片字节、版本和关系不变；继承当前人工标签、私密投影、评分与说明，不继承旧 AI／人脸／照片组及派生结果。保留摄影 EXIF，归正方向，不复制实况配对标识；副本重新进入现有媒体处理链。

客户端幂等键绑定源版本与编辑参数；持久化计划先拥有目标对象键，保存事务再次验证 owner、模式、私密可见性与源版本，并同时发布资源及处理任务。编辑计划锁贯穿对象写入与发布，防止重试或废弃回收竞态。七天未完成的计划由维护任务原子标记过期并写入对象删除 outbox，不能直接删除对象；已完成计划保留用于幂等重放。

## Camera media pipeline

两种模式共用 `library-core` 的格式／资源预算策略及 `media-core` 的本地解码、探测与转码适配。RAW 用 LibRaw 验证与解码，视频生成 H.264／AAC 播放副本；原文件保持字节不变。所有派生媒体仍验证 owner、模式、私密与当前版本，视频支持受鉴权的 Range 读取。不得另建照片上传白名单或直接让浏览器解码相机原文件。格式、限制与验证方法见 [相机媒体兼容](camera-media.md)。

## Live photo media

实况照片沿用共享媒体链路。Apple 图／视频按 ContentIdentifier 精确匹配，JPEG Motion Photo 从原文件的声明视频范围生成播放副本；原始文件不修改，普通照片不凭文件名误配。配对读取继续检查双方 owner、模式、私密与当前版本，旧原件被替换后关联失效。范围与规则见 [实况照片](live-photos.md)。

## Photo map delivery

照片地图默认使用随应用打包的 Natural Earth 陆地与城市概览数据，通过同源静态资源加载；地图代码、底图与标记不依赖海外瓦片、CDN 或外部字体。网站的炭黑与琥珀黄色令牌也用于地图背景、陆地、照片点、按钮与弹窗。照片坐标保持 WGS84，不引入第三方坐标偏移。

本地底图明确标注为概览，不冒充街道级地图。后续如接入国内详细道路服务，应使用正式授权接口、明确坐标系与离线回退，不能为免 Key 改用未授权瓦片地址。本轮不部署现用实例。数据来源、离线验证与限制见 [照片夜间地图](photo-map.md)。

## Image content search

普通搜索的语义召回直接比较搜索词向量与 `EagleAssetEmbedding`，不再通过 AI 标签或其向量召回图片。使用既有 Qwen3-VL-Embedding-2B 的相同模型修订、1024 维与处理空间；只读取 READY、isCurrent 且 assetRevision 等于当前媒体版本的记录。名称与人工标签文字匹配保留，显式 AI 标签筛选不受影响。8B 标签生成是独立能力，不是搜索依赖。

搜索继承 owner、模式、私密、回收状态和统一筛选边界。模型不可用或空间不兼容时明确提示退回文字匹配，不触发全库向量重建或 AI 打标。实现与验收范围见 [图片向量搜索](image-vector-search.md)。

## Dependency direction

```text
HTTP / plugin adapters
        ↓
application services
        ↓
domain rules and narrow ports
        ↓
Prisma repositories / MinIO adapters
```

## Asset deletion boundary

清空回收站只处理当前 owner、模式和私密可见范围。worker 在事务中锁定任务租约及资产，清空上传／采集的限制性引用，将原文件、派生文件和金字塔前缀写入独立删除 outbox 后删除资产行；提交后才允许消费者删除对象。outbox 不随资产级联删除，失败保留意图并带租约重试。禁止先删对象再尝试删除数据库资源。

## Invariants

- ownerId 只从认证主体推导，任何请求 DTO 都不接受 ownerId。
- 跨 owner 资源访问返回 404。
- 数据库与对象存储通过可恢复状态机收敛，不假装跨系统 ACID。
- worker 崩溃不改变已经提交的素材业务事实。
- 浏览器使用 HttpOnly Cookie；插件使用有限 scope 的 PAT。
- 浏览器写请求只有在来源已显式配置，或来源与当前 loopback/私网 IP gateway 的协议、主机和端口完全同源时才可通过；任意私网来源和任意 Host 均不构成信任。
- 不依赖或访问 SekerChat 运行时和数据面。
- locale 只影响 Web 与桌面展示适配层；业务规则、用户数据和 API 领域对象保持语言无关。
- 私密分类只由 owner 选择的人工标签规则决定；`EagleAsset.isPrivate` 是在标签写事务内同步的查询投影，不是第二套可编辑事实源。

## Backup boundary

- Host-owned backup orchestration pauses gateway/API/worker together; PostgreSQL and MinIO stay online.
- The unencrypted, owner-private off-machine directory contains the complete database, all S3 objects, deployment configuration and source/version evidence.
- The application only reads an administrator-only, sanitized status projection from a read-only mount. No public API can initiate backups, change SSH targets or access backup credentials.
- A new ordinary-file generation is atomically published as successful only after full read-back integrity verification and an isolated database restore. Retention never removes the previous successful directory before that point.
- An independent host watchdog terminates interrupted backup/export processes before reopening writers.
- Persist generation intent before receiving and publication evidence before switching current. Recovery reconciles a lost publish acknowledgement; a retention failure never reverses durable success. Owned partial generations are discarded before capacity checks, and NAS operations share a process lock.
- Restore verification containers carry an explicit role label and are removed by inspected immutable ID, including run timeouts. Legacy containers require exact independent identity evidence. Unknown NAS entries are quarantined without traversal or deletion.
- Every SSH path forces known-host verification and a direct connection. Docker contexts use a source allowlist and exclude private runtime directories at all depths. Legacy conversion is an explicit, documented operation; installation never silently adopts an encrypted state.

## Recovery and security invariants

任务记录是执行历史，当前版本的派生事实才是完成依据。补齐任务必须复用已保留的结果、修复缺事实的 completed job，恢复回收站时续跑明确被回收站跳过的工作。终态依赖失败向下传播；媒体与语义构建分别控制并发，所有构建发布先验证租约。事件通知有 30 秒周期兜底，后台与维护有领取配额。API 上传检查同样受两个模式共用的内存与队列预算约束。

原图替换在资产行锁保护的事务内递增版本并退休旧任务、分析和建议；金字塔回收沿用独立对象 outbox。向量空间身份不可就地改写；不同模型空间不得计算距离，切换空间必须有显式迁移方案。实时搜索使用带 owner、模式和查询条件的排序位置游标，不依赖 offset 或锚点行仍存在。

浏览器认证写方法默认验证 Origin；PAT 未声明 scope 时默认拒绝。刷新令牌按登录 family 旋转、退出按 family 吊销；访问令牌检查 family 是否仍有效。前端退出清空查询缓存并用认证 epoch 阻止旧请求重新写入。

MinIO root 仅用于初始化；API／worker 使用单 bucket 受限身份，bucket 不公开。MLX 子进程只继承明确的模型配置及 token，不 source 应用环境。部署先构建，再停止写入服务、迁移、启动并验证 API／Web／worker 健康；不自动倒退数据库。核验结论和验证范围见 [2026-10-19 架构核验](architecture-audit-2026-10-19.md)。

## Media memory boundary

- 原图只用于下载、首轮预览生成和需要离线处理的后台切片任务；图库与大图预览不直接解码原图。
- worker 先串行生成 1600px PREVIEW、256/512px THUMBNAIL，再让代表色与大图金字塔任务通过显式依赖继续。
- 代表色从当前 READY THUMBNAIL 提取；大图使用 512px、overlap 1 的 Deep Zoom WebP 金字塔。
- 浏览器大图查看器最多缓存 64 个瓦片，同时加载 4 个；不同筛选查询只保存资源 ID。当前实体仓库、查询与缩略图 Blob 缓存按 owner 与模式共同隔离。近期文件夹列表保持 5 分钟新鲜、30 分钟后回收，缩略图 Blob 使用 LRU 缓存，默认上限为 2048 项、512 MiB、空闲 30 分钟。
- Sharp 缓存固定为 64 MiB、内部并发为 1，媒体任务并发继续由 worker 队列控制。

## Explicit cross-library sending

共享发送服务从认证主体推导 owner、从路由推导源模式，目标只能为另一模式。原图在服务端独立复制；复制全部成功且源版本／权限仍有效时，在同一数据库事务发布目标资源与任务并将源项放入回收站。原模式移除成功前目标不可见。使用持久化操作计划与客户端幂等键，复制失败不移除任何源项，可重试同一操作；进程中断后的复制对象由计划追踪。实况照片连同唯一可访问的配对视频一起移动。私密标记保留，标签、人物和分组等模式关系不跨库。
