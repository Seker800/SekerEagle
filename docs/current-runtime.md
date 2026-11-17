# 现用运行状态与交接

> 状态：现行 | 核验日期：2026-11-17 17:05（北京时间） | 对应提交：e57b7ab7
>
> 本文只记录现用部署事实与接手顺序。完整发布快照、备份哈希和历史恢复过程见
> [2026-10/11 归档](history/releases/2026-11.md)。设计边界见 [architecture](architecture.md)，
> 进程职责见 [process-map](process-map.md)。

## 现用状态

| 项目                              | 当前值                                                                                       |
| --------------------------------- | -------------------------------------------------------------------------------------------- |
| 图库                              | 群晖 SekerDesign（DS1522+，AMD64，8GB），入口 https://yuntai.design:8181/                    |
| 运行源码                          | API／web `e57b7ab7`；operations／reader `93b5d583`（本轮未更新）                             |
| API / operations / library-reader | API `sekereagle/api:share4k-e57b7ab7`；operations／reader `sekereagle/api:refactor-93b5d583` |
| Web                               | `sekereagle/web:share4k-e57b7ab7`                                                            |
| 数据库                            | 100 项迁移，待应用 0；本轮无迁移、无 schema 变化                                             |
| Mac 业务执行器                    | `.runtime/business-worker/releases/worker-93b5d583`（launchd；不是 Compose `worker`）        |
| 未改动                            | 网关、Postgres、MinIO、计算协调器、中继；不要为排查重启或重建                                |
| 计数                              | MATERIAL / PHOTO / 回收站 / 草稿从运行检查点读取，本文不维护动态百分比                       |

Web 最近三次覆盖：`share4k-e57b7ab7`（17:00）→ `thumbs-e093f6d8`（09:05）
→ `refactor-93b5d583`（00:00）。API 同时切到 `share4k-e57b7ab7`；
operations／reader 保持 `refactor-93b5d583` 未变。

## 进程入口

| 进程           | 入口                                       | 说明                                    |
| -------------- | ------------------------------------------ | --------------------------------------- |
| API            | `apps/api/src/main.ts`                     | HTTP 认证、查询、受理                   |
| operations     | `apps/api/src/asset-operation-executor.ts` | 批量操作、上传终结、恢复、维护          |
| library-reader | `apps/api/src/library-reader.ts`           | 独立读取宿主，内部端口 3001             |
| 业务 worker    | `apps/worker/src/main.ts`                  | Compose `worker` 或 Mac launchd release |
| 计算节点       | `apps/compute-coordinator/main.mjs`        | 节点策略与远程媒体                      |

详细职责、启停和“不负责什么”见 [process-map](process-map.md)。

## 接手顺序

1. 先读 [start-here](start-here.md)、`AGENTS.md` 和 `architecture.md` 的 North star。
2. 用 `git status`、本地／远程提交、NAS `docker inspect` 分别核对代码与运行状态。
3. 通过 SSH 配置 `SekerDesign` 进入群晖；Docker 在 `/usr/local/bin/docker`。
4. 完整 Compose 参数保存在私有 `release-compose.json` 的 `command`；先检查目标与覆盖文件。
5. 只替换实际变化的服务；网页更新不需要重启数据库、MinIO 或独立封面容器。
6. 验收健康、真实页面、任务检查点和错误原因，再更新本页的核验日期与证据。

## 核验命令

```sh
/usr/local/bin/docker inspect --format '{{.Config.Image}} {{.State.Status}}' sekereagle-nas-staging-api-1
/usr/local/bin/docker inspect --format '{{.Config.Image}} {{.State.Status}}' sekereagle-nas-staging-web-1
/usr/local/bin/docker inspect --format '{{.State.Status}}' sekereagle-cover-copy-20261023
```

不输出整个 Env 或展开后的 Compose 配置；不读取密码、令牌或私钥。

## 回退与证据

- Web 回退：`sekereagle/web:thumbs-e093f6d8`。
- API 回退：`sekereagle/api:refactor-93b5d583`；operations／reader 本轮未变。
- Mac worker 回退：`.runtime/business-worker/releases/worker-b852071b`；plist 备份在
  `.omx/artifacts/release-93b5d583/worker-before.plist`。
- 最近一致性备份：936,861,410 字节，SHA-256 `da13a914c04e6e69a94699f85642a20ed0b14d446a5c3c080a05d66f9f968bc1`（本轮无数据写入，未新建备份）。
- 证据目录：本次发布见 NAS 私有 `maintenance/share4k-e57b7ab7/`；上一轮见
  `maintenance/thumbs-e093f6d8/`。完整回退清单与历史备份见
  [归档](history/releases/2026-11.md) 和 `rollback.json`。

## 最新发布摘要

- [2026-11-17 17:00 4K 分享复制与预览/原图标记](history/releases/main-production-release-2026-11-17-share4k-e57b7ab7.md)
- [2026-11-17 09:05 缩略图并发与缓存调优（仅网页）](history/releases/main-production-release-2026-11-17-thumbs-e093f6d8.md)
- [2026-11-17 00:00 接手认知成本重构与审查修复](history/releases/main-production-release-2026-11-16-refactor-93b5d583.md)
- [2026-11-16 17:00 上传列表“清除已结束”修复](history/releases/main-production-release-2026-11-16-upload-clearfix.md)
- [2026-11-16 15:44 上传前查重改为流式指纹](history/releases/main-production-release-2026-11-16-upload-streamhash.md)
- [2026-11-16 15:27 上传前查重与上传管理器](history/releases/main-production-release-2026-11-16-upload-manager.md)

## 历史

- [2026-10/11 发布与恢复归档](history/releases/2026-11.md)
- [2026-10-23/24 恢复结构快照](history/releases/2026-10-recovery-state.md)
- 设计边界：[architecture](architecture.md)；验证入口：[testing](testing.md)；新环境启动：[operations-runbook](operations-runbook.md)。
