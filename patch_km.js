import fs from 'fs';
let content = fs.readFileSync('src/components/KnowledgeManagement.tsx', 'utf8');

const imports = `import React, { useState, useEffect, useCallback, useRef } from 'react';
import { FileText, Trash2, RefreshCw, CheckCircle2, AlertCircle, Clock, Upload, Lock, Globe, Users } from 'lucide-react';
import { API_BASE_URL } from '../config';`;

content = content.replace(/import React.*?from '\.\.\/config';/s, imports);

const stateVars = `    const [deletingDocId, setDeletingDocId] = useState<string | null>(null);

    const [sysUsers, setSysUsers] = useState<{username: string, display_name: string}[]>([]);
    const [showUserModal, setShowUserModal] = useState(false);
    const [selectedUsers, setSelectedUsers] = useState<string[]>([]);
    const [pendingFile, setPendingFile] = useState<File | null>(null);`;

content = content.replace(/    const \[deletingDocId, setDeletingDocId\] = useState<string \| null>\(null\);/, stateVars);

const fetchUsers = `    useEffect(() => {
        fetchDocuments();
        fetchWithAuth(\`\${API_BASE_URL}/api/knowledge/users\`).then(res => res.json()).then(data => {
            if(data.code === 0) setSysUsers(data.data);
        }).catch(e => console.error('Failed to fetch users', e));
    }, [fetchDocuments]);`;

content = content.replace(/    useEffect\(\(\) => \{\n        fetchDocuments\(\);\n    \}, \[fetchDocuments\]\);/, fetchUsers);

const handleUploadNew = `    const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>, visibility: 'PRIVATE' | 'PUBLIC') => {
        if (!e.target.files || e.target.files.length === 0) return;
        const file = e.target.files[0];
        
        if (visibility === 'PRIVATE') {
            setPendingFile(file);
            setSelectedUsers([]);
            setShowUserModal(true);
            return;
        }
        
        await executeUpload(file, visibility, []);
    };

    const executeUpload = async (file: File, visibility: 'PRIVATE' | 'PUBLIC', authorizedUsers: string[]) => {
        const formData = new FormData();
        formData.append('visibility', visibility);
        if (authorizedUsers.length > 0) {
            formData.append('authorized_users', JSON.stringify(authorizedUsers));
        }
        formData.append('file', file);

        setUploading(true);
        setShowUserModal(false);
        try {
            const res = await fetchWithAuth(\`\${API_BASE_URL}/api/knowledge/upload\`, {
                method: 'POST',
                headers: { 'x-tenant-id': currentTenantId, 'x-dataset-id': datasetId },
                body: formData
            });
            const data = await res.json();
            if (data.code === 0) fetchDocuments();
            else alert(\`上传失败: \${data.message}\`);
        } catch (e) {
            alert('上传请求失败');
        } finally {
            setUploading(false);
            setPendingFile(null);
            if (privateFileInputRef.current) privateFileInputRef.current.value = '';
            if (publicFileInputRef.current) publicFileInputRef.current.value = '';
        }
    };`;

content = content.replace(/    const handleUpload = async .*?    \};\n/s, handleUploadNew + "\n");

const modalUI = `
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
                        
                        <div className="overflow-y-auto flex-1 min-h-[200px] max-h-[400px] mb-6">
                            {sysUsers.map(u => (
                                <label key={u.username} className="flex items-center p-3 hover:bg-slate-50 rounded-xl cursor-pointer transition-colors border border-transparent hover:border-slate-100">
                                    <input 
                                        type="checkbox" 
                                        className="w-4 h-4 text-indigo-600 rounded border-slate-300 focus:ring-indigo-500"
                                        checked={selectedUsers.includes(u.username)}
                                        onChange={(e) => {
                                            if(e.target.checked) setSelectedUsers([...selectedUsers, u.username]);
                                            else setSelectedUsers(selectedUsers.filter(n => n !== u.username));
                                        }}
                                    />
                                    <div className="ml-3 flex flex-col">
                                        <span className="text-sm font-bold text-slate-700">{u.display_name}</span>
                                        <span className="text-xs text-slate-400">@{u.username}</span>
                                    </div>
                                </label>
                            ))}
                        </div>
                        
                        <div className="flex items-center justify-end gap-3 pt-4 border-t border-slate-100">
                            <button
                                onClick={() => {
                                    setShowUserModal(false);
                                    setPendingFile(null);
                                    if (privateFileInputRef.current) privateFileInputRef.current.value = '';
                                }}
                                className="px-5 py-2.5 text-sm font-medium text-slate-600 hover:bg-slate-100 rounded-xl transition-colors"
                            >
                                取消
                            </button>
                            <button
                                onClick={() => {
                                    if(pendingFile) executeUpload(pendingFile, 'PRIVATE', selectedUsers);
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
};`;

content = content.replace(/        <\/div>\n    \);\n\};\n?$/, modalUI + "\n");

fs.writeFileSync('src/components/KnowledgeManagement.tsx', content);
console.log("Replaced");
