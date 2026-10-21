# 群晖共享空间一次性导入

仅将共享空间原文件复制到 SekerEagle PHOTO 托管图库。不得挂载个人 `/homes/*/Photos`，不得赋予数据库、MinIO 凭据或 Docker socket。原片与目录只读，人物、AI 搜索索引和深层金字塔不属于本次导入。

先用 `node scripts/synology-import/export-policy.mjs /private/policy.json` 从共用格式目录导出规则；不维护另一份格式白名单。运行镜像复用带 ExifTool 的现有 worker 镜像，无需新的 Python 依赖。

固定源挂载 `/volume1/photo:/source:ro`，脚本目录挂载 `/import:ro`，私有状态目录挂载 `/state`。状态目录必须 0700，`/state/token` 必须 0600，只放专用 `asset:write` PAT，不接受命令行明文凭据。进程以 NAS 文件所有者的非 root UID/GID 运行，禁用提权、只读容器文件系统并限制 CPU／内存。网络只连接本项目 compose 网络。API 固定使用 `api:3000` 的 `/api/photos/uploads`；原文件分片通过签名 URL 的原 Host 发到同项目 `minio:9000`，校验公共 origin、固定 bucket、认证 owner 路径和分片编号，不经过 Mac 或公网传照片。

在 API 容器先运行共用运行目标安全检查，并核验独立项目、数据库、bucket 和可用磁盘。两端升级后先验证会话返回 `assetStatus`，再执行真实导入。

```sh
python3 /import/shared_import.py inventory --state /state --policy /import/policy.json
python3 /import/shared_import.py run --state /state --policy /import/policy.json --public-origin https://your-gallery.example --limit 25
python3 /import/shared_import.py run --state /state --policy /import/policy.json --public-origin https://your-gallery.example
python3 /import/shared_import.py status --state /state
```

已有独立清单进程时，`run --wait-for-inventory` 会等待其释放私有日志锁，再自动继续；不允许两个进程同时写入检查点。

`run` 会先完成清单，再按拍摄时间倒序导入。无时区时间仅用于排序时按上海时区解释，缺失时区不会写回原片或冒充 EXIF。没有拍摄时间时尝试媒体创建时间，最后回退文件修改时间；数据库的拍摄时间仍由原有摄影分析从原片读取，不用排序回退伪造拍摄时间。清单冻结后新增的文件不自动加入本轮。

每批最多 25 项，默认原片发布成功即继续较旧文件，不等待预览；样本验收可显式使用 `--wait-for-processing` 等待 READY／FAILED 后再继续；文件级永久错误保留记录并继续。网络／服务升级暂时失败重试，401／403 停止等待凭据修复。SIGTERM／SIGINT 在检查点安全暂停；再次运行同一目录即恢复，先核对服务器已接收的分片，不清库、不重新复制已完成项。相同文件仍由服务端在同一 owner／PHOTO 内去重。

导入期间 worker 可设 `EAGLE_BACKGROUND_PROCESSING_ENABLED=false`，只暂停该进程的可选后台分析，不修改用户偏好或模型服务。原有基础预览与维护行为保持，通常先用两并发、4 GiB 上限。正式更新应停在批次边界，再部署 API／worker；只更新脚本时也须先停止导入进程。完成后应撤销专用 PAT。

本轮脚本不读取 Synology Photos 私有数据库，因此不会迁移群晖专属的相册集合、分享权限、人脸名字或人工标签；原文件内嵌摄影信息由 SekerEagle 既有链路保留。

入库优先时同时设置 `EAGLE_VIDEO_TRANSCODING_ENABLED=false`；视频完整转码任务保留但不领取，封面仍生成。将该开关恢复为 true 后可继续领取既有版本化播放任务，不必重新导入原片。

可选 `--concurrency 2` 在同一导入进程中最多同时提交两项，默认仍为 1；调度按冻结清单从新到旧，允许两项完成次序不同。两路共用受锁保护的检查点事务、同一个认证身份和进程文件锁，不启动第二个独立导入进程。认证失败停止派发并等待已在途请求结束；断点恢复仍按原会话查询分片。`--limit` 限制本次尝试项数，包含永久拒绝，避免有界验收越过样本范围。提高并发前应比较相近文件类型与大小的入库吞吐、I/O 等待和错误数，不以 CPU 利用率单独决定并发。

## 群晖本地复制（受信任维护命令）

用户授权的本地复制使用 `local` 命令，仍持有原 journal 文件锁；Python 只保留锁并 exec 到服务端 Node 命令。该容器只读挂载共享空间、读写私有检查点，使用服务端配置及原有上传 PAT 验证账号和部署，固定 PHOTO。不得向浏览器或普通客户端分发服务端配置，不允许挂载 MinIO 数据目录或 Docker socket。

原片按新到旧用两路固定大小内存块直接发送至 S3 存储接口，计算 SHA-256、校验每块 Content-MD5，完成后检查来源指纹与对象大小，再调用共用发布事务。重试复用已提交的分片；旧流程已拼好的对象只做字节校验后登记，不解包 RAW。尺寸未知为 null，资源及任务保持 PROCESSING；缩略图、摄影索引与分析之后由原 worker 处理。本命令不启动 API、恢复调度器或解码器，连续异常停止，避免无效重试拖垮服务器。

先用 `local --limit 100` 验收校验值、来源不变与内存，再移除样本上限继续剩余清单。新进程沿用原私有状态，已完成项不重拷。命令和部署镜像须一起更新；运行前执行运行目标安全检查。导入完成后恢复 worker 并撤销本次专用 PAT。
