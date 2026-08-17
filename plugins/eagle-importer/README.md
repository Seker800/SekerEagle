# SekerEagle 独立导入器

用于把当前 Eagle 图库单向增量导入独立 SekerEagle。它不再连接 SekerChat，也不使用 SekerChat 的账号或令牌。

1. 在 SekerEagle 网页中创建同时具有 `import:read`、`import:write` 与 `asset:write` 的 PAT。
2. 在 Eagle 中载入本目录作为插件。
3. 填写本机地址（默认 `http://localhost:8180`）和 PAT，验证后开始扫描。

插件只在当前进程内保存 PAT；图库稳定 ID 和未完成任务 ID 保存于插件 localStorage，用于增量识别和断点继续。

## 一次性大图库迁移

对于迁移完成后不再使用 Eagle 的图库，优先点击“导出迁移快照”，再使用仓库中的 `@sekereagle/eagle-migrator` 本机命令行工具。快照导出不要求先连接服务器，内容包含不可变清单、元数据定义、源文件哈希和完整性校验，不包含 PAT。

导出期间不要修改图库；导出完成后也不要编辑快照文件或移动图库中的原文件。完整的预检、小样本、恢复和全量步骤见 [`apps/eagle-migrator/README.md`](../../apps/eagle-migrator/README.md)。
