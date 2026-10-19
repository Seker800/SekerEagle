# 测试覆盖与执行

本文说明当前测试能证明什么、何时运行，以及仍需独立验证的边界。阶段验收记录中的测试数量是历史快照，不作为当前覆盖率或发布承诺。

## 执行入口

在仓库根目录使用 Node.js 22 和 npm workspaces：

```sh
npm ci
npm run db:generate
npm run ci:check
npm run test:worker-leases
npm run contracts:check
npm run test:library-integration
SEKEREAGLE_TEST_STORAGE_POLICY=1 node --test scripts/testing/storage-policy.test.mjs
PHOTO_WORKBENCH_BASIC=1 npm run test:photo-smoke
```

`ci:check` 包含共用架构门禁、lint、类型、各工作区单测、构建、格式和开源检查。它不等于运行下面所有真实依赖、模型和性能测试。GitHub CI 另运行租约覆盖率门禁、契约漂移、独立 PostgreSQL 与 MinIO、基础 HTTP 照片链路、相机格式 smoke 及镜像构建；MLX 使用单独宿主工作流。

| 入口                                                                                   | 主要证据                                                                                               | 依赖及边界                                                                         |
| -------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------- |
| `npm run ci:check`                                                                     | 共享页面／服务契约、模式边界、领域规则、前端交互、请求竞态、资源预算、常规构建                         | 大部分是单元／组件测试；不能据此宣称真实模型或整机部署已验收                       |
| `npm run test:worker-leases`                                                           | 领取竞争、过期回收、耗尽终态及失效租约拒绝发布；租约模块行／分支／函数覆盖率最低 80%                   | 只度量该模块，不代表全仓库覆盖率；模拟事务与下一行真实数据库测试互补               |
| `npm run contracts:check`                                                              | OpenAPI 生成物与提交内容一致                                                                           | 重新生成后检查 Git 差异；新增 DTO 时先 `contracts:generate`、审查提交，再检查漂移  |
| `npm run test:library-integration`                                                     | 所有迁移重放、历史升级、owner／模式 FK、事务回滚、删除 outbox、原图失效、登录退出、真实 SQL 分页与恢复 | Docker；新建随机名 PostgreSQL，guard 后运行，结束清理；不使用现用数据库            |
| `SEKEREAGLE_TEST_STORAGE_POLICY=1 node --test scripts/testing/storage-policy.test.mjs` | 私有 bucket、应用读写、跨 bucket 与管理权限拒绝                                                        | Docker；独立 MinIO 和网络，只挂载公开 init／policy 文件；不读取现用凭据            |
| `npm run test:photo-smoke`                                                             | 真实 HTTP 认证、共享上传、worker 处理、摄影元数据及两种模式可见性                                      | Docker、Sharp 和对应原生依赖；自动退出并清理临时服务；样本与可选模式见照片验收记录 |
| `npm run smoke:camera-media`                                                           | 本地合成 RAW／相机视频的真实探测、解码与转码                                                           | FFmpeg、FFprobe、LibRaw／rawpy 运行环境；品牌／机型全面兼容性另验                  |
| `npm run mlx:test`                                                                     | MLX 宿主接口、token、输入预算与模型契约                                                                | 受支持 Apple Silicon／Python／uv 环境；不等于图库语义质量或冷启动延迟测试          |
| `npm run test:library-integration -- --scale`                                          | 恢复后双模式各十万行隔离与查询规模检查                                                                 | 临时数据库；不等于十万张真实原图处理或向量检索性能                                 |
| `npm run performance:verify`                                                           | 十万图库、50MP 媒体内存与桌面缓存的性能契约                                                            | 需要独立测试库及实际采集的测量文件；验证测量报告不是自动完成所有测量               |

`PHOTO_WORKBENCH_BASIC=1 npm run test:photo-smoke` 使用本地合成图片，验证真实 HTTP 登录与 Cookie、无会话族令牌／非法 Origin 拒绝、双模式上传与列表隔离、缩略图及 EXIF／GPS 提取。CI 使用这一模式，不下载样本或人脸模型，也不验证人物识别、照片组、实况、相机格式或恢复。完整 `test:photo-smoke` 使用校验和固定的 NASA 公开样本，需先按 [本地人物运行环境](../services/photo-face/README.md) 安装依赖；可选实况／相机／发送开关见照片验收记录。基础模式不能与这些扩展开关混用。

`smoke:auth` 与 `smoke:eagle` 会写入明确指定的本机实例，不能把它们当作上述自动隔离测试随意执行。没有对应环境授权时，使用临时 PostgreSQL／MinIO 与测试工作台。

## 关键失败路径覆盖

| 风险                           | 当前测试如何验证                                                                                      |
| ------------------------------ | ----------------------------------------------------------------------------------------------------- |
| 删除对象后数据库删除失败       | 真实 FK 阻断事务，确认资产、引用和 outbox 一起回滚；对象只在事务提交后消费                            |
| 对象删除中断或存储失败         | outbox 保留，重试成功后才确认；过期 purge 租约不能推进删除                                            |
| 隐藏私密项、跨 owner／模式访问 | 服务、HTTP smoke 与数据库复合 FK 分层验证；清空回收站遵守可见范围                                     |
| 依赖失败永久排队               | 真实 PostgreSQL 验证失败链传播；重试与恢复路径单独覆盖                                                |
| 构建进程消失或旧 worker 晚到   | 两个并发数据库事务竞争同一构建，模拟过期时间再领取；旧租约发布失败且事务写入回滚，旧候选退休          |
| 原图替换后继续使用旧结果       | 验证旧任务租约、颜色、向量、AI 标签和金字塔回收意图在替换事务中失效；前端同时合并媒体版本与 rendition |
| job 裁剪导致全库重复生成       | 保留当前派生结果、移除 job 后对账；缺事实的 completed job 才重排                                      |
| refresh 与退出并发             | 客户端认证 epoch 回归及真实 refresh family 事务竞争；其他独立登录保持有效                             |
| 上传／导入长时间中断           | 过期、耗尽重试、对象清理失败保留意图、NoSuchUpload 幂等与导入进度对账                                 |
| 搜索中增删资源                 | 删除上一页锚点并新增靠前资源，确认排序位置游标继续返回下一项；同时检查查询作用域                      |
| 迁移失败后启动写入服务         | 运行部署编排本身，模拟退出码失败、状态不可读和容器身份缺失，确认未调用启动；构建失败不停止原服务      |

语义构建测试通过可控制的租约时间模拟 SIGKILL 后状态，不等于真实 OOM 注入。部署编排测试使用替代 Docker 执行器，真实 migration SQL 由独立 PostgreSQL 测试验证；没有在用户实例执行部署。

## 证据与限制

- 不使用真实群晖图库、现用账号、生产数据库或对象存储做破坏性测试。数据操作先运行安全目标检查；独立测试脚本会再次检查其随机临时目标。
- 合成向量检验检索／隔离算法，不证明 2B 模型能准确理解真实中文图库。人物阈值、连拍选片质量、相机专有格式、真实最大文件、移动端触控与系统剪贴板还需要各自的代表性样本或原生环境。
- 浏览器组件测试不能替代实际网页／桌面验收；测试工作台也不能证明正式实例的数据迁移、机器容量或长时间稳定性。
- 真实媒体、模型缓存和截图放在被忽略的本地目录，不进入发行包。记录环境、样本来源、命令、结果和未验证项；不提交 token、Cookie、原片或数据库 dump。
- 新增测试应断言行为、权限和失败后的状态；不为每段可逆样式或文档文字增加镜像式断言。共享边界用 AST 反例门禁，持久化正确性优先使用真实数据库事务。

相关操作见 [照片验收](photo-management-acceptance.md)、[相机兼容](camera-media.md)、[媒体内存](media-memory-operations.md)、[维护者指南](maintainer-guide.md)。
