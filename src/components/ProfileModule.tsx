import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
    User, Lock, Monitor, Camera, Save, Key, LogOut,
    Loader2, CheckCircle, AlertCircle, Trash2, Shield,
    Building2, Mail, Calendar, Clock, MapPin
} from 'lucide-react';
import { fetchWithAuth } from '../utils/authFetch';
import { sysAlert, sysConfirm } from '../utils/dialog';

// ─── Types ───────────────────────────────────────────────────
interface Profile {
    id: number;
    username: string;
    display_name: string;
    email: string;
    department: string;
    role: string;
    role_label: string;
    avatar_url: string | null;
    created_at: string;
    last_login_at: string | null;
}

interface Session {
    jti: string;
    device_info: string;
    ip_address: string;
    created_at: string;
    expires_at: string;
    is_current: boolean;
}

type TabId = 'info' | 'password' | 'sessions';

// ─── Helper ───────────────────────────────────────────────────
function formatDate(iso: string | null) {
    if (!iso) return '—';
    const d = new Date(iso);
    return d.toLocaleString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
}

function parseDevice(ua: string) {
    if (!ua) return { browser: '未知浏览器', os: '未知系统' };
    let browser = '未知浏览器';
    let os = '未知系统';
    if (/Edg\//i.test(ua)) browser = 'Microsoft Edge';
    else if (/OPR\//i.test(ua)) browser = 'Opera';
    else if (/Chrome\//i.test(ua) && !/Chromium/i.test(ua)) browser = 'Chrome';
    else if (/Firefox\//i.test(ua)) browser = 'Firefox';
    else if (/Safari\//i.test(ua) && !/Chrome/i.test(ua)) browser = 'Safari';
    if (/Windows NT/i.test(ua)) os = 'Windows';
    else if (/Mac OS X/i.test(ua)) os = 'macOS';
    else if (/Linux/i.test(ua)) os = 'Linux';
    else if (/Android/i.test(ua)) os = 'Android';
    else if (/iPhone|iPad/i.test(ua)) os = 'iOS';
    return { browser, os };
}

// ─── ProfileModule ────────────────────────────────────────────
export const ProfileModule: React.FC = () => {
    const [activeTab, setActiveTab] = useState<TabId>('info');
    const [profile, setProfile] = useState<Profile | null>(null);
    const [sessions, setSessions] = useState<Session[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [isSaving, setIsSaving] = useState(false);
    const [toast, setToast] = useState<{ type: 'ok' | 'err'; msg: string } | null>(null);

    // Info form
    const [displayName, setDisplayName] = useState('');
    const [department, setDepartment] = useState('');
    const [email, setEmail] = useState('');

    // Password form
    const [oldPwd, setOldPwd] = useState('');
    const [newPwd, setNewPwd] = useState('');
    const [confirmPwd, setConfirmPwd] = useState('');
    const [showPwds, setShowPwds] = useState(false);

    // Avatar
    const avatarInputRef = useRef<HTMLInputElement>(null);
    const [avatarPreview, setAvatarPreview] = useState<string | null>(null);

    const showToast = (type: 'ok' | 'err', msg: string) => {
        setToast({ type, msg });
        setTimeout(() => setToast(null), 3000);
    };

    const fetchProfile = useCallback(async () => {
        setIsLoading(true);
        try {
            const res = await fetchWithAuth('/api/user/profile');
            const data = await res.json();
            if (data.success) {
                setProfile(data.data);
                setDisplayName(data.data.display_name || '');
                setDepartment(data.data.department || '');
                setEmail(data.data.email || '');
                setAvatarPreview(data.data.avatar_url || null);
            }
        } catch (_) { /* ignore */ }
        finally { setIsLoading(false); }
    }, []);

    const fetchSessions = useCallback(async () => {
        try {
            const res = await fetchWithAuth('/api/user/sessions');
            const data = await res.json();
            if (data.success) setSessions(data.data);
        } catch (_) { /* ignore */ }
    }, []);

    useEffect(() => { fetchProfile(); }, [fetchProfile]);
    useEffect(() => { if (activeTab === 'sessions') fetchSessions(); }, [activeTab, fetchSessions]);

    // ── Actions ──────────────────────────────────────────────
    const handleSaveInfo = async () => {
        if (!displayName.trim()) { showToast('err', '显示姓名不能为空'); return; }
        setIsSaving(true);
        try {
            const res = await fetchWithAuth('/api/user/profile', {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ display_name: displayName, department, email }),
            });
            const data = await res.json();
            if (data.success) { showToast('ok', '个人信息已更新'); fetchProfile(); }
            else showToast('err', data.message || '更新失败');
        } catch (_) { showToast('err', '网络错误'); }
        finally { setIsSaving(false); }
    };

    const handleChangePassword = async () => {
        if (!oldPwd || !newPwd || !confirmPwd) { showToast('err', '请填写全部密码字段'); return; }
        if (newPwd.length < 6) { showToast('err', '新密码至少 6 位'); return; }
        if (newPwd !== confirmPwd) { showToast('err', '两次输入的新密码不一致'); return; }
        if (oldPwd === newPwd) { showToast('err', '新密码不能与旧密码相同'); return; }
        setIsSaving(true);
        try {
            const res = await fetchWithAuth('/api/user/change-password', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ old_password: oldPwd, new_password: newPwd }),
            });
            const data = await res.json();
            if (data.success) {
                showToast('ok', data.message);
                setOldPwd(''); setNewPwd(''); setConfirmPwd('');
            } else showToast('err', data.message || '修改失败');
        } catch (_) { showToast('err', '网络错误'); }
        finally { setIsSaving(false); }
    };

    const handleAvatarChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;
        if (file.size > 800 * 1024) { sysAlert('头像图片请控制在 800KB 以内'); return; }
        const reader = new FileReader();
        reader.onload = async (ev) => {
            const dataUrl = ev.target?.result as string;
            setAvatarPreview(dataUrl);
            try {
                const res = await fetchWithAuth('/api/user/avatar', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ avatar_data: dataUrl }),
                });
                const data = await res.json();
                if (data.success) showToast('ok', '头像已更新');
                else showToast('err', data.message || '上传失败');
            } catch (_) { showToast('err', '上传头像失败'); }
        };
        reader.readAsDataURL(file);
        e.target.value = '';
    };

    const handleKickSession = (jti: string) => {
        sysConfirm('确定要踢出该设备吗？', async () => {
            try {
                const res = await fetchWithAuth(`/api/user/sessions/${jti}`, { method: 'DELETE' });
                const data = await res.json();
                if (data.success) { showToast('ok', '设备已踢出'); fetchSessions(); }
                else showToast('err', data.message || '操作失败');
            } catch (_) { showToast('err', '网络错误'); }
        });
    };

    const handleKickAll = () => {
        sysConfirm('确定退出所有其他登录设备？', async () => {
            try {
                const res = await fetchWithAuth('/api/user/sessions', { method: 'DELETE' });
                const data = await res.json();
                if (data.success) { showToast('ok', data.message); fetchSessions(); }
                else showToast('err', data.message || '操作失败');
            } catch (_) { showToast('err', '网络错误'); }
        });
    };

    // ── Render ───────────────────────────────────────────────
    if (isLoading) return (
        <div className="h-full flex items-center justify-center bg-slate-50">
            <Loader2 className="w-8 h-8 text-indigo-400 animate-spin" />
        </div>
    );

    const tabs: { id: TabId; label: string; icon: React.ReactNode }[] = [
        { id: 'info', label: '基本信息', icon: <User className="w-4 h-4" /> },
        { id: 'password', label: '修改密码', icon: <Key className="w-4 h-4" /> },
        { id: 'sessions', label: '登录设备', icon: <Monitor className="w-4 h-4" /> },
    ];

    return (
        <div className="h-full flex bg-slate-50 overflow-hidden">
            {/* ── 左侧：头像/用户卡片 ── */}
            <aside className="w-64 shrink-0 flex flex-col items-center bg-gradient-to-b from-indigo-700 to-indigo-900 p-6 gap-4">
                {/* 头像 */}
                <div className="relative group">
                    <div className="w-24 h-24 rounded-full ring-4 ring-white/20 overflow-hidden bg-indigo-600 flex items-center justify-center">
                        {avatarPreview
                            ? <img src={avatarPreview} alt="avatar" className="w-full h-full object-cover" />
                            : <User className="w-12 h-12 text-white/60" />
                        }
                    </div>
                    <button
                        onClick={() => avatarInputRef.current?.click()}
                        className="absolute inset-0 rounded-full bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center"
                    >
                        <Camera className="w-6 h-6 text-white" />
                    </button>
                    <input ref={avatarInputRef} type="file" accept="image/*" className="hidden" onChange={handleAvatarChange} />
                </div>

                {/* 用户信息 */}
                <div className="text-center">
                    <p className="text-white font-bold text-lg leading-tight">{profile?.display_name || profile?.username}</p>
                    <p className="text-indigo-200 text-sm mt-0.5">@{profile?.username}</p>
                    <span className="inline-block mt-2 px-3 py-0.5 rounded-full bg-white/20 text-white text-xs font-medium">
                        {profile?.role_label || profile?.role}
                    </span>
                </div>

                {/* 元数据 */}
                <div className="w-full space-y-2 mt-2">
                    {profile?.department && (
                        <div className="flex items-center gap-2 text-indigo-200 text-sm">
                            <Building2 className="w-3.5 h-3.5 shrink-0" />
                            <span className="truncate">{profile.department}</span>
                        </div>
                    )}
                    {profile?.email && (
                        <div className="flex items-center gap-2 text-indigo-200 text-sm">
                            <Mail className="w-3.5 h-3.5 shrink-0" />
                            <span className="truncate">{profile.email}</span>
                        </div>
                    )}
                    <div className="flex items-center gap-2 text-indigo-200 text-sm">
                        <Calendar className="w-3.5 h-3.5 shrink-0" />
                        <span>注册于 {formatDate(profile?.created_at || null).slice(0, 10)}</span>
                    </div>
                    <div className="flex items-center gap-2 text-indigo-200 text-sm">
                        <Clock className="w-3.5 h-3.5 shrink-0" />
                        <span className="text-xs">上次登录 {formatDate(profile?.last_login_at || null)}</span>
                    </div>
                </div>

                {/* 提示 */}
                <p className="text-indigo-300 text-xs text-center mt-auto">点击头像可更换照片</p>
            </aside>

            {/* ── 右侧：内容区 ── */}
            <div className="flex-1 min-w-0 flex flex-col overflow-hidden">
                {/* Tab 导航 */}
                <div className="shrink-0 border-b border-slate-200 bg-white px-6 flex gap-1 pt-4">
                    {tabs.map(t => (
                        <button
                            key={t.id}
                            onClick={() => setActiveTab(t.id)}
                            className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium rounded-t-lg border-b-2 transition-all ${
                                activeTab === t.id
                                    ? 'border-indigo-600 text-indigo-600 bg-indigo-50'
                                    : 'border-transparent text-slate-500 hover:text-indigo-600 hover:bg-slate-50'
                            }`}
                        >
                            {t.icon}{t.label}
                        </button>
                    ))}
                </div>

                {/* Tab 内容 */}
                <div className="flex-1 overflow-y-auto p-6">
                    {/* ── 基本信息 ── */}
                    {activeTab === 'info' && (
                        <div className="max-w-lg space-y-5">
                            <h2 className="text-base font-bold text-slate-700">个人信息设置</h2>

                            <div>
                                <label className="text-sm font-semibold text-slate-600 mb-1.5 block">
                                    显示姓名 <span className="text-red-500">*</span>
                                </label>
                                <input
                                    value={displayName}
                                    onChange={e => setDisplayName(e.target.value)}
                                    className="w-full border border-slate-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 bg-white"
                                    placeholder="您的显示名称"
                                />
                            </div>

                            <div>
                                <label className="text-sm font-semibold text-slate-600 mb-1.5 block">部门</label>
                                <input
                                    value={department}
                                    onChange={e => setDepartment(e.target.value)}
                                    className="w-full border border-slate-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 bg-white"
                                    placeholder="所属部门（可选）"
                                />
                            </div>

                            <div>
                                <label className="text-sm font-semibold text-slate-600 mb-1.5 block">邮箱</label>
                                <input
                                    type="email"
                                    value={email}
                                    onChange={e => setEmail(e.target.value)}
                                    className="w-full border border-slate-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 bg-white"
                                    placeholder="电子邮箱（可选）"
                                />
                            </div>

                            <div>
                                <label className="text-sm font-semibold text-slate-600 mb-1.5 block">登录账号</label>
                                <input
                                    value={profile?.username || ''}
                                    disabled
                                    className="w-full border border-slate-100 rounded-xl px-4 py-2.5 text-sm bg-slate-50 text-slate-400 cursor-not-allowed"
                                />
                                <p className="text-xs text-slate-400 mt-1">账号名不可修改</p>
                            </div>

                            <button
                                onClick={handleSaveInfo}
                                disabled={isSaving}
                                className="flex items-center gap-2 px-5 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-sm font-semibold transition-all disabled:opacity-60 shadow-md shadow-indigo-200"
                            >
                                {isSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                                保存信息
                            </button>
                        </div>
                    )}

                    {/* ── 修改密码 ── */}
                    {activeTab === 'password' && (
                        <div className="max-w-lg space-y-5">
                            <h2 className="text-base font-bold text-slate-700">修改登录密码</h2>
                            <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 flex gap-3 text-sm text-amber-700">
                                <Shield className="w-4 h-4 shrink-0 mt-0.5" />
                                <span>修改密码后，其他设备上的登录会话将自动失效，需要重新登录。</span>
                            </div>

                            {[
                                { label: '当前密码', value: oldPwd, setter: setOldPwd, placeholder: '请输入当前密码' },
                                { label: '新密码', value: newPwd, setter: setNewPwd, placeholder: '至少 6 位' },
                                { label: '确认新密码', value: confirmPwd, setter: setConfirmPwd, placeholder: '再次输入新密码' },
                            ].map(({ label, value, setter, placeholder }) => (
                                <div key={label}>
                                    <label className="text-sm font-semibold text-slate-600 mb-1.5 block">
                                        {label} <span className="text-red-500">*</span>
                                    </label>
                                    <input
                                        type={showPwds ? 'text' : 'password'}
                                        value={value}
                                        onChange={e => setter(e.target.value)}
                                        className="w-full border border-slate-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 bg-white"
                                        placeholder={placeholder}
                                    />
                                </div>
                            ))}

                            <label className="flex items-center gap-2 text-sm text-slate-500 cursor-pointer select-none">
                                <input type="checkbox" checked={showPwds} onChange={e => setShowPwds(e.target.checked)} className="rounded" />
                                显示密码
                            </label>

                            <button
                                onClick={handleChangePassword}
                                disabled={isSaving}
                                className="flex items-center gap-2 px-5 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-sm font-semibold transition-all disabled:opacity-60 shadow-md shadow-indigo-200"
                            >
                                {isSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Lock className="w-4 h-4" />}
                                确认修改密码
                            </button>
                        </div>
                    )}

                    {/* ── 登录设备 ── */}
                    {activeTab === 'sessions' && (
                        <div className="max-w-2xl space-y-4">
                            <div className="flex items-center justify-between">
                                <h2 className="text-base font-bold text-slate-700">登录设备管理</h2>
                                {sessions.filter(s => !s.is_current).length > 0 && (
                                    <button
                                        onClick={handleKickAll}
                                        className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-red-500 border border-red-200 rounded-lg hover:bg-red-50 transition-colors"
                                    >
                                        <LogOut className="w-3.5 h-3.5" />
                                        退出所有其他设备
                                    </button>
                                )}
                            </div>

                            {sessions.length === 0 ? (
                                <div className="text-center text-slate-400 py-12">
                                    <Monitor className="w-10 h-10 mx-auto mb-3 opacity-30" />
                                    <p className="text-sm">暂无活跃会话记录</p>
                                    <p className="text-xs mt-1">登录后的设备将在这里显示</p>
                                </div>
                            ) : sessions.map(s => {
                                const { browser, os } = parseDevice(s.device_info);
                                return (
                                    <div key={s.jti} className={`rounded-xl border p-4 flex items-start gap-4 transition-all ${
                                        s.is_current ? 'border-indigo-200 bg-indigo-50' : 'border-slate-200 bg-white hover:border-slate-300'
                                    }`}>
                                        <div className={`w-10 h-10 rounded-full flex items-center justify-center shrink-0 ${
                                            s.is_current ? 'bg-indigo-600' : 'bg-slate-100'
                                        }`}>
                                            <Monitor className={`w-5 h-5 ${s.is_current ? 'text-white' : 'text-slate-400'}`} />
                                        </div>
                                        <div className="flex-1 min-w-0">
                                            <div className="flex items-center gap-2">
                                                <p className="font-semibold text-sm text-slate-800">{browser} / {os}</p>
                                                {s.is_current && (
                                                    <span className="text-[10px] bg-indigo-600 text-white px-2 py-0.5 rounded-full font-medium">当前设备</span>
                                                )}
                                            </div>
                                            <div className="flex flex-wrap gap-x-4 gap-y-0.5 mt-1">
                                                <span className="flex items-center gap-1 text-xs text-slate-400">
                                                    <MapPin className="w-3 h-3" />{s.ip_address || '未知 IP'}
                                                </span>
                                                <span className="flex items-center gap-1 text-xs text-slate-400">
                                                    <Calendar className="w-3 h-3" />登录于 {formatDate(s.created_at)}
                                                </span>
                                                <span className="flex items-center gap-1 text-xs text-slate-400">
                                                    <Clock className="w-3 h-3" />过期于 {formatDate(s.expires_at)}
                                                </span>
                                            </div>
                                        </div>
                                        {!s.is_current && (
                                            <button
                                                onClick={() => handleKickSession(s.jti)}
                                                className="shrink-0 flex items-center gap-1.5 px-3 py-1.5 text-xs text-red-500 border border-red-200 rounded-lg hover:bg-red-50 transition-colors"
                                            >
                                                <Trash2 className="w-3.5 h-3.5" />
                                                踢出
                                            </button>
                                        )}
                                    </div>
                                );
                            })}
                        </div>
                    )}
                </div>
            </div>

            {/* ── Toast 通知 ── */}
            {toast && (
                <div className={`fixed bottom-20 left-1/2 -translate-x-1/2 z-[9999] flex items-center gap-2 px-5 py-3 rounded-2xl shadow-xl text-sm font-medium transition-all ${
                    toast.type === 'ok'
                        ? 'bg-emerald-600 text-white'
                        : 'bg-red-600 text-white'
                }`}>
                    {toast.type === 'ok' ? <CheckCircle className="w-4 h-4" /> : <AlertCircle className="w-4 h-4" />}
                    {toast.msg}
                </div>
            )}
        </div>
    );
};
