# 2026年11月2日全部分支整合

## 范围与授权

用户要求全部分支、工作区修改合到 main 并推送生产，随后明确确认未合并的 Dependabot 分支也应合并；已合并的自动分支可删除。整合前远端 main 为 `c83842b15c979cbaecc81a17a5c064ca84be59b3`，现场 API／operations 为 `refresh-ff0c9ac7`，网页为 `refresh-cc4d1978-complete`。

三个业务引用此前未全部进入 main：查重／常用信息读取、独立读取成品验收、旧刷新候选。旧刷新候选中的功能已被现行刷新版本改进，整合保留现行通知安全、活动进度、断网草稿和时段唤醒语义。17个依赖 PR 经 GitHub 开放状态与 Git 祖先双重核对，均未合并，已逐个正常 merge；不存在把未合并分支冒称已合并后删除的操作。各引用和工作区清单保存在本地本次发布取证目录。

## 配套兼容

Nest common／core／platform／testing统一为12.3.2，config12.0.1、JWT12.0.3、Swagger12.0.5、CLI12.0.11配套。Vite统一6.4.5，避免测试框架和网页各加载一个不同类型实例。Node运行时保持22；更新的Node类型不是运行时升级。

Prisma CLI／client／pg适配器统一7.10.1。CLI连接放在Prisma config；连接适配由共用持久层拥有，API、worker和脚本显式注入，不修改领域查询或迁移历史。原有URL显式连接数、连接超时和schema继续生效；未显式连接数沿用pg自身默认10，连接超时默认5秒、闲置300秒。这里改变了Prisma6按宿主核数推导的默认池，必须以整批SQL／事务性能和运行心跳验收，不据此宣称吞吐提升。适配器在建连前拒绝非允许数据库／外部主机和畸形参数；原迁移前目标守卫继续保留。

TypeScript7.0.2以`typescript-native`独立包承担所有原有tsc型typecheck；Bundler不产物模式避免旧Node10解析选项。运行构建和ts-node、OpenAPI、ESLint编译器API继续使用5.9.3；Nest CLI12使用其自带支持的编译器。所有入口显式指定，避免两个包的同名tsc命令互相覆盖。没有使用force、legacy-peer-deps、忽略类型错误或skip测试。集成夹具通过API清单解析JWT／Config依赖，避免依赖npm偶然提升位置。

MLX锁文件按所有升级重新解析，保留certifi2026.10.19、filelock4.2.1、setuptools84.1.0。隔离新虚拟环境25项测试通过；固定Qwen修订和1024维，新旧真实服务3条合成文本／2张1600px合成图的最差余弦1.0。这是小样本兼容检查，不代表全库重新验证。CUDA requirements的Torch2.13.0配torchvision0.28.0，修复原不满足的0.26.0约束，并将transformers要求的safetensors补到0.8.0；Windows依赖解析通过。CUDA仍未取得原跨后端向量资格，不因合并依赖登记为生产节点。

## 当前检查点

此文初始提交记录源码整合；发布与最终验收仍在执行，不能把本地合并和隔离模型检查当成生产已发布。部署完成后在本文和现用运行状态追加现场证据。私有配置、备份和回退资料不提交Git。
