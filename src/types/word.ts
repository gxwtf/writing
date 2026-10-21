// 作文积累本 —— 标签与界面相关的共享类型定义

/** 标签键（即标签名称，作为全局唯一标识） */
export type WordTag = string;

// 颜色配置接口
export interface ColorConfig {
  id: string;
  name: string;
  className: string;
  bgClass: string;
  textClass: string;
  borderClass: string;
}

// 标签配置接口
export interface TagConfig {
  id: string;
  name: string;
  colorId: string;
  description: string;
}

/**
 * 积累本（一个用户可有多个，条目可在多个本之间共享）。
 * 与广学英语的 Wordbook 同构。
 */
export interface Notebook {
  id: number;
  name: string;
  entryCount: number;
  /** 卡片上展示的条目摘要（最多 6 条，取内容前 24 字） */
  previewEntries: string[];
  createdAt: string;
  updatedAt: string;
}
