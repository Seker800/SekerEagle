# 2026-10-21 依赖维护验收

## 合并范围

- `actions/setup-node`：7.0.0 → 7.1.0（PR #63）。
- `actions/upload-artifact`：7.0.1 → 7.0.2（PR #62）。
- `astral-sh/setup-uv`：10.0.1 → 10.3.0（PR #61）。
- MLX 服务 `aiohttp`：3.14.3 → 3.14.4（PR #72）。
- MLX 服务 `multidict`：6.7.1 → 6.9.1（PR #69）。
- MLX 服务 `pillow`：12.3.0 → 13.0.0（PR #73，单独兼容性验证后合入）。

依赖分支通过合并提交保留来源。组合后的锁文件还包含 `yarl` 1.24.5 → 1.25.1，这是 aiohttp 更新分支已包含的依赖更新，其余包版本不变。CI 工具继续固定完整提交 SHA，Node 项目运行版本仍为 22；工作流触发条件、权限和发布入口不变。

## Pillow 升级依据

核对 [Pillow 13 官方发布说明](https://pillow.readthedocs.io/en/stable/releasenotes/13.0.0.html) 的移除项与 API 变化，并用独立临时虚拟环境安装原有版本和升级版本。依赖解析接受现有 Torch、Torchvision、Transformers 和 MLX 版本，无需放宽约束。

两个版本均通过原有 10 项服务测试，以及 JPEG、PNG、WebP 图片的 RGB 转换、Torchvision 缩放和实际 Qwen 图片预处理检查。升级组合新增 7 项持久回归测试，覆盖 RGB、透明、灰度和调色板输入，验证图片可解码、张量有限、patch 形状及网格符合预期。

测试不下载模型权重，服务接口测试使用现有 FakeModel；本次没有执行完整模型推理，也没有将升级安装到正在运行的服务环境。

## 本地验证

- 使用隔离的本地测试目标通过 `npm run db:guard`，不连接运行中的数据库或对象存储。
- `npm run architecture:check`、`npm run lint`、`npm run typecheck`、`npm test`、`npm run build`、`npm run format:check` 全部通过。
- Python 3.13 独立临时环境执行组合锁文件的 `uv sync --locked` 与 `pytest`：17 项全部通过。
- 本机 uv 0.11.6 可安装锁文件，独立运行 uv 0.13.3 的 `uv lock --check` 同样通过。
- 核对三个 GitHub Action 的官方发布提交及其 `action.yml`，均使用 Node 24 Action 运行时；实际 GitHub 托管 runner 执行结果以远端 CI 为准。

本轮仅修改代码仓库、执行本地测试及合并分支，不部署、不重启或操作开发与生产服务。
