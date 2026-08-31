# 国际化维护指南

SekerEagle 当前支持 `zh-CN` 和 `en-US`。国际化属于展示适配层：业务规则、数据库数据、
用户输入、标签名称和 API 领域对象保持语言无关，不得依赖翻译函数。

## 语言选择

Web 启动时按以下顺序解析语言：

1. URL 的临时覆盖参数 `?lang=en-US` 或 `?lang=zh-CN`；
2. `localStorage` 中的显式偏好 `sekereagle.locale.v1`；
3. `navigator.languages`；
4. 回退到 `zh-CN`。

URL 参数不会写入持久偏好。项目暂不提供可见切换按钮，可以通过以下方式使用：

```text
https://eagle.example.com/?lang=en-US
```

也可以在开发控制台持久设置并刷新页面：

```js
window.sekerEagleI18n.setLocale('en-US');
window.sekerEagleI18n.setLocale(null); // 清除偏好，恢复自动选择
```

桌面客户端打开连接设置时会传递当前 Web locale；无法进入 Web 时使用 Electron 的系统
locale。连接设置页面继续保持离线可用，不依赖服务端语言资源。

## 新增和修改文案

- Web 用户可见文案通过 `apps/web/src/i18n` 的 `t()` 输出。
- 中文默认消息与英文词典分别位于 `messages/zh-CN.ts` 和 `messages/en-US.ts`。
- 两个词典必须具有完全相同的键和插值变量；测试会拒绝缺失键、英文中的中文泄漏以及
  生产组件新增的硬编码中文。
- 日期、数字、大小写转换和排序使用 `getLocale()`，不要写死 `zh-CN`。
- 用户数据不翻译；领域枚举只在展示边界映射为文案。

当前消息 ID 使用稳定的中文默认消息，中文词典同时承担可靠回退。这与源消息 ID 工作流
一致，修改默认措辞时必须同步更新调用点和两份词典。

## API 错误

API 可返回 `{ code, message }`。Web 根据稳定 `code` 本地化已知错误：中文模式保留服务端
详细消息，英文模式不会直接展示未结构化的中文 `message`，而是使用错误码翻译或英文
通用回退。新增用户可见错误码时，应同步更新 `apps/web/src/lib/api-error.ts` 和两份词典。
