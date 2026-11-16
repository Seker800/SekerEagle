# 2026年11月16日上传列表清除修复发布

> 状态：历史记录 | 归档日期：2026-11-16 | 不代表当前运行状态；现行事实读 [current-runtime](../../current-runtime.md)。

## 范围与版本

- 运行源码：`79800fc0493cf1084d639f601baf54df276735a7`。
- Web：`sekereagle/web:upload-clearfix-79800fc0`
- API／operations／library-reader 保持 `sekereagle/api:upload-parallel-811ead5b`；数据库、存储、网关、协调器、中继未动。

修复“清除已结束”只删除成功／失败项、重复跳过项一直留在列表里的问题。清理条件现在包含 `duplicate`，并新增队列与面板测试。

## 构建与验收

- Web 镜像以 `linux/amd64` 构建，label revision `79800fc0…`；镜像内、本地构建与公网 `index.html` 均为 `9ff5a8c6992009dac406a3042567ffb33c15e690f908323b9619d41df1ea2e51`。
- 完整 web 测试 1196 项（156 个文件）通过，lint、typecheck、构建与架构检查通过。

## 数据安全与备份

- 发布前一致性备份：936,600,201 字节，SHA-256 `3eda53c3bdba4eda9ba81796bdbae81d88aa3da3dad5b895a6e0c9fa9b5a07e2`，`pg_restore --list` 完整解析。
- 切换窗口内计数 PHOTO 58,632→58,633、编辑草稿 176→179，属并发用户操作；MATERIAL 64,862、回收站 12,032 不变；用户策略与处理设置一致。
- 只替换 web 容器；API、operations、library-reader、postgres、MinIO、gateway、协调器、中继容器 ID 未变；网关未停止未 reload。

## 验证结果

- Web healthy、0 重启；公网首页与 `/api/health/ready` 200。
- 线上页面文件与镜像、本地构建一致；切换后 web 日志无 error／fatal／unhandled。

## 回退

NAS 私有 `maintenance/upload-clearfix-79800fc0/` 保存快照、Compose 链、`images.json`、`rollback.json`、`active.json`、数据库备份与归档索引。回退执行 `up -d --no-deps web`，回退镜像为 `sekereagle/web:upload-streamhash-38dd0da6`。

## 限制

- 未做登录后生产浏览器交互；“清除已结束”行为由队列与面板测试覆盖。
