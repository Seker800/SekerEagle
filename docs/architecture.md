# SekerEagle 架构现状与边界

本文描述当前代码的稳定契约。部署镜像、机器、进程和模型位置由[现用运行状态](current-runtime.md)单独记录；历史决策保存在[归档](history/architecture-through-2026-11-01.md)，不将当时的“本地候选”当成当前发布状态。新增功能先明确能力归属及写入入口，再修改实现。

## North star

SekerEagle是单owner、自托管的个人图片工具，规模锚点为约六万份照片／素材和单张最高6100万像素，默认服务网页与桌面。产品取舍与真实资源预算分别由[产品边界](product-frame.md)和[性能预算](performance-budget.md)维护。

素材和照片是导入托管、业务隔离的两个模式，共用图库与基础能力。认证主体推导ownerId，模块注入不可变libraryMode，资源不能同时属于两个模式。跨owner统一404；私密访问、当前媒体版本及租约守卫在读取和发布时复核。认证、数据正确性和不丢数据优先于吞吐，产品不设置防想象中用户滥用的配额。

共享约束保护的是唯一事实来源和写入语义，不是文件数量或类的名字。允许按能力拆目录、应用服务和模块；拆分后仍须复用原权限、版本、事务及队列原语，不能派生出照片版上传、删除或选择系统。API的Prisma／SQL是现有持久化适配实现，不为形式上的四层图增加转发端口或通用仓储。

## 能力归属

共享能力由`apps/api/src/eagle/library-capabilities.ts`登记并装配；同一provider只归属一个能力，模式差异显式登记。摄影专属服务在`apps/api/src/photos`装配。能力拥有自己的表与写入入口，引用EagleAsset不等于拥有其生命周期。

| 能力 | 权威入口与状态 | 依赖与执行位置 |
| --- | --- | --- |
| 资源、标签、可见性 | EagleService／EaglePrivacyService及既有资源事务 | API读取／接收修改，固定owner／mode |
| 上传与导入 | EagleUploadService、原上传会话；导入应用服务和适配器 | 认证直传S3，原发布事务 |
| 发送 | EagleLibraryTransferService／EagleLibraryTransfer | 独立operations；创建独立目标，成功后源退役 |
| 操作进度与回收 | EagleAssetOperationService及operation／item | 独立operations；复用原回收与租约事务 |
| 查重 | EagleDuplicateService、指纹／分组／忽略表 | 原操作队列；严格原图证据，批量回收 |
| 搜索与索引 | EagleImageSearchService／EagleVectorService及原索引 | API读取；模型与索引计算在独立worker |
| 人物、地图、统计、整理 | PhotoManagement／PhotoMap／PhotoStatistics／PhotoAgent服务及各自表 | PHOTO专属；沿用共享资源和发布守卫 |
| 媒体处理 | 原EagleMediaJob与library-core任务规则 | 独立worker；Mac／NAS位置以运行文档为准 |

新能力必须登记所属provider、持久表及依赖；新增共享模块不自动被禁止，也不能因为“两个模式都注册了”就默认通过。通用控制器继承只用于复用同一路由实现，摄影专属入口应明确自己的业务边界。

## 进程与写入

API负责认证、受理、持久化意图和查询，不执行后台业务轮询。独立operations负责主动批量操作和查重；独立业务worker领取唯一持久媒体队列，媒体节点按固定能力执行有界计算。暂停／时段、模型兼容、资源版本、租约和隐私是执行条件，进度展示不替代这些条件。

发送允许在同owner的两个模式间显式移动：新建独立目标业务记录，在同一发布事务移交不可变对象所有权并退役源项，源不进回收站。历史复制计划保持可恢复，物理删除通过唯一outbox，不能删除已由目标接管的对象。

删除／恢复／查重调用共享回收事务，不因拆能力另写版本或实况组件校验。永久删除受确认与备份保护；普通删除立即更新界面，后台回执局部对账，进度不得裁剪已加载分页或重置滚动。

## Dependency direction

| 层／包 | 可依赖 | 约束 |
| --- | --- | --- |
| library-core | 纯类型、规则与算法 | 无Node IO、Prisma、S3、API或worker依赖 |
| photo-render-core浏览器入口 | library-core及纯像素实现 | 浏览器不得导入独立`/server`入口 |
| photo-render-core/server | Node worker、Sharp／Canvas及纯渲染规则 | 明确的服务端适配入口，不进浏览器包 |
| media-core | library-core与Node媒体工具 | 是服务端媒体适配包，名称不代表纯函数 |
| library-persistence | library-core、Prisma | SQL编译和既有事务原语，不反向依赖应用 |
| API、业务worker | 上述包及各自适配器 | 彼此无源码依赖，共用规则从包导出 |
| web | 浏览器规则、契约与API适配 | 无数据库、S3 SDK或服务端入口 |

JS与SQL表达同一时段规则时以真实数据库等价测试保持语义；任务种类、车道和处理器版本从同一规则包导出，Prisma枚举由契约测试对照。包依赖门禁覆盖动态导入和相对路径，不能仅换import写法规避。

## 前端工作区

唯一LibraryWorkspaceProvider携带owner、mode及其API适配。共享页面装配能力，查询键由同一工厂创建与识别，失效不能靠各处猜数组位置。列表、计数、操作与摄影查询按其实际权限范围隔离；私密撤权清理对应数据、实体和blob。

按职责提取hook／组件应减少页面直接拥有的状态；保持同一选择、卡片、查看器与上传实现。摄影扩展可提供只读数据及动作槽，不能在通用布局中复制模式分支。已有大页面仍须继续按有验证的能力边界收拢，文件变短本身不是验收标准。

## Invariants

- ownerId由认证主体推导；跨owner404；上传DTO不接受ownerId。
- 数据库和对象存储与SekerChat隔离，测试／迁移／导入／恢复前运行安全目标检查。
- 原图不可变；编辑生成独立成片和原片参数关联，不覆盖源内容。
- 缩略图LRU当前为每工作区512项／128MiB；限额和到顶行为由实际代码及性能预算维护，不另设冲突数字。
- 私密投影、版本、租约、幂等、outbox和备份保持唯一写入语义。
- 每项批量改动说明SQL／S3／事务／前端刷新的端到端成本，不以文件移动声称运行提速。

## 验证与变更

[共享门禁](library-sharing-gate.md)检查装配、能力归属和依赖方向；运行时契约和真实数据库测试检查权限、版本及发布语义。静态检查不声称证明任意SQL正确性，也不靠匹配“isPrivate:false”的次数证明隐私安全。

每个里程碑运行lint、typecheck、单测、build、架构和契约检查。最终API镜像发布前必须启动成品镜像验收；完整恢复使用隔离目标。历史ADR描述当时决策，后续生效修订应在原ADR标记并链接当前契约，部署状态不写回多个文档。
