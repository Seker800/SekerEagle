# 路由与双模式映射（Route map）

> 状态：现行 | 核验日期：2026-11-16 | 对应提交：93b5d583

## 一句话

`/eagle` 是 **MATERIAL** 视图，`/photos` 是 **PHOTO** 视图；两边不是两套实现，PHOTO 通过
空继承复用 `Eagle*Controller` 的同一套路由和写路径。

## 空继承控制器

`apps/api/src/photos/photo-library.module.ts` 里只有类声明和 `@Controller` 前缀：

| 父类（路由定义处）          | MATERIAL 前缀             | PHOTO 子类（空）            | PHOTO 前缀                |
| --------------------------- | ------------------------- | --------------------------- | ------------------------- |
| `EagleController`           | `/eagle`                  | `PhotosController`          | `/photos`                 |
| `EagleUploadController`     | `/eagle/uploads`          | `PhotoUploadsController`    | `/photos/uploads`         |
| `EagleVectorController`     | `/eagle/vector`           | `PhotoVectorsController`    | `/photos/vector`          |
| `EagleProcessingController` | `/admin/eagle-processing` | `PhotoProcessingController` | `/admin/photo-processing` |
| `EagleTaskCenterController` | `/eagle/tasks`            | `PhotoTaskCenterController` | `/photos/tasks`           |

`PhotosController` 等类本身没有方法；路由来自父类。Nest 会用子类的 `@Controller('photos')`
前缀注册继承来的方法。这样写是为了让两个模式共用同一份权限、租约、事务和发布实现，避免
出现“照片版上传／删除／选择系统”。

## 摄影专属控制器

这些不是空继承，属于 PHOTO 扩展，仍复用共享资源和发布守卫：

| 控制器                             | 前缀                             | 职责                         |
| ---------------------------------- | -------------------------------- | ---------------------------- |
| `PhotoManagementController`        | `/photos/photography`            | 时间线、人物、分组、地图入口 |
| `PhotoStatisticsController`        | `/photos/photography/statistics` | 摄影统计                     |
| `PhotoAgentController`             | `/photos/agent`                  | 照片整理建议与受控工具       |
| `PhotoPrivacyVisibilityController` | `/photos/privacy-visibility`     | PHOTO 私密可见性状态         |

## 改路由时注意

- 共享路由只改父类；不要在 PHOTO 子类里覆盖写路径，静态门禁会拒绝第二套写入。
- 新增共享端点时同时检查 MATERIAL 与 PHOTO 的可见性、owner、私密和版本守卫。
- 新增照片专属端点时明确它是只读扩展还是写入口；写入口必须复用 operations 队列。
- `npm run architecture:check` 与 `npm run test:architecture` 覆盖共享 provider 身份、
  空继承和依赖方向；不要用前端过滤或复制控制器绕过。
