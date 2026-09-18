import React, { useState } from 'react';
import { ClipboardList, Pen } from 'lucide-react';
import { MeetingMinutes } from './MeetingMinutes';
import { DocDrafting } from './DocDrafting';
import { Tabs, type TabItem } from './ui';

type TabType = 'meeting_minutes' | 'drafting';

const TAB_ITEMS: TabItem[] = [
  { key: 'meeting_minutes', label: '会议纪要', icon: <ClipboardList className="w-4 h-4" /> },
  { key: 'drafting', label: '文档起草', icon: <Pen className="w-4 h-4" /> },
];

const DocCopywritingModule: React.FC = () => {
  const [activeTab, setActiveTab] = useState<TabType>('meeting_minutes');

  return (
    <div className="flex flex-col h-full bg-slate-50/50 overflow-hidden">
      {/* Tab Header */}
      <div className="flex items-center gap-1 p-4 bg-white border-b border-slate-200 shrink-0">
        <Tabs
          items={TAB_ITEMS}
          value={activeTab}
          onChange={(key) => setActiveTab(key as TabType)}
          variant="soft"
        />
      </div>

      {/* Tab Content */}
      <div className="flex-1 overflow-hidden">
        {activeTab === 'meeting_minutes' ? (
          <MeetingMinutes />
        ) : (
          <DocDrafting />
        )}
      </div>
    </div>
  );
};

export default DocCopywritingModule;
