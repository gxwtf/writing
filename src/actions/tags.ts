'use server';

import { prisma } from '@/lib/db';
import { getAuthUser } from './auth';

export type TagConfigMap = Record<string, { id: string; name: string; colorId: string; description: string }>;

/**
 * 加载当前用户的标签配置。
 * 标签的实际使用（作文打标）存在 Tag / WritingEntryTag 表；
 * 这里返回的 TagConfig 只负责颜色、描述等展示偏好。
 */
export async function loadTagConfigs(): Promise<TagConfigMap> {
  const user = await getAuthUser();
  if (!user) return {};

  const tagConfigs = await prisma.tagConfig.findMany({
    where: { userId: user.userId },
    orderBy: { name: 'asc' },
  });

  const result: TagConfigMap = {};
  for (const tag of tagConfigs) {
    result[tag.name] = {
      id: tag.name,
      name: tag.name,
      colorId: tag.colorId,
      description: tag.description || tag.name,
    };
  }
  return result;
}

/**
 * 全量保存当前用户的标签配置（新增 / 重命名 / 改色 / 删除均通过它落地）。
 * 注意：删除标签配置不会删除标签本身；删除标签请调用 deleteTag。
 */
export async function saveTagConfigs(
  tagConfigs: Record<string, { name: string; colorId: string; description?: string }>
): Promise<TagConfigMap> {
  const user = await getAuthUser();
  if (!user) throw new Error('未登录');

  await prisma.tagConfig.deleteMany({ where: { userId: user.userId } });

  const entries = Object.entries(tagConfigs || {});
  if (entries.length > 0) {
    await prisma.tagConfig.createMany({
      data: entries.map(([, config]) => ({
        userId: user.userId,
        name: config.name || (config as { id?: string }).id || '',
        colorId: config.colorId || 'blue',
        description: config.description,
      })),
    });
  }

  return loadTagConfigs();
}

/** 统计某个标签被当前用户多少条作文使用 */
export async function countTagUsage(tagName: string): Promise<{ writingCount: number }> {
  const user = await getAuthUser();
  if (!user) return { writingCount: 0 };

  const writingCount = await prisma.writingEntryTag.count({
    where: {
      tag: { name: tagName },
      writingEntry: { userId: user.userId },
    },
  });

  return { writingCount };
}

/** 删除标签（关联的作文打标由外键级联清理），并移除当前用户的标签配置 */
export async function deleteTag(tagName: string): Promise<{ success: boolean }> {
  const user = await getAuthUser();
  if (!user) throw new Error('未登录');

  await prisma.tag.deleteMany({ where: { name: tagName } });
  await prisma.tagConfig.deleteMany({ where: { userId: user.userId, name: tagName } });

  return { success: true };
}
