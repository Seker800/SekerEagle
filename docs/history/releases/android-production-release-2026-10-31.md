# 安卓0.9.13生产分发

2026-10-31，用户授权「全部弄好之后commit and push，然后推送生产环境」。功能源码已提交并推送main，固定为 `eb24258212772dc29cb934903d750d0caca10e3c`；本次仅发布安装包分发与运行记录，不增加API或客户端业务修改。

## 下载与安装

- [下载0.9.13安装包](https://yuntai.design:8181/downloads/android/SekerEagle-0.9.13.apk)
- [SHA256校验文件](https://yuntai.design:8181/downloads/android/SekerEagle-0.9.13.apk.sha256)
- [版本清单](https://yuntai.design:8181/downloads/android/latest.json)

包名 `com.sekereagle.android.debug`，versionCode30／versionName0.9.13，70,896,780字节，SHA256 `e91a67762028b2de5a24d1425b3519dc0deb19daf465c8660599650ab8638b7e`。签名与0.9.12一致，可覆盖安装，不必卸载旧版本；保持原账号及缓存命名空间。该包仍为既有调试签名，并未配置商店发行证书或自动更新。手机须安装新APK，服务端发布不会自动替换手机应用。

## 发布范围与验证

此前34项Android16模拟器回归、80项JVM、安卓完整检查／核心覆盖、网页智能文件夹多选回归、全仓源码检查和隔离数据库完整集成及恢复均已完成，详见安卓客户端记录。没有连接用户实体手机或对真实图库执行发送。

生产web镜像为 `sekereagle/web:android-0.9.13-eb2425821277`，在既有 `people-quality-a3bcda8eea99` 网页产物上增加三份下载文件。46份原网页文件及7份nginx配置文件SHA保持。基础镜像在不同Docker版本间存在元数据序列化差异；核对实际文件、运行默认值及空User语义后发布，未用标签相同代替内容验证。

最终镜像nginx配置、自身HTTP首页、完整APK下载、Range206及版本清单验证通过，临时验证容器已删除。生产切换后，经真实HTTPS完整下载再次验证SHA与长度；首页SHA为 `9d3b2aea29847c79aea168e979c3b1c5b62d770ced7a544091c7efdafd3f8fc1`，与原网页一致；APK响应为 `application/octet-stream`，断点请求返回206；匿名 `auth/me` 返回401。

web现场healthy、零重启。API继续 `sekereagle/api:android-search-e332c5f47e2a`，健康；API、PostgreSQL、MinIO、gateway、compute-coordinator及business-worker-relay容器ID保持。NAS worker仍停止／restart=no；唯一Mac业务worker仍running，PID17421未变。没有执行数据库迁移、恢复或资源写入，没有调整暂停、时段、模型及计算策略。

## 配置与回滚

现用完整Compose登记仍为 `maintenance/processing-upgrade-20261023/release-compose.json`，末尾追加 `maintenance/android-0.9.13-eb242582-20261031/images.json`，只覆盖web镜像。该维护目录保留发布前登记、容器私有快照、归档、日志、验收与 `rollback.json`。回滚须先核对当前完整参数链，再用本次rollback仅重建web；不得恢复旧数据库或启动NAS worker。

本次不涉及数据库或对象写入，未额外执行生产数据库备份、迁移或恢复；此前备份均保留。私有本机证据位于 `.omx/artifacts/android-production-20261031/`。推送后的DeepSeek按准确提交范围独立后台运行，不作为上线门禁，不将已启动称为审核通过。
