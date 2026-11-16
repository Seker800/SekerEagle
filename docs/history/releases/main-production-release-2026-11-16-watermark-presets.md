# 2026年11月16日水印跨照片预设生产发布

> 状态：历史记录 | 归档日期：2026-11-16 | 不代表当前运行状态；现行事实读 [current-runtime](../../current-runtime.md)。

## 范围与版本

- 运行源码：`f70f763d6caa18fc812cfc249721594272fc41bb`。
- API／operations／library-reader：`sekereagle/api:watermark-presets-f70f763d`
- Web：`sekereagle/web:watermark-presets-f70f763d`
- Mac 唯一业务执行器保持上一版 `.runtime/business-worker/releases/worker-b852071b`（PID 90288，worker ID `worker-1bf14bec-3895-4d22-8906-b60bfcc0e875`，心跳新鲜、`activeJobCount=0`）；本次不需要 worker 变更。
- 新增第 98 项迁移 `20261116090000_watermark_presets`：`EagleWatermarkPreset`（ownerId、libraryMode、templateId、settings JSONB，复合主键与 owner 外键）。不修改既有表或数据。

本批解决“每换一张照片都要重新设置水印”的问题：每种水印模板现在有一个账号级、按图库隔离的预设。水印设置行右侧新增「存预设」按钮，保存当前模板的底色、对齐、角标颜色、显示开关、网站地址和自定义 url；机型和拍摄参数／时间文字不进入预设，继续使用每张照片自己的元数据。保存后按钮显示「已保存」，同一模板再次保存即覆盖；已有预设时显示「更新预设」。

新照片打开编辑器时，初始模板会先套用该模板预设；之后选择任何模板，如果这张照片没有自己的分模板记忆，就使用账号预设。照片自己的草稿和分模板记忆始终优先，已有编辑结果不会被新预设悄悄改写。

## 数据安全与备份

- 发布前一致性备份：934,624,105 字节，SHA-256 `1cb37bf70d0aa7ccfe35ee1e0f49e1b3bb9f6201eba9664a48f5735afd2fd5e3`，`pg_restore --list` 完整解析。
- 迁移前 97 项，迁移后 98 项；待应用 0。schema 前后仅新增 `EagleWatermarkPreset`（0 → 1），既有操作计数列、清理列、触发器和读取通知触发器均未变。
- 发布前后计数严格相等：MATERIAL 64,856／PHOTO 58,308（合计 123,164）、回收站 12,030、编辑草稿 174。没有恢复、seed 或重新导入。
- 用户任务策略与处理设置逐项一致；postgres、MinIO、协调器、中继容器 ID 未变；gateway 容器复用，切换时短暂停止以释放 API 上游连接，随后 `nginx -t` 与 reload。
- 发布后的生产 API 容器内用真实 Prisma adapter 做了一次事务内保存、读取、校验并回滚的预设往返测试，确认 owner 隔离、模板 ID 校验、文字剥离和 JSONB 写入正常；回滚后 `User` 测试行与 `EagleWatermarkPreset` 行均为 0，没有测试数据残留。

## 验证结果

- API、operations、library-reader、web 四个容器均 healthy、0 重启；镜像 revision 均为 `f70f763d…`。
- 公网首页 200、`/api/health/ready` 200；匿名 `GET /api/eagle/watermark-presets` 与 `/api/photos/watermark-presets` 均 401；两个 PUT 路由已注册到 API。
- 线上 `index.html`（`d9dacc8b…`）、`PhotoEditor-BSduSJA1.js`（`cbf0932b…`）、`photo-watermark-variants-DfQPtD02.js`（`0b89b23b…`）与本机构建 SHA256 一致；web 镜像内 85 个静态文件与本地 84 个构建文件一致（额外为 nginx 默认 `50x.html`）。
- 最终全量 `npm test` 整链退出 0：web 1168 项通过；API 672 项（671 通过、1 跳过、0 失败）；架构门禁 42 项；API 成品镜像冒烟通过（独立依赖、98 项隔离迁移、readiness 200、匿名 401、执行器干净退出）；lint、Prettier、contracts、迁移临时库验证通过。
- 迁移在一次性临时 pgvector 数据库中完整应用 98 项并通过 `migrate status`；生产迁移由发布脚本在最终 API 镜像内执行，未使用本地源码替代。

## 回退

NAS 私有 `maintenance/watermark-presets-f70f763d/` 保存发布前服务快照、原 Compose 链、`images.json`、`rollback.json`、`migration-plan.json`、`active.json`、数据库备份与归档索引。回退镜像为 `sekereagle/api:watermark-memory-b852071b`／`sekereagle/web:watermark-memory-b852071b`；回退后重新校验并 reload gateway。由于本次迁移是新增表，回退应用代码不会删除 `EagleWatermarkPreset`，已保存预设会留在库中；Mac worker 无需回退。

## 限制

- 预设按 owner + 图库模式隔离；照片模式与素材模式各有一份，不跨模式混用。这是现有双模式隔离的延续。
- 预设只保存样式（底色、对齐、角标颜色、显示开关、网址），不保存机型、拍摄参数和时间文字，避免把某张照片的元数据带到别的照片。
- 同一照片的既有草稿和分模板记忆优先于账号预设；保存预设不会批量改写已有照片。
- 未做登录后的生产浏览器交互（无生产账号凭据）；按钮、初始套用、模板切换和保存请求由组件、会话与 API 测试覆盖，生产只核验静态资源、路由、迁移、匿名鉴权和事务内预设往返。
