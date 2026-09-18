import React, { useState, useEffect } from 'react';

export const ClockWidget: React.FC = () => {
  const [time, setTime] = useState(new Date());

  useEffect(() => {
    const timer = setInterval(() => setTime(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  const timeString = time.toLocaleTimeString('zh-CN', { 
    hour: '2-digit', 
    minute: '2-digit', 
    hour12: false 
  });
  
  const dateString = time.toLocaleDateString('zh-CN', {
    month: 'long',
    day: 'numeric'
  });
  
  const weekString = time.toLocaleDateString('zh-CN', {
    weekday: 'long'
  });

  // 获取农历
  const lunarString = new Intl.DateTimeFormat('zh-u-ca-chinese', {
    month: 'long',
    day: 'numeric'
  }).format(time);

  return (
    <div className="w-full h-full flex items-center justify-between px-4 py-2 text-white select-none relative overflow-hidden">
      {/* 左侧：时间 */}
      <div className="flex flex-col justify-center">
        <div className="text-[34px] font-black tracking-tight drop-shadow-xl leading-none">
          {timeString}
        </div>
      </div>

      {/* 右侧：日期信息垂直排列 */}
      <div className="flex flex-col items-end text-right justify-center gap-0.5">
        <span className="text-xs font-bold tracking-tight text-white/95 whitespace-nowrap">{dateString}</span>
        <span className="text-[11px] font-semibold text-blue-300 whitespace-nowrap">{weekString}</span>
        <span className="text-[10px] font-medium opacity-50 whitespace-nowrap">农历 {lunarString}</span>
      </div>
      
      {/* 装饰性背景微光 */}
      <div className="absolute top-0 right-0 w-24 h-24 bg-blue-500/5 blur-[30px] -z-10 rounded-full" />
      <div className="absolute bottom-0 left-0 w-24 h-24 bg-purple-500/5 blur-[30px] -z-10 rounded-full" />
    </div>
  );
};
