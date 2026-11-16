# 2026年11月16日网页批量上传吞吐生产发布

> 状态：历史记录 | 归档日期：2026-11-16 | 不代表当前运行状态；现行事实读 [current-runtime](../../current-runtime.md)。

## 范围与版本

- 运行源码：`811ead5b1011b73e7ba3b607748e7bab802f44e5`。
- API／operations／library-reader：`sekereagle/api:upload-parallel-811ead5b`
- Web：`sekereagle/web:upload-parallel-811ead5b`
- 数据库仍为 98 项迁移，待应用 0；本次无迁移、无 schema 变更。对象存储、网关、协调器、中继、Mac 业务执行器均未改。

本批把网页批量导入的传输主路径改为并行，并解除服务器入库校验对上传位的占用：

- 文件级并发由 2 提到 4，单文件分片由串行改为最多 3 路并行；5 MiB 分片下最多 12 个分片 PUT 在途。
- `complete` 被服务器接受后立即释放上传位，入库校验在后台继续；新增 owner／图库模式隔离的 `POST /api/(eagle|photos)/uploads/status-batch`，客户端每 1.5 秒一次批量查询全部待入库会话，替代逐会话每秒 GET。
- 界面显示“已上传 X/Y · 入库 Z/Y”，单项传输完成后显示“已上传，入库校验中”；列表刷新仍在每批入库结束后执行一次。

## 构建与验收

- API 镜像以 `linux/amd64` 构建，label `org.opencontainers.image.revision=811ead5b…`；成品镜像通过 `npm run test:api-image -- sekereagle/api:upload-parallel-811ead5b`：隔离启动、98 项迁移、readiness 200、匿名 401、独立执行器启动与干净退出均通过。
- Web 镜像以同一源码、`linux/amd64` 构建，label 相同；镜像内 `index.html` 为 `026cf98c2ef9ac1b3d2c67ea499f77ebb749124b6af18ee988fdef1feaccf280`，与公网实际返回体一致；线上资源包含 `status-batch` 调用与新增的两段入库文案。
- 两个镜像载入 NAS 后再次核对为 `linux/amd64` 且 revision 为 `811ead5b…`，随后由发布脚本校验 Compose 差异、迁移 checksum 与待应用列表。

## 数据安全与备份

- 发布前一致性备份：935,576,488 字节，SHA-256 `6749481a2e7e3bdc6c7982ce02ca830d6b932e018773ba046a5d0ef22a4bade2`，`pg_restore --list` 完整解析。
- 迁移账本保持 98 项；schema 前后一致（操作计数列 7、`cleanupAttempts` 1、item 触发器 3、读取通知触发器 1、`EagleWatermarkPreset` 1）。
- 用户任务策略与处理设置逐项一致。发布窗口内计数 MATERIAL 64,862／PHOTO 58,547→58,589、回收站 12,030→12,032、编辑草稿 174→176，属并发用户操作，不是发布写入；没有恢复、seed 或重新导入。
- postgres、MinIO、协调器、中继容器 ID 未变；gateway 容器复用，切换时短暂停止以释放 API 上游连接，随后 `nginx -t` 与 reload。Mac 业务执行器未改。

## 验证结果

- API、operations、library-reader、web 四个容器均 healthy、0 重启；镜像 revision 均为 `811ead5b…`。
- 公网首页 200、`/api/health` 200、`/api/health/ready` 200；匿名 `POST /api/eagle/uploads/status-batch` 与匿名 `GET /api/eagle/assets` 均 401，说明新路由已注册且鉴权生效。
- 切换后 8 分钟窗口内 API／operations／reader／web／gateway 日志未发现 error／fatal／unhandled。
- 切换前完整门禁：web 1175 项、API 677 项（676 通过、1 跳过）、lint、typecheck、web 构建、架构检查与 `contracts:generate` 均通过。

## 回退

NAS 私有 `maintenance/upload-parallel-811ead5b/` 保存发布前服务快照、原 Compose 链、`images.json`、`rollback.json`、`migration-plan.json`、`active.json`、数据库备份与归档索引。回退时读取 `maintenance/processing-upgrade-20261023/release-compose.json` 的 command，在末尾追加本目录 `images.json` 与 `rollback.json`，执行 `--profile processing up -d --no-deps api operations library-reader web`；随后重新校验并 reload gateway。回退镜像为 `sekereagle/api:watermark-presets-f70f763d`／`sekereagle/web:watermark-presets-f70f763d`。本次无迁移，回退不涉及数据库恢复。

## 限制

- 未做登录后的生产浏览器上传交互（无生产账号凭据）；并发上限、传完即释放、批量状态查询、分片顺序和会话撤销由单元测试与 API 测试覆盖，生产只核验容器健康、静态资源、路由与匿名鉴权。
- 尚未在现网 NAS 或公网链路测量端到端上传吞吐；实际提速幅度需现场用一批照片对比，公网上行带宽仍是硬上限。
- 服务器端入库校验仍一次处理一份；本次只移除它对传输的阻塞，没有提高校验并发。
- 上传前查重与断点续传未包含在本批。
