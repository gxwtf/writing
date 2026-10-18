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
