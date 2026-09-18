// ============================================================
// permissionConfig.ts — 应用元数据常量（权限从后端 sys_roles 表动态加载）
//
// 阶段 2：AppId 联合类型 / APP_META / ALL_APP_IDS 三项已改为从
//         src/config/appRegistry.ts 派生，本文件不再手写应用清单。
// ============================================================

import { APP_REGISTRY, type AppId } from './appRegistry';

export type { AppId };

export type RoleType = string; // 现在是动态字符串，不再硬编码

// 应用元信息（用于权限配置 UI 展示）。由注册表派生，显示名取 permissionLabel ?? label。
export const APP_META: Record<AppId, { label: string; category: string }> = Object.fromEntries(
    APP_REGISTRY.map((e) => [e.id, { label: e.permissionLabel ?? e.label, category: e.permissionCategory }]),
) as Record<AppId, { label: string; category: string }>;

export const APP_CATEGORIES = ['分析', '运营', '创作', '研发', '知识', '资讯', '系统', '专业工具'];
export const ALL_APP_IDS: AppId[] = APP_REGISTRY.map((e) => e.id as AppId);

/** 从 JWT Token 中解析当前角色名 */
export function parseCurrentRole(): string {
    try {
        const token = localStorage.getItem('blue_os_token');
        if (!token) return '';
        const payload = JSON.parse(atob(token.split('.')[1]));
        return payload.role || '';
    } catch { return ''; }
}
