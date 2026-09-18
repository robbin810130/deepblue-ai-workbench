import React, { useState } from 'react';
import { BookOpen, MessageSquare, ChevronRight } from 'lucide-react';

// 懒加载子功能组件
const CompanyRulesAssistant = React.lazy(() =>
    import('./CompanyRulesAssistant').then(m => ({ default: m.CompanyRulesAssistant }))
);

// ─── 功能列表定义 ───────────────────────────────────────────────────────────
interface KBFeature {
    id: string;
    label: string;
    description: string;
    icon: React.ElementType;
    iconBg: string;
    tag?: string;      // 标签，如"即将上线"
    available: boolean;
}

const FEATURES: KBFeature[] = [
    {
        id: 'rules',
        label: '制度问答助手',
        description: '基于企业知识库，智能回答公司规章制度、流程规范等问题',
        icon: MessageSquare,
        iconBg: 'from-indigo-500 to-purple-600',
        available: true,
    },
    {
        id: 'product_kb',
        label: '产品知识库',
        description: '查询产品配方、成分、功效、使用方法等产品相关知识',
        icon: BookOpen,
        iconBg: 'from-emerald-500 to-teal-600',
        tag: '即将上线',
        available: false,
    },
    {
        id: 'market_kb',
        label: '市场政策问答',
        description: '了解各地区市场政策、法规、资质要求等合规知识',
        icon: BookOpen,
        iconBg: 'from-amber-500 to-orange-600',
        tag: '即将上线',
        available: false,
    },
];

// ─── 主组件 ────────────────────────────────────────────────────────────────
interface KnowledgeBaseModuleProps {
    username?: string;
}

export const KnowledgeBaseModule: React.FC<KnowledgeBaseModuleProps> = ({ username }) => {
    const [activeFeatureId, setActiveFeatureId] = useState<string | null>(null);

    const activeFeature = FEATURES.find(f => f.id === activeFeatureId);

    return (
        <div className="flex h-full w-full bg-slate-50 overflow-hidden font-sans">

            {/* ─── 左侧功能导航 ─────────────────────────────────────── */}
            <div className="w-72 shrink-0 bg-white border-r border-slate-200 flex flex-col">
                {/* 顶部标题 */}
                <div className="px-6 py-5 border-b border-slate-100">
                    <div className="flex items-center gap-3">
                        <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center shadow-sm">
                            <BookOpen className="w-5 h-5 text-white" />
                        </div>
                        <div>
                            <h1 className="text-base font-black text-slate-800 leading-tight">知识库</h1>
                            <p className="text-[11px] text-slate-400 font-medium">Knowledge Base</p>
                        </div>
                    </div>
                </div>

                {/* 功能列表 */}
                <div className="flex-1 overflow-y-auto p-3 space-y-1.5 custom-scrollbar">
                    <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest px-3 pt-2 pb-1">
                        功能列表
                    </p>
                    {FEATURES.map(feature => {
                        const isActive = activeFeatureId === feature.id;
                        const Icon = feature.icon;
                        return (
                            <button
                                key={feature.id}
                                onClick={() => feature.available && setActiveFeatureId(feature.id)}
                                disabled={!feature.available}
                                className={`w-full text-left rounded-xl p-3.5 transition-all duration-200 group flex items-start gap-3
                                    ${isActive
                                        ? 'bg-indigo-50 border border-indigo-200 shadow-sm'
                                        : feature.available
                                            ? 'hover:bg-slate-50 border border-transparent hover:border-slate-200'
                                            : 'opacity-50 cursor-not-allowed border border-transparent'
                                    }`}
                            >
                                <div className={`w-9 h-9 rounded-xl bg-gradient-to-br ${feature.iconBg} flex items-center justify-center shrink-0 shadow-sm mt-0.5`}>
                                    <Icon className="w-4 h-4 text-white" />
                                </div>
                                <div className="flex-1 min-w-0">
                                    <div className="flex items-center gap-2 mb-0.5">
                                        <span className={`text-sm font-bold truncate ${isActive ? 'text-indigo-700' : 'text-slate-700'}`}>
                                            {feature.label}
                                        </span>
                                        {feature.tag && (
                                            <span className="shrink-0 text-[9px] font-black px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-600 border border-amber-200 tracking-wide">
                                                {feature.tag}
                                            </span>
                                        )}
                                    </div>
                                    <p className="text-[11px] text-slate-400 font-medium leading-relaxed line-clamp-2">
                                        {feature.description}
                                    </p>
                                </div>
                                {feature.available && (
                                    <ChevronRight className={`w-4 h-4 shrink-0 mt-2.5 transition-colors ${isActive ? 'text-indigo-500' : 'text-slate-300 group-hover:text-slate-500'}`} />
                                )}
                            </button>
                        );
                    })}
                </div>

                {/* 底部说明 */}
                <div className="p-4 border-t border-slate-100">
                    <p className="text-[11px] text-slate-400 text-center leading-relaxed">
                        知识库持续扩充中，更多功能即将上线
                    </p>
                </div>
            </div>

            {/* ─── 右侧内容区 ────────────────────────────────────────── */}
            <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
                {activeFeature && activeFeature.available ? (
                    <React.Suspense fallback={
                        <div className="flex-1 flex items-center justify-center">
                            <div className="flex flex-col items-center gap-3">
                                <div className="w-8 h-8 border-4 border-slate-200 border-t-indigo-500 rounded-full animate-spin" />
                                <p className="text-sm text-slate-400 font-medium">加载中...</p>
                            </div>
                        </div>
                    }>
                        {activeFeatureId === 'rules' && <CompanyRulesAssistant username={username} />}
                    </React.Suspense>
                ) : (
                    /* 未选中时的欢迎页 */
                    <div className="flex-1 flex flex-col items-center justify-center p-12 text-center">
                        <div className="w-24 h-24 rounded-3xl bg-gradient-to-br from-indigo-100 to-purple-100 flex items-center justify-center mb-6 shadow-inner border border-indigo-100">
                            <BookOpen className="w-12 h-12 text-indigo-400" />
                        </div>
                        <h2 className="text-xl font-black text-slate-700 mb-2">欢迎使用知识库</h2>
                        <p className="text-sm text-slate-400 max-w-xs leading-relaxed">
                            请从左侧选择一个功能开始使用。知识库整合了企业内部各类知识资产，助力高效决策。
                        </p>

                        {/* 快捷卡片 */}
                        <div className="mt-8 grid grid-cols-1 gap-3 w-full max-w-sm">
                            {FEATURES.filter(f => f.available).map(f => {
                                const Icon = f.icon;
                                return (
                                    <button
                                        key={f.id}
                                        onClick={() => setActiveFeatureId(f.id)}
                                        className="flex items-center gap-4 p-4 bg-white rounded-2xl border border-slate-200 hover:border-indigo-300 hover:shadow-md transition-all duration-200 text-left group"
                                    >
                                        <div className={`w-10 h-10 rounded-xl bg-gradient-to-br ${f.iconBg} flex items-center justify-center shrink-0 shadow-sm`}>
                                            <Icon className="w-5 h-5 text-white" />
                                        </div>
                                        <div className="flex-1 min-w-0">
                                            <p className="text-sm font-bold text-slate-700 group-hover:text-indigo-600 transition-colors">{f.label}</p>
                                            <p className="text-xs text-slate-400 truncate">{f.description}</p>
                                        </div>
                                        <ChevronRight className="w-4 h-4 text-slate-300 group-hover:text-indigo-500 transition-colors shrink-0" />
                                    </button>
                                );
                            })}
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
};

export default KnowledgeBaseModule;
