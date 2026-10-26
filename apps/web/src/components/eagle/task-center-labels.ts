import { t } from '../../i18n';
import {
  TASK_FAMILIES,
  resolveTaskPresentation,
  type TaskFamily,
  type TaskWaitReason,
  type BackgroundSchedule,
  type TaskGroup,
  type TaskCenterOverview,
} from '@sekereagle/library-core';

export function taskFamilyLabels(family: TaskFamily): [string, string, string, string] {
  const labels: Record<TaskFamily, [string, string, string, string]> = {
    BROWSE: [
      t('缩略图与预览'),
      t('生成缩略图、预览图，读取文件信息。'),
      t('原文件'),
      t('图库服务器 · 读写与解码'),
    ],
    DETAILS: [
      t('高清与动态组件'),
      t('补齐 RAW 编辑图、动态视频、清晰度和相似特征。'),
      t('原文件 + 解码工具'),
      t('图库服务器 · 较重'),
    ],
    VIDEO: [
      t('视频转码'),
      t('生成浏览器可播放的视频副本。'),
      t('原视频 + FFmpeg'),
      t('图库服务器 · 重'),
    ],
    EMBEDDING: [
      t('2B 向量搜图'),
      t('计算图片向量，用于文字和相似图搜索。'),
      t('预览图 + Mac 2B 模型'),
      t('Mac · 较重'),
    ],
    FACES: [
      t('人脸检测与匹配'),
      t('检测人脸并计算特征，用于人物分组。'),
      t('预览图 + YuNet / SFace 模型'),
      t('图库服务器 · 较重'),
    ],
    COLOR: [
      t('代表色提取'),
      t('从缩略图提取颜色，用于颜色筛选。'),
      t('缩略图'),
      t('图库服务器 · 轻'),
    ],
    PYRAMID: [
      t('大图切片'),
      t('生成分级切片，用于放大浏览。'),
      t('原图 + 解码工具'),
      t('图库服务器 · 较重'),
    ],
    SMART_FOLDERS: [
      t('语义文件夹匹配'),
      t('按描述与图片向量匹配，更新文件夹结果。'),
      t('图片向量；新描述需 Mac 2B 模型'),
      t('图库服务器；新描述用 Mac'),
    ],
    TAG_INDEX: [
      t('标签向量索引'),
      t('用已有图片向量构建标签推荐索引。'),
      t('图片向量 + 标签'),
      t('图库服务器 · 数据计算'),
    ],
    PHOTO_MAP: [
      t('照片位置索引'),
      t('汇总拍摄位置，更新地图分组和封面。'),
      t('照片位置数据'),
      t('图库服务器 · 分批计算'),
    ],
    CLEANUP: [
      t('删除文件清理'),
      t('清理已确认删除的文件及派生图。'),
      t('已确认删除的资源'),
      t('图库服务器 · 存储读写'),
    ],
    APPROVALS: [
      t('整理审批'),
      t('审核整理建议，同意后执行。'),
      t('待审核建议 + 你的确认'),
      t('审核本身无计算'),
    ],
    UPLOADS: [
      t('上传文件入库'),
      t('校验已上传文件，建立图库记录。'),
      t('文件上传完成'),
      t('图库服务器 · 校验与读写'),
    ],
    IMPORTS: [
      t('批量文件导入'),
      t('分批导入文件，记录进度和结果。'),
      t('导入客户端 + 源文件'),
      t('导入端与图库服务器 · 读写'),
    ],
  };
  return labels[family];
}

const waits: Record<TaskWaitReason, () => string> = {
  MODEL_OFFLINE: () => t('等待 Mac 2B 模型上线'),
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
  RENDER_EDITED_COPY: () => t('生成编辑成片'),
  GENERATE_RENDITIONS: () => t('生成缩略图与预览图'),
  GENERATE_THUMBNAIL: () => t('生成缩略图'),
  GENERATE_PREVIEW: () => t('生成预览图'),
  PROBE_MEDIA: () => t('读取媒体信息'),
  GENERATE_EMBEDDING: () => t('生成图片向量'),
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

export function taskExecutionLabel(group: TaskGroup, schedule: BackgroundSchedule): string {
  if (
    group.availability === 'DISABLED' ||
    group.waiting.some(
      (wait) => wait.reason === 'DISABLED' && wait.count === group.queued && group.queued > 0,
    )
  )
    return t('服务器未启用');
  if (group.background) {
    if (group.policy?.paused || schedule.mode === 'MANUAL') return t('已暂停');
    return schedule.mode === 'ALWAYS' ? t('随时') : `${schedule.nightStart}–${schedule.nightEnd}`;
  }
  const triggers: Partial<Record<TaskFamily, string>> = {
    BROWSE: t('上传后排队'),
    PHOTO_MAP: t('位置变化后分批更新'),
    CLEANUP: t('确认删除后排队'),
    APPROVALS: t('你审批后执行'),
    UPLOADS: t('上传完成后执行'),
    IMPORTS: t('导入客户端触发'),
  };
  return triggers[group.id] ?? t('随时');
}

export function taskStatus(
  group: TaskGroup,
  schedule: BackgroundSchedule,
  embedding?: TaskCenterOverview['embedding'],
) {
  return resolveTaskPresentation(group, schedule, embedding).status;
}

export function taskStatusLabel(
  group: TaskGroup,
  schedule: BackgroundSchedule,
  embedding?: TaskCenterOverview['embedding'],
): string {
  const presentation = resolveTaskPresentation(group, schedule, embedding);
  switch (presentation.status) {
    case 'WAITING': {
      const {reason} = presentation;
      return reason === 'MODEL_OFFLINE' || reason === 'MODEL_DRIFTED'
        ? t('等待模型')
        : reason === 'WORKER_OFFLINE'
          ? t('等待处理服务')
          : reason
            ? taskWaitLabel(reason)
            : t('等待执行');
    }
    case 'RUNNING':
      return t('计算ing');
    case 'QUEUED':
      return t('排队ing');
    case 'STOPPED':
      return group.failed > 0
        ? t('已停止（{{count}}项失败）', { count: group.failed })
        : t('已停止');
    case 'COMPLETED':
      return t('已完成');
  }
}
