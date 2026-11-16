# 现用运行状态与交接

> 状态：现行 | 核验日期：2026-11-16 17:00（北京时间） | 对应提交：79800fc0
>
> 本文只记录现用部署事实与接手顺序。完整发布快照、备份哈希和历史恢复过程见
> [2026-10/11 归档](history/releases/2026-11.md)。设计边界见 [architecture](architecture.md)，
> 进程职责见 [process-map](process-map.md)。

## 现用状态

| 项目                              | 当前值                                                                                |
| --------------------------------- | ------------------------------------------------------------------------------------- |
| 图库                              | 群晖 SekerDesign（DS1522+，AMD64，8GB），入口 https://yuntai.design:8181/             |
| 运行源码                          | `79800fc0`（上传列表“清除已结束”修复）                                                |
| API / operations / library-reader | `sekereagle/api:upload-parallel-811ead5b`                                             |
| Web                               | `sekereagle/web:upload-clearfix-79800fc0`                                             |
| 数据库                            | 98 项迁移，待应用 0；schema 与 17:00 发布一致                                         |
| Mac 业务执行器                    | `.runtime/business-worker/releases/worker-b852071b`（launchd；不是 Compose `worker`） |
| 未改动                            | 网关、Postgres、MinIO、计算协调器、中继；不要为排查重启或重建                         |
| 计数                              | MATERIAL / PHOTO / 回收站 / 草稿从运行检查点读取，本文不维护动态百分比                |

Web 最近三次覆盖：`upload-clearfix-79800fc0`（17:00）→ `upload-streamhash-38dd0da6`（15:44）
→ `upload-manager-c4d26c7e`（15:27）。API 侧本次保持 `upload-parallel-811ead5b`。

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

- Web 回退：`sekereagle/web:upload-streamhash-38dd0da6`。
- API / operations / reader 回退：`sekereagle/api:watermark-presets-f70f763d`。
- 最近一致性备份：936,600,201 字节，SHA-256 `3eda53c3bdba4eda9ba81796bdbae81d88aa3da3dad5b895a6e0c9fa9b5a07e2`。
- 证据目录：NAS 私有 `maintenance/upload-clearfix-79800fc0/`；完整回退清单与历史备份见
  [归档](history/releases/2026-11.md) 和 `rollback.json`。

## 最新发布摘要

- [2026-11-16 17:00 上传列表“清除已结束”修复](history/releases/main-production-release-2026-11-16-upload-clearfix.md)
- [2026-11-16 15:44 上传前查重改为流式指纹](history/releases/main-production-release-2026-11-16-upload-streamhash.md)
- [2026-11-16 15:27 上传前查重与上传管理器](history/releases/main-production-release-2026-11-16-upload-manager.md)

## 历史

- [2026-10/11 发布与恢复归档](history/releases/2026-11.md)
- [2026-10-23/24 恢复结构快照](history/releases/2026-10-recovery-state.md)
- 设计边界：[architecture](architecture.md)；验证入口：[testing](testing.md)；新环境启动：[operations-runbook](operations-runbook.md)。
