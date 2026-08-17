# SekerEagle Architecture

## North star

SekerEagle 是独立的多用户个人素材库。NestJS 持有业务规则，PostgreSQL 是业务事实源，MinIO 保存对象，worker 执行可重试媒体处理。浏览器和 Eagle 插件只通过同源 gateway 访问 API。

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
- 不依赖或访问 SekerChat 运行时和数据面。

## Media memory boundary

- 原图只用于下载、首轮预览生成和需要离线处理的后台切片任务；图库与大图预览不直接解码原图。
- worker 先串行生成 1600px PREVIEW、256/512px THUMBNAIL，再让代表色与大图金字塔任务通过显式依赖继续。
- 代表色从当前 READY THUMBNAIL 提取；大图使用 512px、overlap 1 的 Deep Zoom WebP 金字塔。
- 浏览器大图查看器最多缓存 64 个瓦片，同时加载 4 个；不同筛选查询只保存素材 ID，实体按 owner 规范化存储。
- Sharp 缓存固定为 64 MiB、内部并发为 1，媒体任务并发继续由 worker 队列控制。
