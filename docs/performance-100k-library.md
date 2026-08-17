# 十万图库性能基线

## 结论

SekerEagle 的 PostgreSQL 元数据路径已在独立 `sekereagle_test` 数据库中通过 100,000
素材规模门禁。默认列表使用部分索引和 index-only scan；真实 `EagleService` 查询的全部
p95 均低于门禁。这个结论只覆盖元数据与图库交互，不等价于对象存储容量或备份已经满足
实际图片体积。

## 数据分布

基准由 `scripts/performance/verify-library-100k.mjs` 可重复生成：

- 100,000 个素材；
- 100,000 个缩略图记录；
- 200 个标签和 800,000 个素材—标签关联；
- 100,000 个颜色分析和 500,000 个 Lab 色板；
- 100,000 个已完成后台任务和 1 个交互任务；
- PostgreSQL 数据库大小约 925 MiB。

造数脚本执行前同时经过共享运行目标 guard 和专用 `sekereagle_test` 断言；`--seed` 还要求
显式设置 `SEKEREAGLE_SCALE_RESET=sekereagle_test`。它拒绝开发库 `sekereagle`、未知主机
和任何 SekerChat 目标。

## 2026-08-17 验证结果

环境：PostgreSQL 16 Alpine 容器，2 GiB 内存限制，Apple Silicon Docker Desktop。每个场景
预热 2 次、测量 10 次，调用真实 `EagleService.listAssets`，不是只测手写 SQL。

| 场景                 | 返回数 |      p95 |
| -------------------- | -----: | -------: |
| 默认首屏             |     40 |  7.72 ms |
| 90,000 深度游标      |     40 | 20.23 ms |
| 名称搜索             |     20 | 37.91 ms |
| 格式 + 评分          |     40 |  7.96 ms |
| 两个人工标签 ALL     |     40 | 15.11 ms |
| Lab 颜色筛选         |     40 | 81.81 ms |
| 十万任务中的交互候选 |      1 |  0.56 ms |

默认首屏执行计划为 `Limit -> Index Only Scan`，核心 SQL 执行 0.021 ms；90,000 深游标同样
为 `Index Only Scan`。门禁明确拒绝默认列表和交互任务候选出现 `Seq Scan`，也拒绝任何
返回 0 行的“快速伪通过”。

## 前端规模验证

瀑布流单元测试使用 100,000 个真实比例分布的素材。完整布局与视窗索引耗时约 31 ms，
中段 900 px 视窗加 1,800 px overscan 的可渲染卡片少于 200 个。图库 DOM 因此保持有界；
列表 API 同时只返回卡片所需的缩略图和人工标签，AI 标签、注释与色板仅在详情查询加载。

## 长期维护

- API 每 10 分钟运行一次互斥维护循环；
- 每轮最多删除 10,000 条 30 天前的已完成媒体任务；
- 失败、等待和处理中任务不会被删除；
- 终态导入保留每个图库最新 10 次，且每轮最多删除 100 次旧运行；
- 默认图库部分索引不包含回收站行；颜色使用 owner-scoped Lab 复合索引。

## 复跑

先创建并迁移独立 `sekereagle_test`，且必须运行 `npm run db:guard`。在已构建的 API 容器内，
将 `DATABASE_URL` 的数据库名改为 `sekereagle_test` 后运行：

```sh
SEKEREAGLE_SCALE_RESET=sekereagle_test \
node scripts/performance/verify-library-100k.mjs --seed --verify
```

已有数据时可只运行 `npm run performance:library:100k`。脚本输出单行 `SCALE_REPORT` JSON，
只要数据量、返回基数、p95 或关键执行计划不符合契约，就以非零状态退出。

## 容量边界

10 万“行”不是主要容量风险，原图与派生图磁盘才是。实际部署必须按
`平均原图大小 × 100,000 + 派生图 + 临时上传 + 备份` 规划 MinIO 容量，并保留至少 30%
余量。当前单机 MinIO volume 适合个人本地图库，但不提供磁盘级冗余；应另行完成 PostgreSQL
与 MinIO 的备份、恢复演练和磁盘告警。
