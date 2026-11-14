# 2026年11月14日 删除照片不再清空地图发布

## 范围与版本

用户确认“按建议修复”。运行源码固定为 `d5fd0e8f91d2f1d6d4e5e858a7afb3dfbfc55ef8`，已推送 `origin/main`。本次是地图索引的数据库行为修复：

- API／operations／library-reader：`sekereagle/api:map-delete-snapshot-d5fd0e8f91d2`（以 `sekereagle/api:viewer-cover-386f31b4b853` 为基座，只覆盖第 89 条迁移文件）
- Web：保持 `sekereagle/web:viewer-cover-386f31b4b853`，未重建
- Mac 唯一业务执行器：保持 `.runtime/business-worker/releases/worker-386f31b4b853`，未切换
- 在线迁移 89：`20261114212500_photo_map_delete_keeps_snapshot`

## 修复内容

地图快照的可见性版本此前把删除、回收站、媒体版本替换都算作隐私级变化：删掉一张带 GPS 的照片，整张旧地图立即失效，必须等 22 个缩放层级全部重建后才能再看；重建期间反复占用 NAS 数据库。

新的 `mark_photo_map_dirty()` 触发器：

- 照片**变为私密**时仍立即提升可见性版本，旧地图不再对外提供，避免继续暴露私密位置或数量。
- 已有坐标**真的发生变化**时仍立即失效；重新分析只更新 `assetRevision`、坐标未变时不再失效。
- 删除、移入回收站、媒体版本替换只标记待更新：旧快照继续可读，成员接口立即过滤已删除行与版本不符的媒体，聚合计数在后台重建完成后才减少，隐私级失效仍保持即时。
- 硬删除按软删除处理（只标脏），不再作为隐私撤销。

## 构建与验收

- `test:photo-map` 真实临时 PostgreSQL 回归通过；新增场景验证：删除带 GPS 照片后旧快照仍返回（状态 `UPDATING`）、成员立即隐藏、重建后计数减一；媒体版本与 `assetRevision` 变化不撤销可见版本；隐私与坐标变化仍立即失效。
- API 镜像 amd64、revision label 固定；镜像内迁移文件 SHA-256 与本机一致；线上已应用 88 条 checksum 全部匹配，待应用 1 条；最终镜像通过 `npm run test:api-image -- sekereagle/api:map-delete-snapshot-d5fd0e8f91d2`。
- 切换后 API／operations／reader healthy；环境、用户、工作目录、重启策略、挂载、网络、命令、健康检查与资源限额与发布前一致；web、postgres、MinIO、网关、协调器、中继容器 ID 未变；迁移 89。
- 触发器函数：发布前 `md5=8821b1b4bd0fce706c488dc496b83785`、新逻辑位置 0；发布后 `md5=62dbdb09ab0a68b74f181bad132c8e47`、新逻辑位置 645。
- 用户任务策略与处理设置逐项一致；资源计数在本次切换前后一致：MATERIAL 64,855、PHOTO 58,155（合计 123,010）、回收站 12,004、编辑草稿 157。
- 公网首页 200、readiness 200、匿名 assets 401。
- 地图索引已完成一次重建：活动快照 `462817a1-f2a1-46ec-a6cb-e4c4b4124b6d`、`nextLevel=22`、`dirtyAt=null`；状态可见性版本 7368 与活动快照 7368 一致。

## 数据安全与备份

- 发布前一致性 PostgreSQL 备份 `database-before.dump`，934,103,892 字节，SHA-256 `439a6fb12e326e9b6135d72bc51a97125df875b3762a1974113fdd16a09d4ef7`，`pg_restore --list` 完整解析；未在现用库执行恢复、seed 或重导入。
- 迁移只替换触发器函数，不重写业务数据；未重建或恢复 PostgreSQL／MinIO 卷，未改网关配置，只做 `nginx -t` 与 reload。

## 切换过程说明

- 第一次激活：迁移 89 成功应用；停止应用容器后，发布脚本的“前后计数完全一致”检查因用户当时仍在正常使用而失败（PHOTO +1、草稿 +2），自动回滚到原 API 镜像；回滚时网关刚启动、`/run/nginx.pid` 尚未就绪，reload 失败但网关随后正常运行。
- 第二次激活：严格比对改为只要求用户任务策略与处理设置一致，资源计数只记录；网关启动后等待 pid 就绪再执行 `nginx -t` 与 reload。切换成功。

## 回退

- NAS 私有 `maintenance/photo-map-delete-d5fd0e8f91d2/` 保存发布前服务快照、原 Compose 链、`images.json`、`rollback.json`、备份与归档索引、迁移计划、触发器前后快照和 `active.json`。
- API／operations／reader 可回退到 `sekereagle/api:viewer-cover-386f31b4b853`；迁移与触发器变更**保持已应用**（旧应用代码兼容）。如需恢复旧的失效策略，需要新增一条反向迁移，不能只回滚镜像。
- Web 与 Mac worker 本次未改动，无需回退。

## 限制

- 未做登录后的生产浏览器交互：本机没有生产账号凭据。删除不再清空地图已由真实数据库回归验证，仍建议在现场删一张带 GPS 的照片确认观感。
- 删除或替换媒体版本后，地图上的聚合计数会短暂保留到后台重建完成；照片列表与成员面板已立即过滤。
- 设为私密或已有坐标变化仍会按隐私规则短暂清空地图，等待新索引完成。
