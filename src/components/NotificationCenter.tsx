import React, { useState, useEffect, useRef } from 'react';
import { Bell, BellOff, X, Check, Trash2, Info } from 'lucide-react';

export interface AppNotification {
    id: string;
    appId: string;
    appName: string;
    title: string;
    message: string;
    timestamp: number;
    isRead: boolean;
}

interface NotificationCenterProps {
    notifications: AppNotification[];
    onItemClick: (notification: AppNotification) => void;
    onMarkAsRead: (id: string) => void;
    onClearAll: () => void;
    onDelete: (id: string) => void;
}

export const NotificationCenter: React.FC<NotificationCenterProps> = ({
    notifications,
    onItemClick,
    onMarkAsRead,
    onClearAll,
    onDelete
}) => {
    const [isOpen, setIsOpen] = useState(false);
    const containerRef = useRef<HTMLDivElement>(null);
    const unreadCount = notifications.filter(n => !n.isRead).length;

    // 点击外部关闭
    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
                setIsOpen(false);
            }
        };
        if (isOpen) {
            document.addEventListener('mousedown', handleClickOutside);
        }
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, [isOpen]);

    const formatTime = (ts: number) => {
        const date = new Date(ts);
        return date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
    };

    return (
        <div className="relative" ref={containerRef}>
            {/* 触发按钮 */}
            <button
                onClick={() => setIsOpen(!isOpen)}
                className={`group relative w-10 h-10 rounded-xl flex items-center justify-center transition-all border ${isOpen 
                    ? 'bg-blue-600 border-blue-400 text-white shadow-lg shadow-blue-500/20' 
                    : 'bg-white/5 border-white/10 text-white/70 hover:bg-white/10 hover:text-white'}`}
                title="消息中心"
            >
                <Bell className={`w-5 h-5 ${unreadCount > 0 && !isOpen ? 'animate-bounce' : ''}`} />
                {unreadCount > 0 && (
                    <span className="absolute -top-1 -right-1 w-5 h-5 bg-red-500 text-white text-[10px] font-bold rounded-full flex items-center justify-center border-2 border-slate-900 shadow-sm animate-in zoom-in">
                        {unreadCount > 9 ? '9+' : unreadCount}
                    </span>
                )}
            </button>

            {/* 弹出面板 */}
            {isOpen && (
                <div className="absolute bottom-full right-0 mb-4 w-80 max-h-[500px] bg-slate-900/90 backdrop-blur-2xl border border-white/20 rounded-2xl shadow-[0_20px_50px_-15px_rgba(0,0,0,0.7)] overflow-hidden flex flex-col z-[100] ctx-animate">
                    {/* 头部 */}
                    <div className="p-4 border-b border-white/10 flex items-center justify-between bg-white/5">
                        <div className="flex items-center gap-2">
                            <h3 className="text-white font-bold text-sm">通知中心</h3>
                            {unreadCount > 0 && (
                                <span className="px-1.5 py-0.5 rounded bg-blue-500/20 text-blue-400 text-[10px] font-bold">
                                    {unreadCount} 条未读
                                </span>
                            )}
                        </div>
                        <div className="flex items-center gap-1">
                            {notifications.length > 0 && (
                                <button 
                                    onClick={onClearAll}
                                    className="p-1.5 hover:bg-white/10 text-white/40 hover:text-red-400 rounded-lg transition-colors"
                                    title="清除全部"
                                >
                                    <Trash2 className="w-4 h-4" />
                                </button>
                            )}
                            <button 
                                onClick={() => setIsOpen(false)}
                                className="p-1.5 hover:bg-white/10 text-white/40 hover:text-white rounded-lg transition-colors"
                            >
                                <X className="w-4 h-4" />
                            </button>
                        </div>
                    </div>

                    {/* 列表区 */}
                    <div className="flex-1 overflow-y-auto custom-scrollbar p-2 space-y-2 min-h-[100px]">
                        {notifications.length === 0 ? (
                            <div className="py-12 flex flex-col items-center justify-center text-slate-500 space-y-3">
                                <BellOff className="w-10 h-10 opacity-20" />
                                <p className="text-xs">暂无新通知</p>
                            </div>
                        ) : (
                            notifications.map((n) => (
                                <div 
                                    key={n.id}
                                    onClick={() => { onItemClick(n); setIsOpen(false); }}
                                    className={`group relative p-3 rounded-xl border transition-all cursor-pointer ${n.isRead 
                                        ? 'bg-white/5 border-transparent hover:bg-white/10' 
                                        : 'bg-blue-500/10 border-blue-500/30 hover:bg-blue-500/20 shadow-lg shadow-blue-500/5'}`}
                                >
                                    <div className="flex items-start gap-3">
                                        <div className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${n.isRead ? 'bg-white/10 text-slate-400' : 'bg-blue-500 text-white shadow-lg shadow-blue-500/20'}`}>
                                            <Info className="w-4 h-4" />
                                        </div>
                                        <div className="flex-1 min-w-0">
                                            <div className="flex items-center justify-between gap-2 mb-0.5">
                                                <span className={`text-xs font-bold truncate ${n.isRead ? 'text-slate-300' : 'text-white'}`}>
                                                    {n.title}
                                                </span>
                                                <span className="text-[10px] text-slate-500 whitespace-nowrap">
                                                    {formatTime(n.timestamp)}
                                                </span>
                                            </div>
                                            <p className={`text-xs leading-relaxed line-clamp-2 ${n.isRead ? 'text-slate-500' : 'text-slate-300'}`}>
                                                {n.message}
                                            </p>
                                            <div className="mt-2 flex items-center gap-2">
                                                <span className="px-1.5 py-0.5 rounded bg-white/5 text-slate-400 text-[10px]">
                                                    {n.appName}
                                                </span>
                                                <div className="ml-auto flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                                    {!n.isRead && (
                                                        <button 
                                                            onClick={(e) => { e.stopPropagation(); onMarkAsRead(n.id); }}
                                                            className="p-1 px-1.5 hover:bg-white/10 text-white/40 hover:text-blue-400 rounded-md text-[10px] font-medium transition-colors flex items-center gap-1"
                                                        >
                                                            <Check className="w-3 h-3" /> 已读
                                                        </button>
                                                    )}
                                                    <button 
                                                        onClick={(e) => { e.stopPropagation(); onDelete(n.id); }}
                                                        className="p-1 px-1.5 hover:bg-white/10 text-white/40 hover:text-red-400 rounded-md text-[10px] font-medium transition-colors flex items-center gap-1"
                                                    >
                                                        <Trash2 className="w-3 h-3" /> 删除
                                                    </button>
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                    {!n.isRead && (
                                        <div className="absolute top-3 right-3 w-1.5 h-1.5 bg-blue-500 rounded-full shadow-[0_0_8px_rgba(59,130,246,0.8)]" />
                                    )}
                                </div>
                            ))
                        )}
                    </div>

                    {/* 底部按钮 */}
                    {notifications.length > 0 && (
                        <div className="p-3 border-t border-white/10 bg-white/5">
                            <button 
                                onClick={onClearAll}
                                className="w-full py-2 rounded-lg text-xs font-bold text-slate-400 hover:text-white hover:bg-white/5 transition-all"
                            >
                                清空所有通知
                            </button>
                        </div>
                    )}
                </div>
            )}
        </div>
    );
};
