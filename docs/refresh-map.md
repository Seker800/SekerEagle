# 前端刷新与失效地图（Refresh map）

> 状态：现行 | 核验日期：2026-11-16 | 对应提交：319c087a

前端现在有五套刷新／失效机制。**先选机制，再写查询；不要在一个功能里混用多套。**
共同不变量：进度更新不得重置分页、滚动位置、选择或未保存草稿。

| 机制               | 代码入口                                                                                        | 什么时候用                                                              | 不要用来做什么                                        |
| ------------------ | ----------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- | ----------------------------------------------------- |
| Workspace 提交通知 | `lib/workspace-refresh.ts`、`lib/useRefreshPolicy.ts` 的 `useRefreshOnWorkspaceChanges`         | 数据库提交后按 owner／mode／能力失效查询；页面重新可见时校准            | 不要把它当业务轮询；不要用它搬运资源内容              |
| 操作回执刷新       | `components/eagle/asset-operation-refresh.ts`                                                   | 用户批量操作返回 operation 回执后，按回执局部更新列表、计数、详情和缓存 | 不要在每次进度 tick 重取整页；不要 `pages.slice(0,1)` |
| 进度观察           | `lib/useRefreshPolicy.ts` 的 `useActivityRefresh`、`useProgressQueryInterval`、`usePageVisible` | 有活动任务时 5 秒观察、停滞 10 秒；隐藏时暂停                           | 不要用于普通列表；终态后要停止完整读取                |
| 处理页轮询         | `components/eagle/useEagleProcessingUpdates.ts`                                                 | 处理／任务中心查看媒体任务进度                                          | 不要扩展到图库列表或操作回执                          |
| 手工重载           | `components/eagle/useReloadableWorkspaceData.ts`、组件内 `reload()`                             | 旧面板或局部视图没有正式查询键时的过渡方案                              | 新增功能不要继续复制；优先用 `useQuery` + 上面的机制  |

## 选择顺序

1. **写操作**：返回 operation 回执 → `asset-operation-refresh`；不要自己猜列表位置。
2. **别的标签页／进程提交了变化**：`useRefreshOnWorkspaceChanges`，只失效受影响能力。
3. **当前有活动进度**：`useActivityRefresh`／`useProgressQueryInterval`，终态后停。
4. **处理页自己的任务列表**：`useEagleProcessingUpdates`。
5. **以上都不适用的旧面板**：`useReloadableWorkspaceData`，并标注为过渡。

## 查询键耦合点

`workspace-refresh.ts:116` 和 `eagle-workspace-cache.ts:225` 仍用位置协议读
`key[3]`、要求 `key.length === 6`。新增查询键必须复用 `createEagleQueryKeys` 工厂；
不要手工拼数组。后续应把键形状收进带类型的构造器，位置协议只是当前实现细节。

## 验收

- 批量操作部分失败：保留已加载分页，显示完成数与待重试项，不重置滚动。
- 进度更新：不裁剪页链、不清空选择、不覆盖元数据草稿。
- 私密撤权：清理对应数据、实体和 blob；不要只清查询键。
- 隐藏标签页：暂停轮询；恢复可见时合并校准，而不是并发重取所有查询。
