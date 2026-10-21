'use server';

import { prisma } from '@/lib/db';
import { getAuthUser } from './auth';
import type { Notebook } from '@/types/word';

/**
 * 积累本服务端逻辑。
 *
 * 完全照搬广学英语的 `src/actions/wordbooks.ts`（Wordbook / WordbookWord）：
 * 一个用户可以有多个积累本，一条积累可以同时属于多个本；
 * 删除积累本时，仅属于该本的积累会被一并删除，被其它本共享的只解除关联。
 */

async function buildNotebookSummary(notebook: {
  id: number;
  name: string;
  createdAt: Date;
  updatedAt: Date;
  entries: { writingEntry: { content: string } }[];
}): Promise<Notebook> {
  return {
    id: notebook.id,
    name: notebook.name,
    entryCount: notebook.entries.length,
    previewEntries: notebook.entries.slice(0, 6).map((link) =>
      link.writingEntry.content.replace(/\s+/g, ' ').trim().slice(0, 24)
    ),
    createdAt: notebook.createdAt.toISOString(),
    updatedAt: notebook.updatedAt.toISOString(),
  };
}

const summaryInclude = {
  entries: {
    include: { writingEntry: { select: { content: true } } },
    orderBy: [{ createdAt: 'desc' as const }, { id: 'asc' as const }],
  },
};

// 加载当前用户的所有积累本
export async function loadNotebooks(): Promise<Notebook[]> {
  const user = await getAuthUser();
  if (!user) return [];

  const notebooks = await prisma.notebook.findMany({
    where: { userId: user.userId },
    include: summaryInclude,
    orderBy: { updatedAt: 'desc' },
  });

  return Promise.all(notebooks.map(buildNotebookSummary));
}

// 加载单个积累本
export async function getNotebook(id: number): Promise<Notebook | null> {
  const user = await getAuthUser();
  if (!user) return null;

  const notebook = await prisma.notebook.findFirst({
    where: { id, userId: user.userId },
    include: summaryInclude,
  });

  if (!notebook) return null;
  return buildNotebookSummary(notebook);
}

/**
 * 统计删除某个积累本会删掉多少条、保留多少条。
 * 供删除确认弹窗提示用户使用（广学英语的删除弹窗只写了一句静态文案，
 * 这里把真实条数算出来展示，避免用户误删）。
 */
export async function previewDeleteNotebook(
  id: number
): Promise<{ exclusive: number; shared: number; name: string }> {
  const user = await getAuthUser();
  if (!user) throw new Error('未登录');

  const notebook = await prisma.notebook.findFirst({
    where: { id, userId: user.userId },
    select: { id: true, name: true },
  });
  if (!notebook) throw new Error('积累本不存在');

  const links = await prisma.notebookEntry.findMany({
    where: { notebookId: id },
    select: { writingEntryId: true },
  });
  const entryIds = links.map((link) => link.writingEntryId);
  if (entryIds.length === 0) {
    return { exclusive: 0, shared: 0, name: notebook.name };
  }

  const sharedLinks = await prisma.notebookEntry.findMany({
    where: { writingEntryId: { in: entryIds }, notebookId: { not: id } },
    select: { writingEntryId: true },
  });
  const sharedIds = new Set(sharedLinks.map((link) => link.writingEntryId));

  return {
    exclusive: entryIds.filter((eid) => !sharedIds.has(eid)).length,
    shared: sharedIds.size,
    name: notebook.name,
  };
}

// 新建积累本
export async function createNotebook(name: string): Promise<Notebook> {
  const user = await getAuthUser();
  if (!user) throw new Error('未登录');

  const nameTrim = name.trim();
  if (!nameTrim) throw new Error('积累本名称不能为空');

  const existing = await prisma.notebook.findFirst({
    where: { userId: user.userId, name: nameTrim },
  });
  if (existing) throw new Error('已存在同名积累本');

  const created = await prisma.notebook.create({
    data: { userId: user.userId, name: nameTrim },
    include: summaryInclude,
  });

  return buildNotebookSummary(created);
}

// 重命名积累本
export async function renameNotebook(id: number, name: string): Promise<Notebook> {
  const user = await getAuthUser();
  if (!user) throw new Error('未登录');

  const nameTrim = name.trim();
  if (!nameTrim) throw new Error('积累本名称不能为空');

  const notebook = await prisma.notebook.findFirst({
    where: { id, userId: user.userId },
  });
  if (!notebook) throw new Error('积累本不存在');

  const duplicate = await prisma.notebook.findFirst({
    where: { userId: user.userId, name: nameTrim, id: { not: id } },
  });
  if (duplicate) throw new Error('已存在同名积累本');

  const updated = await prisma.notebook.update({
    where: { id },
    data: { name: nameTrim },
    include: summaryInclude,
  });

  return buildNotebookSummary(updated);
}

// 删除积累本
// 仅属于该积累本的条目会被一并删除；被其它积累本共享的条目只解除关联并保留
export async function deleteNotebook(
  id: number
): Promise<{ success: boolean; deletedEntries: number; keptSharedEntries: number }> {
  const user = await getAuthUser();
  if (!user) throw new Error('未登录');

  const notebook = await prisma.notebook.findFirst({
    where: { id, userId: user.userId },
  });
  if (!notebook) throw new Error('积累本不存在');

  return prisma.$transaction(async (tx) => {
    const links = await tx.notebookEntry.findMany({
      where: { notebookId: id },
      select: { writingEntryId: true },
    });
    const entryIds = links.map((link) => link.writingEntryId);

    let exclusiveEntryIds: number[] = [];
    if (entryIds.length > 0) {
      // 同时存在于其它积累本的条目要保留，其余即为独占条目
      const shared = await tx.notebookEntry.findMany({
        where: { writingEntryId: { in: entryIds }, notebookId: { not: id } },
        select: { writingEntryId: true },
      });
      const sharedIds = new Set(shared.map((s) => s.writingEntryId));
      exclusiveEntryIds = entryIds.filter((eid) => !sharedIds.has(eid));
    }

    let deletedEntries = 0;
    if (exclusiveEntryIds.length > 0) {
      const deleted = await tx.writingEntry.deleteMany({
        where: { id: { in: exclusiveEntryIds }, userId: user.userId },
      });
      deletedEntries = deleted.count;
    }

    // 删除积累本（级联清掉剩余关联，共享条目本身保留）
    await tx.notebook.delete({ where: { id } });

    return {
      success: true,
      deletedEntries,
      keptSharedEntries: entryIds.length - deletedEntries,
    };
  });
}

// 把条目加入积累本（条目可在多个本之间共享）
export async function addEntriesToNotebook(
  notebookId: number,
  entryIds: number[]
): Promise<{ added: number }> {
  const user = await getAuthUser();
  if (!user) throw new Error('未登录');

  const notebook = await prisma.notebook.findFirst({
    where: { id: notebookId, userId: user.userId },
  });
  if (!notebook) throw new Error('积累本不存在');

  const owned = await prisma.writingEntry.findMany({
    where: { id: { in: entryIds }, userId: user.userId },
    select: { id: true },
  });

  const existing = await prisma.notebookEntry.findMany({
    where: { notebookId, writingEntryId: { in: owned.map((e) => e.id) } },
    select: { writingEntryId: true },
  });
  const existingIds = new Set(existing.map((e) => e.writingEntryId));
  const toAdd = owned.filter((e) => !existingIds.has(e.id));

  if (toAdd.length > 0) {
    await prisma.notebookEntry.createMany({
      data: toAdd.map((e) => ({ notebookId, writingEntryId: e.id })),
    });
    await prisma.notebook.update({
      where: { id: notebookId },
      data: { updatedAt: new Date() },
    });
  }

  return { added: toAdd.length };
}

// 复制条目到其它积累本（自动去重，原积累本的关联保留）
export async function copyEntriesToNotebook(
  targetNotebookId: number,
  entryIds: number[]
): Promise<{ copied: number; skipped: number }> {
  const user = await getAuthUser();
  if (!user) throw new Error('未登录');

  const target = await prisma.notebook.findFirst({
    where: { id: targetNotebookId, userId: user.userId },
  });
  if (!target) throw new Error('积累本不存在');

  return prisma.$transaction(async (tx) => {
    const owned = await tx.writingEntry.findMany({
      where: { id: { in: entryIds }, userId: user.userId },
      select: { id: true },
    });
    const ownedIds = owned.map((e) => e.id);

    const existing =
      ownedIds.length > 0
        ? await tx.notebookEntry.findMany({
            where: { notebookId: targetNotebookId, writingEntryId: { in: ownedIds } },
            select: { writingEntryId: true },
          })
        : [];
    const existingIds = new Set(existing.map((e) => e.writingEntryId));
    const toAdd = owned.filter((e) => !existingIds.has(e.id));

    if (toAdd.length > 0) {
      await tx.notebookEntry.createMany({
        data: toAdd.map((e) => ({ notebookId: targetNotebookId, writingEntryId: e.id })),
        skipDuplicates: true,
      });
      await tx.notebook.update({
        where: { id: targetNotebookId },
        data: { updatedAt: new Date() },
      });
    }

    return { copied: toAdd.length, skipped: existingIds.size };
  });
}

// 移动条目到其它积累本（自动去重，移动后从原积累本移除，条目本身保留）
export async function moveEntriesToNotebook(
  sourceNotebookId: number,
  targetNotebookId: number,
  entryIds: number[]
): Promise<{ moved: number; skipped: number }> {
  const user = await getAuthUser();
  if (!user) throw new Error('未登录');

  if (sourceNotebookId === targetNotebookId) {
    throw new Error('目标积累本不能与当前积累本相同');
  }

  const [source, target] = await Promise.all([
    prisma.notebook.findFirst({ where: { id: sourceNotebookId, userId: user.userId } }),
    prisma.notebook.findFirst({ where: { id: targetNotebookId, userId: user.userId } }),
  ]);
  if (!source) throw new Error('原积累本不存在');
  if (!target) throw new Error('目标积累本不存在');

  return prisma.$transaction(async (tx) => {
    const owned = await tx.writingEntry.findMany({
      where: { id: { in: entryIds }, userId: user.userId },
      select: { id: true },
    });
    const ownedIds = owned.map((e) => e.id);

    const existing =
      ownedIds.length > 0
        ? await tx.notebookEntry.findMany({
            where: { notebookId: targetNotebookId, writingEntryId: { in: ownedIds } },
            select: { writingEntryId: true },
          })
        : [];
    const existingIds = new Set(existing.map((e) => e.writingEntryId));
    const toAdd = owned.filter((e) => !existingIds.has(e.id));

    if (toAdd.length > 0) {
      await tx.notebookEntry.createMany({
        data: toAdd.map((e) => ({ notebookId: targetNotebookId, writingEntryId: e.id })),
        skipDuplicates: true,
      });
    }

    const removed = await tx.notebookEntry.deleteMany({
      where: { notebookId: sourceNotebookId, writingEntryId: { in: ownedIds } },
    });

    await tx.notebook.update({
      where: { id: targetNotebookId },
      data: { updatedAt: new Date() },
    });
    await tx.notebook.update({
      where: { id: sourceNotebookId },
      data: { updatedAt: new Date() },
    });

    return { moved: removed.count, skipped: existingIds.size };
  });
}

export interface HomeStats {
  notebooks: number;
  entries: number;
  tags: number;
  todayEntries: number;
}

/** 首页统计：积累本数、条目数、标签数、今天新增 */
export async function loadHomeStats(): Promise<HomeStats> {
  const user = await getAuthUser();
  if (!user) return { notebooks: 0, entries: 0, tags: 0, todayEntries: 0 };

  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);

  // 标签只统计当前用户实际用到的（与标签管理页的口径一致：用户自己的 TagConfig）
  const [notebooks, entries, tags, todayEntries] = await Promise.all([
    prisma.notebook.count({ where: { userId: user.userId } }),
    prisma.writingEntry.count({ where: { userId: user.userId } }),
    prisma.tagConfig.count({ where: { userId: user.userId } }),
    prisma.writingEntry.count({
      where: { userId: user.userId, createdAt: { gte: startOfToday } },
    }),
  ]);

  return { notebooks, entries, tags, todayEntries };
}
