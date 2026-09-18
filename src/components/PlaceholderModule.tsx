import React from 'react';

interface PlaceholderModuleProps {
  title: string;
  icon: any;
}

// 关键点：这里必须要有 'export' 关键字
export const PlaceholderModule: React.FC<PlaceholderModuleProps> = ({ title, icon: Icon }) => {
  return (
    <div className="flex-1 min-h-[400px] flex flex-col items-center justify-center text-slate-400 animate-fade-in">
      <div className="w-24 h-24 bg-slate-100 rounded-full flex items-center justify-center mb-6 shadow-inner">
        <Icon className="w-10 h-10 text-slate-300" />
      </div>
      <h2 className="text-2xl font-bold text-slate-300 mb-2">{title}</h2>
      <p className="text-sm bg-slate-100 px-4 py-1 rounded-full text-slate-500">该功能模块正在开发中，敬请期待</p>
    </div>
  );
};