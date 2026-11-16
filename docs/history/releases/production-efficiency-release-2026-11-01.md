# 运行效率与页面读取优化生产发布

2026-11-01。用户明确授权“先这样，帮我推送生产环境”。main 已推送，应用固定源码为 `df6d3688305a648a66e3bd621f094a8ef452546e`；后续文档提交不代表重建运行镜像。原生产应用为 `727ef115cf2e`，此次同时发布此前尚未上线的架构与批处理修改，不能将整轮收益归于最后三处读取优化。

## 实际运行版本

| 组件                 | 最终版本                                          | 现场核验                                       |
| -------------------- | ------------------------------------------------- | ---------------------------------------------- |
| API、独立 operations | `sekereagle/api:efficiency-df6d3688305a`          | healthy，零重启                                |
| 网页                 | `sekereagle/web:efficiency-df6d3688305a-complete` | healthy，零重启，公网文件一致                  |
| Mac 唯一业务 worker  | `worker-df6d3688305a`，PID 41559                  | 旧 PID 57244 正常退出，新进程及数据库心跳新鲜  |
| 数据库               | 77 项迁移完成                                     | 新增待处理依赖索引、媒体过渡表事件两项迁移     |
| 计算节点             | 修订 66，三节点 READY                             | 分工、容量、交互预留、模型及用户暂停／时段未改 |

NAS worker 继续停止且 restart=no。PostgreSQL、MinIO、协调器、中继、停止的 NAS worker 和网关容器身份保持；网关配置字节保持，维护期间原容器停止／启动，最终网页更新后仅校验并 reload。Mac placement 检查点已同步新 release、PID、worker ID 和源码版本。

## 本次纳入

- 删除、恢复和查重共用元数据批次发布；发送批次映射、标签关联与逐语句参数预算摊销，保留原事务、权限、版本和租约守卫。
- 失败依赖传播只读取实际待处理依赖边；媒体任务事件及通知按过渡集合发布，保留不同规模下的查询计划回归。
- 上传恢复、对象维护转到独立 operations，API 不自行启动后台业务计时器；文字向量逐次兼容检查、向量发布和人工建议保护保持。
- 清空回收站由原持久命令在独立执行器分批推进，繁忙保留同一任务恢复；进度和终态校准保留列表分页、滚动与用户草稿。
- 人物先分页再取代表头像；统计先按日期和设备聚合；语义智能文件夹在排名分页前执行完整筛选，减少被淘汰候选的重复读取。

实现、SQL／事务／S3 与刷新成本及其测量边界分别见[后台批处理](background-processing-performance-2026-11-01.md)、[架构效率](architecture-efficiency-review-followup-2026-11-01.md)、[页面读取](read-path-efficiency-2026-11-01.md)和[性能预算](performance-budget.md)。没有增加产品操作数量限制、数据库缓存或并发配置，没有替用户重放真实清理。

## 备份、切换与中间问题

先完成生产数据库一致性备份，**900786714 字节**，SHA-256 `5834077b2e4e83d5b327dab67eeaccd3e6a6e28a09d59bcb315c291cd99fcb60`，并由 `pg_restore --file=/dev/null` 完整解析；备份、原容器私有配置和策略快照保存在 NAS `maintenance/read-efficiency-20261101/`。未恢复覆盖现用数据。

排空旧 Mac worker 后，停止网关、operations、API，应用两项迁移，再启动匹配的 API／网页／Mac worker／operations。所有新服务健康后，Compose 的 `start gateway` 仍等待历史一次性依赖；没有为结束等待重跑旧迁移或改服务依赖。直接启动同一已停止网关，在确认 live 服务健康后，只终止等待中的维护 Python／Compose 命令，再独立复核全部配置、用户策略和服务身份，原子更新 Compose 注册表。该过程没有回退应用。原网关停止于 17:33:41、恢复于 17:40:29，约 6 分 49 秒；维护期间外网出现 502，记录为维护中断，不作为正常请求延迟。

最终检查发现首个网页镜像清空旧静态目录时漏带原下载目录，容器内 APK 校验失败；当时公网 Range 请求仍正常，不能据此跳过成品遗漏。最终网页改为保留原下载目录，三份分发文件逐一哈希与旧镜像一致，再单独更新 web。API、operations、Mac worker 没有因此重复切换。最终 APK SHA `e91a67762028b2de5a24d1425b3519dc0deb19daf465c8660599650ab8638b7e`，公网 Range206 保持。

完整 Compose 链由 `maintenance/processing-upgrade-20261023/release-compose.json` 读取，仅追加本次 `images.json`，其中网页已指向 `-complete`。保留原 727 镜像、`rollback.json`、旧 Mac plist／release 和配置快照。回退须协调 API／网页／operations／Mac worker，保留已应用的兼容迁移，不逆向迁移或以备份覆盖用户后续修改。网关应在依赖服务已现场核验后直接启动原容器，避免再次等待历史一次性依赖。

## 验收与限制

- 固定源码完整 `npm run ci:check` 和 `npm run test:library-integration` 均通过，含真实六万项成本回归、历史升级和完整恢复逐表摘要；最终 API 镜像独立启动、77 项迁移、就绪200、匿名401、独立执行器退出0通过。
- 准备的不可变 Mac 原生 release 在隔离 DB／HTTP 下验证两资源 worker 及远端图片、视频、切片、向量、策略排空和正常退出，通过后才切换。媒体 bundle 的原始字节不同来自新增纯操作协议导出，完整差异仅两处代码块，无媒体渲染行为变化；已登记媒体节点不变，其现用 bundle SHA 仍为 `cd6a46bf1a81326362fe2a13befbc3f046aa93a62b170723e45dc3753dd299e9`。
- 生产 HTTPS 的普通合成账号，在真实 Chrome 和运行当前桌面构建的独立 Electron 配置中，分别验证所有人目录2人及已解码头像、全时段统计2照片、相关度文件夹2项，六条页面路径均通过，页面错误零，截图已查看。不是已安装桌面壳自动升级证明。
- 两模式生产 HTTP 查重各1组／2预览，名称、大小、尺寸及修订绑定通过；原操作队列完成 TRASH、RESTORE、TRASH、EMPTY_TRASH，均零失败，回收站正确清空，匿名401保持。只操作合成主体，没有清理真实照片。
- 测试共4份资源／16对象；正常永久清理删除8对象，最终人工夹具清理另删除8对象，2份存活原件哈希保持。合成账号、资源、人物、文件夹、临时凭据已移除；66张 ownerId 表逐表零残留。用户原策略与处理设置在夹具清理后与切换基线严格一致。
- 最终外网首页和入口 JS 与固定构建逐字节一致，入口554302字节／gzip172344字节；API、web、operations 健康且零重启，77项迁移、新 worker 心跳、APK哈希及无关容器身份再次核验通过。首个网页验证失败和维护命令中断均保留证据，不冒充首次即成功。

此轮证明优化已上线及基本功能正确；没有在真实六万图库重复删除，也没有测量 NAS 冷缓存 p95、完整前后台混合负载或 SSD 收益，不能承诺所有页面秒开或以本机样本宣称生产提速倍率。历史后台分析是否完成仍需读实时检查点。

本机私有证据目录 `.omx/artifacts/production-read-efficiency-20261101/`；最终生产证据为 `production-verification.log`、`public-checks.json`、`production-http.json`、`ui-results.json`、`fixture-verified.log` 及 `download-manifest.json`。DeepSeek 按每次实际 push 的固定提交范围独立后台启动，报告位于项目 `docs/deepseek-reviews/`，不等待、不当作发布门禁，也不将启动说成通过。
