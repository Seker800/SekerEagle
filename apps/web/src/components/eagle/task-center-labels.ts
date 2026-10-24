import { t } from '../../i18n';
import { TASK_FAMILIES, type TaskFamily, type TaskWaitReason } from '@sekereagle/library-core';

export function taskFamilyLabels(family: TaskFamily): [string, string] {
  const labels: Record<TaskFamily, [string, string]> = {
    BROWSE: [t('入库与浏览'), t('生成缩略图、预览并读取基础信息，让图片尽快可以浏览。')],
    DETAILS: [t('高清与动态照片'), t('补齐高清编辑来源和动态照片组件。')],
    VIDEO: [t('视频播放'), t('生成适合直接播放的视频副本。')],
    EMBEDDING: [t('图片内容搜索'), t('分析画面，让图片可以通过内容搜索。')],
    AI_TAGS: [t('AI 内容识别'), t('识别画面内容并生成 AI 标签，需要单独开启。')],
    FACES: [t('人物识别'), t('识别人脸并整理人物信息。')],
    COLOR: [t('颜色分析'), t('提取代表色，支持按颜色筛选。')],
    PYRAMID: [t('大图浏览优化'), t('生成放大浏览所需的图片切片。')],
    SMART_FOLDERS: [t('智能文件夹'), t('更新按画面描述匹配的文件夹结果。')],
    TAG_INDEX: [t('标签推荐索引'), t('更新标签推荐所需的索引。')],
    PHOTO_MAP: [t('地图索引'), t('合并近期变化，更新照片地图。')],
    CLEANUP: [t('存储清理'), t('清理已确认删除的资源和待删除对象。')],
    APPROVALS: [t('整理审批'), t('等待你审核整理建议，同意后才会执行。')],
    UPLOADS: [t('上传入库'), t('完成已上传文件的校验和入库。')],
    IMPORTS: [t('批量导入'), t('查看批量导入的整体状态。')],
  };
  return labels[family];
}
const waits: Record<TaskWaitReason, () => string> = {
  MODEL_OFFLINE: () => t('等待模型服务上线'),
  MODEL_DRIFTED: () => t('模型配置不匹配，等待修复'),
  DEPENDENCY: () => t('等待前置步骤'),
  DEPENDENCY_FAILED: () => t('前置步骤失败，请先重试'),
  PAUSED: () => t('已暂停'),
  SCHEDULE: () => t('等待运行时段'),
  DISABLED: () => t('当前部署未启用'),
  WORKER_OFFLINE: () => t('等待处理服务上线'),
  RETRY: () => t('等待自动重试'),
  QUEUED: () => t('等待执行'),
  APPROVAL: () => t('等待你审批'),
};
const steps: Record<string, () => string> = {
  SMART_FOLDER_QUERY: () => t('分析文件夹描述'),
  GENERATE_RENDITIONS: () => t('生成缩略图与预览图'),
  GENERATE_THUMBNAIL: () => t('生成缩略图'),
  GENERATE_PREVIEW: () => t('生成预览图'),
  PROBE_MEDIA: () => t('读取媒体信息'),
  GENERATE_EMBEDDING: () => t('生成图片向量'),
  GENERATE_AI_TAGS: () => t('生成 AI 标签'),
  ANALYZE_PHOTO_FACES: () => t('分析人物'),
  EXTRACT_COLOR_PALETTE: () => t('提取图片代表色'),
  GENERATE_IMAGE_PYRAMID: () => t('生成大图缩放切片'),
  PURGE_ASSET: () => t('清理回收站资源'),
  OBJECT_DELETION: () => t('删除存储对象'),
};
export const taskWaitLabel = (reason: TaskWaitReason) => waits[reason]();
export const taskStepLabel = (step: string) =>
  steps[step]?.() ??
  (step in familyKeys ? taskFamilyLabels(step as TaskFamily)[0] : t('其他处理步骤'));
const familyKeys = Object.fromEntries(TASK_FAMILIES.map((id) => [id, true]));
