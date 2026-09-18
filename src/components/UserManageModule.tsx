import React, { useState, useEffect, useCallback } from 'react';
import {
    Users, Plus, Search, Shield, User, UserCheck, UserX,
    Edit2, Trash2, KeyRound, X, Check, Loader2, ChevronDown,
    AlertTriangle, ShieldCheck, Eye, EyeOff, RefreshCw
} from 'lucide-react';
import { fetchWithAuth } from '../utils/authFetch';

// ============================================================
// 类型定义
// ============================================================
interface UserRecord {
    id: number;
    username: string;
    display_name: string;
    email: string | null;
    role: string;
    is_active: boolean;
    created_at: string;
    last_login_at: string | null;
}

interface DynamicRole {
    name: string;
    display_name: string;
}

// 动态角色徽章
const RoleBadge: React.FC<{ roleName: string; roleLabel?: string }> = ({ roleName, roleLabel }) => {
    const isAdmin = roleName === 'admin';
    const isUser = roleName === 'user';
    
    let color = 'bg-slate-100 text-slate-700 border-slate-200';
    let icon = <Shield className="w-3 h-3" />;
    
    if (isAdmin) {
        color = 'bg-purple-100 text-purple-700 border-purple-200';
    } else if (isUser) {
        color = 'bg-blue-100 text-blue-700 border-blue-200';
        icon = <User className="w-3 h-3" />;
    } else {
        color = 'bg-indigo-50 text-indigo-600 border-indigo-200';
        icon = <UserCheck className="w-3 h-3" />;
    }

    return (
        <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-bold border ${color}`}>
            {icon} {roleLabel || roleName}
        </span>
    );
};

// ============================================================
// 用户表单 Modal（新建 / 编辑）
// ============================================================
interface UserFormProps {
    user?: UserRecord | null;
    roles: DynamicRole[];
    onClose: () => void;
    onSuccess: () => void;
}

const UserFormModal: React.FC<UserFormProps> = ({ user, roles, onClose, onSuccess }) => {
    const isEdit = !!user;
    const [form, setForm] = useState({
        username: user?.username || '',
        display_name: user?.display_name || '',
        email: user?.email || '',
        role: user?.role || 'user',
        password: '',
    });
    const [showPwd, setShowPwd] = useState(false);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!isEdit && !form.password) { setError('新用户必须设置密码'); return; }
        if (!isEdit && form.username.length < 3) { setError('用户名至少需要 3 位'); return; }
        if (!isEdit && !/^[a-zA-Z0-9_一-龥]+$/.test(form.username)) { setError('用户名仅支持英文、数字、下划线、中文'); return; }
        setLoading(true);
        setError('');
        try {
            const payload: any = { display_name: form.display_name, email: form.email || undefined, role: form.role };
            if (!isEdit) { payload.username = form.username; payload.password = form.password; }
            const url = isEdit ? `/api/admin/users/${user!.id}` : '/api/admin/users';
            const method = isEdit ? 'PUT' : 'POST';
            const res = await fetchWithAuth(url, {
                method,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload),
            });
            const data = await res.json();
            if (!data.success) throw new Error(data.message);
            onSuccess();
        } catch (err: any) {
            setError(err.message || '操作失败');
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm animate-in fade-in">
            <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md mx-4 overflow-hidden">
                <div className="bg-gradient-to-r from-blue-600 to-indigo-600 px-6 py-4 flex items-center justify-between">
                    <h2 className="text-lg font-black text-white">{isEdit ? '编辑用户' : '新建用户'}</h2>
                    <button onClick={onClose} className="text-white/70 hover:text-white"><X className="w-5 h-5" /></button>
                </div>
                <form onSubmit={handleSubmit} className="p-6 space-y-4">
                    {!isEdit && (
                        <div>
                            <label className="text-sm font-bold text-slate-700 mb-1.5 block">用户名 <span className="text-red-500">*</span></label>
                            <input
                                required
                                minLength={3}
                                value={form.username}
                                onChange={e => setForm(p => ({ ...p, username: e.target.value.trim() }))}
                                className="w-full border border-slate-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                                placeholder="登录账号（至少 3 位，不可修改）"
                            />
                        </div>
                    )}
                    <div>
                        <label className="text-sm font-bold text-slate-700 mb-1.5 block">显示姓名</label>
                        <input
                            value={form.display_name}
                            onChange={e => setForm(p => ({ ...p, display_name: e.target.value }))}
                            className="w-full border border-slate-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                            placeholder="用户的显示名称"
                        />
                    </div>
                    <div>
                        <label className="text-sm font-bold text-slate-700 mb-1.5 block">邮箱</label>
                        <input
                            type="email"
                            value={form.email}
                            onChange={e => setForm(p => ({ ...p, email: e.target.value }))}
                            className="w-full border border-slate-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                            placeholder="可选"
                        />
                    </div>
                    <div>
                        <label className="text-sm font-bold text-slate-700 mb-1.5 block">角色 <span className="text-red-500">*</span></label>
                        <div className="relative">
                            <select
                                value={form.role}
                                onChange={e => setForm(p => ({ ...p, role: e.target.value as any }))}
                                className="w-full border border-slate-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 appearance-none bg-white"
                            >
                                {roles.map(r => (
                                    <option key={r.name} value={r.name}>{r.display_name}</option>
                                ))}
                            </select>
                            <ChevronDown className="absolute right-3 top-3 w-4 h-4 text-slate-400 pointer-events-none" />
                        </div>
                    </div>
                    {!isEdit && (
                        <div>
                            <label className="text-sm font-bold text-slate-700 mb-1.5 block">初始密码 <span className="text-red-500">*</span></label>
                            <div className="relative">
                                <input
                                    type={showPwd ? 'text' : 'password'}
                                    value={form.password}
                                    onChange={e => setForm(p => ({ ...p, password: e.target.value }))}
                                    className="w-full border border-slate-200 rounded-xl px-4 pr-10 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                                    placeholder="至少 6 位"
                                />
                                <button type="button" onClick={() => setShowPwd(v => !v)} className="absolute right-3 top-2.5 text-slate-400 hover:text-slate-600">
                                    {showPwd ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                                </button>
                            </div>
                        </div>
                    )}
                    {error && <p className="text-red-500 text-sm flex items-center gap-1.5"><AlertTriangle className="w-4 h-4" />{error}</p>}
                    <div className="flex gap-3 pt-2">
                        <button type="button" onClick={onClose} className="flex-1 py-2.5 rounded-xl border border-slate-200 text-slate-600 hover:bg-slate-50 font-bold text-sm transition-colors">取消</button>
                        <button type="submit" disabled={loading} className="flex-1 py-2.5 rounded-xl bg-blue-600 text-white font-bold text-sm hover:bg-blue-700 disabled:opacity-50 flex items-center justify-center gap-2 transition-colors">
                            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
                            {isEdit ? '保存修改' : '创建用户'}
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
};

// ============================================================
// 重置密码 Modal
// ============================================================
const ResetPasswordModal: React.FC<{ userId: number; username: string; onClose: () => void }> = ({ userId, username, onClose }) => {
    const [pwd, setPwd] = useState('');
    const [showPwd, setShowPwd] = useState(false);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const [done, setDone] = useState(false);

    const handleReset = async () => {
        if (pwd.length < 6) { setError('密码至少 6 位'); return; }
        setLoading(true); setError('');
        try {
            const res = await fetchWithAuth(`/api/admin/users/${userId}/reset-password`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ new_password: pwd }),
            });
            const data = await res.json();
            if (!data.success) throw new Error(data.message);
            setDone(true);
        } catch (err: any) {
            setError(err.message || '重置密码失败');
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm animate-in fade-in">
            <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm mx-4 overflow-hidden">
                <div className="bg-gradient-to-r from-amber-500 to-orange-600 px-6 py-4 flex items-center justify-between">
                    <h2 className="text-lg font-black text-white flex items-center gap-2"><KeyRound className="w-5 h-5" />重置密码</h2>
                    <button onClick={onClose} className="text-white/70 hover:text-white"><X className="w-5 h-5" /></button>
                </div>
                <div className="p-6">
                    {done ? (
                        <div className="text-center py-4">
                            <ShieldCheck className="w-12 h-12 text-green-500 mx-auto mb-3" />
                            <p className="text-slate-700 font-bold">密码已成功重置</p>
                            <p className="text-sm text-slate-400 mt-1">请告知用户 {username} 新密码</p>
                            <button onClick={onClose} className="mt-4 px-6 py-2 bg-slate-100 rounded-xl text-slate-600 font-bold hover:bg-slate-200 transition-colors text-sm">关闭</button>
                        </div>
                    ) : (
                        <>
                            <p className="text-sm text-slate-600 mb-4">为 <span className="font-bold text-slate-800">{username}</span> 设置新密码</p>
                            <div className="relative mb-4">
                                <input
                                    type={showPwd ? 'text' : 'password'}
                                    value={pwd}
                                    onChange={e => setPwd(e.target.value)}
                                    className="w-full border border-slate-200 rounded-xl px-4 pr-10 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-amber-500"
                                    placeholder="输入新密码（至少 6 位）"
                                />
                                <button type="button" onClick={() => setShowPwd(v => !v)} className="absolute right-3 top-2.5 text-slate-400 hover:text-slate-600">
                                    {showPwd ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                                </button>
                            </div>
                            {error && <p className="text-red-500 text-sm mb-3 flex items-center gap-1"><AlertTriangle className="w-4 h-4" />{error}</p>}
                            <div className="flex gap-3">
                                <button onClick={onClose} className="flex-1 py-2.5 rounded-xl border border-slate-200 text-slate-600 font-bold text-sm hover:bg-slate-50 transition-colors">取消</button>
                                <button onClick={handleReset} disabled={loading} className="flex-1 py-2.5 rounded-xl bg-amber-500 text-white font-bold text-sm hover:bg-amber-600 disabled:opacity-50 flex items-center justify-center gap-2 transition-colors">
                                    {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <KeyRound className="w-4 h-4" />}确认重置
                                </button>
                            </div>
                        </>
                    )}
                </div>
            </div>
        </div>
    );
};

// ============================================================
// 确认删除 Modal
// ============================================================
const DeleteConfirmModal: React.FC<{ userId: number; username: string; onClose: () => void; onSuccess: () => void }> = ({ userId, username, onClose, onSuccess }) => {
    const [loading, setLoading] = useState(false);
    const handleDelete = async () => {
        setLoading(true);
        try {
            const res = await fetchWithAuth(`/api/admin/users/${userId}`, { method: 'DELETE' });
            const data = await res.json();
            if (!data.success) throw new Error(data.message);
            onSuccess();
        } catch { setLoading(false); }
    };
    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm animate-in fade-in">
            <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm mx-4 p-6">
                <div className="flex flex-col items-center text-center mb-6">
                    <div className="w-14 h-14 rounded-full bg-red-100 flex items-center justify-center mb-4">
                        <Trash2 className="w-7 h-7 text-red-500" />
                    </div>
                    <h2 className="text-lg font-black text-slate-800 mb-1">确认删除用户</h2>
                    <p className="text-sm text-slate-500">即将删除用户 <span className="font-bold text-red-600">{username}</span>，此操作不可撤销。</p>
                </div>
                <div className="flex gap-3">
                    <button onClick={onClose} className="flex-1 py-2.5 rounded-xl border border-slate-200 text-slate-600 font-bold text-sm hover:bg-slate-50 transition-colors">取消</button>
                    <button onClick={handleDelete} disabled={loading} className="flex-1 py-2.5 rounded-xl bg-red-500 text-white font-bold text-sm hover:bg-red-600 disabled:opacity-50 flex items-center justify-center gap-2 transition-colors">
                        {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}确认删除
                    </button>
                </div>
            </div>
        </div>
    );
};

// ============================================================
// 主组件：用户管理模块
// ============================================================
export const UserManageModule: React.FC = () => {
    const [users, setUsers] = useState<UserRecord[]>([]);
    const [roles, setRoles] = useState<DynamicRole[]>([]);
    const [total, setTotal] = useState(0);
    const [loading, setLoading] = useState(true);
    const [search, setSearch] = useState('');
    const [roleFilter, setRoleFilter] = useState('');

    const [showForm, setShowForm] = useState(false);
    const [editUser, setEditUser] = useState<UserRecord | null>(null);
    const [resetTarget, setResetTarget] = useState<UserRecord | null>(null);
    const [deleteTarget, setDeleteTarget] = useState<UserRecord | null>(null);
    const [toastMsg, setToastMsg] = useState('');

    const showToast = (msg: string) => {
        setToastMsg(msg);
        setTimeout(() => setToastMsg(''), 3000);
    };

    const fetchUsersAndRoles = useCallback(async () => {
        setLoading(true);
        try {
            // 拉取角色列表
            const roleRes = await fetchWithAuth('/api/admin/roles-public');
            const roleData = await roleRes.json();
            if (roleData.success) {
                setRoles(roleData.data);
                // 给表单一个兜底
                if (!roleFilter && roleData.data.length > 0) {} 
            }

            // 拉取用户列表
            const params = new URLSearchParams({ search, role: roleFilter, page: '1', pageSize: '50' });
            const res = await fetchWithAuth(`/api/admin/users?${params}`);
            const data = await res.json();
            if (data.success) { setUsers(data.data.list); setTotal(data.data.total); }
        } catch { }
        finally { setLoading(false); }
    }, [search, roleFilter]);

    useEffect(() => {
        const t = setTimeout(fetchUsersAndRoles, 300);
        return () => clearTimeout(t);
    }, [fetchUsersAndRoles]);

    const toggleStatus = async (u: UserRecord) => {
        try {
            const res = await fetchWithAuth(`/api/admin/users/${u.id}/status`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ is_active: !u.is_active }),
            });
            const data = await res.json();
            if (!data.success) throw new Error(data.message);
            showToast(`账号已${!u.is_active ? '启用' : '禁用'}`);
            fetchUsersAndRoles();
        } catch (err: any) { showToast(err.message || '操作失败'); }
    };

    const formatDate = (d: string | null) => {
        if (!d) return '从未';
        return new Date(d).toLocaleDateString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
    };

    return (
        <div className="h-full w-full flex flex-col overflow-hidden bg-slate-50/50 animate-in fade-in slide-in-from-bottom-2 duration-500">
            {/* Toast */}
            {toastMsg && (
                <div className="fixed top-6 left-1/2 -translate-x-1/2 z-[100] bg-slate-800 text-white px-5 py-2.5 rounded-xl shadow-2xl text-sm font-bold animate-in fade-in slide-in-from-top-2">
                    {toastMsg}
                </div>
            )}

            {/* 顶部标题区 */}
            <div className="shrink-0 px-6 pt-5 pb-4 bg-white border-b border-slate-200/60">
                <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center shadow-lg shadow-indigo-500/20">
                            <Users className="w-5 h-5 text-white" />
                        </div>
                        <div>
                            <h1 className="text-xl font-black text-slate-900">用户管理</h1>
                            <p className="text-xs text-slate-400 font-medium">共 {total} 个账号 · 仅管理员可访问</p>
                        </div>
                    </div>
                    <button
                        onClick={() => { setEditUser(null); setShowForm(true); }}
                        className="flex items-center gap-2 px-5 py-2.5 bg-gradient-to-r from-indigo-500 to-purple-600 text-white rounded-xl font-bold text-sm shadow-md hover:scale-[1.02] active:scale-95 transition-all"
                    >
                        <Plus className="w-4 h-4" /> 新建用户
                    </button>
                </div>
            </div>

            {/* 搜索与筛选栏 */}
            <div className="shrink-0 px-6 py-3 bg-white border-b border-slate-200/40 flex items-center gap-3">
                <div className="relative flex-1 max-w-md">
                    <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                    <input
                        value={search}
                        onChange={e => setSearch(e.target.value)}
                        className="w-full pl-10 pr-4 py-2 rounded-xl border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400 bg-slate-50"
                        placeholder="搜索用户名、姓名、邮箱..."
                    />
                </div>
                <div className="relative">
                    <select
                        value={roleFilter}
                        onChange={e => setRoleFilter(e.target.value)}
                        className="pl-3 pr-8 py-2 rounded-xl border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400 bg-slate-50 appearance-none"
                    >
                        <option value="">全部角色</option>
                        {roles.map(r => (
                            <option key={r.name} value={r.name}>{r.display_name}</option>
                        ))}
                    </select>
                    <ChevronDown className="absolute right-2 top-2.5 w-4 h-4 text-slate-400 pointer-events-none" />
                </div>
                <button onClick={fetchUsersAndRoles} className="p-2 rounded-xl border border-slate-200 text-slate-500 hover:bg-slate-100 transition-colors">
                    <RefreshCw className="w-4 h-4" />
                </button>
            </div>

            {/* 表格区域 */}
            <div className="flex-1 overflow-y-auto px-6 py-4">
                {loading ? (
                    <div className="flex items-center justify-center h-40">
                        <Loader2 className="w-8 h-8 text-indigo-500 animate-spin" />
                    </div>
                ) : users.length === 0 ? (
                    <div className="flex flex-col items-center justify-center h-40 text-slate-400">
                        <Users className="w-12 h-12 mb-3 opacity-30" />
                        <p className="font-bold">暂无用户</p>
                    </div>
                ) : (
                    <div className="bg-white rounded-2xl border border-slate-200/80 shadow-sm overflow-hidden">
                        <table className="w-full text-sm">
                            <thead>
                                <tr className="bg-slate-50 border-b border-slate-100">
                                    <th className="text-left px-5 py-3.5 text-xs font-black text-slate-500 uppercase tracking-wider">用户</th>
                                    <th className="text-left px-5 py-3.5 text-xs font-black text-slate-500 uppercase tracking-wider">角色</th>
                                    <th className="text-left px-5 py-3.5 text-xs font-black text-slate-500 uppercase tracking-wider">状态</th>
                                    <th className="text-left px-5 py-3.5 text-xs font-black text-slate-500 uppercase tracking-wider">最后登录</th>
                                    <th className="text-left px-5 py-3.5 text-xs font-black text-slate-500 uppercase tracking-wider">创建时间</th>
                                    <th className="text-right px-5 py-3.5 text-xs font-black text-slate-500 uppercase tracking-wider">操作</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-50">
                                {users.map(u => (
                                    <tr key={u.id} className="hover:bg-slate-50/70 transition-colors group">
                                        <td className="px-5 py-4">
                                            <div className="flex items-center gap-3">
                                                <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-indigo-400 to-purple-500 flex items-center justify-center text-white font-black text-sm shrink-0 shadow-sm">
                                                    {(u.display_name || u.username).charAt(0).toUpperCase()}
                                                </div>
                                                <div>
                                                    <p className="font-bold text-slate-800 leading-tight">{u.display_name || u.username}</p>
                                                    <p className="text-xs text-slate-400 mt-0.5">@{u.username}{u.email ? ` · ${u.email}` : ''}</p>
                                                </div>
                                            </div>
                                        </td>
                                        <td className="px-5 py-4"><RoleBadge roleName={u.role} roleLabel={(u as any).role_label} /></td>
                                        <td className="px-5 py-4">
                                            <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-bold border ${u.is_active ? 'bg-green-50 text-green-700 border-green-200' : 'bg-red-50 text-red-500 border-red-200'}`}>
                                                {u.is_active ? <><UserCheck className="w-3 h-3" />启用</> : <><UserX className="w-3 h-3" />禁用</>}
                                            </span>
                                        </td>
                                        <td className="px-5 py-4 text-slate-500 text-xs">{formatDate(u.last_login_at)}</td>
                                        <td className="px-5 py-4 text-slate-400 text-xs">{formatDate(u.created_at)}</td>
                                        <td className="px-5 py-4">
                                            <div className="flex items-center justify-end gap-1.5 opacity-0 group-hover:opacity-100 transition-opacity">
                                                <button
                                                    title="编辑用户"
                                                    onClick={() => { setEditUser(u); setShowForm(true); }}
                                                    className="p-1.5 rounded-lg text-slate-400 hover:text-blue-600 hover:bg-blue-50 transition-colors"
                                                ><Edit2 className="w-4 h-4" /></button>
                                                <button
                                                    title="重置密码"
                                                    onClick={() => setResetTarget(u)}
                                                    className="p-1.5 rounded-lg text-slate-400 hover:text-amber-600 hover:bg-amber-50 transition-colors"
                                                ><KeyRound className="w-4 h-4" /></button>
                                                <button
                                                    title={u.is_active ? '禁用账号' : '启用账号'}
                                                    onClick={() => toggleStatus(u)}
                                                    className={`p-1.5 rounded-lg transition-colors ${u.is_active ? 'text-slate-400 hover:text-orange-600 hover:bg-orange-50' : 'text-slate-400 hover:text-green-600 hover:bg-green-50'}`}
                                                >{u.is_active ? <UserX className="w-4 h-4" /> : <UserCheck className="w-4 h-4" />}</button>
                                                <button
                                                    title="删除用户"
                                                    onClick={() => setDeleteTarget(u)}
                                                    className="p-1.5 rounded-lg text-slate-400 hover:text-red-600 hover:bg-red-50 transition-colors"
                                                ><Trash2 className="w-4 h-4" /></button>
                                            </div>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>

            {/* Modal 层 */}
            {showForm && (
                <UserFormModal
                    user={editUser}
                    roles={roles}
                    onClose={() => { setShowForm(false); setEditUser(null); }}
                    onSuccess={() => { setShowForm(false); setEditUser(null); fetchUsersAndRoles(); showToast(editUser ? '用户信息已更新' : '用户创建成功'); }}
                />
            )}
            {resetTarget && (
                <ResetPasswordModal
                    userId={resetTarget.id}
                    username={resetTarget.username}
                    onClose={() => setResetTarget(null)}
                />
            )}
            {deleteTarget && (
                <DeleteConfirmModal
                    userId={deleteTarget.id}
                    username={deleteTarget.username}
                    onClose={() => setDeleteTarget(null)}
                    onSuccess={() => { setDeleteTarget(null); fetchUsersAndRoles(); showToast('用户已删除'); }}
                />
            )}
        </div>
    );
};

export default UserManageModule;
