/**
 * 品牌标识（BrandMark）—— DeepBlue AI
 *
 * 设计定案（2026-09-21）：B 方案「深潜 D」
 *   深蓝渐变圆角方块 + 白色几何字母 D（直边 + 右半圆），
 *   以品牌首字母做识别锚点，造型与侧栏既有圆角几何语言同源。
 *
 * 配色取自设计 token：
 *   #6E9BFF = --color-primary-400 、#1F58E8 = --color-primary-600
 *   （与侧栏深蓝 #163A5F～#102A43 形成明度对比，不抢主体）
 *
 * 几何规格（viewBox 48×48，可作为唯一真相源）：
 *   容器  rect 48×48 rx=13
 *   字形  M16.3 13.5 H21.3 A10.5 10.5 0 0 1 21.3 34.5 H16.3
 *         stroke 5 round —— 视觉包围盒 13.8~34.3 × 11~37，两轴均居中
 *
 * ⚠️ 同一套几何另有静态副本 public/favicon.svg（index.html 无法 import 模块）。
 *    改这里就必须同步改那份，否则标签页图标与界面图标会不一致。
 */
import { useId } from 'react';

/** 品牌图形路径（与 public/favicon.svg 保持一致） */
const GLYPH_D =
  'M16.3 13.5H21.3A10.5 10.5 0 0 1 21.3 34.5H16.3';

export interface BrandMarkProps {
  /** 渲染边长（px），默认 32 —— 侧栏品牌区规格 */
  size?: number;
  className?: string;
  /** 装饰性使用（旁边已有文字）时置 false，避免读屏重复播报 */
  labelled?: boolean;
}

export function BrandMark({ size = 32, className, labelled = false }: BrandMarkProps) {
  // useId 会带 ':' 等字符，直接拼进 url(#…) 会解析失败，先净化
  const gradientId = `bm-${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`;

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 48 48"
      className={className}
      role={labelled ? 'img' : 'presentation'}
      aria-label={labelled ? 'DeepBlue AI' : undefined}
      aria-hidden={labelled ? undefined : true}
      focusable="false"
    >
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#6E9BFF" />
          <stop offset="1" stopColor="#1F58E8" />
        </linearGradient>
      </defs>
      <rect width="48" height="48" rx="13" fill={`url(#${gradientId})`} />
      <path
        d={GLYPH_D}
        fill="none"
        stroke="#ffffff"
        strokeWidth="5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
