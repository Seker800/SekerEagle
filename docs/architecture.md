# SekerEagle Architecture

## North star

SekerEagle 是独立的多用户图片管理系统，提供业务数据完全分开的「素材」与「照片」两个模式。素材模式延续现有素材管理用途；照片模式承载个人照片管理及摄影专属能力。用户通过模式切换进入对应的完整工作空间，而不是在同一图库中切换筛选条件。

两个模式复用底层实现：NestJS 持有业务规则，PostgreSQL 是业务事实源，MinIO 保存导入的原文件和派生媒体，worker 执行可重试媒体处理。浏览器和 Eagle 插件只通过同源 gateway 访问 API。复用基础设施和代码，不意味着共享业务资源、分类或可编辑状态。

### Materials and photos boundary

以下产品决策于 2026-10-18 确定，是后续设计和实现的约束；本节描述目标，不表示照片模式已实现。

- 照片采用导入后由 SekerEagle 托管的路线，不建设群晖相册目录兼容、外部目录图库或双向文件同步。群晖备份属于独立的备份职责，不受此决策排除。
- 每项资源只属于素材或照片中的一个模式。不支持同一资源双重归属，也不提供跨模式添加、移动或转换入口。
- 相同文件分别导入两种模式时，形成独立资源；跨模式去重不得复用业务记录或导致编辑、替换、删除和恢复联动。
- 标签、标签分组、评分、智能分类、AI 分析结果、推荐、回收站及其他资源管理数据按模式隔离。同名标签可以在两种模式分别存在，不能建立跨模式资源关联。
- 所有资源读写、搜索、统计、分页、上传会话、导入幂等、批量操作和后台处理均须维护 owner 与模式边界。仅靠前端隐藏或过滤不构成隔离；跨模式按 ID 访问资源与跨 owner 访问一样返回 404。
- 模式在资源创建时确定并保持不可变。切换页面不能改变已经开始的上传、导入或处理任务的目标模式，也不能造成旧请求结果、选择状态或缓存串入另一模式。
- 通用资源管理能力在两个模式保持一致，通过共享应用服务和组件实现；不得复制两套完整系统，也不得在现有巨型页面或服务中持续堆积模式条件。
- 照片模式的规划范围包括人脸识别与人物管理、GPS 地图展示、连拍／相似照片分组及清晰度选片建议、相机与镜头等摄影参数筛选。摄影能力与共用媒体、存储和任务能力保持明确依赖边界。
- 照片分组与选片建议是不同能力；分组保留成员原片，自动选片不等于自动删除。自动删除、覆盖原片、人物识别模型和具体分组规则未在本轮讨论中获得确认。
- 现有资源与现有采集入口的兼容行为保留为素材模式；不得在升级时猜测或自动将现有图片重新归类为照片。

完整修改计划与待定事项见 [素材／照片双模式修改计划](photo-management-plan.md)。实施前须先完成计划中的模式隔离设计，不能跳过基础边界直接叠加摄影功能。

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

## Media memory boundary

- 原图只用于下载、首轮预览生成和需要离线处理的后台切片任务；图库与大图预览不直接解码原图。
- worker 先串行生成 1600px PREVIEW、256/512px THUMBNAIL，再让代表色与大图金字塔任务通过显式依赖继续。
- 代表色从当前 READY THUMBNAIL 提取；大图使用 512px、overlap 1 的 Deep Zoom WebP 金字塔。
- 浏览器大图查看器最多缓存 64 个瓦片，同时加载 4 个；不同筛选查询只保存资源 ID。当前实体仓库与缩略图 Blob 缓存按 owner 隔离，双模式实施后须按 owner 与模式共同隔离。近期文件夹列表保持 5 分钟新鲜、30 分钟后回收，缩略图 Blob 使用 LRU 缓存，默认上限为 2048 项、512 MiB、空闲 30 分钟。
- Sharp 缓存固定为 64 MiB、内部并发为 1，媒体任务并发继续由 worker 队列控制。
