import React, { useState, useEffect, useCallback } from 'react';
import {
    ShieldCheck, Plus, Save, Trash2, Check,
    Info, AlertTriangle,
} from 'lucide-react';
import { APP_META, APP_CATEGORIES, ALL_APP_IDS, type AppId } from '../config/permissionConfig';
import { getPermissionIcon } from '../config/appRegistry';
import { fetchWithAuth } from '../utils/authFetch';
import { sysAlert } from '../utils/dialog';
import { Button, Checkbox, EmptyState, Input, Modal, Skeleton, Tag } from './ui';

interface Role {
    id: number;
    name: string;
    display_name: string;
    is_builtin: boolean;
    permissions: string[];
}

// ── 新建角色 Modal ──────────────────────────────────────────
const CreateRoleModal: React.FC<{ onClose: () => void; onSuccess: () => void }> = ({ onClose, onSuccess }) => {
    const [name, setName] = useState('');
    const [displayName, setDisplayName] = useState('');
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');

    const handleCreate = async () => {
        if (!name || !displayName) { setError('角色标识和显示名不能为空'); return; }
        setLoading(true); setError('');
        try {
            const res = await fetchWithAuth('/api/admin/roles', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name, display_name: displayName, permissions: [] }),
            });
            const data = await res.json();
            if (!data.success) throw new Error(data.message);
            onSuccess();
        } catch (e: any) { setError(e.message || '创建失败'); }
        finally { setLoading(false); }
    };

    return (
        <Modal
            open
            onClose={onClose}
            title="新建角色"
            size="sm"
            footer={
                <>
                    <Button onClick={onClose}>取消</Button>
                    <Button
                        variant="primary"
                        loading={loading}
                        icon={<Plus className="w-4 h-4" />}
                        onClick={handleCreate}
                    >
                        创建
                    </Button>
                </>
            }
        >
            <div className="space-y-4">
                <div>
                    <label className="text-body font-medium text-slate-700 mb-1.5 block">
                        角色标识 <span className="text-red-500">*</span>
                    </label>
                    <Input
                        value={name}
                        onChange={e => setName(e.target.value.trim())}
                        placeholder="例如：salesman（英文/中文/数字/下划线）"
                    />
                </div>
                <div>
                    <label className="text-body font-medium text-slate-700 mb-1.5 block">
                        显示名称 <span className="text-red-500">*</span>
                    </label>
                    <Input
                        value={displayName}
                        onChange={e => setDisplayName(e.target.value)}
                        placeholder="例如：业务员"
                    />
                </div>
                {error && (
                    <p className="text-body text-red-500 flex items-center gap-1.5">
                        <AlertTriangle className="w-4 h-4 shrink-0" />{error}
                    </p>
                )}
            </div>
        </Modal>
    );
};

// ── 角色权限编辑面板 ────────────────────────────────────────
const RolePermissionPanel: React.FC<{ role: Role; onSaved: () => void; onDelete: () => void }> = ({ role, onSaved, onDelete }) => {
    const [perms, setPerms] = useState<string[]>(role.permissions || []);
    const [saving, setSaving] = useState(false);
    const [deleting, setDeleting] = useState(false);
    const [saved, setSaved] = useState(false);
    const [confirmDelete, setConfirmDelete] = useState(false);

    useEffect(() => { setPerms(role.permissions || []); setSaved(false); }, [role.id]);

    const toggle = (appId: AppId) => {
        if (role.name === 'admin') return;
        const isSystem = appId === 'usermanage' || appId === 'permissions';
        if (isSystem && role.name !== 'admin') return;
        setPerms(prev => prev.includes(appId) ? prev.filter(a => a !== appId) : [...prev, appId]);
        setSaved(false);
    };

    const handleSave = async () => {
        setSaving(true);
        try {
            const res = await fetchWithAuth(`/api/admin/roles/${role.id}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ permissions: perms }),
            });
            const data = await res.json();
            if (!data.success) throw new Error(data.message);
            setSaved(true);
            setTimeout(() => setSaved(false), 2000);
            window.dispatchEvent(new CustomEvent('permissions-updated'));
            onSaved();
        } catch { } finally { setSaving(false); }
    };

    const handleDelete = async () => {
        setDeleting(true);
        try {
            const res = await fetchWithAuth(`/api/admin/roles/${role.id}`, { method: 'DELETE' });
            const data = await res.json();
            if (!data.success) throw new Error(data.message);
            window.dispatchEvent(new CustomEvent('permissions-updated'));
            onDelete();
        } catch (e: any) {
            sysAlert(e.message || '删除角色失败');
            setDeleting(false);
            setConfirmDelete(false);
        }
    };

    const isAdmin = role.name === 'admin';

    return (
        <div className="flex-1 overflow-y-auto">
            {/* 角色头部 */}
            <div className="sticky top-0 z-10 bg-white border-b border-slate-100 px-6 py-3 flex items-center justify-between">
                <div>
                    <h3 className="text-title font-medium text-slate-800">{role.display_name}</h3>
                    <p className="text-caption text-slate-400">@{role.name}{role.is_builtin ? ' · 内置角色' : ' · 自定义角色'}</p>
                </div>
                <div className="flex gap-2 items-center">
                    {!role.is_builtin && !confirmDelete && (
                        <Button
                            variant="danger-outline"
                            size="sm"
                            icon={<Trash2 className="w-3.5 h-3.5" />}
                            onClick={() => setConfirmDelete(true)}
                        >
                            删除角色
                        </Button>
                    )}
                    {confirmDelete && (
                        <div className="flex gap-2 items-center">
                            <span className="text-caption text-red-600 font-medium">确认删除?</span>
                            <Button variant="danger" size="sm" loading={deleting} onClick={handleDelete}>
                                确认
                            </Button>
                            <Button variant="secondary" size="sm" onClick={() => setConfirmDelete(false)}>
                                取消
                            </Button>
                        </div>
                    )}
                    {!isAdmin && (
                        <Button
                            variant="primary"
                            size="sm"
                            loading={saving}
                            icon={saved ? <Check className="w-3.5 h-3.5" /> : <Save className="w-3.5 h-3.5" />}
                            onClick={handleSave}
                        >
                            {saved ? '已保存' : '保存权限'}
                        </Button>
                    )}
                </div>
            </div>

            {isAdmin && (
                <div className="m-4 p-3 bg-brand-50 rounded-card border border-brand-100 text-caption text-brand-700 flex items-center gap-2">
                    <Info className="w-4 h-4 shrink-0" />管理员角色始终拥有全部功能访问权，权限不可修改。
                </div>
            )}

            {/* 权限分类列表 */}
            <div className="px-4 py-3 space-y-3">
                {APP_CATEGORIES.map(cat => {
                    const catApps = ALL_APP_IDS.filter(id => APP_META[id].category === cat);
                    if (catApps.length === 0) return null;
                    return (
                        <div key={cat} className="bg-slate-50 rounded-card border border-slate-100 overflow-hidden">
                            <div className="px-4 py-2 bg-slate-100/80 border-b border-slate-100">
                                <span className="text-caption font-medium text-slate-500 uppercase tracking-wider">{cat}</span>
                            </div>
                            <div className="divide-y divide-slate-100">
                                {catApps.map(appId => {
                                    const isSystem = appId === 'usermanage' || appId === 'permissions';
                                    const isChecked = isAdmin || isSystem ? (isAdmin) : perms.includes(appId);
                                    const isLocked = isAdmin || (isSystem);
                                    const Icon = getPermissionIcon(appId);
                                    return (
                                        <div key={appId} className="flex items-center gap-3 px-4 py-3 hover:bg-white transition-colors">
                                            <Checkbox
                                                checked={isChecked}
                                                disabled={isLocked}
                                                onChange={() => toggle(appId)}
                                                aria-label={APP_META[appId].label}
                                            />
                                            {Icon && (
                                                <span className="text-slate-500 shrink-0">
                                                    <Icon className="w-3.5 h-3.5" />
                                                </span>
                                            )}
                                            <span className="text-body font-medium text-slate-700">{APP_META[appId].label}</span>
                                            {isSystem && (
                                                <Tag tone="brand" className="ml-auto">系统专属</Tag>
                                            )}
                                        </div>
                                    );
                                })}
                            </div>
                        </div>
                    );
                })}
            </div>
        </div>
    );
};

// ── 主组件 ──────────────────────────────────────────────────
export const PermissionModule: React.FC = () => {
    const [roles, setRoles] = useState<Role[]>([]);
    const [selectedRole, setSelectedRole] = useState<Role | null>(null);
    const [loading, setLoading] = useState(true);
    const [showCreate, setShowCreate] = useState(false);

    const fetchRoles = useCallback(async () => {
        setLoading(true);
        try {
            const res = await fetchWithAuth('/api/admin/roles');
            const data = await res.json();
            if (data.success) {
                setRoles(data.data);
                setSelectedRole(prev => {
                    if (!prev) return data.data[0] || null;
                    return data.data.find((r: Role) => r.id === prev.id) || data.data[0] || null;
                });
            }
        } catch { } finally { setLoading(false); }
    }, []);

    useEffect(() => { fetchRoles(); }, [fetchRoles]);

    return (
        <div className="h-full w-full flex overflow-hidden bg-slate-50/50">
            {/* 左栏：角色列表 */}
            <div className="w-56 bg-white border-r border-slate-200/60 flex flex-col shrink-0">
                <div className="px-4 py-4 border-b border-slate-100">
                    <div className="flex items-center gap-2 mb-3">
                        <div className="w-7 h-7 rounded-control bg-gradient-to-br from-brand-500 to-brand-700 flex items-center justify-center">
                            <ShieldCheck className="w-4 h-4 text-white" />
                        </div>
                        <h1 className="text-lead font-medium text-slate-900">权限管理</h1>
                    </div>
                    <Button
                        size="sm"
                        block
                        icon={<Plus className="w-3.5 h-3.5" />}
                        onClick={() => setShowCreate(true)}
                        className="bg-brand-50 text-brand-600 border-brand-100 hover:bg-brand-100 hover:border-brand-200"
                    >
                        新建角色
                    </Button>
                </div>

                <div className="flex-1 overflow-y-auto py-2">
                    {loading ? (
                        <div className="px-4 py-2 space-y-3">
                            {[0, 1, 2, 3].map(i => (
                                <div key={i} className="flex items-center gap-2.5">
                                    <Skeleton className="h-7 w-7 rounded-control" />
                                    <div className="flex-1 space-y-1.5">
                                        <Skeleton className="h-3 w-16" />
                                        <Skeleton className="h-2.5 w-20" />
                                    </div>
                                </div>
                            ))}
                        </div>
                    ) : (
                        roles.map(role => (
                            <button key={role.id} onClick={() => setSelectedRole(role)}
                                className={`w-full text-left px-4 py-3 transition-colors flex items-center gap-2.5 ${selectedRole?.id === role.id ? 'bg-brand-50 border-r-2 border-brand-500' : 'hover:bg-slate-50'}`}>
                                <div className={`w-7 h-7 rounded-control flex items-center justify-center text-caption font-medium shrink-0 ${role.name === 'admin' ? 'bg-brand-100 text-brand-700' : 'bg-slate-100 text-slate-600'}`}>
                                    {role.display_name.charAt(0)}
                                </div>
                                <div className="min-w-0">
                                    <p className={`text-body font-medium truncate ${selectedRole?.id === role.id ? 'text-brand-700' : 'text-slate-700'}`}>{role.display_name}</p>
                                    <p className="text-caption text-slate-400 truncate">{role.is_builtin ? '内置' : '自定义'} · {role.permissions?.length ?? 0} 项权限</p>
                                </div>
                            </button>
                        ))
                    )}
                </div>
            </div>

            {/* 右栏：权限配置 */}
            <div className="flex-1 overflow-hidden flex flex-col relative">
                {selectedRole ? (
                    <RolePermissionPanel
                        key={selectedRole.id}
                        role={selectedRole}
                        onSaved={fetchRoles}
                        onDelete={() => { fetchRoles(); setSelectedRole(null); }}
                    />
                ) : (
                    <div className="flex-1 flex items-center justify-center">
                        <EmptyState
                            icon={<ShieldCheck className="w-12 h-12" />}
                            title="选择左侧角色进行权限配置"
                        />
                    </div>
                )}

                {/* 底部提示 */}
                <div className="absolute bottom-3 left-3 right-3">
                    <div className="flex items-center gap-2 bg-amber-50 rounded-card px-4 py-2.5 border border-amber-100 text-caption text-amber-700">
                        <Info className="w-3.5 h-3.5 shrink-0" />
                        保存后对下次打开应用的用户立即生效。"系统专属"功能仅限管理员，不可授权给其他角色。
                    </div>
                </div>
            </div>

            {/* 新建角色 Modal */}
            {showCreate && (
                <CreateRoleModal
                    onClose={() => setShowCreate(false)}
                    onSuccess={() => { setShowCreate(false); fetchRoles(); }}
                />
            )}
        </div>
    );
};

export default PermissionModule;
