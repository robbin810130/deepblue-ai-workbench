import { Component } from 'react';
import type { ErrorInfo, ReactNode } from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';

interface Props {
    children: ReactNode;
    fallbackMessage?: string;
    onRetry?: () => void;
}

interface State {
    hasError: boolean;
    error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
    public state: State = {
        hasError: false,
        error: null
    };

    public static getDerivedStateFromError(error: Error): State {
        return { hasError: true, error };
    }

    public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
        console.error('组件奔溃拦截报告:', error, errorInfo);
    }

    public render() {
        if (this.state.hasError) {
            return (
                <div className="w-full h-full flex flex-col items-center justify-center p-6 text-slate-500 bg-slate-50/50 rounded-xl border border-slate-200/50 backdrop-blur-sm">
                    <AlertTriangle className="w-12 h-12 text-red-400 mb-4 opacity-80" />
                    <h3 className="text-lg font-medium text-slate-700 mb-2">组件加载受挫</h3>
                    <p className="text-sm text-center mb-6 max-w-sm">
                        {this.props.fallbackMessage || '因不可预期的执行故障导致此处内容崩溃，这不影响其他应用的运行。'}
                    </p>
                    <div className="w-full max-w-2xl p-4 bg-red-50/80 rounded-xl border border-red-200 mb-6 overflow-auto custom-scrollbar text-left">
                        <h4 className="text-red-800 font-bold mb-1 text-sm">错误详情：</h4>
                        <p className="text-red-600 font-mono text-xs whitespace-pre-wrap break-all">
                            {this.state.error?.toString()}
                        </p>
                        <p className="text-red-400 font-mono text-[10px] whitespace-pre-wrap break-all mt-2">
                            {this.state.error?.stack}
                        </p>
                    </div>
                    <button
                        onClick={() => {
                            this.setState({ hasError: false, error: null });
                            if (this.props.onRetry) {
                                this.props.onRetry();
                            }
                        }}
                        className="flex items-center gap-2 px-4 py-2 bg-white hover:bg-slate-50 text-slate-600 rounded-lg border border-slate-200 shadow-sm transition-all focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
                    >
                        <RefreshCw className="w-4 h-4" />
                        <span>尝试重新挂载该模块</span>
                    </button>
                </div>
            );
        }

        return this.props.children;
    }
}
