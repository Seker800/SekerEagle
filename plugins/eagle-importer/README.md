# SekerEagle 独立导入器

用于把当前 Eagle 图库单向增量导入独立 SekerEagle。它不再连接 SekerChat，也不使用 SekerChat 的账号或令牌。

1. 在 SekerEagle 网页中创建同时具有 `import:read`、`import:write` 与 `asset:write` 的 PAT。
2. 在 Eagle 中载入本目录作为插件。
3. 填写本机地址（默认 `http://localhost:8180`）和 PAT，验证后开始扫描。

插件只在当前进程内保存 PAT；图库稳定 ID 和未完成任务 ID 保存于插件 localStorage，用于增量识别和断点继续。
