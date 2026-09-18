import React, { useState, useEffect, useCallback, useRef } from 'react';
import { FileText, Trash2, RefreshCw, CheckCircle2, AlertCircle, Clock, Upload, Lock, Globe, Users } from 'lucide-react';
import { API_BASE_URL } from '../config';

interface KBDocument {
    id: string;
    dify_document_id: string;
    file_name: string;
    tenant_id: string;
    visibility: 'PUBLIC' | 'PRIVATE';
    parse_status: 'PENDING' | 'INDEXING' | 'COMPLETED' | 'FAILED';
    created_at: string;
    updated_at: string;
}

import { fetchWithAuth } from '../utils/authFetch';

export const KnowledgeManagement: React.FC<{ username?: string, datasetId: string }> = ({ username, datasetId }) => {
    const [documents, setDocuments] = useState<KBDocument[]>([]);
    const [loading, setLoading] = useState(true);
    const [uploading, setUploading] = useState(false);
    const privateFileInputRef = useRef<HTMLInputElement>(null);
    const publicFileInputRef = useRef<HTMLInputElement>(null);
    const updateFileInputRef = useRef<HTMLInputElement>(null);
    const [updatingDocId, setUpdatingDocId] = useState<string | null>(null);
    const [deletingDocId, setDeletingDocId] = useState<string | null>(null);

    const [sysUsers, setSysUsers] = useState<{username: string, display_name: string, role?: string, role_display_name?: string}[]>([]);
    const [showUserModal, setShowUserModal] = useState(false);
    const [selectedUsers, setSelectedUsers] = useState<string[]>([]);
    const [pendingFiles, setPendingFiles] = useState<File[]>([]);

    // Mock tenant ID using username
    const currentTenantId = username === 'admin' ? 'ADMIN' : username || 'DEFAULT_TENANT';

    const fetchDocuments = useCallback(async () => {
        try {
            const res = await fetchWithAuth(`${API_BASE_URL}/api/knowledge/list?_t=${Date.now()}`, {
                headers: { 'x-tenant-id': currentTenantId, 'x-dataset-id': datasetId },
                cache: 'no-store'
            });
            const data = await res.json();
            if (data.code === 0) setDocuments(data.data);
        } catch (e) {
            console.error('Failed to fetch documents', e);
        } finally {
            setLoading(false);
        }
    }, [currentTenantId, datasetId]);

    useEffect(() => {
        fetchDocuments();
        fetchWithAuth(`${API_BASE_URL}/api/knowledge/users?_t=${Date.now()}`)
            .then(async (res) => {
                if (!res.ok) {
                    if (res.status === 404) {
                        throw new Error('后端接口不存在 (404)，请确保您已按要求重启了后端服务！');
                    }
                    throw new Error(`HTTP Error: ${res.status}`);
                }
                return res.json();
            })
            .then(data => {
                if(data.code === 0) setSysUsers(data.data || []);
            })
            .catch(e => {
                console.error('Failed to fetch users', e);
                alert(`获取用户列表失败: ${e.message}\n(如果您刚更新了代码，请务必在终端按 Ctrl+C 停止后，重新运行 node server/server.js)`);
            });
    }, [fetchDocuments]);

    // 轮询非完成状态的文档
    useEffect(() => {
        const interval = setInterval(() => {
            const pendingDocs = documents.filter(d => d.parse_status === 'PENDING' || d.parse_status === 'INDEXING');
            if (pendingDocs.length === 0) return;

            pendingDocs.forEach(async (doc) => {
                try {
                    const res = await fetchWithAuth(`${API_BASE_URL}/api/knowledge/status/${doc.id}`, {
                        headers: { 'x-tenant-id': currentTenantId, 'x-dataset-id': datasetId }
                    });
                    const data = await res.json();
                    if (data.code === 0 && data.data.parse_status !== doc.parse_status) {
                        setDocuments(prev => prev.map(p => p.id === doc.id ? data.data : p));
                    }
                } catch (e) {
                    console.error('Status poll error', e);
                }
            });
        }, 5000); // 5秒轮询
        return () => clearInterval(interval);
    }, [documents, currentTenantId, datasetId]);

    const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>, visibility: 'PRIVATE' | 'PUBLIC') => {
        if (!e.target.files || e.target.files.length === 0) return;
        const files = Array.from(e.target.files);
        
        if (visibility === 'PRIVATE') {
            setPendingFiles(files);
            setSelectedUsers([]);
            setShowUserModal(true);
            return;
        }
        
        await executeUpload(files, visibility, []);
    };

    const executeUpload = async (files: File[], visibility: 'PRIVATE' | 'PUBLIC', authorizedUsers: string[]) => {
        setUploading(true);
        setShowUserModal(false);
        
        for (const file of files) {
            const formData = new FormData();
            formData.append('visibility', visibility);
            if (authorizedUsers.length > 0) {
                formData.append('authorized_users', JSON.stringify(authorizedUsers));
            }
            formData.append('file', file);

            try {
                const res = await fetchWithAuth(`${API_BASE_URL}/api/knowledge/upload`, {
                    method: 'POST',
                    headers: { 'x-tenant-id': currentTenantId, 'x-dataset-id': datasetId },
                    body: formData
                });
                const data = await res.json();
                if (data.code !== 0) {
                    alert(`上传失败 (${file.name}): ${data.message}`);
                }
            } catch (e) {
                alert(`上传请求失败 (${file.name})`);
            }
        }
        
        setUploading(false);
        setPendingFiles([]);
        fetchDocuments();
        if (privateFileInputRef.current) privateFileInputRef.current.value = '';
        if (publicFileInputRef.current) publicFileInputRef.current.value = '';
    };

    const handleDeleteClick = (id: string) => {
        setDeletingDocId(id);
    };

    const confirmDelete = async () => {
        if (!deletingDocId) return;
        const id = deletingDocId;
        setDeletingDocId(null);
        try {
            const res = await fetchWithAuth(`${API_BASE_URL}/api/knowledge/${id}`, {
                method: 'DELETE',
                headers: { 'x-tenant-id': currentTenantId, 'x-dataset-id': datasetId }
            });
            const data = await res.json();
            if (data.code === 0) fetchDocuments();
            else alert(`删除失败: ${data.message}`);
        } catch (e) {
            alert('删除请求失败');
        }
    };

    const triggerUpdate = (id: string) => {
        setUpdatingDocId(id);
        updateFileInputRef.current?.click();
    };

    const handleUpdate = async (e: React.ChangeEvent<HTMLInputElement>) => {
        if (!e.target.files || e.target.files.length === 0 || !updatingDocId) return;
        const file = e.target.files[0];
        const formData = new FormData();
        formData.append('file', file);

        try {
            const res = await fetchWithAuth(`${API_BASE_URL}/api/knowledge/update/${updatingDocId}`, {
                method: 'POST',
                headers: { 'x-tenant-id': currentTenantId, 'x-dataset-id': datasetId },
                body: formData
            });
            const data = await res.json();
            if (data.code === 0) fetchDocuments();
            else alert(`更新失败: ${data.message}`);
        } catch (e) {
            alert('更新请求失败');
        } finally {
            setUpdatingDocId(null);
            if (updateFileInputRef.current) updateFileInputRef.current.value = '';
        }
    };

    const StatusIcon = ({ status }: { status: string }) => {
        switch (status) {
            case 'COMPLETED': return <span className="flex items-center text-emerald-600 bg-emerald-50 px-2 py-1 rounded-full text-[10px] font-bold border border-emerald-200"><CheckCircle2 className="w-3 h-3 mr-1" /> 已生效</span>;
            case 'INDEXING': return <span className="flex items-center text-blue-600 bg-blue-50 px-2 py-1 rounded-full text-[10px] font-bold border border-blue-200"><RefreshCw className="w-3 h-3 mr-1 animate-spin" /> 解析中</span>;
            case 'PENDING': return <span className="flex items-center text-amber-600 bg-amber-50 px-2 py-1 rounded-full text-[10px] font-bold border border-amber-200"><Clock className="w-3 h-3 mr-1" /> 排队中</span>;
            case 'FAILED': return <span className="flex items-center text-red-600 bg-red-50 px-2 py-1 rounded-full text-[10px] font-bold border border-red-200"><AlertCircle className="w-3 h-3 mr-1" /> 失败</span>;
            default: return null;
        }
    };

    const groupedUsers = sysUsers.reduce((acc, user) => {
        const roleName = user.role_display_name || '其他/未分配角色';
        if (!acc[roleName]) {
            acc[roleName] = [];
        }
        acc[roleName].push(user);
        return acc;
    }, {} as Record<string, typeof sysUsers>);

    return (
        <div className="flex flex-col h-full bg-slate-50 relative p-6 overflow-y-auto">
            <div className="flex justify-between items-center mb-6">
                <div>
                    <h2 className="text-xl font-black text-slate-800">文档资源库管理</h2>
                    <p className="text-xs text-slate-500 mt-1 font-medium">支持自主上传文档并建立专属检索空间。支持 PDF, Word, TXT 等常见文本格式。</p>
                </div>
                <div className="flex gap-3">
                    <input type="file" className="hidden" ref={privateFileInputRef} onChange={(e) => handleUpload(e, 'PRIVATE')} accept=".pdf,.doc,.docx,.txt" multiple />
                    <input type="file" className="hidden" ref={publicFileInputRef} onChange={(e) => handleUpload(e, 'PUBLIC')} accept=".pdf,.doc,.docx,.txt" multiple />
                    <input type="file" className="hidden" ref={updateFileInputRef} onChange={handleUpdate} accept=".pdf,.doc,.docx,.txt" />
                    
                    <button 
                        onClick={() => privateFileInputRef.current?.click()}
                        disabled={uploading}
                        className="flex items-center gap-2 bg-slate-100 hover:bg-slate-200 text-slate-700 px-4 py-2 rounded-xl text-sm font-bold shadow-sm transition-all disabled:opacity-50"
                    >
                        {uploading ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Lock className="w-4 h-4" />}
                        {uploading ? '上传中...' : '上传私有文档'}
                    </button>
                    
                    <button 
                        onClick={() => publicFileInputRef.current?.click()}
                        disabled={uploading}
                        className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2 rounded-xl text-sm font-bold shadow-md shadow-indigo-200 transition-all disabled:opacity-50"
                    >
                        {uploading ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Globe className="w-4 h-4" />}
                        {uploading ? '上传中...' : '上传公共文档'}
                    </button>
                </div>
            </div>

            {loading ? (
                <div className="flex justify-center py-12"><RefreshCw className="w-6 h-6 animate-spin text-indigo-500" /></div>
            ) : documents.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-16 bg-white rounded-3xl border border-dashed border-slate-300">
                    <FileText className="w-12 h-12 text-slate-300 mb-4" />
                    <p className="text-slate-500 font-bold">暂无文档资源</p>
                    <p className="text-xs text-slate-400 mt-1">点击右上角上传属于您的专属文档</p>
                </div>
            ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                    {documents.map(doc => {
                        const isPublic = doc.visibility === 'PUBLIC';
                        const isOwner = doc.tenant_id === currentTenantId;
                        const canEdit = isOwner || currentTenantId === 'ADMIN';

                        return (
                            <div key={doc.id} className="bg-white rounded-2xl p-4 border border-slate-200 shadow-sm hover:shadow-md transition-all flex flex-col group relative overflow-hidden">
                                <div className="absolute top-0 right-0 w-16 h-16 bg-gradient-to-bl from-slate-50 to-transparent pointer-events-none" />
                                
                                <div className="flex justify-between items-start mb-3">
                                    <div className="flex items-center gap-2">
                                        <div className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${isPublic ? 'bg-indigo-100 text-indigo-600' : 'bg-emerald-100 text-emerald-600'}`}>
                                            <FileText className="w-4 h-4" />
                                        </div>
                                        <div className="flex flex-col min-w-0">
                                            <span className="text-sm font-bold text-slate-800 truncate" title={doc.file_name}>{doc.file_name}</span>
                                            <div className="flex items-center gap-1 mt-0.5">
                                                {isPublic ? (
                                                    <span className="flex items-center text-[10px] text-indigo-500 font-bold"><Globe className="w-3 h-3 mr-0.5" /> 全局共享</span>
                                                ) : (
                                                    <span className="flex items-center text-[10px] text-emerald-500 font-bold"><Lock className="w-3 h-3 mr-0.5" /> 专属私有</span>
                                                )}
                                            </div>
                                        </div>
                                    </div>
                                </div>
                                
                                <div className="flex items-center justify-between mt-auto pt-4 border-t border-slate-50">
                                    <StatusIcon status={doc.parse_status} />
                                    
                                    <div className="flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                                        {canEdit ? (
                                            <>
                                                <button onClick={() => triggerUpdate(doc.id)} className="p-1.5 text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg tooltip" title="用新文件覆盖更新版本">
                                                    <Upload className="w-4 h-4" />
                                                </button>
                                                <button onClick={() => handleDeleteClick(doc.id)} className="p-1.5 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg tooltip" title="删除该文档">
                                                    <Trash2 className="w-4 h-4" />
                                                </button>
                                            </>
                                        ) : (
                                            <span className="text-[10px] text-slate-400 font-medium px-2">仅提供公共查阅</span>
                                        )}
                                    </div>
                                </div>
                            </div>
                        );
                    })}
                </div>
            )}

            {/* 删除确认弹窗 */}
            {deletingDocId && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 backdrop-blur-sm transition-opacity">
                    <div className="bg-white rounded-2xl shadow-2xl p-6 w-[400px] max-w-[90vw] animate-in fade-in zoom-in-95 duration-200">
                        <div className="flex items-start gap-4">
                            <div className="w-10 h-10 rounded-full bg-red-100 flex items-center justify-center shrink-0">
                                <AlertCircle className="w-5 h-5 text-red-600" />
                            </div>
                            <div className="flex-1">
                                <h3 className="text-lg font-bold text-slate-800 mb-2">确认删除文档？</h3>
                                <p className="text-sm text-slate-600 mb-6 leading-relaxed">
                                    此操作将从数据库和底层的 Dify 知识库引擎中同步删除该文件，且不可恢复。
                                </p>
                                <div className="flex items-center justify-end gap-3">
                                    <button
                                        onClick={() => setDeletingDocId(null)}
                                        className="px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100 rounded-xl transition-colors"
                                    >
                                        取消
                                    </button>
                                    <button
                                        onClick={confirmDelete}
                                        className="px-4 py-2 text-sm font-medium text-white bg-red-600 hover:bg-red-700 rounded-xl shadow-md shadow-red-200 transition-all active:scale-95"
                                    >
                                        确认删除
                                    </button>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {/* 授权用户选择弹窗 */}
            {showUserModal && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 backdrop-blur-sm transition-opacity">
                    <div className="bg-white rounded-2xl shadow-2xl p-6 w-[500px] max-w-[90vw] max-h-[90vh] flex flex-col animate-in fade-in zoom-in-95 duration-200">
                        <div className="flex items-center gap-3 mb-4">
                            <div className="w-10 h-10 rounded-full bg-emerald-100 flex items-center justify-center shrink-0">
                                <Users className="w-5 h-5 text-emerald-600" />
                            </div>
                            <div>
                                <h3 className="text-lg font-bold text-slate-800">选择可见用户</h3>
                                <p className="text-sm text-slate-500">仅勾选的用户可以查看和检索此私有文档</p>
                            </div>
                        </div>
                        
                        <div className="flex items-center justify-between py-2 border-b border-slate-100 mb-2">
                            <span className="text-sm font-medium text-slate-700">可授权用户列表</span>
                            <button 
                                onClick={() => setSelectedUsers(selectedUsers.length === sysUsers.length ? [] : sysUsers.map(u => u.username))}
                                className="text-sm text-indigo-600 hover:text-indigo-700 font-medium"
                            >
                                {selectedUsers.length === sysUsers.length ? '取消全选' : '全选'}
                            </button>
                        </div>
                        
                        <div className="overflow-y-auto flex-1 min-h-[200px] max-h-[400px] mb-6 pr-2">
                            {Object.entries(groupedUsers).map(([role, usersInRole]) => {
                                const allSelected = usersInRole.length > 0 && usersInRole.every(u => selectedUsers.includes(u.username));
                                const someSelected = usersInRole.some(u => selectedUsers.includes(u.username));
                                
                                const toggleRole = () => {
                                    if (allSelected) {
                                        setSelectedUsers(selectedUsers.filter(u => !usersInRole.find(ur => ur.username === u)));
                                    } else {
                                        const newlySelected = usersInRole.map(ur => ur.username).filter(u => !selectedUsers.includes(u));
                                        setSelectedUsers([...selectedUsers, ...newlySelected]);
                                    }
                                };

                                return (
                                    <div key={role} className="mb-4 last:mb-0">
                                        <div className="flex items-center justify-between mb-2 px-1">
                                            <div className="flex items-center gap-2">
                                                <input 
                                                    type="checkbox"
                                                    className="w-4 h-4 text-indigo-600 rounded border-slate-300 focus:ring-indigo-500 cursor-pointer"
                                                    checked={allSelected}
                                                    ref={input => { if(input) input.indeterminate = !allSelected && someSelected; }}
                                                    onChange={toggleRole}
                                                />
                                                <span className="text-sm font-bold text-slate-800">{role} <span className="text-xs font-normal text-slate-400">({usersInRole.length})</span></span>
                                            </div>
                                        </div>
                                        <div className="grid grid-cols-2 gap-2 pl-6">
                                            {usersInRole.map(u => (
                                                <label key={u.username} className="flex items-center p-2 hover:bg-slate-50 rounded-xl cursor-pointer transition-colors border border-transparent hover:border-slate-100">
                                                    <input 
                                                        type="checkbox" 
                                                        className="w-4 h-4 text-indigo-600 rounded border-slate-300 focus:ring-indigo-500 cursor-pointer"
                                                        checked={selectedUsers.includes(u.username)}
                                                        onChange={(e) => {
                                                            if(e.target.checked) setSelectedUsers([...selectedUsers, u.username]);
                                                            else setSelectedUsers(selectedUsers.filter(n => n !== u.username));
                                                        }}
                                                    />
                                                    <div className="ml-3 flex flex-col">
                                                        <span className="text-sm font-bold text-slate-700">{u.display_name}</span>
                                                        <span className="text-[10px] text-slate-400">@{u.username}</span>
                                                    </div>
                                                </label>
                                            ))}
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                        
                        <div className="flex items-center justify-end gap-3 pt-4 border-t border-slate-100">
                            <button
                                onClick={() => {
                                    setShowUserModal(false);
                                    setPendingFiles([]);
                                    if (privateFileInputRef.current) privateFileInputRef.current.value = '';
                                }}
                                className="px-5 py-2.5 text-sm font-medium text-slate-600 hover:bg-slate-100 rounded-xl transition-colors"
                            >
                                取消
                            </button>
                            <button
                                onClick={() => {
                                    if(pendingFiles.length > 0) executeUpload(pendingFiles, 'PRIVATE', selectedUsers);
                                }}
                                className="px-5 py-2.5 text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 rounded-xl shadow-md shadow-indigo-200 transition-all active:scale-95 flex items-center gap-2"
                            >
                                <Upload className="w-4 h-4" />
                                确认上传
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};
