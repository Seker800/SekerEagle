# SekerEagle Architecture

## North star

SekerEagle 是独立的多用户图片管理系统，提供业务数据完全分开的「素材」与「照片」两个模式。素材模式延续现有素材管理用途；照片模式承载个人照片管理及摄影专属能力。用户通过模式切换进入对应的完整工作空间，而不是在同一图库中切换筛选条件。

两个模式复用底层实现：NestJS 持有业务规则，PostgreSQL 是业务事实源，MinIO 保存导入的原文件和派生媒体，worker 执行可重试媒体处理。浏览器和 Eagle 插件只通过同源 gateway 访问 API。复用基础设施和代码，不意味着共享业务资源、分类或可编辑状态。

群晖托管沿用上述应用与托管存储架构，不转成外部目录图库。AMD64 测试部署从共用服务定义生成独立项目，恢复到独立数据库与对象卷，现有备份只读；Mac 正式服务保持运行，测试完成前不切换。部署边界与恢复顺序见 [群晖测试部署](nas-staging.md)。

### Materials and photos boundary

以下产品决策于 2026-10-18 确定，是后续设计和实现的约束；本节定义产品边界；代码实现与验证范围见实施计划及照片验收记录。

- 照片采用导入后由 SekerEagle 托管的路线，不建设群晖相册目录兼容、外部目录图库或双向文件同步。群晖备份属于独立的备份职责，不受此决策排除。
- 每项资源只属于素材或照片中的一个模式。不支持同一资源双重归属。2026-10-19 用户新增显式「发送到」移动入口：单选／多选右键将资源发送至另一模式，成功后原模式不再显示。创建新的目标资源、独立原文件和目标模式处理任务，原资源放入源回收站以保留可恢复性；不原地修改 libraryMode，不共享标签／分组／人物等关系。
- 私密资源发送到另一模式时，目标独立创建或复用本模式的「跨库私密」人工标签并标记为私密标签，以保持私密投影；不复制源标签关系，也不把目标已有同名公开标签改成私密。两个模式的私密投影锁按固定顺序获取。
- 相同文件分别导入两种模式时，形成独立资源；跨模式去重不得复用业务记录或导致编辑、替换、删除和恢复联动。
- 标签、标签分组、评分、智能分类、AI 分析结果、推荐、回收站及其他资源管理数据按模式隔离。同名标签可以在两种模式分别存在，不能建立跨模式资源关联。
- 所有资源读写、搜索、统计、分页、上传会话、导入幂等、批量操作和后台处理均须维护 owner 与模式边界。仅靠前端隐藏或过滤不构成隔离；跨模式按 ID 访问资源与跨 owner 访问一样返回 404。
- 模式在资源创建时确定并保持不可变。切换页面不能改变已经开始的上传、导入或处理任务的目标模式，也不能造成旧请求结果、选择状态或缓存串入另一模式。拖拽导入默认归属拖入时所在模式，发送操作是唯一显式跨模式资源创建入口。
- 通用资源管理能力在两个模式保持一致，通过共享应用服务和组件实现；不得复制两套完整系统，也不得在现有巨型页面或服务中持续堆积模式条件。
- 快捷筛选栏的固定项与顺序按模式分别保存在当前浏览器的 localStorage，重载或重开后恢复，切换模式同时切换布局并关闭旧弹层。照片未自定义时默认相机、镜头、标签、格式；素材维持颜色、标签、形状、评分、格式。已保存的自定义（含空布局）优先于默认值；不持久化当前筛选条件，不新增另一套筛选器。
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

## Photo agent organization

2026-10-20 本机开发：摄影模块新增有界整理任务、城市级补充位置与非照片候选审核。设备 EXIF 保持只读；推断与人工位置独立保存，已接受的补充位置才参与普通展示与城市筛选，城市代表点不得冒充拍摄坐标。Agent 通过独立 stdio MCP 适配器访问现有认证 API，PAT 仅能读公开照片及生成建议；应用、拒绝、撤销与取消必须由浏览器主体执行。任务冻结资源和媒体版本，重试幂等，过期或并发变化拒绝写入。原片、原始 GPS 和时间线不变。

PhotoAgentService 属于摄影应用服务，不替换共用 provider。回收操作抽取为共用事务函数，普通界面与审核使用同一实现；MCP 不直接访问数据库或存储。首轮不开放跨库发送工具或永久删除，发送仍使用已有显式界面。现有基础设施共用、owner／模式与私密边界保持完整。实施与验证范围见 [照片智能整理计划](photo-agent-plan.md)。

## Shared library architecture gate

### Existing photo editor integration

个人 LUT 属于浏览器本地偏好资源：通过文件选择器导入，独立 IndexedDB 保存，现有照片 Worker 按需读取选中表并统一预览与导出。通用实现不携带私人 LUT，不建立上传接口或模式间业务资源关联；细节见 `docs/photo-editor.md`。

正式编辑由共享工作区的单一会话入口装配，图库单选右键、详情、大图和组内照片均调用它；查看器只发出编辑请求，不再持有第二份编辑状态。会话冻结来源、版本、当前模式上传函数及摄影元数据；身份或私密授权范围改变时销毁会话。RAW 显影副本的水印读取已有摄影元数据，不回读或修改 RAW 原片。

沿用现有 `media/photo-editor/PhotoEditor` 的调整、滤镜、裁剪、水印和 Worker 渲染，不建立第二套编辑器。显式编辑是原图按需读取的例外：浏览器原片编辑仅 JPG／PNG／WebP、最多 4800 万像素；RAW 使用 worker 生成的当前版本 sRGB 无损 WebP 显影副本（最长边 6000），明确标注为显影副本编辑，交互优先读取当前版本普通预览并缩至最长边 1280，保存时才读取上述高清来源，原图保持不变；普通图库与查看器继续只读取派生媒体。预览与高清来源的尺寸分开传递，裁剪与输出尺寸按高清来源计算；图库拍摄元数据直接传给水印，不为读取 EXIF 再下载原片。历史资源缺少摄影元数据、可靠预览或尺寸时保留原有读取路径，不以小图替代高清保存。该浏览器全尺寸保存路径尚不承诺手机内存表现，细节见 `docs/photo-editor.md`。

保存复用当前模式的认证分片上传，以 `CREATE_COPY` 创建独立资源。上传声明冻结来源 ID 与版本，由服务端验证 owner、模式和私密访问；发布事务锁定私密投影与源资源，复核版本后继承人工标签、私密状态、评分及说明。编辑副本在同一发布事务中自动追加当前 owner／模式的「已编辑」人工标签，与继承标签去重；同名标签保留用户设置并遵循私密投影。不按文件名推断历史资源的编辑状态。不复制 AI／人脸分析；照片组按下述成片归组规则处理；来源声明保留至会话清理，以便源删除后明确拒绝发布，不产生源模式归属关联。失败重试复用同一输出文件与上传会话，确认完成后只重试读取结果。编辑器打开时冻结原图和保存回调，避免后台刷新改变本次编辑的目标。

素材与照片的通用页面、瀑布流、缩略图、查看器、上传与编辑流程使用同一装配入口；API 的照片通用 Controller 只继承素材 Controller，不覆盖方法，服务从同一 provider 注册表装配。`npm run architecture:check` 在 CI 最前执行，`npm test` 同时运行分叉反例、API 方法／服务身份和客户端请求契约检查。摄影扩展保留在工作区组合层与摄影模块中。规则、允许差异和变更流程见 [共用逻辑门禁](library-sharing-gate.md)。

## Edited photo timeline and groups

照片时间线明确显示「拍摄时间 · 最新优先」，无拍摄时间使用添加时间；素材显示「添加时间 · 最新优先」。成片保留自身真实添加／创建时间，同时继承原片 chronologicalAt 与拍摄信息快照；后台只重算成片的画面哈希和清晰度，不从缺失 EXIF 的 PNG 覆盖继承信息或时间线位置。

仅真正发布成片时，在同一事务中通过既有摄影观察者扩展共用上传事件：先锁定 owner 的照片组，再锁定来源，继承摄影快照并加入来源已有可见组；无组时建立原片／成片组。组内私密边界不混合。主图优先级为用户手选、最新成片、自动推荐；未处理完的成片先保留可用封面，完成后展示成片。草稿不触发分组，普通素材上传不新增摄影行为。卡片右上角始终显示实际照片组叠片图标与可见成员数量，组内标明原片和成片；不依赖文件名或重新识别相似度建立编辑关系。

## Durable edit recipes and batch application

编辑参数版本化保存在 PostgreSQL，按 owner／模式／资源与媒体版本隔离；当前草稿自动保存，上传成片时在同一发布事务中冻结参数及原片来源。重新编辑成片读取原片和冻结参数，不对已合成的 PNG 重复叠加；原片缺失或版本变化明确拒绝继续，禁止跨 owner／模式／私密访问。私人 LUT 只保存表 ID，不上传表内容。

批量套用由共用编辑装配提供，使用现有 Worker 顺序处理并复用认证上传，一张完成后再处理下一张，始终生成独立副本。调整、滤镜、水印分别可选，裁剪默认关闭；每张照片用自己的摄影元数据，批量水印不复制源片的机型、参数和时间覆盖值。进度、逐项失败、取消和仅重试失败项可见；成功项不重复生成。

## Portrait and touch workspace

素材／照片复用同一导航树、文件选择器、选择算法和管理菜单。720px 以下通过原生模态抽屉访问完整导航，模式切换始终可见；改视图或身份／模式作用域时关闭抽屉。导入沿用既有认证上传与共享格式目录，文件选择不触发跨模式移动。显式选择模式以单次点击切换选择，右键和修饰键仍可用；操作按钮打开同一菜单。

快捷筛选弹层统一装入 body 浮层，按触发器与 visualViewport 定位，脱离工具栏滚动裁切，并随窗口／软键盘变化调整。普通大图按钮与键盘复用同一图片顺序和边界；不将单指切图绑定到已用于拖拽和平移的画布手势。

## Unified media viewer

单张图片、照片组成员和媒体预览共用 `EagleViewerShell` 的信息层级、工具栏、导航及关闭行为；图片统一使用既有 OpenSeadragon 查看器，视频仅替换舞台内容。摄影包装层只负责组成员选择、主图与取消分组，不建立另一套图片显示或页脚。

照片组在共享工具栏上方增加可横向触控滚动的缩略图条，标记当前选片和主图，并自动将选片滚入可视区域。组成员详情只在缩略图进入邻近可视区域或被选中时请求，沿用 owner／PHOTO 作用域及查询缓存，图片只读取当前派生缩略图；加载或失败时不以封面代替当前选片执行编辑、复制或设置主图。

## Viewer location navigation

大图查看器在复制图片左侧提供共享定位操作。返回当前模式的完整图库，清除搜索、规则与智能分类，按该模式默认日期顺序定位并选中图片；照片回到时间线，素材回到素材列表。服务端先验证目标 owner、模式、私密与回收状态，再用相同排序规则生成含附近图片的受作用域保护游标，不遍历全库。相似组成员定位到可见组封面，不修改主图；错误保留大图并允许重试。

## Camera media pipeline

两种模式共用 `library-core` 的格式／资源预算策略及 `media-core` 的本地解码、探测与转码适配。RAW 用 LibRaw 验证与解码，原始传感器预算最多 1.2 亿像素，RGB 派生解码仍限制 5000 万像素，高像素 RAW 采用半尺寸显影；元数据保留真实原片尺寸，不以副本尺寸覆盖。显影保留相机白平衡、关闭自动提亮，不承诺复刻厂商影调。视频生成 H.264／AAC 播放副本；原文件保持字节不变。所有派生媒体仍验证 owner、模式、私密与当前版本，视频支持受鉴权的 Range 读取。不得另建照片上传白名单或直接让浏览器解码相机原文件。格式、限制与验证方法见 [相机媒体兼容](camera-media.md)。

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

## Abandoned library sends

跨库复制计划先持久化再复制；超过 24 小时未完成的计划由全局维护任务分批锁定，标记为 ABANDONED 并事务写入现有对象删除 outbox。发布事务与清理使用同一计划行锁，过期操作不能再发布，必须重新发送。已完成计划永不参与此清理；原资源保持不变。过期计划保留为删除墓碑并每日重新排队，收敛可能迟于首次删除才返回的对象复制。

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

## Migration review safeguards

PostgreSQL 列级 `ON DELETE SET NULL (pointer)` 是刻意保留的数据库契约：删除可选关联仅清空指针，不清空 ownerId 或 libraryMode。Prisma schema 不能完整表达该列清单，部分关系使用 NoAction 作为建模折衷；生成迁移中的相关外键差异必须人工保留上述语义，禁止直接应用全字段 SET NULL。隔离数据库测试检查这些约束真实的 confdelsetcols，历史升级和完整恢复测试同样执行该契约。

双模式历史迁移要求停止写入后离线执行，不改写已执行迁移的 checksum。部署 Docker 命令有期限：普通命令 2 分钟、构建 30 分钟、迁移等待 10 分钟；迁移超时只停止本次迁移容器，保持业务写入停止。恢复时先查看 migrate 容器日志和 Prisma migration 状态，确认数据库一致后按 Prisma resolve 流程处理失败记录，再重新部署；不能盲目启动旧代码。新加入的废弃发送状态迁移在事务中设置 5 秒锁等待和 60 秒语句期限。

## 2026-10-20 人物隐私

照片沿用人工私密标签与同一个隐私可见开关，新增人物的私密规则。私密结果是当前版本人工标签、当前有效人脸所属私密人物的并集；实况同标识组件保守共享保护。API 与 worker 共用后端 library-persistence 中的事务投影，不在浏览器公共 library-core 引入数据库依赖，不覆盖共用 Controller 或 provider。人物合并保留任一方私密规则；纠错与分析写回必须在同一事务更新投影，锁顺序为隐私、人物。人工纠错在同一媒体版本的模型重跑中保留。

摄影人物入口只管理人物规则，通用图库、搜索、地图、媒体与 MCP 继续读取共用 isPrivate。编辑副本通过独立人工私密标签保留来源保护，不复制人脸分析；不自动删除、模糊人脸或将尚未分析的照片全部隔离。识别可能漏检，敏感照片仍可人工加私密标签。实施和测试限独立本机环境，不部署现用服务。
