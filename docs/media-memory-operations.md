# 媒体内存与大图库运维

PostgreSQL 容器显式分配 512 MiB `/dev/shm`，用于图库查询的排序、聚合与受控并行执行。该值是容量边界的一部分，不应替代慢查询分析；出现 shared-memory 错误时，应先检查执行计划、并行度和 `work_mem`，再依据压测调整。

## 结论

原图总容量不会线性变成容器内存。60 GiB 图片主要增加 MinIO 数据卷、PostgreSQL 元数据和派生文件占用；运行内存由同时解码的像素、worker 并发、浏览器当前可见缩略图和大图瓦片缓存决定。

当前链路采用以下固定边界：

- 普通大图预览读取最长边 1600px 的 PREVIEW，不读取原图。
- 图库使用 256/512px WebP 响应式缩略图。
- 超过 4096px 或 1600 万像素的静态图片生成 512px Deep Zoom WebP 切片。
- 代表色从 512px 以内的 THUMBNAIL 提取，不再次读取原图。
- Sharp cache 为 64 MiB、concurrency 为 1；OpenSeadragon cache 为 64 tiles、loader limit 为 4。
- React Query 的筛选页只保存 ID；同一 owner＋模式的资源实体按挂载引用共享，最后一个消费者卸载时立即释放。
- 桌面冷缓存只消费一条上游流：先有界分块落盘、校验并原子提交，再从本地文件服务；不使用 `Response.body.tee()`。
- 本地 MinIO 的 namespace scanner 默认为 `slowest`，避免数十万小瓦片反复扫描形成高 CPU 和可回收 slab；代价是容量统计更新较慢。

这些边界下，图库静置内存不应随 60 GiB 原图容量增长；它主要随已加载的素材元数据数量增长。单 worker 处理 5000 万像素图片时仍会出现短时峰值，因此生产默认保持 `EAGLE_INTERACTIVE_CONCURRENCY=1`，扩吞吐优先横向增加 worker，而不是提高单进程并发。

## 部署与回填

1. 先在隔离环境验证迁移及媒体链路，再通过 `npm run deploy:mac` 执行正式发布；该入口先构建、停止写入服务，再等待迁移退出码为 0 后启动。代码／测试任务不会自动执行此步骤。
2. 不因 migration 是 additive 或存在旧预览回退而假定可以混跑任意版本。独立执行 migration 时，必须先通过安全目标检查并停掉 API／worker 写入。
3. 在“处理任务”页执行“补齐任务”：每轮最多新建／重排合计 500 个任务，可重复执行。核验以当前版本的 READY 派生事实为准，正常任务日志被裁剪不会触发全库重做；它不逐对象 HEAD 检查物理文件。
4. 先观察 INTERACTIVE 队列完成，再允许 NIGHT/ALWAYS 模式处理代表色和金字塔后台队列。
5. 观察 `eagle_media_source_selected`：代表色任务必须显示 `THUMBNAIL`；观察 `eagle_media_job_completed` 的 RSS 字段定位峰值。

## 验收

将浏览器/worker 集成测量写入 `.omx/artifacts/media-memory-measurements.json`：

```json
{
  "measurements": [
    { "name": "viewer-preview-50mp", "peakRssMiB": 180, "originalGetCount": 0 },
    { "name": "palette-50mp", "peakRssMiB": 140, "originalGetCount": 0 },
    { "name": "pyramid-viewer-50mp", "peakRssMiB": 240, "originalGetCount": 0 }
  ]
}
```

只在隔离测试库运行：

```bash
DATABASE_URL='postgresql://sekereagle:...@localhost:5432/sekereagle_test' \
  npm run performance:media-memory
```

验收器会拒绝非 `sekereagle_test`、非 loopback/compose host、缺失场景、超 RSS 阈值以及任何预览/代表色/瓦片查看阶段的原图 GET。

桌面缓存索引的十万条目门禁可独立执行：

```bash
npm run performance:desktop-cache:100k
```

发布前聚合入口为 `npm run performance:verify`；它要求十万图库、50MP 内存报告和桌面缓存索引三类证据同时通过。

## 回滚

先回滚 web 以恢复普通 PREVIEW 查看；API 瓦片端点和数据库表可以暂时保留。停止新金字塔任务后再回滚 worker。迁移均为 additive，紧急回滚不删除表、切片或原始素材；确认无需恢复后再单独安排清理任务。
