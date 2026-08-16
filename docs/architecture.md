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
