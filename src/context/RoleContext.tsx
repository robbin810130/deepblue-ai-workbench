// ============================================================
// RoleContext.tsx — 全局角色与权限 Context（权限从后端动态加载）
// ============================================================
import React, { createContext, useContext, useState, useCallback, useEffect } from 'react';
import { parseCurrentRole, type AppId } from '../config/permissionConfig';
import { fetchWithAuth } from '../utils/authFetch';

interface RoleContextValue {
    currentRole: string;
    canAccess: (appId: AppId | string) => boolean;
    refreshRole: () => void;
    isLoading: boolean;
}

const RoleContext = createContext<RoleContextValue>({
    currentRole: '',
    canAccess: () => false,
    refreshRole: () => {},
    isLoading: true,
});

export const RoleProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const [currentRole, setCurrentRole] = useState<string>(parseCurrentRole);
    const [allowedApps, setAllowedApps] = useState<string[]>([]);
    const [isLoading, setIsLoading] = useState<boolean>(true);

    const fetchPermissions = useCallback(async () => {
        setIsLoading(true);
        const role = parseCurrentRole();
        setCurrentRole(role);
        if (!role) { setAllowedApps([]); setIsLoading(false); return; }
        // admin 特殊处理：直接视为全量权限（无需额外请求）
        if (role === 'admin') {
            setAllowedApps(['*']); // * 代表全量
            setIsLoading(false);
            return;
        }
        try {
            const res = await fetchWithAuth('/api/admin/my-permissions');
            if (res.ok) {
                const data = await res.json();
                if (data.success) setAllowedApps(data.data || []);
            }
        } catch { /* token 不存在时不报错 */ }
        finally {
            setIsLoading(false);
        }
    }, []);

    const refreshRole = useCallback(() => {
        fetchPermissions();
    }, [fetchPermissions]);

    // 初始化及登录/权限变更时重新加载
    useEffect(() => {
        fetchPermissions();
    }, [fetchPermissions]);

    useEffect(() => {
        const handler = () => fetchPermissions();
        window.addEventListener('user-logged-in', handler);
        window.addEventListener('permissions-updated', handler);
        return () => {
            window.removeEventListener('user-logged-in', handler);
            window.removeEventListener('permissions-updated', handler);
        };
    }, [fetchPermissions]);

    const canAccess = useCallback((appId: AppId | string) => {
        if (currentRole === 'admin') return true;  // admin 全量
        if (allowedApps.includes('*')) return true;
        return allowedApps.includes(appId);
    }, [currentRole, allowedApps]);

    return (
        <RoleContext.Provider value={{ currentRole, canAccess, refreshRole, isLoading }}>
            {children}
        </RoleContext.Provider>
    );
};

export const useRole = () => useContext(RoleContext);
