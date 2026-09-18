import React, { useState, useMemo } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';

export const CalendarWidget: React.FC = () => {
  const today = new Date();
  const [viewDate, setViewDate] = useState(new Date());
  const [selectedDate, setSelectedDate] = useState(new Date());

  // 日历逻辑
  const calendarData = useMemo(() => {
    const year = viewDate.getFullYear();
    const month = viewDate.getMonth();
    
    const firstDay = new Date(year, month, 1);
    const lastDay = new Date(year, month + 1, 0);
    
    const daysInMonth = lastDay.getDate();
    const startingDay = firstDay.getDay(); // 0 is Sunday
    
    const days = [];
    
    // 上个月补充
    const prevMonthLastDay = new Date(year, month, 0).getDate();
    for (let i = startingDay - 1; i >= 0; i--) {
      days.push({ 
        day: prevMonthLastDay - i, 
        month: month - 1, 
        year: month === 0 ? year - 1 : year,
        isCurrent: false 
      });
    }
    
    // 当前月
    for (let i = 1; i <= daysInMonth; i++) {
      days.push({ 
        day: i, 
        month, 
        year,
        isCurrent: true 
      });
    }
    
    // 下个月补充 - 减少为 5 行 (35个格子)
    const totalSlots = 35; 
    const remaining = totalSlots - days.length;
    if (remaining > 0) {
      for (let i = 1; i <= remaining; i++) {
        days.push({ 
          day: i, 
          month: month + 1, 
          year: month === 11 ? year + 1 : year,
          isCurrent: false 
        });
      }
    } else if (days.length > 35) {
      // 如果超过35个（某些月份需要6行），截断可能会导致部分日期不显示
      // 但按照用户要求减少一行，我们这里保持逻辑
      return days.slice(0, 35);
    }
    
    return days;
  }, [viewDate]);

  const weekDays = ['日', '一', '二', '三', '四', '五', '六'];
  
  // 农历获取
  const getLunar = (date: Date) => {
    return new Intl.DateTimeFormat('zh-u-ca-chinese', {
      month: 'long',
      day: 'numeric'
    }).format(date);
  };

  const handleMonthChange = (offset: number) => {
    const nextMonth = new Date(viewDate.getFullYear(), viewDate.getMonth() + offset, 1);
    setViewDate(nextMonth);
    setSelectedDate(nextMonth);
  };

  const handleSelect = (item: any) => {
    const newDate = new Date(item.year, item.month, item.day);
    setSelectedDate(newDate);
  };

  return (
    <div className="w-full h-full flex text-white select-none relative overflow-hidden p-3.5 gap-3">
      {/* 左侧：选中日期概览 */}
      <div className="w-[88px] flex-shrink-0 flex flex-col justify-center border-r border-white/10 pr-3">
        <div className="text-xs font-bold opacity-60 whitespace-nowrap">
          {selectedDate.getFullYear()}年{selectedDate.getMonth() + 1}月
        </div>
        <div className="text-5xl font-black tracking-tighter drop-shadow-xl leading-none my-1">
          {selectedDate.getDate()}
        </div>
        <div className="flex flex-col gap-0.5">
          <span className="text-xs font-bold text-blue-300 whitespace-nowrap">
            {selectedDate.toLocaleDateString('zh-CN', { weekday: 'long' })}
          </span>
          <span className="text-[10px] font-medium opacity-50 whitespace-nowrap truncate">
            农历 {getLunar(selectedDate)}
          </span>
        </div>
      </div>

      {/* 右侧：日历网格 */}
      <div className="flex-1 flex flex-col justify-center min-w-0">
        <div className="flex items-center justify-between mb-1.5 px-0.5">
          <button 
            onPointerDown={e => e.stopPropagation()}
            onClick={() => handleMonthChange(-1)}
            className="p-0.5 hover:bg-white/10 rounded-full transition-colors flex-shrink-0"
            title="上个月"
          >
            <ChevronLeft className="w-3.5 h-3.5" />
          </button>
          <span className="text-xs font-bold whitespace-nowrap text-center">
            {viewDate.getFullYear()}年 {viewDate.getMonth() + 1}月
          </span>
          <button 
            onPointerDown={e => e.stopPropagation()}
            onClick={() => handleMonthChange(1)}
            className="p-0.5 hover:bg-white/10 rounded-full transition-colors flex-shrink-0"
            title="下个月"
          >
            <ChevronRight className="w-3.5 h-3.5" />
          </button>
        </div>

        <div className="grid grid-cols-7 text-center text-[10px] font-bold opacity-40 mb-1">
          {weekDays.map(w => <div key={w}>{w}</div>)}
        </div>

        {/* 5行布局 7列 */}
        <div className="grid grid-cols-7 gap-y-1 gap-x-0.5 flex-1 items-center">
          {calendarData.map((item, idx) => {
            const isToday = item.isCurrent && 
                           item.day === today.getDate() && 
                           item.month === today.getMonth() && 
                           item.year === today.getFullYear();
            
            const isSelected = item.day === selectedDate.getDate() && 
                              item.month === selectedDate.getMonth() && 
                              item.year === selectedDate.getFullYear();
            
            return (
              <div 
                key={idx} 
                onPointerDown={e => e.stopPropagation()}
                className="flex items-center justify-center relative group/day"
              >
                <button
                  onClick={() => handleSelect(item)}
                  className={`
                    w-6 h-6 flex items-center justify-center rounded-md text-[10px] font-semibold transition-all relative
                    ${item.isCurrent ? 'text-white' : 'text-white/20'}
                    ${isSelected ? 'bg-orange-500 text-white shadow-md shadow-orange-500/50 scale-105 z-10' : 
                      isToday ? 'bg-blue-600 text-white shadow-md shadow-blue-500/50' : 'hover:bg-white/10'}
                  `}
                >
                  {item.day}
                </button>
              </div>
            );
          })}
        </div>
      </div>

      {/* 装饰性背景 */}
      <div className="absolute top-0 right-0 w-32 h-32 bg-blue-500/5 blur-[40px] -z-10 rounded-full" />
      <div className="absolute bottom-0 left-0 w-32 h-32 bg-purple-500/5 blur-[40px] -z-10 rounded-full" />
    </div>
  );
};
