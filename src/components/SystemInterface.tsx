import React, { useState, useEffect, useRef, useCallback } from 'react';
// 注：各应用图标已随应用清单一起收敛到 src/config/appRegistry.ts，
//     此处只保留壳层自身用到的图标。
import { LogOut, X, Minus, Plus, Maximize2, Minimize2, Monitor, Grid3X3, Image, ShieldCheck, Loader2, ClipboardList, Trash2, FolderPlus, Star } from 'lucide-react';
import type { ModuleType } from '../types';
import { fetchWithAuth } from '../utils/authFetch';
import { ErrorBoundary } from './ErrorBoundary';
import { sysAlert, sysConfirm } from '../utils/dialog';
import { NotificationCenter } from './NotificationCenter';
import type { AppNotification } from './NotificationCenter';

// 应用组件不再在此逐条声明。
// 懒加载定义已收敛到 src/config/appRegistry.ts 的 component 字段，
// 渲染时按 tab id 动态取用（见下方 renderAppModule）。
import { useRole } from '../context/RoleContext';
import type { AppId } from '../config/permissionConfig';
import {
  DESKTOP_APPS,
  getApp,
  getAppLayout,
  getAppDefaultPosition,
  DEFAULT_FAVORITE_APP_IDS as REGISTRY_FAVORITE_APP_IDS,
} from '../config/appRegistry';

// ─── 桌面小组件 ──────────────────────────────────────────────────
import { ClockWidget } from './desktopComponents/ClockWidget';
import { WeatherWidget } from './desktopComponents/WeatherWidget';
import { CalendarWidget } from './desktopComponents/CalendarWidget';
import { clampWidgetPosition } from '../utils/desktopWidgetBounds';

interface SystemInterfaceProps { username: string; onLogout: () => void; onEnterAdmin?: () => void; }

// ─── 网格常量 ──────────────────────────────────────────────────────
const GRID_COL_W = 120; const GRID_ROW_H = 115; const GRID_START_X = 32; const GRID_START_Y = 28;
const LAYOUT_VERSION = 'v4.7'; // 紧凑型桌面图标与间距优化，消除滚动条自适应全览
const FAVORITE_LAYOUT_VERSION = 'v1.4';
const CUSTOM_DESKTOP_LAYOUT_VERSION = 'v1';
const MAX_DESKTOPS = 5;
type DesktopId = string;
interface DesktopDefinition {
  id: DesktopId;
  label: string;
  description: string;
  template: 'all' | 'favorites' | 'blank';
}
interface DesktopSettings {
  desktops: DesktopDefinition[];
  defaultDesktop: DesktopId;
}
const DEFAULT_DESKTOP_SETTINGS: DesktopSettings = {
  desktops: [
    { id: 'all', label: '桌面 1', description: '全部应用', template: 'all' },
    { id: 'favorites', label: '桌面 2', description: '常用演示', template: 'favorites' },
  ],
  defaultDesktop: 'all',
};
// 桌面 2 默认演示布局：以“洞察决策 / 内容运营”两组文件夹组织常用演示应用。
// 集合与顺序统一来自 src/config/appRegistry.ts（原手写数组已删除）。
const DEFAULT_FAVORITE_APP_IDS: string[] = REGISTRY_FAVORITE_APP_IDS;

// 桌面默认坐标表：由注册表的 defaultGrid 派生（原为 33 条手写常量）。
// 注：enterprisequalification 在重构前即缺失坐标（会走 (32,32) 兜底），此处保持原状不修。
const DEFAULT_POSITIONS: Record<string, { x: number; y: number }> = Object.fromEntries(
  DESKTOP_APPS
    .map((e) => [e.id, getAppDefaultPosition(e.id)] as const)
    .filter(([, pos]) => pos != null),
) as Record<string, { x: number; y: number }>;

function snapToGrid(x: number, y: number) {
  return {
    x: Math.round((x - GRID_START_X) / GRID_COL_W) * GRID_COL_W + GRID_START_X,
    y: Math.round((y - GRID_START_Y) / GRID_ROW_H) * GRID_ROW_H + GRID_START_Y,
  };
}

function genId() { return Math.random().toString(36).slice(2, 9); }

// ─── 多窗口实例类型 ────────────────────────────────────────────────
interface WinInst {
  id: string;
  desktopId: DesktopId;
  tabs: ModuleType[];
  activeTab: ModuleType | null;
  isMinimized: boolean;
  isMaximized: boolean;
  posX: number;
  posY: number;
}

// ─── 文件夹类型 ──────────────────────────────────────────────────
interface Folder {
  id: string;
  label: string;
  appIds: string[];
  x: number;
  y: number;
}

// ─── 小组件类型 ──────────────────────────────────────────────────
interface Widget {
  id: string;
  type: 'clock' | 'weather' | 'calendar';
  x: number;
  y: number;
  w: number; // 网格宽度单位
  h: number; // 网格高度单位
}

// 内置栏目文件夹 ID（隐藏时用于紧凑前移与放大计算）
const BUILTIN_FOLDER_IDS = ['folder_admin', 'folder_core', 'folder_emp', 'folder_tools'];

const FAVORITE_FOLDER_DEFS = [
  { id: 'folder_favorite_insight', label: '洞察决策', appIds: ['news', 'marketing_analysis', 'rules', 'customer', 'market', 'prediction', 'business_dashboard', 'dashboard_center'], x: GRID_START_X + GRID_COL_W * 1, y: GRID_START_Y },
  { id: 'folder_favorite_content', label: '内容运营', appIds: ['layoutcompare', 'orderrecognition', 'aiimage', 'seamarketing', 'beautyrnd', 'qualification', 'hazarddetection', 'contractaudit', 'riskdetection'], x: GRID_START_X + GRID_COL_W * 5, y: GRID_START_Y },
];

function buildFavoriteLayout(favoriteIds: string[]) {
  const extraIds = [...favoriteIds];
  const assignedIds = new Set<string>();
  const folders: Folder[] = FAVORITE_FOLDER_DEFS.map(definition => {
    const appIds = definition.appIds.filter(id => extraIds.includes(id));
    appIds.forEach(id => assignedIds.add(id));
    return {
      id: definition.id,
      label: definition.label,
      appIds,
      x: definition.x,
      y: definition.y,
    };
  }).filter(folder => folder.appIds.length > 0);

  // 未列入预设场景的新应用统一收进“内容运营”，避免再次散落在桌面上。
  const unassignedIds = extraIds.filter(id => !assignedIds.has(id));
  if (unassignedIds.length > 0) {
    const fallback = folders.find(folder => folder.id === 'folder_favorite_content');
    if (fallback) fallback.appIds.push(...unassignedIds);
    else folders.push({ id: 'folder_favorite_content', label: '内容运营', appIds: unassignedIds, x: GRID_START_X + GRID_COL_W * 5, y: GRID_START_Y });
  }

  return { pos: {}, fld: folders };
}

// 全局标签拖拽状态（跨窗口实例共享）
const getFolderDim = (folder: Folder, maxCols = 4) => {
  const count = folder.appIds.length;
  if (count === 0) return { cols: 2, rows: 1 };
  // 9 个及以内最多三列；超过 9 个时允许扩展到四列，优先减少纵向滚动。
  const allowedMaxCols = count > 9 ? Math.max(maxCols, 4) : maxCols;
  const idealCols = Math.max(2, Math.min(allowedMaxCols, Math.ceil(count / 3)));
  const winW = typeof window !== 'undefined' ? window.innerWidth : 1920;
  const screenMaxCols = Math.max(2, Math.floor((winW - folder.x - SAFE_MARGIN_RIGHT) / GRID_COL_W));
  const cols = Math.min(idealCols, allowedMaxCols, screenMaxCols);
  // 在紧凑高密度网格下支持最多 6 行，消除不必要的滚动条
  const rows = Math.min(6, Math.max(1, Math.ceil(count / cols)));
  return { cols, rows };
};
const SAFE_MARGIN_BOTTOM = 96;
const SAFE_MARGIN_RIGHT = 32;

const getWidgetDisplaySize = (widget: Widget, viewport = { width: window.innerWidth, height: window.innerHeight }) => ({
  width: Math.min(GRID_COL_W * widget.w, Math.max(0, viewport.width - GRID_START_X - SAFE_MARGIN_RIGHT)),
  height: Math.min(GRID_ROW_H * widget.h, Math.max(0, viewport.height - GRID_START_Y - SAFE_MARGIN_BOTTOM)),
});

const constrainWidgetPosition = (widget: Widget, position: { x: number; y: number }) => {
  const viewport = { width: window.innerWidth, height: window.innerHeight };
  return clampWidgetPosition(position, getWidgetDisplaySize(widget, viewport), viewport, {
    left: GRID_START_X,
    top: GRID_START_Y,
    right: SAFE_MARGIN_RIGHT,
    bottom: SAFE_MARGIN_BOTTOM,
  });
};

const resolveFolderCollisions = (flds: Folder[], visualOffsets: Record<string, number> = {}, maxColsMap: Record<string, number> = {}) => {
  const sorted = [...flds].sort((a, b) => {
    const vXa = a.x - (visualOffsets[a.id] || 0);
    const vXb = b.x - (visualOffsets[b.id] || 0);
    if (a.y !== b.y) return a.y - b.y;
    return vXa - vXb;
  });

  const nextFlds: Folder[] = [];
  const winW = typeof window !== 'undefined' ? window.innerWidth : 1920;
  const winH = typeof window !== 'undefined' ? window.innerHeight : 1080;

  const safeMaxRow = Math.max(0, Math.floor((winH - SAFE_MARGIN_BOTTOM) / GRID_ROW_H));
  const safeMaxCol = Math.max(0, Math.floor((winW - GRID_START_X - SAFE_MARGIN_RIGHT) / GRID_COL_W));

  for (const f of sorted) {
    const offset = visualOffsets[f.id] || 0;
    const vX = f.x - offset;
    let col = Math.round((vX - GRID_START_X) / GRID_COL_W);
    let row = Math.round((f.y - GRID_START_Y) / GRID_ROW_H);
    const maxCols = maxColsMap[f.id] || 4;

    const getDimAt = (c: number) => getFolderDim({ ...f, x: c * GRID_COL_W + GRID_START_X }, maxCols);

    // Initial clamp
    let dim = getDimAt(col);
    col = Math.max(0, Math.min(col, safeMaxCol - dim.cols + 1));
    row = Math.max(0, Math.min(row, safeMaxRow));
    dim = getDimAt(col); // Recompute after clamp

    const isOccupied = (c: number, r: number, d: { cols: number, rows: number }) => {
      if (c + d.cols > safeMaxCol + 1) return true;
      for (const placed of nextFlds) {
        const pOffset = visualOffsets[placed.id] || 0;
        const pVx = placed.x - pOffset;
        const pCol = Math.round((pVx - GRID_START_X) / GRID_COL_W);
        const pRow = Math.round((placed.y - GRID_START_Y) / GRID_ROW_H);
        const pMaxCols = maxColsMap[placed.id] || 4;
        const pDim = getFolderDim({ ...placed, x: pVx }, pMaxCols);

        if (Math.max(c, pCol) < Math.min(c + d.cols, pCol + pDim.cols) &&
          Math.max(r, pRow) < Math.min(r + d.rows, pRow + pDim.rows)) {
          return true;
        }
      }
      return false;
    };

    while (isOccupied(col, row, dim)) {
      col++;
      dim = getDimAt(col);
      if (col + dim.cols > safeMaxCol + 1) {
        col = 0;
        row++;
        dim = getDimAt(col);
      }
      if (row > safeMaxRow) { row = 0; col = 0; dim = getDimAt(col); break; }
    }

    const finalVisualX = col * GRID_COL_W + GRID_START_X;
    nextFlds.push({ ...f, x: finalVisualX + offset, y: row * GRID_ROW_H + GRID_START_Y });
  }
  return nextFlds;
};

const TAB_DRAG = { tabId: null as string | null, fromWinId: null as string | null, dropHandled: false };

// ─── 共享应用图标项 (纯视觉展示) ──────────────────────────────────
const DesktopAppItem = ({ app, badgeNode, isDragging, onContextMenu }: any) => (
  <div
    className={`flex flex-col items-center justify-center group/app transition-all duration-200 select-none ${isDragging ? 'opacity-0' : 'hover:bg-white/10 rounded-2xl'} w-full h-full p-1`}
    onContextMenu={onContextMenu}
  >
    <div className={`w-14 h-14 rounded-2xl ${app.color} shadow-md flex items-center justify-center transition-transform group-hover/app:scale-105 relative border border-white/20 will-change-transform`}>
      <app.icon className="w-7 h-7 text-white drop-shadow-sm" />
      {badgeNode}
    </div>
    <span className="text-white text-xs font-medium text-center truncate px-1 w-full mt-1.5 group-hover/app:text-white drop-shadow-sm">{app.label}</span>
  </div>
);

// ─── DesktopIcon ──────────────────────────────────────────────────
const DesktopIcon = ({ app, position, onPositionChange, onOpenApp, badgeNode, onContextMenu, onTogglePin, onPromptPin }: any) => {
  const [isDragging, setIsDragging] = useState(false);
  const dragOffset = useRef({ x: 0, y: 0 });
  const dragStartPos = useRef<{ x: number; y: number } | null>(null);
  const origPos = useRef(position);

  const handlePointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    dragOffset.current = { x: e.clientX - position.x, y: e.clientY - position.y };
    dragStartPos.current = { x: e.clientX, y: e.clientY };
    origPos.current = position;
    setIsDragging(true);
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const handlePointerMove = (e: React.PointerEvent) => {
    if (!isDragging) return;
    onPositionChange(app.id, { x: e.clientX - dragOffset.current.x, y: e.clientY - dragOffset.current.y }, false);
  };
  const handlePointerUp = (e: React.PointerEvent) => {
    if (!isDragging) return;
    e.currentTarget.releasePointerCapture(e.pointerId);
    setIsDragging(false);

    if (e.clientY > window.innerHeight - 60) {
      if (onPromptPin) onPromptPin(app);
      else sysConfirm(`是否要将【${app.label}】固定至任务栏？`, () => onTogglePin());
      onPositionChange(app.id, origPos.current, true);
      return;
    }

    const newPos = { x: e.clientX - dragOffset.current.x, y: e.clientY - dragOffset.current.y };
    onPositionChange(app.id, newPos, true);

    if (dragStartPos.current) {
      const dx = e.clientX - dragStartPos.current.x, dy = e.clientY - dragStartPos.current.y;
      if (Math.sqrt(dx * dx + dy * dy) < 5) onOpenApp(app.id);
    }
  };

  return (
    <div className={`absolute select-none touch-none ${!isDragging ? 'transition-all duration-500 ease-[cubic-bezier(0.2,0.8,0.2,1)]' : 'z-30 cursor-grabbing'}`}
      style={{
        left: position.x, top: position.y,
        width: GRID_COL_W, height: GRID_ROW_H,
        zIndex: isDragging ? 40 : 10
      }}
      onPointerDown={handlePointerDown} onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp} onPointerCancel={handlePointerUp}>

      {/* 桌面图标直接使用共享渲染器，不传 onClick/draggable 避免冲突 */}
      <div
        className={`w-full h-full cursor-pointer ${isDragging ? 'scale-105 opacity-80' : ''} transition-transform duration-200`}
        onClick={() => !isDragging && onOpenApp(app.id)}
      >
        <DesktopAppItem
          app={app}
          badgeNode={badgeNode}
          onContextMenu={onContextMenu}
        />
      </div>
    </div>
  );
};

// ─── DesktopFolder ────────────────────────────────────────────────
const DesktopFolder = ({ folder, apps, onPositionChange, onOpenApp, onRename, badgeNodeRenderer, onContextMenu, renameId, onRenameHandled, onMoveApp, displayOffset = 0, maxCols = 4 }: any) => {
  const [isDragging, setIsDragging] = useState(false);
  const [isDropTarget, setIsDropTarget] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [tempName, setTempName] = useState(folder.label);
  const dragOffset = useRef({ x: 0, y: 0 });

  // 渲染位置：内置栏目隐藏时向前紧凑排列（真实位置保持持久化不变）
  const posX = folder.x - displayOffset;
  const posY = folder.y;

  useEffect(() => {
    if (renameId === folder.id) {
      setIsEditing(true);
      if (onRenameHandled) onRenameHandled();
    }
  }, [renameId, folder.id, onRenameHandled]);

  useEffect(() => {
    setTempName(folder.label);
  }, [folder.label]);

  const handlePointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    if ((e.target as HTMLElement).closest('input, .app-icon-item')) return;

    dragOffset.current = { x: e.clientX - posX, y: e.clientY - posY };
    setIsDragging(true);
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    if (!isDragging) return;
    onPositionChange(folder.id, { x: e.clientX - dragOffset.current.x, y: e.clientY - dragOffset.current.y }, false);
  };

  const handlePointerUp = (e: React.PointerEvent) => {
    if (!isDragging) return;
    e.currentTarget.releasePointerCapture(e.pointerId);
    setIsDragging(false);
    onPositionChange(folder.id, { x: e.clientX - dragOffset.current.x, y: e.clientY - dragOffset.current.y }, true);
  };

  const folderApps = folder.appIds.map((id: string) => apps.find((a: any) => a.id === id)).filter(Boolean);
  const { cols, rows } = getFolderDim({ ...folder, x: posX }, maxCols);
  const contentRows = Math.max(1, Math.ceil(folderApps.length / cols));
  const needScroll = contentRows > rows;

  const handleFolderDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDropTarget(false);
    try {
      const data = JSON.parse(e.dataTransfer.getData('text/plain'));
      if (data.appId && data.fromFolderId && data.fromFolderId !== folder.id) onMoveApp(data.appId, data.fromFolderId, folder.id);
    } catch { }
  };

  return (
    <div className={`absolute select-none touch-none ${!isDragging ? 'transition-[left,top,transform] duration-300 ease-out' : 'z-20 scale-[1.02]'}`}
      style={{
        left: posX,
        top: posY,
        width: GRID_COL_W * cols,
        zIndex: isDragging ? 30 : 5
      }}
      onPointerDown={handlePointerDown} onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp} onPointerCancel={handlePointerUp}
      onContextMenu={onContextMenu}
      onDragOver={e => { e.preventDefault(); e.stopPropagation(); setIsDropTarget(true); }}
      onDragLeave={() => setIsDropTarget(false)}
      onDrop={handleFolderDrop}>

      <div className={`m-1.5 rounded-2xl bg-slate-950/65 border shadow-[0_10px_24px_rgba(0,0,0,0.18)] overflow-y-auto custom-scroll transition-colors ${isDropTarget ? 'bg-blue-500/35 border-blue-200 ring-2 ring-blue-300/80' : 'border-white/20'}`}
        style={{ height: GRID_ROW_H * rows - 12, isolation: 'isolate', contain: 'paint' }}>
        <div className="grid" style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}>
          {folderApps.map((app: any) => (
            <div key={app.id} className="app-icon-item h-[102px] flex flex-col items-center justify-center cursor-pointer hover:bg-white/10 rounded-xl transition-colors p-1"
              draggable
              onClick={(e) => { e.stopPropagation(); onOpenApp(app.id); }}
              onDragStart={e => { e.dataTransfer.setData('text/plain', JSON.stringify({ appId: app.id, fromFolderId: folder.id })); e.dataTransfer.effectAllowed = 'move'; }}>
              <DesktopAppItem app={app} badgeNode={badgeNodeRenderer(app.id)} />
            </div>
          ))}
          {folderApps.length === 0 && <div className="col-span-full h-[102px] flex items-center justify-center text-xs text-white/50">拖入应用</div>}
        </div>
      </div>

      <div className="absolute -bottom-4 left-0 right-0 flex flex-col items-center z-20 pointer-events-auto">
        {isEditing ? (
          <input
            autoFocus
            className="bg-blue-600/90 text-white text-xs font-semibold text-center border-none rounded px-2.5 py-0.5 outline-none w-3/4 shadow-lg focus:ring-2 ring-white/50"
            value={tempName}
            onChange={e => setTempName(e.target.value)}
            onBlur={() => { setIsEditing(false); onRename(folder.id, tempName); }}
            onKeyDown={e => {
              if (e.key === 'Enter') { setIsEditing(false); onRename(folder.id, tempName); }
              if (e.key === 'Escape') { setIsEditing(false); setTempName(folder.label); }
            }}
            onClick={e => e.stopPropagation()}
            onPointerDown={e => e.stopPropagation()}
          />
        ) : (
          <span className="text-white text-xs font-bold drop-shadow-md px-2.5 py-0.5 rounded-full bg-black/40 border border-white/10 cursor-text select-none"
            onDoubleClick={(e) => { e.stopPropagation(); setIsEditing(true); }} onPointerDown={e => e.stopPropagation()}>{folder.label}</span>
        )}
        {needScroll && <span className="mt-0.5 text-[9px] text-white/55">向下滚动查看全部 {folderApps.length} 个应用</span>}
      </div>
    </div>
  );
};

// ─── DesktopWidget ────────────────────────────────────────────────
const DesktopWidget = ({ widget, onPositionChange, onRemove }: any) => {
  const [isDragging, setIsDragging] = useState(false);
  const dragOffset = useRef({ x: 0, y: 0 });
  const displaySize = getWidgetDisplaySize(widget);

  const handlePointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    if ((e.target as HTMLElement).closest('button, input')) return;
    dragOffset.current = { x: e.clientX - widget.x, y: e.clientY - widget.y };
    setIsDragging(true);
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    if (!isDragging) return;
    onPositionChange(widget.id, { x: e.clientX - dragOffset.current.x, y: e.clientY - dragOffset.current.y }, false);
  };

  const handlePointerUp = (e: React.PointerEvent) => {
    if (!isDragging) return;
    e.currentTarget.releasePointerCapture(e.pointerId);
    setIsDragging(false);
    onPositionChange(widget.id, { x: e.clientX - dragOffset.current.x, y: e.clientY - dragOffset.current.y }, true);
  };

  return (
    <div className={`absolute select-none touch-none ${!isDragging ? 'transition-all duration-500 ease-[cubic-bezier(0.2,0.8,0.2,1)]' : 'z-40 cursor-grabbing'}`}
      style={{
        left: widget.x, top: widget.y,
        width: displaySize.width, height: displaySize.height,
        zIndex: isDragging ? 50 : 2
      }}
      onPointerDown={handlePointerDown} onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp} onPointerCancel={handlePointerUp}>

      <div className={`absolute inset-1.5 rounded-2xl bg-white/5 backdrop-blur-2xl border border-white/10 shadow-2xl overflow-hidden group/widget ${isDragging ? 'scale-[1.02] ring-2 ring-blue-500/50' : ''}`}>
        {widget.type === 'clock' && <ClockWidget />}
        {widget.type === 'weather' && <WeatherWidget />}
        {widget.type === 'calendar' && <CalendarWidget />}

        {/* 移除按钮 */}
        <button
          className="absolute top-2 right-2 w-6 h-6 rounded-full bg-black/30 hover:bg-red-500/80 text-white flex items-center justify-center opacity-0 group-hover/widget:opacity-100 transition-all duration-200 backdrop-blur-md z-30"
          onClick={(e) => { e.stopPropagation(); onRemove(widget.id); }}
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
};


// ─── AppWindowFrame（单个窗口实例）────────────────────────────────
const AppWindowFrame = React.memo(({
  win, apps, zIndex, isFocused,
  onFocus, onSetActive, onCloseTab, onMinimize, onToggleMaximize,
  onReorderTabs, onDetachTab, onReceiveTab, onMoveWindow, username
}: {
  win: WinInst; apps: any[]; zIndex: number; isFocused: boolean;
  onFocus: () => void; onSetActive: (t: ModuleType) => void;
  onCloseTab: (t: ModuleType, e: React.MouseEvent) => void;
  onMinimize: () => void; onToggleMaximize: () => void;
  onReorderTabs: (tabs: ModuleType[]) => void;
  onDetachTab: (tabId: ModuleType, x: number, y: number) => void;
  onReceiveTab: (tabId: ModuleType, fromWinId: string, idx: number) => void;
  onMoveWindow: (x: number, y: number) => void;
  username?: string;
}) => {
  const [dragOverIdx, setDragOverIdx] = useState<number | null>(null);
  const winRef = useRef<HTMLDivElement>(null);
  const winDrag = useRef({ active: false, sx: 0, sy: 0, ox: 0, oy: 0 });

  if (win.tabs.length === 0) return null;

  const onTitlePtrDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (win.isMaximized) return;
    if ((e.target as Element).closest('button,[draggable="true"]')) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    winDrag.current = { active: true, sx: e.clientX, sy: e.clientY, ox: win.posX, oy: win.posY };
  };
  const onTitlePtrMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!winDrag.current.active) return;
    const nx = winDrag.current.ox + e.clientX - winDrag.current.sx;
    const ny = Math.max(0, winDrag.current.oy + e.clientY - winDrag.current.sy);
    if (winRef.current) { winRef.current.style.left = `${nx}px`; winRef.current.style.top = `${ny}px`; }
  };
  const onTitlePtrUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!winDrag.current.active) return;
    winDrag.current.active = false;
    e.currentTarget.releasePointerCapture(e.pointerId);
    onMoveWindow(
      winDrag.current.ox + e.clientX - winDrag.current.sx,
      Math.max(0, winDrag.current.oy + e.clientY - winDrag.current.sy),
    );
  };

  const handleTabDragStart = (e: React.DragEvent, tabId: string) => {
    TAB_DRAG.tabId = tabId;
    TAB_DRAG.fromWinId = win.id;
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', tabId);
  };

  const handleTabDragEnd = (e: React.DragEvent, tabId: string) => {
    if (!TAB_DRAG.dropHandled && e.dataTransfer.dropEffect === 'none') {
      onDetachTab(tabId as ModuleType, e.clientX, e.clientY);
    }
    TAB_DRAG.tabId = null;
    TAB_DRAG.fromWinId = null;
    TAB_DRAG.dropHandled = false;
    setDragOverIdx(null);
  };

  const handleTabBarDragOver = (e: React.DragEvent, idx: number) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    setDragOverIdx(idx);
  };

  const handleTabBarDrop = (e: React.DragEvent, dropIdx: number) => {
    e.preventDefault();
    e.stopPropagation();
    const tabId = TAB_DRAG.tabId as ModuleType | null;
    if (!tabId) return;

    if (TAB_DRAG.fromWinId === win.id) {
      const tabs = [...win.tabs];
      const fromIdx = tabs.indexOf(tabId);
      if (fromIdx === -1) { setDragOverIdx(null); return; }
      tabs.splice(fromIdx, 1);
      tabs.splice(dropIdx, 0, tabId);
      onReorderTabs(tabs);
    } else if (TAB_DRAG.fromWinId) {
      TAB_DRAG.dropHandled = true;
      onReceiveTab(tabId, TAB_DRAG.fromWinId, dropIdx);
    }
    setDragOverIdx(null);
  };

  return (
    <div
      ref={winRef}
      className={`absolute flex flex-col overflow-hidden border border-white/20 backdrop-blur-2xl window-animate ${isFocused ? '' : 'opacity-95'} ${win.isMaximized
        ? 'inset-x-0 top-0 bottom-16 rounded-none'
        : 'rounded-xl shadow-[0_20px_60px_-15px_rgba(0,0,0,0.5)]'}`}
      style={{
        zIndex,
        display: win.isMinimized ? 'none' : 'flex',
        backgroundColor: 'rgba(241,245,249,0.95)',
        ...(win.isMaximized ? {} : { left: win.posX, top: win.posY, width: '85vw', height: '82vh' }),
      }}
      onPointerDown={onFocus}
    >
      <div
        className="h-11 bg-white/50 backdrop-blur-md shrink-0 border-b border-white/30 shadow-[inset_0_1px_0_rgba(255,255,255,0.7)] flex items-stretch select-none"
        style={win.isMaximized ? {} : { cursor: 'grab' }}
        onPointerDown={onTitlePtrDown}
        onPointerMove={onTitlePtrMove}
        onPointerUp={onTitlePtrUp}
        onPointerCancel={onTitlePtrUp}
        onDoubleClick={(e) => {
          if ((e.target as Element).closest('button, [role="button"]')) return;
          onToggleMaximize();
        }}
      >
        <div
          className="flex items-end flex-1 overflow-x-auto min-w-0 px-1 pt-1 gap-0 cursor-default"
          onDragOver={e => handleTabBarDragOver(e, win.tabs.length)}
          onDrop={e => handleTabBarDrop(e, win.tabs.length)}
          onDragLeave={() => setDragOverIdx(null)}
        >
          {win.tabs.map((id, idx) => {
            const tabApp = apps.find((a: any) => a.id === id);
            if (!tabApp) return null;
            const isActive = win.activeTab === id;
            return (
              <React.Fragment key={id}>
                {dragOverIdx === idx && TAB_DRAG.fromWinId && (
                  <div className="w-0.5 h-7 bg-blue-500 rounded-full self-center shrink-0 mx-0.5" />
                )}
                <button
                  draggable
                  onDragStart={e => handleTabDragStart(e, id)}
                  onDragEnd={e => handleTabDragEnd(e, id)}
                  onDragOver={e => handleTabBarDragOver(e, idx)}
                  onDrop={e => handleTabBarDrop(e, idx)}
                  onClick={() => onSetActive(id)}
                  className={`group flex items-center gap-1.5 px-3 py-1.5 rounded-t-lg text-xs font-medium whitespace-nowrap max-w-[160px] transition-all duration-100 border-t border-x relative cursor-grab active:cursor-grabbing ${isActive ? 'bg-white/90 text-slate-800 border-slate-200 shadow-sm z-10' : 'bg-white/20 text-slate-500 border-transparent hover:bg-white/50 hover:text-slate-700'
                    }`}
                >
                  <tabApp.icon className={`w-3.5 h-3.5 shrink-0 ${isActive ? 'text-slate-600' : 'text-slate-400'}`} />
                  <span className="truncate">{tabApp.label}</span>
                  <span
                    role="button"
                    onClick={e => { e.stopPropagation(); onCloseTab(id, e); }}
                    className={`ml-1 w-4 h-4 rounded flex items-center justify-center shrink-0 hover:bg-slate-200 transition-colors ${isActive ? 'opacity-70 hover:opacity-100' : 'opacity-0 group-hover:opacity-70'}`}
                  >
                    <X className="w-2.5 h-2.5" />
                  </span>
                </button>
              </React.Fragment>
            );
          })}
          {dragOverIdx === win.tabs.length && TAB_DRAG.fromWinId && (
            <div className="w-0.5 h-7 bg-blue-500 rounded-full self-center shrink-0 mx-0.5" />
          )}
        </div>

        <div className="flex items-stretch shrink-0 border-l border-white/20">
          <button onClick={onMinimize} className="w-12 h-full hover:bg-slate-200/60 flex items-center justify-center transition-colors group" title="最小化">
            <Minus className="w-4 h-4 text-slate-600 group-hover:text-slate-800" />
          </button>
          <button onClick={onToggleMaximize} className="w-12 h-full hover:bg-slate-200/60 flex items-center justify-center transition-colors group" title={win.isMaximized ? '还原' : '最大化'}>
            {win.isMaximized ? <Minimize2 className="w-3.5 h-3.5 text-slate-600 group-hover:text-slate-800" /> : <Maximize2 className="w-3.5 h-3.5 text-slate-600 group-hover:text-slate-800" />}
          </button>
          <button onClick={e => win.activeTab && onCloseTab(win.activeTab, e)} className="w-12 h-full hover:bg-red-500 flex items-center justify-center transition-colors group" title="关闭当前标签">
            <X className="w-4 h-4 text-slate-600 group-hover:text-white" />
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-hidden relative" style={{ backgroundColor: 'rgba(255,255,255,0.65)' }}>
        {win.tabs.map(id => (
          <div key={id} className="absolute inset-0 overflow-auto" style={{ display: win.activeTab === id ? 'block' : 'none' }}>
            <div className={getAppLayout(id) === 'full'
              ? 'h-full w-full flex flex-col'
              : 'max-w-7xl mx-auto h-full p-4 md:p-6 flex flex-col w-full'
            }>
              <ErrorBoundary fallbackMessage="应用界面组件内部发生执行故障，为了维护 Web OS 大屏整体稳定性已将此处隔离。您可尝试刷新模块重试。">
                <React.Suspense fallback={
                  <div className="flex-1 flex items-center justify-center p-8 h-full">
                    <div className="flex flex-col items-center gap-4">
                      <div className="w-8 h-8 border-4 border-slate-300 border-t-blue-500 rounded-full animate-spin" />
                      <div className="text-slate-600 font-medium text-sm animate-pulse">应用加载中...</div>
                    </div>
                  </div>
                }>
                  {/* 按 tab id 从注册表动态取组件（原为 35 条手写条件渲染分支） */}
                  {(() => {
                    const entry = getApp(id);
                    if (!entry?.component) return null;
                    const Comp = entry.component;
                    return (
                      <Comp
                        {...(entry.componentProps ?? {})}
                        {...(entry.injectUsername ? { username } : {})}
                      />
                    );
                  })()}
                </React.Suspense>
              </ErrorBoundary>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
});

// ─── Win11 风格固定底栏 (Taskbar) ───────────────────────────────
const Taskbar = React.memo(({ apps, openTabIds, pinnedApps, onTaskbarClick, renderBadge, onShowDesktop, onDockAction, onUnpin, onReorder, username, onEnterAdmin, activeDesktop, onSelectDesktop, desktopSettings, onSaveDesktopSettings, onBuildDesktopPreview, onAddDesktop, onDeleteDesktop, onReorderDesktops }: any) => {
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [draggedAppId, setDraggedAppId] = useState<string | null>(null);
  const [dragOverAppId, setDragOverAppId] = useState<string | null>(null);
  const [ctxMenu, setCtxMenu] = useState<{ visible: boolean; x: number; y: number; appId: string | null }>({ visible: false, x: 0, y: 0, appId: null });
  const [hoveredDesktop, setHoveredDesktop] = useState<DesktopId | null>(null);
  const [editingDesktop, setEditingDesktop] = useState<DesktopId | null>(null);
  const [draftDesktopLabel, setDraftDesktopLabel] = useState('');
  const [draggedDesktopId, setDraggedDesktopId] = useState<DesktopId | null>(null);
  const [dragOverDesktopId, setDragOverDesktopId] = useState<DesktopId | null>(null);
  const livePreviewMountRef = useRef<HTMLDivElement>(null);
  const [livePreviewReady, setLivePreviewReady] = useState(false);

  useEffect(() => {
    const mount = livePreviewMountRef.current;
    if (!mount || !hoveredDesktop || editingDesktop) return;
    mount.replaceChildren();
    const preview = onBuildDesktopPreview?.(hoveredDesktop);
    if (preview) mount.appendChild(preview);
    setLivePreviewReady(Boolean(preview));
    return () => { mount.replaceChildren(); };
  }, [hoveredDesktop, editingDesktop, onBuildDesktopPreview]);

  // 全局点击关闭上下文菜单
  useEffect(() => {
    if (!ctxMenu.visible) return;
    const handleGlobalClick = (e: MouseEvent) => {
      // 如果点击的是菜单内部，则不处理（交给菜单自身的点击逻辑）
      if ((e.target as HTMLElement).closest('.ctx-animate')) return;
      setCtxMenu(prev => ({ ...prev, visible: false }));
    };
    // 使用 mousedown 且在捕获阶段或延迟执行，确保不影响菜单内操作
    window.addEventListener('mousedown', handleGlobalClick);
    return () => window.removeEventListener('mousedown', handleGlobalClick);
  }, [ctxMenu.visible]);

  useEffect(() => {
    if (!editingDesktop) return;
    const handleOutsideDesktopSettings = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (target.closest('.desktop-settings-popover') || target.closest('[data-desktop-settings-trigger]')) return;
      setEditingDesktop(null);
    };
    window.addEventListener('mousedown', handleOutsideDesktopSettings);
    return () => window.removeEventListener('mousedown', handleOutsideDesktopSettings);
  }, [editingDesktop]);

  const handleClick = useCallback((id: string) => {
    onTaskbarClick(id);
  }, [onTaskbarClick]);

  const handleCtxMenu = (e: React.MouseEvent, appId: string) => {
    e.preventDefault();
    e.stopPropagation();
    setCtxMenu({ visible: true, x: e.clientX, y: e.clientY, appId });
  };

  const closeCtx = () => setCtxMenu(c => ({ ...c, visible: false }));

  const ctxApp = ctxMenu.appId ? apps.find((a: any) => a.id === ctxMenu.appId) : null;
  const ctxIsOpen = ctxMenu.appId ? openTabIds.includes(ctxMenu.appId) : false;

  const handleDragStart = (e: React.DragEvent, id: string) => {
    setDraggedAppId(id);
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', id);
  };

  const handleDragOver = (e: React.DragEvent, id: string) => {
    e.preventDefault();
    if (draggedAppId && draggedAppId !== id) {
      setDragOverAppId(id);
    }
  };

  const handleDrop = (e: React.DragEvent, targetId: string) => {
    e.preventDefault();
    const sourceId = e.dataTransfer.getData('text/plain');
    setDragOverAppId(null);
    setDraggedAppId(null);
    if (sourceId && sourceId !== targetId && onReorder) {
      onReorder(sourceId, targetId);
    }
  };

  const cleanDragState = () => {
    setDragOverAppId(null);
    setDraggedAppId(null);
  };

  return (
    <>
      <div className="flex items-center justify-center gap-2 h-full select-none relative">
        {/* 实施人员专用系统配置中心入口 */}
        {username === 'sys_admin' && (
          <div
            onClick={() => onEnterAdmin?.()}
            onMouseEnter={() => setHoveredId('__sysadmin')}
            onMouseLeave={() => setHoveredId(null)}
            className="w-12 h-12 rounded-xl hover:bg-red-500/20 active:bg-red-500/10 flex items-center justify-center cursor-pointer transition-all duration-300 relative group"
          >
            {hoveredId === '__sysadmin' && (
              <div className="absolute bottom-full mb-4 bg-red-900/95 text-white text-[11px] font-bold px-2.5 py-1 rounded-lg shadow-lg whitespace-nowrap pointer-events-none border border-red-500/30 z-50">
                系统配置中心
              </div>
            )}
            <ShieldCheck className={`w-6 h-6 text-red-400 transition-all duration-200 ease-out origin-bottom pointer-events-none ${hoveredId === '__sysadmin' ? 'scale-[1.3] -translate-y-2 drop-shadow-xl z-20 mx-1' : 'scale-100'}`} />
          </div>
        )}

        <div
          onClick={onShowDesktop}
          onMouseEnter={() => setHoveredId('__desktop')}
          onMouseLeave={() => setHoveredId(null)}
          className="w-12 h-12 rounded-xl hover:bg-white/10 active:bg-white/5 flex items-center justify-center cursor-pointer transition-all duration-300 relative"
        >
          {hoveredId === '__desktop' && (
            <div className="absolute bottom-full mb-4 bg-slate-800/95 text-white text-[11px] font-medium px-2.5 py-1 rounded-lg shadow-lg whitespace-nowrap pointer-events-none border border-white/10 z-50">
              显示桌面
            </div>
          )}
          <Monitor className={`w-6 h-6 text-white/90 transition-all duration-200 ease-out origin-bottom pointer-events-none ${hoveredId === '__desktop' ? 'scale-[1.3] -translate-y-2 drop-shadow-xl z-20 mx-1' : 'scale-100 translate-y-0 active:scale-95'}`} />
        </div>

        <div className="w-px h-6 bg-white/20 mx-1" />

        <div className="flex items-center gap-1 mr-2" aria-label="桌面切换">
          {desktopSettings.desktops.map((desktop: DesktopDefinition) => {
            const active = activeDesktop === desktop.id;
            const isDefault = desktopSettings.defaultDesktop === desktop.id;
            return (
              <div key={desktop.id} draggable
                onDragStart={e => { setDraggedDesktopId(desktop.id); e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', `desktop:${desktop.id}`); }}
                onDragOver={e => { e.preventDefault(); if (draggedDesktopId && draggedDesktopId !== desktop.id) setDragOverDesktopId(desktop.id); }}
                onDragLeave={() => setDragOverDesktopId(null)}
                onDrop={e => { e.preventDefault(); const source = e.dataTransfer.getData('text/plain').replace('desktop:', ''); if (source && source !== desktop.id) onReorderDesktops?.(source, desktop.id); setDraggedDesktopId(null); setDragOverDesktopId(null); }}
                onDragEnd={() => { setDraggedDesktopId(null); setDragOverDesktopId(null); }}
                className={`relative transition-transform duration-200 ${draggedDesktopId === desktop.id ? 'opacity-45 scale-95' : ''} ${dragOverDesktopId === desktop.id ? 'translate-x-1' : ''}`}
                onMouseEnter={() => setHoveredDesktop(desktop.id)} onMouseLeave={() => setHoveredDesktop(null)}>
                {hoveredDesktop === desktop.id && editingDesktop !== desktop.id && (
                  <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-3 w-[286px] p-2.5 rounded-xl bg-slate-950/95 border border-white/15 shadow-2xl backdrop-blur-xl z-[80] pointer-events-none">
                    <div className="relative h-40 overflow-hidden rounded-lg border border-white/15 bg-slate-950">
                      <div ref={hoveredDesktop === desktop.id ? livePreviewMountRef : undefined} className="absolute inset-0 overflow-hidden" />
                      {!livePreviewReady && <span className="absolute inset-0 flex items-center justify-center text-[10px] text-white/50">该桌面尚未生成预览</span>}
                    </div>
                    <div className="flex items-center justify-between px-1 pt-2 text-[11px] text-white">
                      <span className="font-bold truncate">{desktop.label}</span>
                      {isDefault && <Star className="w-3.5 h-3.5 fill-amber-300 text-amber-300" />}
                    </div>
                  </div>
                )}
                {editingDesktop === desktop.id && (
                  <div className="desktop-settings-popover absolute bottom-full left-1/2 -translate-x-1/2 mb-3 w-64 p-3 rounded-xl bg-slate-950/95 border border-white/15 shadow-2xl backdrop-blur-xl z-[90]">
                    <p className="text-[11px] font-bold text-white mb-2">桌面设置</p>
                    <input autoFocus value={draftDesktopLabel} maxLength={12} onChange={e => setDraftDesktopLabel(e.target.value)} className="w-full h-8 px-2 rounded-md bg-white/10 border border-white/15 text-xs text-white outline-none focus:border-blue-400" placeholder="桌面名称" />
                    <label className="mt-3 flex cursor-pointer items-center gap-1.5 text-[11px] text-white/75">
                      <input type="checkbox" checked={isDefault} onChange={e => { if (e.target.checked) onSaveDesktopSettings({ ...desktopSettings, defaultDesktop: desktop.id }); }} className="h-3.5 w-3.5 accent-amber-400" />
                      是否设置为默认桌面
                    </label>
                    <div className="mt-3 flex items-center justify-end gap-2">
                        <button type="button" onClick={() => setEditingDesktop(null)} className="text-[11px] text-white/60 hover:text-white">取消</button>
                        <button type="button" onClick={() => { const label = draftDesktopLabel.trim(); if (label) onSaveDesktopSettings({ ...desktopSettings, desktops: desktopSettings.desktops.map((item: DesktopDefinition) => item.id === desktop.id ? { ...item, label } : item) }); setEditingDesktop(null); }} className="text-[11px] font-bold text-blue-300 hover:text-blue-200">保存</button>
                    </div>
                    {desktopSettings.desktops.length > 1 && <button type="button" onClick={() => { setEditingDesktop(null); onDeleteDesktop(desktop.id); }} className="mt-3 text-[11px] text-rose-300 hover:text-rose-200">删除此桌面</button>}
                  </div>
                )}
                <div className={`flex items-center rounded-lg border transition-all ${active ? (isDefault ? 'bg-orange-500/30 text-white border-orange-300/80 shadow-[0_0_14px_rgba(251,146,60,0.36)]' : 'bg-blue-500/30 text-white border-blue-300/70 shadow-[0_0_14px_rgba(96,165,250,0.35)]') : (isDefault ? 'bg-orange-500/12 text-orange-100 border-orange-300/35 hover:bg-orange-500/22' : 'text-white/60 border-transparent hover:bg-white/10 hover:text-white')}`}>
                  <button type="button" title={`${desktop.label} · ${desktop.description}`} onClick={() => onSelectDesktop(desktop.id)} className="h-9 px-2 text-xs font-bold">
                    {desktop.label}
                  </button>
                  <button type="button" data-desktop-settings-trigger aria-label={`设置${desktop.label}`} onClick={(e) => { e.stopPropagation(); setDraftDesktopLabel(desktop.label); setEditingDesktop(desktop.id); }} className="w-5 h-9 text-white/35 hover:text-white text-xs">···</button>
                </div>
              </div>
            );
          })}
          {desktopSettings.desktops.length < MAX_DESKTOPS && (
            <button type="button" onClick={onAddDesktop} title="新增桌面" className="w-8 h-8 ml-1 rounded-lg text-white/65 hover:text-white hover:bg-white/10 border border-dashed border-white/20 text-lg leading-none">+</button>
          )}
        </div>

        {apps.map((app: any, index: number) => {
          const isHov = hoveredId === app.id;
          const hoveredIndex = hoveredId ? apps.findIndex((a: any) => a.id === hoveredId) : -1;
          const isDragging = draggedAppId === app.id;
          const isDragOver = dragOverAppId === app.id;

          let macDockStyles = 'scale-100 translate-y-0 active:scale-95';
          if (!isDragging && hoveredIndex !== -1) {
            const dist = Math.abs(index - hoveredIndex);
            if (dist === 0) macDockStyles = 'scale-[1.35] -translate-y-2.5 shadow-2xl z-20 mx-1 border-white/40 ring-2 ring-white/10';
            else if (dist === 1) macDockStyles = 'scale-[1.15] -translate-y-1 shadow-xl z-10 mx-0.5';
          }

          return (
            <div
              key={app.id}
              className={`relative flex items-center justify-center transition-transform ${isDragging ? 'opacity-50' : 'opacity-100'} ${isDragOver ? 'scale-110 mx-2' : ''}`}
            >
              {isHov && !isDragging && (
                <div className="absolute bottom-full mb-4 bg-slate-800/95 text-white text-[11px] font-medium px-2.5 py-1 rounded-lg shadow-lg whitespace-nowrap pointer-events-none border border-white/10 z-50">
                  {app.label}
                </div>
              )}
              <div
                draggable
                onDragStart={e => handleDragStart(e, app.id)}
                onDragOver={e => handleDragOver(e, app.id)}
                onDrop={e => handleDrop(e, app.id)}
                onDragEnd={cleanDragState}
                onDragLeave={() => setDragOverAppId(null)}
                onClick={(e) => {
                  const target = e.currentTarget;
                  target.classList.add('icon-click-anim');
                  setTimeout(() => target.classList.remove('icon-click-anim'), 200);
                  handleClick(app.id);
                }}
                onMouseEnter={() => setHoveredId(app.id)}
                onMouseLeave={() => setHoveredId(null)}
                onContextMenu={e => handleCtxMenu(e, app.id)}
                className={`w-12 h-12 rounded-2xl cursor-pointer flex items-center justify-center relative transition-all duration-300 ${isDragOver ? 'bg-white/20' : 'hover:bg-white/10 active:bg-white/5 hover:shadow-[0_0_20px_rgba(255,255,255,0.15)]'}`}
              >
                <div className={`w-9 h-9 rounded-xl ${app.color} shadow-lg border border-white/20 flex items-center justify-center pointer-events-none transition-all duration-200 ease-out origin-bottom ${macDockStyles}`}>
                  <app.icon className="w-5 h-5 text-white drop-shadow-md" />
                  {renderBadge(app.id)}
                </div>
                {openTabIds.includes(app.id) && (
                  <div className="absolute -bottom-1 left-1/2 -translate-x-1/2 w-1 h-1 bg-white rounded-full shadow-[0_0_8px_white]" />
                )}
              </div>
            </div>
          );
        })}
      </div>

      {ctxMenu.visible && ctxApp && (
        <div
          className="fixed z-[999] py-1.5 min-w-[180px] rounded-xl overflow-hidden shadow-2xl ctx-animate border border-white/10"
          onClick={e => e.stopPropagation()}
          onContextMenu={e => e.preventDefault()}
          style={{
            left: Math.max(10, ctxMenu.x - 90),
            bottom: 60,
            background: 'rgba(30,30,35,0.95)',
            backdropFilter: 'blur(20px) saturate(180%)',
          }}
        >
          <div className="flex items-center gap-2.5 px-4 py-2 border-b border-white/10">
            <div className={`w-6 h-6 rounded-lg ${ctxApp.color} flex items-center justify-center shrink-0`}>
              <ctxApp.icon className="w-3.5 h-3.5 text-white" />
            </div>
            <div className="text-white/90 text-xs font-semibold">{ctxApp.label}</div>
          </div>

          {pinnedApps.includes(ctxMenu.appId) ? (
            <button className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-white/80 hover:bg-white/10 transition-colors text-left"
              onClick={() => { onUnpin(ctxMenu.appId!); closeCtx(); }}>
              <Minus className="w-3.5 h-3.5" /> 取消固定
            </button>
          ) : (
            <button className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-white/80 hover:bg-white/10 transition-colors text-left"
              onClick={() => { onUnpin(ctxMenu.appId!); closeCtx(); }}>
              <Plus className="w-3.5 h-3.5" /> 固定至任务栏
            </button>
          )}
          <div className="my-1 border-t border-white/10" />

          {ctxIsOpen ? (
            <>
              <button className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-white/80 hover:bg-white/10 transition-colors text-left"
                onClick={() => { onDockAction('show', ctxMenu.appId); closeCtx(); }}>
                <span className="text-base text-blue-400">↗</span> 显示窗口
              </button>
              <button className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-white/80 hover:bg-white/10 transition-colors text-left"
                onClick={() => { onDockAction('minimize', ctxMenu.appId); closeCtx(); }}>
                <span className="text-base text-slate-400">—</span> 最小化
              </button>
              <div className="my-1 border-t border-white/10" />
              <button className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-red-400 hover:bg-red-500/15 transition-colors text-left"
                onClick={() => { onDockAction('close', ctxMenu.appId); closeCtx(); }}>
                <X className="w-3.5 h-3.5" /> 退出应用
              </button>
            </>
          ) : (
            <button className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-white/80 hover:bg-white/10 transition-colors text-left"
              onClick={() => { handleClick(ctxMenu.appId!); closeCtx(); }}>
              <span className="text-base">▶</span> 打开应用
            </button>
          )}
        </div>
      )}
    </>
  );
});

// ─── SystemInterface（主容器） ────────────────────────────────────
export const SystemInterface: React.FC<SystemInterfaceProps> = ({ username, onLogout, onEnterAdmin }) => {
  const [windows, setWindows] = useState<WinInst[]>(() => {
    try {
      const saved = sessionStorage.getItem("desktop_windows");
      if (saved) return JSON.parse(saved).map((win: WinInst) => ({ ...win, desktopId: win.desktopId === 'favorites' ? 'favorites' : 'all' }));
    } catch (e) { }
    return [];
  });
  const [focusedWinId, setFocusedWinId] = useState<string | null>(() => {
    return sessionStorage.getItem("desktop_focused_win") || null;
  });

  useEffect(() => {
    try {
      sessionStorage.setItem("desktop_windows", JSON.stringify(windows));
    } catch (e) { }
  }, [windows]);

  useEffect(() => {
    if (focusedWinId) {
      sessionStorage.setItem("desktop_focused_win", focusedWinId);
    } else {
      sessionStorage.removeItem("desktop_focused_win");
    }
  }, [focusedWinId]);

  const [notifications, setNotifications] = useState<AppNotification[]>([]);

  const fetchNotifications = useCallback(async () => {
    try {
      const res = await fetchWithAuth('/api/notifications');
      const data = await res.json();
      if (data.success) setNotifications(data.data);
    } catch (e) {
      console.error('Failed to fetch notifications:', e);
    }
  }, []);

  useEffect(() => {
    fetchNotifications();
  }, [fetchNotifications]);

  // 监听其他模块触发的通知刷新事件
  useEffect(() => {
    const handleRefresh = () => fetchNotifications();
    window.addEventListener('refresh-notifications', handleRefresh);
    return () => window.removeEventListener('refresh-notifications', handleRefresh);
  }, [fetchNotifications]);

  const getStoreKey = useCallback((key: string) => `${key}_${username}`, [username]);
  const { canAccess, isLoading } = useRole();
  const readDesktopSettings = useCallback((): DesktopSettings => {
    try {
      const saved = localStorage.getItem(`desktop_settings_${username}`);
      if (!saved) return DEFAULT_DESKTOP_SETTINGS;
      const parsed = JSON.parse(saved);
      if (Array.isArray(parsed.desktops)) {
        const desktops = parsed.desktops
          .filter((desktop: DesktopDefinition) => desktop?.id && desktop?.label)
          .slice(0, MAX_DESKTOPS)
          .map((desktop: DesktopDefinition) => ({ ...desktop, template: desktop.template === 'all' || desktop.template === 'favorites' ? desktop.template : 'blank' }));
        if (desktops.length) return { desktops, defaultDesktop: desktops.some((desktop: DesktopDefinition) => desktop.id === parsed.defaultDesktop) ? parsed.defaultDesktop : desktops[0].id };
      }
      // 兼容已保存的双桌面配置。
      return {
        desktops: DEFAULT_DESKTOP_SETTINGS.desktops.map(desktop => ({ ...desktop, ...(parsed[desktop.id] || {}) })),
        defaultDesktop: parsed.defaultDesktop === 'favorites' ? 'favorites' : 'all',
      };
    } catch { return DEFAULT_DESKTOP_SETTINGS; }
  }, [username]);
  const [desktopSettings, setDesktopSettings] = useState<DesktopSettings>(() => readDesktopSettings());
  const [activeDesktop, setActiveDesktop] = useState<DesktopId>(() => readDesktopSettings().defaultDesktop);
  const [desktopTransition, setDesktopTransition] = useState<'idle' | 'in'>('idle');
  const [desktopSlideDirection, setDesktopSlideDirection] = useState<'forward' | 'backward'>('forward');
  const [outgoingDesktopMarkup, setOutgoingDesktopMarkup] = useState<string | null>(null);
  const desktopSwitchTimerRef = useRef<number | null>(null);
  const getDesktopStoreKey = useCallback((key: string) => `${key}_${activeDesktop}_${username}`, [activeDesktop, username]);

  useEffect(() => {
    const next = readDesktopSettings();
    setDesktopSettings(next);
    setActiveDesktop(next.defaultDesktop);
  }, [readDesktopSettings]);

  useEffect(() => () => {
    if (desktopSwitchTimerRef.current) window.clearTimeout(desktopSwitchTimerRef.current);
  }, []);

  const handleSaveDesktopSettings = useCallback((next: DesktopSettings) => {
    setDesktopSettings(next);
    localStorage.setItem(`desktop_settings_${username}`, JSON.stringify(next));
  }, [username]);

  const getDesktopDefinition = useCallback((desktopId: DesktopId) => desktopSettings.desktops.find(desktop => desktop.id === desktopId) || desktopSettings.desktops[0], [desktopSettings]);

  const handleReorderDesktops = useCallback((sourceId: DesktopId, targetId: DesktopId) => {
    const sourceIndex = desktopSettings.desktops.findIndex(desktop => desktop.id === sourceId);
    const targetIndex = desktopSettings.desktops.findIndex(desktop => desktop.id === targetId);
    if (sourceIndex < 0 || targetIndex < 0 || sourceIndex === targetIndex) return;
    const desktops = [...desktopSettings.desktops];
    const [source] = desktops.splice(sourceIndex, 1);
    desktops.splice(targetIndex, 0, source);
    handleSaveDesktopSettings({ ...desktopSettings, desktops });
  }, [desktopSettings, handleSaveDesktopSettings]);

  const handleAddDesktop = useCallback(() => {
    if (desktopSettings.desktops.length >= MAX_DESKTOPS) return;
    const id = `custom_${genId()}`;
    const desktop: DesktopDefinition = { id, label: `桌面 ${desktopSettings.desktops.length + 1}`, description: '自定义桌面', template: 'blank' };
    const next = { ...desktopSettings, desktops: [...desktopSettings.desktops, desktop] };
    handleSaveDesktopSettings(next);
    localStorage.setItem(`desktop_app_ids_${id}_${username}`, JSON.stringify([]));
    setActiveDesktop(id);
  }, [desktopSettings, handleSaveDesktopSettings, username]);

  const handleDeleteDesktop = useCallback((desktopId: DesktopId) => {
    if (desktopSettings.desktops.length <= 1) return;
    const desktop = getDesktopDefinition(desktopId);
    sysConfirm(`确定删除“${desktop.label}”吗？该桌面的图标布局与窗口状态将被移除。`, () => {
      const desktops = desktopSettings.desktops.filter(item => item.id !== desktopId);
      const nextActive = activeDesktop === desktopId ? (desktops[0]?.id || 'all') : activeDesktop;
      const next = { desktops, defaultDesktop: desktopSettings.defaultDesktop === desktopId ? nextActive : desktopSettings.defaultDesktop };
      handleSaveDesktopSettings(next);
      ['desktop_layout_version', 'desktop_folders', 'desktop_app_positions', 'desktop_widgets', 'desktop_app_ids'].forEach(key => localStorage.removeItem(`${key}_${desktopId}_${username}`));
      setWindows(previous => previous.filter(win => win.desktopId !== desktopId));
      delete desktopPreviewMarkupRef.current[desktopId];
      if (activeDesktop === desktopId) setActiveDesktop(nextActive);
    });
  }, [desktopSettings, activeDesktop, getDesktopDefinition, handleSaveDesktopSettings, username]);

  const handleSelectDesktop = useCallback((desktop: DesktopId) => {
    if (desktop === activeDesktop || desktopTransition !== 'idle') return;
    if (desktopSwitchTimerRef.current) window.clearTimeout(desktopSwitchTimerRef.current);
    // 离开前保留当前桌面的真实 DOM 状态，供鼠标稍后悬停预览。
    cacheCurrentPreviewRef.current();
    const currentIndex = desktopSettings.desktops.findIndex(item => item.id === activeDesktop);
    const nextIndex = desktopSettings.desktops.findIndex(item => item.id === desktop);
    setDesktopSlideDirection(nextIndex >= currentIndex ? 'forward' : 'backward');
    const currentWorkspace = workspacePreviewRef.current?.querySelector('.desktop-workspace');
    if (currentWorkspace) {
      const clone = currentWorkspace.cloneNode(true) as HTMLElement;
      clone.querySelectorAll('[data-preview-ignore]').forEach(node => node.remove());
      setOutgoingDesktopMarkup(clone.outerHTML);
    }
    setActiveDesktop(desktop);
    setDesktopTransition('in');
    desktopSwitchTimerRef.current = window.setTimeout(() => {
      setOutgoingDesktopMarkup(null);
      setDesktopTransition('idle');
    }, 380);
  }, [activeDesktop, desktopTransition, desktopSettings.desktops]);

  useEffect(() => {
    // 切换到另一个桌面时，焦点只能落在该桌面的窗口上，不能引用隐藏桌面的窗口。
    const visibleWindows = windows.filter(win => win.desktopId === activeDesktop);
    if (focusedWinId && visibleWindows.some(win => win.id === focusedWinId)) return;
    setFocusedWinId(visibleWindows.find(win => !win.isMinimized)?.id || visibleWindows[visibleWindows.length - 1]?.id || null);
  }, [activeDesktop, windows, focusedWinId]);

  // 桌面应用清单：由注册表派生（原为 35 条手写数组，其中 supply 一条长期被注释）。
  // 顺序 = desktopIndex 升序，与原数组逐位一致（已实测校验）。
  const allApps = DESKTOP_APPS.map((e) => ({
    id: e.id,
    label: e.label,
    icon: e.icon,
    color: e.color,
    category: e.desktopGroup,
  }));

  const apps = allApps.filter(a => a.id === 'profile' || canAccess(a.id as AppId));
  const [desktopAppIds, setDesktopAppIds] = useState<string[]>([]);
  const desktopApps = apps.filter(app => desktopAppIds.includes(app.id));
  const [showFavoriteManager, setShowFavoriteManager] = useState(false);

  const [folders, setFolders] = useState<Folder[]>([]);
  const [positions, setPositions] = useState<Record<string, { x: number; y: number }>>({});
  const [widgets, setWidgets] = useState<Widget[]>([]);
  const workspacePreviewRef = useRef<HTMLDivElement>(null);
  const desktopPreviewMarkupRef = useRef<Partial<Record<DesktopId, string>>>({});
  const cacheCurrentPreviewRef = useRef<() => void>(() => {});

  useEffect(() => {
    const desktop = getDesktopDefinition(activeDesktop);
    const key = `desktop_app_ids_${activeDesktop}_${username}`;
    try {
      const saved = localStorage.getItem(key);
      if (saved) { setDesktopAppIds(JSON.parse(saved)); return; }
      // 首次迁移时保留旧桌面 2 的常用应用配置。
      const legacyFavorites = activeDesktop === 'favorites' ? localStorage.getItem(getStoreKey('desktop_favorite_app_ids')) : null;
      const initialIds = legacyFavorites ? JSON.parse(legacyFavorites)
        : desktop?.template === 'all' ? allApps.map(app => app.id)
          : desktop?.template === 'favorites' ? DEFAULT_FAVORITE_APP_IDS : [];
      setDesktopAppIds(initialIds);
      localStorage.setItem(key, JSON.stringify(initialIds));
    } catch { setDesktopAppIds([]); }
  }, [activeDesktop, username, getDesktopDefinition, getStoreKey]);

  const buildDesktopPreview = useCallback((desktopId: DesktopId): HTMLElement | null => {
    let clone: HTMLElement | null = null;
    if (desktopId === activeDesktop && workspacePreviewRef.current) {
      clone = workspacePreviewRef.current.cloneNode(true) as HTMLElement;
    } else {
      const markup = desktopPreviewMarkupRef.current[desktopId];
      if (markup) {
        const holder = document.createElement('div');
        holder.innerHTML = markup;
        clone = holder.firstElementChild as HTMLElement | null;
      }
    }
    if (!clone) return null;
    clone.querySelectorAll('[data-preview-ignore]').forEach(node => node.remove());
    const scale = Math.min(266 / Math.max(1, window.innerWidth), 160 / Math.max(1, window.innerHeight));
    clone.style.cssText += `;position:absolute!important;left:0!important;top:0!important;width:${window.innerWidth}px!important;height:${window.innerHeight}px!important;min-width:${window.innerWidth}px!important;transform:scale(${scale})!important;transform-origin:top left!important;pointer-events:none!important;overflow:hidden!important;`;
    clone.setAttribute('aria-hidden', 'true');
    return clone;
  }, [activeDesktop]);

  cacheCurrentPreviewRef.current = () => {
    if (workspacePreviewRef.current) {
      const clone = workspacePreviewRef.current.cloneNode(true) as HTMLElement;
      clone.querySelectorAll('[data-preview-ignore]').forEach(node => node.remove());
      desktopPreviewMarkupRef.current[activeDesktop] = clone.outerHTML;
    }
  };

  // 内置栏目紧凑布局：栏目因无权限隐藏时，后续可见栏目自动前移并放大展示
  const builtinDisplayOffsets: Record<string, number> = {};
  let hiddenBuiltinCount = 0;
  for (const fid of BUILTIN_FOLDER_IDS) {
    const folder = folders.find(f => f.id === fid);
    const isVisible = !!folder && folder.appIds.some(pid => desktopApps.some(a => a.id === pid));
    if (isVisible) {
      builtinDisplayOffsets[fid] = hiddenBuiltinCount * GRID_COL_W * 2;
    } else {
      hiddenBuiltinCount++;
    }
  }
  const hasHiddenBuiltin = hiddenBuiltinCount > 0;
  // 内置文件夹统一使用最多三列：7–9 个应用可完整展示，避免不必要的内部滚动。
  const FOLDER_MAX_COLS: Record<string, number> = { folder_admin: 3, folder_core: 3, folder_emp: 3, folder_tools: 3 };
  // 已隐藏（无权限）的内置栏目 ID 集合：不参与同行列宽分配
  const hiddenBuiltinIds = new Set<string>();
  for (const fid of BUILTIN_FOLDER_IDS) {
    const folder = folders.find(f => f.id === fid);
    if (folder && !builtinDisplayOffsets.hasOwnProperty(fid)) hiddenBuiltinIds.add(fid);
  }

  useEffect(() => {
    const computeInitial = () => {
      const desktop = getDesktopDefinition(activeDesktop);
      if (desktop?.template === 'favorites') {
        return buildFavoriteLayout(DEFAULT_FAVORITE_APP_IDS);
      }
      if (desktop?.template === 'blank') return { pos: {}, fld: [] };
      const nextPos: Record<string, { x: number; y: number }> = {};
      const initialFolders: Folder[] = [
        { id: 'folder_admin', label: '系统配置', appIds: [], x: GRID_START_X + GRID_COL_W * 0, y: GRID_START_Y },
        { id: 'folder_core', label: '核心业务', appIds: [], x: GRID_START_X + GRID_COL_W * 2, y: GRID_START_Y },
        { id: 'folder_emp', label: '产业赋能', appIds: [], x: GRID_START_X + GRID_COL_W * 4, y: GRID_START_Y },
        { id: 'folder_tools', label: '专业工具', appIds: [], x: GRID_START_X + GRID_COL_W * 6, y: GRID_START_Y },
      ];

      allApps.forEach(app => {
        const folder = initialFolders.find(s => s.label === app.category);
        if (folder) folder.appIds.push(app.id);
        else nextPos[app.id] = DEFAULT_POSITIONS[app.id] || { x: 32, y: 32 };
      });
      return { pos: nextPos, fld: initialFolders };
    };

    const versionKey = getDesktopStoreKey('desktop_layout_version');
    const foldersKey = getDesktopStoreKey('desktop_folders');
    const positionsKey = getDesktopStoreKey('desktop_app_positions');
    const widgetsKey = getDesktopStoreKey('desktop_widgets');
    const activeTemplate = getDesktopDefinition(activeDesktop)?.template;
    const expectedLayoutVersion = activeTemplate === 'favorites' ? FAVORITE_LAYOUT_VERSION : activeTemplate === 'blank' ? CUSTOM_DESKTOP_LAYOUT_VERSION : LAYOUT_VERSION;
    let version = localStorage.getItem(versionKey);
    // 首次升级时保留原“全部应用”桌面的既有布局。
    if (activeDesktop === 'all' && !version) {
      const legacyVersion = localStorage.getItem(getStoreKey('desktop_layout_version'));
      if (legacyVersion) {
        ['desktop_layout_version', 'desktop_folders', 'desktop_app_positions', 'desktop_widgets'].forEach(key => {
          const legacyValue = localStorage.getItem(getStoreKey(key));
          if (legacyValue) localStorage.setItem(getDesktopStoreKey(key), legacyValue);
        });
        version = legacyVersion;
      }
    }
    const initial = computeInitial();

    if (version !== expectedLayoutVersion) {
      setFolders(initial.fld);
      setPositions(initial.pos);
      localStorage.setItem(versionKey, expectedLayoutVersion);
      localStorage.setItem(foldersKey, JSON.stringify(initial.fld));
      localStorage.setItem(positionsKey, JSON.stringify(initial.pos));
    } else {
      try {
        const f = localStorage.getItem(foldersKey);
        const p = localStorage.getItem(positionsKey);
        if (f) {
          const validAppIds = new Set(allApps.map(a => a.id));
          const cleanedFolders = JSON.parse(f).map((folder: Folder) => ({
            ...folder,
            appIds: folder.appIds.filter(id => validAppIds.has(id))
          }));

          // 自动补齐未分配但存在的模块到对应分类文件夹
          const assignedAppIds = new Set(cleanedFolders.flatMap((folder: Folder) => folder.appIds));
          allApps.forEach(app => {
            if (!assignedAppIds.has(app.id)) {
              const targetFolder = cleanedFolders.find((f: Folder) => f.label === app.category);
              if (targetFolder) {
                targetFolder.appIds.push(app.id);
                assignedAppIds.add(app.id);
              }
            }
          });

          setFolders(cleanedFolders);
          localStorage.setItem(foldersKey, JSON.stringify(cleanedFolders));
        } else setFolders(initial.fld);

        if (p) {
          const validAppIds = new Set(allApps.map(a => a.id));
          const parsedPos = JSON.parse(p);
          const cleanedPos = Object.fromEntries(Object.entries(parsedPos).filter(([k]) => validAppIds.has(k))) as Record<string, { x: number; y: number }>;
          setPositions(cleanedPos);
        } else setPositions(initial.pos);
      } catch {
        setFolders(initial.fld);
        setPositions(initial.pos);
      }
    }

    // 加载小组件
    try {
      const w = localStorage.getItem(widgetsKey);
      if (w) {
        const parsed = JSON.parse(w);
        const normalized = parsed.map((item: Widget) => {
          const widget = {
            ...item,
            w: item.type === 'calendar' ? Math.max(item.w, 3) : (item.w || 2),
            h: item.type === 'calendar' ? Math.max(item.h, 2) : (item.h || 1)
          };
          return { ...widget, ...constrainWidgetPosition(widget, widget) };
        });
        setWidgets(normalized);
        localStorage.setItem(widgetsKey, JSON.stringify(normalized));
      }
    } catch { }
  }, [getStoreKey, getDesktopStoreKey, activeDesktop, getDesktopDefinition]);

  useEffect(() => {
    const allowedIds = new Set(apps.map(app => app.id));
    setDesktopAppIds(prev => {
      const next = prev.filter(id => allowedIds.has(id));
      if (next.length !== prev.length) localStorage.setItem(`desktop_app_ids_${activeDesktop}_${username}`, JSON.stringify(next));
      return next;
    });
  }, [isLoading, activeDesktop, username]);


  const [userProfile, setUserProfile] = useState<{ display_name?: string; avatar_url?: string | null }>({});

  useEffect(() => {
    fetchWithAuth('/api/user/profile')
      .then(res => res.json())
      .then(data => {
        if (data.success) setUserProfile(data.data);
      })
      .catch(() => { });
  }, []);

  const DEFAULT_WALLPAPERS = [
    "url('/wallpaper.png')",
    "url('/wall2.png')",
    "url('/wall4.png')",
    "url('/wall5.png')"
  ];

  const [isWallpaperLocked, setIsWallpaperLocked] = useState<boolean>(() => {
    return localStorage.getItem(getStoreKey('wallpaper_locked')) === 'true';
  });

  const [wallpaper, setWallpaper] = useState<string>(() => {
    const custom = localStorage.getItem(getStoreKey('custom_wallpaper'));
    if (custom) return custom;
    const locked = localStorage.getItem(getStoreKey('wallpaper_locked')) === 'true';
    const savedDefault = localStorage.getItem(getStoreKey('last_default_wallpaper'));
    if (locked && savedDefault) return savedDefault;
    const random = DEFAULT_WALLPAPERS[Math.floor(Math.random() * DEFAULT_WALLPAPERS.length)];
    if (locked) localStorage.setItem(getStoreKey('last_default_wallpaper'), random);
    return random;
  });

  const wallpaperInputRef = useRef<HTMLInputElement>(null);
  const [ctxMenu, setCtxMenu] = useState<{ visible: boolean; x: number; y: number; appId?: string | null }>({ visible: false, x: 0, y: 0 });

  // 全局点击关闭桌面右键菜单
  useEffect(() => {
    if (!ctxMenu.visible) return;
    const handleGlobalClick = (e: MouseEvent) => {
      if ((e.target as HTMLElement).closest('.ctx-animate')) return;
      setCtxMenu(prev => ({ ...prev, visible: false }));
    };
    window.addEventListener('mousedown', handleGlobalClick);
    return () => window.removeEventListener('mousedown', handleGlobalClick);
  }, [ctxMenu.visible]);
  const [renameId, setRenameId] = useState<string | null>(null);

  const [pinnedApps, setPinnedApps] = useState<string[]>(() => {
    try {
      const stored = localStorage.getItem(getStoreKey('desktop_pinned_apps'));
      if (!stored) return [];
      const parsed = JSON.parse(stored);
      // 获取当前所有的合法 appId
      const validAppIds = new Set(allApps.map(a => a.id));
      return parsed.filter((id: string) => validAppIds.has(id));
    } catch { return []; }
  });

  const handleTogglePin = useCallback((id: string) => {
    setPinnedApps(prev => {
      const next = prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id];
      try { localStorage.setItem(getStoreKey('desktop_pinned_apps'), JSON.stringify(next)); } catch { }
      return next;
    });
  }, [getStoreKey]);

  const handleReorderPinned = useCallback((sourceId: string, targetId: string) => {
    setPinnedApps(prev => {
      const sourceIndex = prev.indexOf(sourceId);
      const targetIndex = prev.indexOf(targetId);
      if (sourceIndex === -1 || targetIndex === -1) return prev;
      const next = [...prev];
      const [removed] = next.splice(sourceIndex, 1);
      next.splice(targetIndex, 0, removed);
      try { localStorage.setItem(getStoreKey('desktop_pinned_apps'), JSON.stringify(next)); } catch { }
      return next;
    });
  }, [getStoreKey]);

  const [tracking, setTracking] = useState<any>(null);
  const [pinPromptApp, setPinPromptApp] = useState<any>(null);
  const [sysDialog, setSysDialog] = useState<any>(null);

  useEffect(() => {
    const handleDialog = (e: any) => setSysDialog(e.detail);
    window.addEventListener('sys-dialog', handleDialog);
    return () => window.removeEventListener('sys-dialog', handleDialog);
  }, []);
  const [lastReadDate, setLastReadDate] = useState<string | null>(null);


  const [newsStatus, setNewsStatus] = useState<any>(null);
  const [lastNewsReadDate, setLastNewsReadDate] = useState<string | null>(null);

  const [qualAlerts, setQualAlerts] = useState<any>(null);
  const [lastQualReadDate, setLastQualReadDate] = useState<string | null>(null);

  const [currentDate, setCurrentDate] = useState(new Date());
  const [showCalendar, setShowCalendar] = useState(false);

  useEffect(() => {
    const s = localStorage.getItem(getStoreKey('last_alert_read_date')); if (s) setLastReadDate(s);
    const n = localStorage.getItem(getStoreKey('last_news_read_date')); if (n) setLastNewsReadDate(n);
    const q = localStorage.getItem(getStoreKey('last_qual_read_date')); if (q) setLastQualReadDate(q);
  }, [getStoreKey]);

  useEffect(() => {
    const fetchAlerts = async () => { try { const r = await fetchWithAuth(`/api/deviation-alerts?t=${Date.now()}`); setTracking(await r.json()); } catch { } };
    const fetchNews = async () => { try { const r = await fetchWithAuth(`/api/news/latest?t=${Date.now()}`); setNewsStatus(await r.json()); } catch { } };
    const fetchQualsAlerts = async () => { try { const r = await fetchWithAuth(`/api/qualifications/alerts?t=${Date.now()}`); setQualAlerts(await r.json()); } catch { } };

    fetchAlerts(); fetchNews(); fetchQualsAlerts();
    const t = setInterval(() => { fetchAlerts(); fetchNews(); fetchQualsAlerts(); }, 60000);
    const clockT = setInterval(() => { setCurrentDate(new Date()); }, 1000);
    return () => { clearInterval(t); clearInterval(clockT); };
  }, []);

  const applyGridRules = (nextPositions: Record<string, { x: number; y: number }>, primaryId: string | null, currentFolders: Folder[], oldPos?: { x: number; y: number }, currentWidgets: Widget[] = widgets) => {
    const resolved: Record<string, { x: number; y: number }> = {};
    let appsToPlace = Object.keys(nextPositions);

    if (primaryId && nextPositions[primaryId]) {
      resolved[primaryId] = nextPositions[primaryId];
      appsToPlace = appsToPlace.filter(k => k !== primaryId);
    }

    const isSlotOccupied = (col: number, row: number, wUnits: number, hUnits: number, skipId: string) => {
      // 检查文件夹碰撞
      for (const f of currentFolders) {
        if (f.id === skipId) continue;
        const offset = builtinDisplayOffsets[f.id] || 0;
        const vX = f.x - offset;
        const maxCols = BUILTIN_FOLDER_IDS.includes(f.id) ? (FOLDER_MAX_COLS[f.id] ?? (hasHiddenBuiltin ? 6 : 4)) : 4;
        const fDim = getFolderDim({ ...f, x: vX }, maxCols);
        const fCol = Math.round((vX - GRID_START_X) / GRID_COL_W);
        const fRow = Math.round((f.y - GRID_START_Y) / GRID_ROW_H);
        if (Math.max(col, fCol) < Math.min(col + wUnits, fCol + fDim.cols) &&
          Math.max(row, fRow) < Math.min(row + hUnits, fRow + fDim.rows)) return true;
      }
      // 检查小组件碰撞
      for (const w of currentWidgets) {
        if (w.id === skipId) continue;
        const wCol = Math.round((w.x - GRID_START_X) / GRID_COL_W);
        const wRow = Math.round((w.y - GRID_START_Y) / GRID_ROW_H);
        if (Math.max(col, wCol) < Math.min(col + wUnits, wCol + w.w) &&
          Math.max(row, wRow) < Math.min(row + hUnits, wRow + w.h)) return true;
      }
      // 检查已定位图标碰撞
      for (const [rid, rp] of Object.entries(resolved)) {
        if (rid === skipId) continue;
        const iCol = Math.round((rp.x - GRID_START_X) / GRID_COL_W);
        const iRow = Math.round((rp.y - GRID_START_Y) / GRID_ROW_H);
        if (Math.max(col, iCol) < Math.min(col + wUnits, iCol + 1) &&
          Math.max(row, iRow) < Math.min(row + hUnits, iRow + 1)) return true;
      }
      return false;
    };

    appsToPlace.sort((a, b) => {
      const pa = nextPositions[a]; const pb = nextPositions[b];
      if (pa.x !== pb.x) return pa.x - pb.x;
      return pa.y - pb.y;
    });

    const safeMaxRow = Math.max(0, Math.floor((window.innerHeight - SAFE_MARGIN_BOTTOM) / GRID_ROW_H));
    const safeMaxCol = Math.max(0, Math.floor((window.innerWidth - GRID_START_X - SAFE_MARGIN_RIGHT) / GRID_COL_W));

    // 交换逻辑：如果存在 oldPos，先尝试将被挤占的图标放到 oldPos
    let availableOldCol = oldPos ? Math.round((oldPos.x - GRID_START_X) / GRID_COL_W) : -1;
    let availableOldRow = oldPos ? Math.round((oldPos.y - GRID_START_Y) / GRID_ROW_H) : -1;

    for (const id of appsToPlace) {
      let pos = nextPositions[id];
      let col = Math.round((pos.x - GRID_START_X) / GRID_COL_W);
      let row = Math.round((pos.y - GRID_START_Y) / GRID_ROW_H);

      // 如果这个位置被 primaryId 占了
      if (isSlotOccupied(col, row, 1, 1, id)) {
        if (availableOldCol !== -1 && !isSlotOccupied(availableOldCol, availableOldRow, 1, 1, id)) {
          col = availableOldCol;
          row = availableOldRow;
          availableOldCol = -1; // 用掉这个位置
        } else {
          // 正常的找空位逻辑
          while (isSlotOccupied(col, row, 1, 1, id)) {
            row++;
            if (row > safeMaxRow) { row = 0; col++; }
          }
        }
      }

      // 边界限制
      col = Math.max(0, Math.min(col, safeMaxCol));
      row = Math.max(0, Math.min(row, safeMaxRow));
      resolved[id] = { x: col * GRID_COL_W + GRID_START_X, y: row * GRID_ROW_H + GRID_START_Y };
    }
    return resolved;
  };

  const saveFolders = useCallback((flds: Folder[]) => {
    localStorage.setItem(getDesktopStoreKey('desktop_folders'), JSON.stringify(flds));
  }, [getDesktopStoreKey]);

  const handlePositionChange = useCallback((id: string, newPos: { x: number; y: number }, persist: boolean) => {
    // 0. 检查是否是小组件拖拽
    if (widgets.some(w => w.id === id)) {
      setWidgets(prev => {
        const widget = prev.find(x => x.id === id);
        if (!widget) return prev;

        const boundedPosition = constrainWidgetPosition(widget, newPos);
        let targetX = persist ? Math.round((boundedPosition.x - GRID_START_X) / GRID_COL_W) * GRID_COL_W + GRID_START_X : boundedPosition.x;
        let targetY = persist ? Math.round((boundedPosition.y - GRID_START_Y) / GRID_ROW_H) * GRID_ROW_H + GRID_START_Y : boundedPosition.y;

        if (persist) {
          let col = Math.round((targetX - GRID_START_X) / GRID_COL_W);
          let row = Math.round((targetY - GRID_START_Y) / GRID_ROW_H);
          const safeMaxRow = Math.max(0, Math.floor((window.innerHeight - SAFE_MARGIN_BOTTOM) / GRID_ROW_H));
          const safeMaxCol = Math.max(0, Math.floor((window.innerWidth - GRID_START_X - SAFE_MARGIN_RIGHT) / GRID_COL_W));

          col = Math.max(0, Math.min(col, safeMaxCol - widget.w + 1));
          row = Math.max(0, Math.min(row, safeMaxRow));

          const isWidgetSlotOccupied = (c: number, r: number, skipId: string) => {
            if (c + widget.w > safeMaxCol + 1) return true;
            for (const f of folders) {
              const offset = builtinDisplayOffsets[f.id] || 0;
              const vX = f.x - offset;
              const maxCols = BUILTIN_FOLDER_IDS.includes(f.id) ? (FOLDER_MAX_COLS[f.id] ?? (hasHiddenBuiltin ? 6 : 4)) : 4;
              const fDim = getFolderDim({ ...f, x: vX }, maxCols);
              const fCol = Math.round((vX - GRID_START_X) / GRID_COL_W);
              const fRow = Math.round((f.y - GRID_START_Y) / GRID_ROW_H);
              if (Math.max(c, fCol) < Math.min(c + widget.w, fCol + fDim.cols) &&
                Math.max(r, fRow) < Math.min(r + widget.h, fRow + fDim.rows)) return true;
            }
            for (const otherW of prev) {
              if (otherW.id === skipId) continue;
              const oCol = Math.round((otherW.x - GRID_START_X) / GRID_COL_W);
              const oRow = Math.round((otherW.y - GRID_START_Y) / GRID_ROW_H);
              if (Math.max(c, oCol) < Math.min(c + widget.w, oCol + otherW.w) &&
                Math.max(r, oRow) < Math.min(r + widget.h, oRow + otherW.h)) return true;
            }
            return false;
          };

          while (isWidgetSlotOccupied(col, row, id)) {
            row++;
            if (row > safeMaxRow) { row = 0; col++; }
            if (col + widget.w > safeMaxCol + 1) { col = 0; }
          }

          targetX = col * GRID_COL_W + GRID_START_X;
          targetY = row * GRID_ROW_H + GRID_START_Y;
        }

        const constrainedTarget = constrainWidgetPosition(widget, { x: targetX, y: targetY });
        targetX = constrainedTarget.x;
        targetY = constrainedTarget.y;

        const next = prev.map(w => w.id === id ? { ...w, x: targetX, y: targetY } : w);
        if (persist) {
          localStorage.setItem(getDesktopStoreKey('desktop_widgets'), JSON.stringify(next));
          setPositions(currentPos => {
            const visibleAppIds = desktopApps.map(a => a.id);
            const visiblePositions = Object.fromEntries(
              Object.entries(currentPos).filter(([k]) => visibleAppIds.includes(k))
            );
            return applyGridRules(visiblePositions, null, folders, { x: widget.x, y: widget.y });
          });
        }
        return next;
      });
      return;
    }

    // 1. 检查是否是文件夹拖拽
    if (id.startsWith('folder_')) {
      setFolders(prev => {
        let f = prev.find(x => x.id === id);
        if (!f) return prev;

        const offset = builtinDisplayOffsets[id] || 0;
        let visualTargetX = persist ? Math.round((newPos.x - GRID_START_X) / GRID_COL_W) * GRID_COL_W + GRID_START_X : newPos.x;
        let targetY = persist ? Math.round((newPos.y - GRID_START_Y) / GRID_ROW_H) * GRID_ROW_H + GRID_START_Y : newPos.y;

        if (persist) {
          let col = Math.round((visualTargetX - GRID_START_X) / GRID_COL_W);
          let row = Math.round((targetY - GRID_START_Y) / GRID_ROW_H);
          const safeMaxRow = Math.max(0, Math.floor((window.innerHeight - SAFE_MARGIN_BOTTOM) / GRID_ROW_H));
          const safeMaxCol = Math.max(0, Math.floor((window.innerWidth - GRID_START_X - SAFE_MARGIN_RIGHT) / GRID_COL_W));
          const maxCols = BUILTIN_FOLDER_IDS.includes(id) ? (FOLDER_MAX_COLS[id] ?? (hasHiddenBuiltin ? 6 : 4)) : 4;

          const getDimAt = (c: number) => getFolderDim({ ...f, x: c * GRID_COL_W + GRID_START_X }, maxCols);

          let dim = getDimAt(col);
          col = Math.max(0, Math.min(col, safeMaxCol - dim.cols + 1));
          row = Math.max(0, Math.min(row, safeMaxRow));
          dim = getDimAt(col);

          const isSlotOccupied = (c: number, r: number, d: { cols: number, rows: number }) => {
            if (c + d.cols > safeMaxCol + 1) return true;
            for (const otherF of prev) {
              if (otherF.id === id) continue;
              const oOffset = builtinDisplayOffsets[otherF.id] || 0;
              const oVx = otherF.x - oOffset;
              const oMaxCols = BUILTIN_FOLDER_IDS.includes(otherF.id) ? (FOLDER_MAX_COLS[otherF.id] ?? (hasHiddenBuiltin ? 6 : 4)) : 4;
              const oDim = getFolderDim({ ...otherF, x: oVx }, oMaxCols);
              const oCol = Math.round((oVx - GRID_START_X) / GRID_COL_W);
              const oRow = Math.round((otherF.y - GRID_START_Y) / GRID_ROW_H);
              if (Math.max(c, oCol) < Math.min(c + d.cols, oCol + oDim.cols) &&
                Math.max(r, oRow) < Math.min(r + d.rows, oRow + oDim.rows)) return true;
            }
            return false;
          };

          while (isSlotOccupied(col, row, dim)) {
            row++;
            if (row > safeMaxRow) { row = 0; col++; }
            dim = getDimAt(col);
            if (col + dim.cols > safeMaxCol + 1) { col = 0; dim = getDimAt(col); }
          }

          visualTargetX = col * GRID_COL_W + GRID_START_X;
          targetY = row * GRID_ROW_H + GRID_START_Y;
        }

        const targetXState = visualTargetX + offset;
        const next = prev.map(x => x.id === id ? { ...x, x: targetXState, y: targetY } : x);
        if (persist) {
          saveFolders(next);
          setPositions(currentPos => {
            const visibleAppIds = desktopApps.map(a => a.id);
            const visiblePositions = Object.fromEntries(
              Object.entries(currentPos).filter(([k]) => visibleAppIds.includes(k))
            );
            return applyGridRules(visiblePositions, null, next, { x: f.x, y: f.y });
          });
        }
        return next;
      });
      return;
    }

    // 2. 正常图标拖拽
    setPositions(prev => {
      if (!persist) return { ...prev, [id]: newPos };

      const snappedPos = snapToGrid(Math.max(GRID_START_X, newPos.x), Math.max(GRID_START_Y, newPos.y));

      // 使用当前的 folders 状态判断目标文件夹
      const targetFolder = folders.find(f => {
        const offset = builtinDisplayOffsets[f.id] || 0;
        const vX = f.x - offset;
        const maxCols = BUILTIN_FOLDER_IDS.includes(f.id) ? (FOLDER_MAX_COLS[f.id] ?? (hasHiddenBuiltin ? 6 : 4)) : 4;
        const dim = getFolderDim({ ...f, x: vX }, maxCols);
        const folderW = GRID_COL_W * dim.cols;
        const folderH = GRID_ROW_H * dim.rows;
        const iconCenterX = snappedPos.x + GRID_COL_W / 2;
        const iconCenterY = snappedPos.y + GRID_ROW_H / 2;
        return iconCenterX >= vX && iconCenterX < vX + folderW && iconCenterY >= f.y && iconCenterY < f.y + folderH;
      });

      if (targetFolder) {
        setFolders(flds => {
          const updated = flds.map(f => f.id === targetFolder.id ? { ...f, appIds: [...new Set([...f.appIds, id])] } : f);
          const fMaxColsMap = Object.fromEntries(
            updated.map(f => [f.id, BUILTIN_FOLDER_IDS.includes(f.id) ? (FOLDER_MAX_COLS[f.id] ?? (hasHiddenBuiltin ? 6 : 4)) : 4])
          );
          const resolved = resolveFolderCollisions(updated, builtinDisplayOffsets, fMaxColsMap);
          saveFolders(resolved);
          return resolved;
        });

        const { [id]: _, ...rest } = prev;
        localStorage.setItem(getDesktopStoreKey('desktop_app_positions'), JSON.stringify(rest));
        return rest;
      }

      // 正常的桌面网格逻辑
      const visibleAppIds = desktopApps.map(a => a.id);
      const visiblePositions = Object.fromEntries(
        Object.entries({ ...prev, [id]: snappedPos }).filter(([k]) => visibleAppIds.includes(k))
      );
      const finalPos = applyGridRules(visiblePositions, id, folders, prev[id]);
      const nextAll = { ...prev, ...finalPos };
      localStorage.setItem(getDesktopStoreKey('desktop_app_positions'), JSON.stringify(nextAll));
      return nextAll;
    });
  }, [getDesktopStoreKey, desktopApps, saveFolders, folders, positions]);

  const handleRenameFolder = useCallback((folderId: string, newName: string) => {
    setFolders(prev => {
      const next = prev.map(f => f.id === folderId ? { ...f, label: newName } : f);
      saveFolders(next);
      return next;
    });
  }, [saveFolders]);

  const handleMoveOutOfFolder = useCallback((appId: string, folderId: string, dropX: number, dropY: number) => {
    const finalPos = snapToGrid(dropX, dropY);

    const targetFolder = folders.find(f => {
      if (f.id === folderId) return false;
      const offset = builtinDisplayOffsets[f.id] || 0;
      const vX = f.x - offset;
      const maxCols = BUILTIN_FOLDER_IDS.includes(f.id) ? (FOLDER_MAX_COLS[f.id] ?? (hasHiddenBuiltin ? 6 : 4)) : 4;
      const dim = getFolderDim({ ...f, x: vX }, maxCols);
      const folderW = GRID_COL_W * dim.cols;
      const folderH = GRID_ROW_H * dim.rows;
      return dropX >= vX && dropX < vX + folderW && dropY >= f.y && dropY < f.y + folderH;
    });

    if (targetFolder) {
      setFolders(prev => {
        const next = prev.map(f => {
          if (f.id === folderId) return { ...f, appIds: f.appIds.filter(id => id !== appId) };
          if (f.id === targetFolder.id) return { ...f, appIds: [...new Set([...f.appIds, appId])] };
          return f;
        });
        const fMaxColsMap = Object.fromEntries(
          next.map(f => [f.id, BUILTIN_FOLDER_IDS.includes(f.id) ? (FOLDER_MAX_COLS[f.id] ?? (hasHiddenBuiltin ? 6 : 4)) : 4])
        );
        const resolved = resolveFolderCollisions(next, builtinDisplayOffsets, fMaxColsMap);
        saveFolders(resolved);
        return resolved;
      });
      return;
    }

    setFolders(prev => {
      const next = prev.map(f => f.id === folderId ? { ...f, appIds: f.appIds.filter(id => id !== appId) } : f);
      const fMaxColsMap = Object.fromEntries(
        next.map(f => [f.id, BUILTIN_FOLDER_IDS.includes(f.id) ? (FOLDER_MAX_COLS[f.id] ?? (hasHiddenBuiltin ? 6 : 4)) : 4])
      );
      const resolved = resolveFolderCollisions(next, builtinDisplayOffsets, fMaxColsMap);
      saveFolders(resolved);
      return resolved;
    });
    setPositions(prev => {
      const next = { ...prev, [appId]: finalPos };
      localStorage.setItem(getDesktopStoreKey('desktop_app_positions'), JSON.stringify(next));
      return next;
    });
  }, [getDesktopStoreKey, saveFolders, folders]);

  const handleMoveBetweenFolders = useCallback((appId: string, sourceFolderId: string, targetFolderId: string) => {
    if (sourceFolderId === targetFolderId) return;
    setFolders(prev => {
      const next = prev.map(folder => {
        if (folder.id === sourceFolderId) return { ...folder, appIds: folder.appIds.filter(id => id !== appId) };
        if (folder.id === targetFolderId) return { ...folder, appIds: [...new Set([...folder.appIds, appId])] };
        return folder;
      });
      const resolved = resolveFolderCollisions(next);
      saveFolders(resolved);
      return resolved;
    });
  }, [saveFolders]);

  const handleCreateFolder = useCallback((x: number, y: number) => {
    const folderId = `folder_${genId()}`;
    const snapped = snapToGrid(x, y);
    const newFolder: Folder = {
      id: folderId,
      label: '新建文件夹',
      appIds: [],
      x: snapped.x,
      y: snapped.y
    };

    setFolders(prev => {
      const next = [...prev, newFolder];
      saveFolders(next);
      return next;
    });
    // 创建后立即进入重命名模式
    setRenameId(folderId);
  }, [saveFolders]);

  const handleDeleteFolder = useCallback((folderId: string) => {
    sysConfirm('确定要删除此文件夹吗？其中的应用图标将返回桌面。', () => {
      setFolders(prev => {
        const folder = prev.find(f => f.id === folderId);
        if (folder && folder.appIds.length > 0) {
          // 将文件夹内的应用移回桌面
          setPositions(posPrev => {
            const nextPos = { ...posPrev };
            // 根据文件夹位置估算一个起始区域
            folder.appIds.forEach((appId, idx) => {
              const colOffset = idx % 3;
              const rowOffset = Math.floor(idx / 3);
              nextPos[appId] = snapToGrid(folder.x + colOffset * GRID_COL_W, folder.y + rowOffset * GRID_ROW_H);
            });
            const visibleAppIds = desktopApps.map(a => a.id);
            const visiblePositions = Object.fromEntries(
              Object.entries(nextPos).filter(([k]) => visibleAppIds.includes(k))
            );
            const finalPos = applyGridRules(visiblePositions, null, prev.filter(f => f.id !== folderId));
            const nextAll = { ...posPrev, ...finalPos };
            localStorage.setItem(getDesktopStoreKey('desktop_app_positions'), JSON.stringify(nextAll));
            return nextAll;
          });
        }
        const next = prev.filter(f => f.id !== folderId);
        saveFolders(next);
        return next;
      });
    });
  }, [saveFolders, desktopApps, getDesktopStoreKey]);

  const handleAddWidget = useCallback((type: 'clock' | 'weather' | 'calendar', x: number, y: number) => {
    const snapped = snapToGrid(x, y);
    const w = type === 'calendar' ? 3 : 2;
    const h = type === 'calendar' ? 2 : 1;

    const newWidget: Widget = {
      id: `widget_${genId()}`,
      type,
      x: snapped.x,
      y: snapped.y,
      w, h
    };
    Object.assign(newWidget, constrainWidgetPosition(newWidget, newWidget));

    setWidgets(prev => {
      const next = [...prev, newWidget];
      localStorage.setItem(getDesktopStoreKey('desktop_widgets'), JSON.stringify(next));
      return next;
    });

    // 添加后重排图标
    setPositions(currentPos => {
      const visibleAppIds = desktopApps.map(a => a.id);
      const visiblePositions = Object.fromEntries(
        Object.entries(currentPos).filter(([k]) => visibleAppIds.includes(k))
      );
      return applyGridRules(visiblePositions, null, folders);
    });
  }, [getDesktopStoreKey, desktopApps, folders]);

  const handleRemoveWidget = useCallback((id: string) => {
    setWidgets(prev => {
      const next = prev.filter(w => w.id !== id);
      localStorage.setItem(getDesktopStoreKey('desktop_widgets'), JSON.stringify(next));
      return next;
    });
  }, [getDesktopStoreKey]);

  const handleAlignToGrid = useCallback(() => {
    let nextWidgets = widgets;
    setWidgets(prev => {
      let changed = false;
      const safeMaxRow = Math.max(0, Math.floor((window.innerHeight - SAFE_MARGIN_BOTTOM) / GRID_ROW_H));
      const safeMaxCol = Math.max(0, Math.floor((window.innerWidth - GRID_START_X - SAFE_MARGIN_RIGHT) / GRID_COL_W));
      const next = prev.map(w => {
        let col = Math.round((w.x - GRID_START_X) / GRID_COL_W);
        let row = Math.round((w.y - GRID_START_Y) / GRID_ROW_H);
        let newCol = Math.max(0, Math.min(col, safeMaxCol - w.w + 1));
        let newRow = Math.max(0, Math.min(row, safeMaxRow));
        if (newCol !== col || newRow !== row) {
          changed = true;
          return { ...w, x: newCol * GRID_COL_W + GRID_START_X, y: newRow * GRID_ROW_H + GRID_START_Y };
        }
        return w;
      });
      if (changed) {
        localStorage.setItem(getDesktopStoreKey('desktop_widgets'), JSON.stringify(next));
      }
      nextWidgets = next;
      return next;
    });

    let nextFolders = folders;
    setFolders(prev => {
      const fMaxColsMap = Object.fromEntries(
        prev.map(f => [f.id, BUILTIN_FOLDER_IDS.includes(f.id) ? (FOLDER_MAX_COLS[f.id] ?? (hasHiddenBuiltin ? 6 : 4)) : 4])
      );
      const resolved = resolveFolderCollisions(prev, builtinDisplayOffsets, fMaxColsMap);
      saveFolders(resolved);
      nextFolders = resolved;
      return resolved;
    });

    setPositions(prev => {
      const visibleAppIds = desktopApps.map(a => a.id);
      const visiblePositions = Object.fromEntries(
        Object.entries(prev).filter(([k]) => visibleAppIds.includes(k))
      );

      Object.keys(visiblePositions).forEach(k => {
        const p = visiblePositions[k];
        visiblePositions[k] = snapToGrid(p.x, p.y);
      });

      const finalPos = applyGridRules(visiblePositions, null, nextFolders, undefined, nextWidgets);
      try {
        const nextAll = { ...prev, ...finalPos };
        localStorage.setItem(getDesktopStoreKey('desktop_app_positions'), JSON.stringify(nextAll));
      } catch { }
      return { ...prev, ...finalPos };
    });
  }, [getDesktopStoreKey, desktopApps, folders, widgets, builtinDisplayOffsets, hasHiddenBuiltin]);

  useEffect(() => {
    const timer = setTimeout(() => handleAlignToGrid(), 500);
    window.addEventListener('resize', handleAlignToGrid);
    return () => {
      clearTimeout(timer);
      window.removeEventListener('resize', handleAlignToGrid);
    };
  }, [handleAlignToGrid]);

  const hasNewData = tracking?.last_tracking_date && tracking.last_tracking_date !== lastReadDate && tracking.unread_alerts > 0;
  const [taskDoneApps, setTaskDoneApps] = useState<Set<string>>(new Set());

  const hasUnreadQualAlerts = qualAlerts?.unread_alerts > 0;
  const hasNewQualAlerts = qualAlerts?.last_update && new Date(qualAlerts.last_update).getTime() > new Date(lastQualReadDate || 0).getTime() && hasUnreadQualAlerts;

  useEffect(() => {
    if (hasNewQualAlerts && qualAlerts) {
      const notifiedKey = localStorage.getItem(getStoreKey('qual_notified_hash'));
      if (notifiedKey !== qualAlerts.last_update) {
        fetchWithAuth('/api/notifications', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            appId: 'qualification',
            appName: '资质管理',
            title: '资质提醒',
            message: `系统为您检测到当前共有 ${qualAlerts.unread_alerts} 份员工挂靠资质产品即将过期或已失效，请您及时进入系统跟进处理。`
          })
        }).then(() => fetchNotifications());
        try { localStorage.setItem(getStoreKey('qual_notified_hash'), qualAlerts.last_update); } catch { }
      }
    }
  }, [hasNewQualAlerts, qualAlerts, getStoreKey, fetchNotifications]);

  const handleTaskDone = useCallback((e: Event) => {
    const detail = (e as CustomEvent).detail;
    const appId = detail?.appId;
    const app = apps.find(a => a.id === appId);
    const appName = app?.label || '系统应用';

    setTaskDoneApps(prev => new Set([...prev, appId]));

    fetchWithAuth('/api/notifications', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        appId: appId,
        appName: appName,
        title: 'AI 任务已完成',
        message: `${appName} 任务已处理完毕，请点击查看结果。`
      })
    }).then(() => fetchNotifications());
  }, [apps, fetchNotifications]);

  useEffect(() => {
    window.addEventListener('app-task-done', handleTaskDone);
    return () => window.removeEventListener('app-task-done', handleTaskDone);
  }, [handleTaskDone]);

  const createWindow = useCallback((tabs: ModuleType[], activeTab: ModuleType): WinInst => ({
    id: genId(), desktopId: activeDesktop, tabs, activeTab, isMinimized: false, isMaximized: false,
    posX: Math.max(0, (window.innerWidth - window.innerWidth * 0.85) / 2 + (Math.random() * 40 - 20)),
    posY: Math.max(0, (window.innerHeight - window.innerHeight * 0.82) / 2 + (Math.random() * 40 - 20)),
  }), [activeDesktop]);

  const handleOpenApp = useCallback((id: ModuleType) => {
    setTaskDoneApps(prev => { const next = new Set(prev); next.delete(id); return next; });
    if (id === 'prediction' && tracking?.last_tracking_date) {
      localStorage.setItem(getStoreKey('last_alert_read_date'), tracking.last_tracking_date);
      setLastReadDate(tracking.last_tracking_date);
    }
    if (id === 'news' && newsStatus?.lastUpdate) {
      localStorage.setItem(getStoreKey('last_news_read_date'), newsStatus.lastUpdate);
      setLastNewsReadDate(newsStatus.lastUpdate);
    }
    if (id === 'qualification' && qualAlerts?.last_update) {
      localStorage.setItem(getStoreKey('last_qual_read_date'), qualAlerts.last_update);
      setLastQualReadDate(qualAlerts.last_update);
    }
    setWindows(prev => {
      const desktopWindows = prev.filter(w => w.desktopId === activeDesktop);
      const existingWin = desktopWindows.find(w => w.tabs.includes(id));
      if (existingWin) {
        setFocusedWinId(existingWin.id);
        return prev.map(w => w.id === existingWin.id ? { ...w, activeTab: id, isMinimized: false } : w);
      }
      if (desktopWindows.length === 0) {
        const nw = createWindow([id], id);
        setFocusedWinId(nw.id);
        return [nw];
      }
      const targetWin = desktopWindows.find(w => w.id === focusedWinId) || desktopWindows[desktopWindows.length - 1];
      setFocusedWinId(targetWin.id);
      return prev.map(w => w.id === targetWin.id ? { ...w, tabs: [...w.tabs, id], activeTab: id, isMinimized: false } : w);
    });
  }, [tracking, focusedWinId, createWindow, getStoreKey, newsStatus, activeDesktop]);

  const handleCloseTab = useCallback((winId: string, tabId: ModuleType, e: React.MouseEvent) => {
    e.stopPropagation();
    setWindows(prev => {
      const result = prev.reduce<WinInst[]>((acc, w) => {
        if (w.id !== winId) { acc.push(w); return acc; }
        const newTabs = w.tabs.filter(t => t !== tabId);
        if (newTabs.length === 0) {
          if (winId === focusedWinId) setFocusedWinId(null);
          return acc;
        }
        const newActive = w.activeTab === tabId ? newTabs[newTabs.length - 1] : w.activeTab;
        acc.push({ ...w, tabs: newTabs, activeTab: newActive });
        return acc;
      }, []);
      if (winId === focusedWinId && result.length > 0) {
        setFocusedWinId(result[result.length - 1].id);
      }
      return result;
    });
  }, [focusedWinId]);

  const handleReorderTabs = useCallback((winId: string, newTabs: ModuleType[]) => {
    setWindows(prev => prev.map(w => w.id === winId ? { ...w, tabs: newTabs } : w));
  }, []);

  const handleDetachTab = useCallback((tabId: ModuleType, fromWinId: string, cx: number, cy: number) => {
    setWindows(prev => {
      const source = prev.find(w => w.id === fromWinId);
      if (!source || source.tabs.length <= 1) return prev;
      const newTabs = source.tabs.filter(t => t !== tabId);
      const newActive = source.activeTab === tabId ? newTabs[newTabs.length - 1] : source.activeTab;
      const newWin: WinInst = { id: genId(), desktopId: source.desktopId, tabs: [tabId], activeTab: tabId, isMinimized: false, isMaximized: false, posX: Math.max(0, cx - 300), posY: Math.max(0, cy - 22) };
      setFocusedWinId(newWin.id);
      return [...prev.map(w => w.id === fromWinId ? { ...w, tabs: newTabs, activeTab: newActive } : w), newWin];
    });
  }, []);

  const handleReceiveTab = useCallback((tabId: ModuleType, fromWinId: string, dropIdx: number, toWinId: string) => {
    setWindows(prev => {
      let result = prev.map(w => {
        if (w.id === fromWinId) {
          const newTabs = w.tabs.filter(t => t !== tabId);
          return { ...w, tabs: newTabs, activeTab: w.activeTab === tabId ? (newTabs[0] ?? null) : w.activeTab };
        }
        if (w.id === toWinId) {
          const deduplicated = w.tabs.filter(t => t !== tabId);
          const insertAt = Math.min(dropIdx, deduplicated.length);
          deduplicated.splice(insertAt, 0, tabId);
          return { ...w, tabs: deduplicated, activeTab: tabId };
        }
        return w;
      });
      result = result.filter(w => w.tabs.length > 0);
      return result;
    });
  }, []);

  const handleDockAction = useCallback((action: string, appId: string | null) => {
    if (!appId) return;
    const id = appId as ModuleType;
    if (action === 'close') {
      setWindows(prev => prev.reduce<WinInst[]>((acc, w) => {
        if (w.desktopId !== activeDesktop || !w.tabs.includes(id)) { acc.push(w); return acc; }
        const newTabs = w.tabs.filter(t => t !== id);
        if (newTabs.length === 0) return acc;
        const newActive = w.activeTab === id ? newTabs[newTabs.length - 1] : w.activeTab;
        acc.push({ ...w, tabs: newTabs, activeTab: newActive });
        return acc;
      }, []));
    } else if (action === 'minimize') {
      setWindows(prev => prev.map(w => w.desktopId === activeDesktop && w.tabs.includes(id) ? { ...w, isMinimized: true } : w));
    } else if (action === 'show') {
      setWindows(prev => prev.map(w => w.desktopId === activeDesktop && w.tabs.includes(id) ? { ...w, isMinimized: false, activeTab: id } : w));
      const win = windows.find(w => w.desktopId === activeDesktop && w.tabs.includes(id));
      if (win) setFocusedWinId(win.id);
    }
  }, [windows, activeDesktop]);

  const handleToggleWallpaperLock = useCallback(() => {
    setIsWallpaperLocked(prev => {
      const next = !prev;
      localStorage.setItem(getStoreKey('wallpaper_locked'), next ? 'true' : 'false');
      if (next) localStorage.setItem(getStoreKey('last_default_wallpaper'), wallpaper);
      return next;
    });
  }, [wallpaper, getStoreKey]);

  const handleResetLayout = useCallback(() => {
    if (getDesktopDefinition(activeDesktop)?.template === 'favorites') {
      const nextIds = DEFAULT_FAVORITE_APP_IDS.filter(id => apps.some(app => app.id === id));
      const layout = buildFavoriteLayout(nextIds);
      setDesktopAppIds(nextIds);
      setFolders(layout.fld);
      setPositions(layout.pos);
      setWidgets([]);
      localStorage.setItem(`desktop_app_ids_${activeDesktop}_${username}`, JSON.stringify(nextIds));
      localStorage.setItem(getDesktopStoreKey('desktop_folders'), JSON.stringify(layout.fld));
      localStorage.setItem(getDesktopStoreKey('desktop_app_positions'), JSON.stringify(layout.pos));
      localStorage.setItem(getDesktopStoreKey('desktop_widgets'), JSON.stringify([]));
      return;
    }
    const nextPos: Record<string, { x: number; y: number }> = {};
    const initialFolders: Folder[] = [
      { id: 'folder_admin', label: '系统配置', appIds: [], x: GRID_START_X + GRID_COL_W * 0, y: GRID_START_Y },
      { id: 'folder_core', label: '核心业务', appIds: [], x: GRID_START_X + GRID_COL_W * 2, y: GRID_START_Y },
      { id: 'folder_emp', label: '产业赋能', appIds: [], x: GRID_START_X + GRID_COL_W * 4, y: GRID_START_Y },
      { id: 'folder_tools', label: '专业工具', appIds: [], x: GRID_START_X + GRID_COL_W * 6, y: GRID_START_Y },
    ];

    allApps.forEach(app => {
      if (app.id === 'review_partner') {
        initialFolders.find(f => f.id === 'folder_core')!.appIds.push(app.id);
        return;
      }
      const folder = initialFolders.find(s => s.label === app.category);
      if (folder) folder.appIds.push(app.id);
      else nextPos[app.id] = DEFAULT_POSITIONS[app.id] || { x: 32, y: 32 };
    });

    setFolders(initialFolders);
    setPositions(nextPos);
    try {
      localStorage.setItem(getDesktopStoreKey('desktop_folders'), JSON.stringify(initialFolders));
      localStorage.setItem(getDesktopStoreKey('desktop_app_positions'), JSON.stringify(nextPos));
    } catch { }
  }, [activeDesktop, apps, getStoreKey, getDesktopStoreKey, allApps, getDesktopDefinition, username]);

  const handleToggleDesktopApp = useCallback((appId: string) => {
    const isSelected = desktopAppIds.includes(appId);
    const nextIds = isSelected ? desktopAppIds.filter(id => id !== appId) : [...desktopAppIds, appId];
    setDesktopAppIds(nextIds);
    localStorage.setItem(`desktop_app_ids_${activeDesktop}_${username}`, JSON.stringify(nextIds));
    if (getDesktopDefinition(activeDesktop)?.template === 'favorites') {
      const layout = buildFavoriteLayout(nextIds);
      setFolders(layout.fld);
      setPositions(layout.pos);
      localStorage.setItem(getDesktopStoreKey('desktop_folders'), JSON.stringify(layout.fld));
      localStorage.setItem(getDesktopStoreKey('desktop_app_positions'), JSON.stringify(layout.pos));
    } else if (!isSelected) {
      const slot = nextIds.length - 1;
      const position = { x: GRID_START_X + (slot % 7) * GRID_COL_W, y: GRID_START_Y + Math.floor(slot / 7) * GRID_ROW_H };
      setPositions(previous => {
        const next = { ...previous, [appId]: position };
        localStorage.setItem(getDesktopStoreKey('desktop_app_positions'), JSON.stringify(next));
        return next;
      });
    }
  }, [desktopAppIds, activeDesktop, username, getDesktopDefinition, getDesktopStoreKey]);

  const handleRestoreFavoriteLayout = useCallback(() => {
    const nextIds = DEFAULT_FAVORITE_APP_IDS.filter(id => apps.some(app => app.id === id));
    const layout = buildFavoriteLayout(nextIds);
    setDesktopAppIds(nextIds);
    setFolders(layout.fld);
    setPositions(layout.pos);
    setWidgets([]);
    localStorage.setItem(`desktop_app_ids_${activeDesktop}_${username}`, JSON.stringify(nextIds));
    localStorage.setItem(getDesktopStoreKey('desktop_folders'), JSON.stringify(layout.fld));
    localStorage.setItem(getDesktopStoreKey('desktop_app_positions'), JSON.stringify(layout.pos));
    localStorage.setItem(getDesktopStoreKey('desktop_widgets'), JSON.stringify([]));
  }, [apps, getDesktopStoreKey, activeDesktop, username]);

  const handleOrganizeFavoriteLayout = useCallback(() => {
    const layout = buildFavoriteLayout(desktopAppIds);
    setFolders(layout.fld);
    setPositions(layout.pos);
    localStorage.setItem(getDesktopStoreKey('desktop_folders'), JSON.stringify(layout.fld));
    localStorage.setItem(getDesktopStoreKey('desktop_app_positions'), JSON.stringify(layout.pos));
  }, [desktopAppIds, getDesktopStoreKey]);

  const handleWallpaperChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 4 * 1024 * 1024) { sysAlert('图片文件过大（请选择 4MB 以内的图片）'); return; }
    const reader = new FileReader();
    reader.onload = ev => {
      const dataUrl = ev.target?.result as string;
      setWallpaper(`url("${dataUrl}")`);
      try { localStorage.setItem(getStoreKey('custom_wallpaper'), `url("${dataUrl}")`); } catch { sysAlert('壁纸保存失败（存储空间不足）'); }
    };
    reader.readAsDataURL(file);
    e.target.value = '';
  };
  const handleResetWallpaper = () => {
    const random = DEFAULT_WALLPAPERS[Math.floor(Math.random() * DEFAULT_WALLPAPERS.length)];
    setWallpaper(random);
    localStorage.removeItem(getStoreKey('custom_wallpaper'));
    if (isWallpaperLocked) localStorage.setItem(getStoreKey('last_default_wallpaper'), random);
  };

  const activeWindows = windows.filter(w => w.desktopId === activeDesktop);
  const allOpenTabIds = [...new Set(activeWindows.flatMap(w => w.tabs))];

  const renderBadge = (id: string) => {
    if (taskDoneApps.has(id)) {
      return (
        <span className="absolute -top-2 -right-2 bg-emerald-500 text-white text-[16px] w-7 h-7 rounded-full font-bold shadow-lg border-2 border-slate-900 z-10 animate-bounce flex items-center justify-center">
          ✓
        </span>
      );
    }
    if (id === 'prediction') return renderPredictionBadge(true);
    if (id === 'news') return renderNewsBadge();
    if (id === 'qualification') return renderQualBadge();
    return null;
  };

  const renderPredictionBadge = (bounce = false) => {
    if (hasNewData) return <span className={`absolute -top-2.5 -right-2.5 bg-red-500 text-white text-[12px] leading-none px-2 py-1 rounded-full font-bold shadow-lg border-2 border-slate-900 z-10 ${bounce ? 'animate-bounce' : ''}`}>NEW</span>;
    return null;
  };

  const hasNewNews = newsStatus?.lastUpdate && newsStatus.lastUpdate !== lastNewsReadDate;

  const renderNewsBadge = () => {
    if (hasNewNews) return <span className="absolute -top-2.5 -right-2.5 bg-red-500 text-white text-[12px] leading-none px-2 py-1 rounded-full font-bold shadow-lg border-2 border-slate-900 z-10 animate-bounce">NEW</span>;
    return null;
  };

  const renderQualBadge = () => {
    if (hasNewQualAlerts) return <span className="absolute -top-2.5 -right-2.5 bg-rose-500 text-white text-[12px] leading-none px-2 py-1 rounded-full font-bold shadow-lg border-2 border-slate-900 z-10 animate-[bounce_1s_infinite]">NEW</span>;
    if (hasUnreadQualAlerts) return <span className="absolute -top-1 -right-1 w-5 h-5 bg-rose-500 rounded-full border-2 border-slate-900 shadow-md"></span>;
    return null;
  };

  return (
    <div ref={workspacePreviewRef} data-workspace-preview-root className="w-full h-screen overflow-hidden flex flex-col relative bg-slate-900 bg-cover bg-center"
      style={{ backgroundImage: wallpaper }} onClick={() => { setCtxMenu(m => ({ ...m, visible: false })); setShowCalendar(false); }}>
      <style>{`
        @keyframes windowPop { 0%{opacity:0;scale:0.95} 100%{opacity:1;scale:1} }
        .window-animate { animation: windowPop 0.25s cubic-bezier(0.16,1,0.3,1) forwards; }
        @keyframes ctxFade { 0%{opacity:0;transform:scale(0.95) translateY(-4px)} 100%{opacity:1;transform:scale(1) translateY(0)} }
        .ctx-animate { animation: ctxFade 0.12s ease forwards; }
        @keyframes dockBounce { 0%,100%{transform:translateY(0)} 30%{transform:translateY(-18px)} 60%{transform:translateY(-8px)} 80%{transform:translateY(-14px)} }
        .dock-bounce { animation: dockBounce 0.65s cubic-bezier(0.36,0.07,0.19,0.97) forwards; }
        @keyframes iconClick { 0% { transform: scale(1); } 50% { transform: scale(0.85); } 100% { transform: scale(1); } }
        .icon-click-anim { animation: iconClick 0.2s cubic-bezier(0.4, 0, 0.2, 1); }
        @keyframes shimmer { 0% { transform: translateX(-100%); } 100% { transform: translateX(100%); } }
        @keyframes desktopSlideInForward { from { transform: translate3d(100%, 0, 0); } to { transform: translate3d(0, 0, 0); } }
        @keyframes desktopSlideInBackward { from { transform: translate3d(-100%, 0, 0); } to { transform: translate3d(0, 0, 0); } }
        @keyframes desktopSlideOutForward { from { transform: translate3d(0, 0, 0); } to { transform: translate3d(-100%, 0, 0); } }
        @keyframes desktopSlideOutBackward { from { transform: translate3d(0, 0, 0); } to { transform: translate3d(100%, 0, 0); } }
        .desktop-workspace { will-change: transform; }
        .desktop-workspace-in-forward { animation: desktopSlideInForward 380ms cubic-bezier(0.22, 0.76, 0.26, 1) both; }
        .desktop-workspace-in-backward { animation: desktopSlideInBackward 380ms cubic-bezier(0.22, 0.76, 0.26, 1) both; }
        .desktop-workspace-out-forward { animation: desktopSlideOutForward 380ms cubic-bezier(0.22, 0.76, 0.26, 1) both; }
        .desktop-workspace-out-backward { animation: desktopSlideOutBackward 380ms cubic-bezier(0.22, 0.76, 0.26, 1) both; }
                .custom-scroll::-webkit-scrollbar { width: 6px; }
                .custom-scroll::-webkit-scrollbar-track { background: transparent; }
                .custom-scroll::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.15); border-radius: 999px; }
                .custom-scroll::-webkit-scrollbar-thumb:hover { background: rgba(255,255,255,0.3); }
      `}</style>

      <input ref={wallpaperInputRef} type="file" accept="image/*" className="hidden" onChange={handleWallpaperChange} />

      {outgoingDesktopMarkup && <div className={`absolute inset-x-0 top-0 bottom-16 z-20 overflow-hidden pointer-events-none desktop-workspace-out-${desktopSlideDirection}`} aria-hidden="true" dangerouslySetInnerHTML={{ __html: outgoingDesktopMarkup }} />}
      <main key={activeDesktop} className={`desktop-workspace flex-1 relative z-10 w-full h-[calc(100%-64px)] pb-10 text-left ${desktopTransition === 'in' ? `desktop-workspace-in-${desktopSlideDirection}` : ''}`}
        onContextMenu={e => { e.preventDefault(); setCtxMenu({ visible: true, x: e.clientX, y: e.clientY }); }}
        onDragOver={e => e.preventDefault()}
        onDrop={e => {
          e.preventDefault();
          try {
            const data = JSON.parse(e.dataTransfer.getData('text/plain'));
            if (data.appId && data.fromFolderId) {
              handleMoveOutOfFolder(data.appId, data.fromFolderId, e.clientX, e.clientY);
            }
          } catch { }
        }}>
        {isLoading ? (
          <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
            <Loader2 className="w-10 h-10 text-white/50 animate-spin" />
            <span className="text-white/60 text-sm mt-4 tracking-widest uppercase animate-pulse">Loading Workspace...</span>
          </div>
        ) : (
          <>

            {/* 渲染大文件夹容器 */}
            {folders.map(folder => {
              // 内置栏目文件夹：若其下所有应用均无访问权限，则隐藏该栏目（自建文件夹不受影响）
              const isBuiltinFolder = BUILTIN_FOLDER_IDS.includes(folder.id);
              if (isBuiltinFolder && !folder.appIds.some(id => desktopApps.some(a => a.id === id))) {
                return null;
              }
              // 有内置栏目隐藏时：可见栏目前移到空位（displayOffset），并放大列数上限（maxCols）
              const displayOffset = isBuiltinFolder ? (builtinDisplayOffsets[folder.id] ?? 0) : 0;
              const folderMaxCols = isBuiltinFolder ? (FOLDER_MAX_COLS[folder.id] ?? (hasHiddenBuiltin ? 6 : 4)) : 4;
              return (
                <DesktopFolder
                  key={folder.id}
                  folder={folder}
                  apps={desktopApps}
                  folders={folders}
                  displayOffset={displayOffset}
                  maxCols={folderMaxCols}
                  hiddenFolderIds={hiddenBuiltinIds}
                  badgeNodeRenderer={renderBadge}
                  onPositionChange={handlePositionChange}
                  onOpenApp={handleOpenApp}
                  onMoveApp={handleMoveBetweenFolders}
                  onRename={handleRenameFolder}
                  renameId={renameId}
                  onRenameHandled={() => setRenameId(null)}
                  onContextMenu={(e: React.MouseEvent) => {
                    e.preventDefault(); e.stopPropagation();
                    setCtxMenu({ visible: true, x: e.clientX, y: e.clientY, appId: folder.id });
                  }}
                />
              );
            })}

            {/* 渲染桌面上的应用（不在文件夹内的） */}
            {desktopApps.filter(app => !folders.some(f => f.appIds.includes(app.id))).map(app => {
              const badgeNode = renderBadge(app.id);
              return (
                <DesktopIcon key={app.id} app={app}
                  position={positions[app.id] || DEFAULT_POSITIONS[app.id] || { x: 32, y: 32 }}
                  onPositionChange={handlePositionChange} onOpenApp={handleOpenApp}
                  badgeNode={badgeNode}
                  onTogglePin={() => handleTogglePin(app.id)}
                  onContextMenu={(e: React.MouseEvent) => {
                    e.preventDefault(); e.stopPropagation();
                    setCtxMenu({ visible: true, x: e.clientX, y: e.clientY, appId: app.id });
                  }}
                  onPromptPin={(appData: any) => setPinPromptApp(appData)}
                />
              );
            })}

            {/* 渲染小组件 */}
            {widgets.map(w => (
              <DesktopWidget
                key={w.id}
                widget={w}
                onPositionChange={handlePositionChange}
                onRemove={handleRemoveWidget}
                widgets={widgets}
                folders={folders}
              />
            ))}
          </>
        )}
      </main>

      {activeWindows.map((win, idx) => (
        <AppWindowFrame
          key={win.id}
          win={win}
          apps={apps}
          zIndex={win.id === focusedWinId ? 45 : 40 + idx}
          isFocused={win.id === focusedWinId}
          onFocus={() => setFocusedWinId(win.id)}
          onSetActive={t => setWindows(prev => prev.map(w => w.id === win.id ? { ...w, activeTab: t } : w))}
          onCloseTab={(t, e) => handleCloseTab(win.id, t, e)}
          onMinimize={() => setWindows(prev => prev.map(w => w.id === win.id ? { ...w, isMinimized: true } : w))}
          onToggleMaximize={() => setWindows(prev => prev.map(w => w.id === win.id ? { ...w, isMaximized: !w.isMaximized } : w))}
          onReorderTabs={tabs => handleReorderTabs(win.id, tabs)}
          onDetachTab={(t, cx, cy) => handleDetachTab(t, win.id, cx, cy)}
          onReceiveTab={(t, fromWinId, idx2) => handleReceiveTab(t, fromWinId, idx2, win.id)}
          onMoveWindow={(x, y) => setWindows(prev => prev.map(w => w.id === win.id ? { ...w, posX: x, posY: y } : w))}
          username={username}
        />
      ))}

      {ctxMenu.visible && (
        <div className="ctx-animate fixed z-[999] bg-white/90 backdrop-blur-xl border border-slate-200 rounded-xl shadow-2xl shadow-black/20 py-1.5 min-w-[200px]"
          style={{ left: Math.min(ctxMenu.x, window.innerWidth - 220), top: Math.min(ctxMenu.y, window.innerHeight - 200) }}
          onClick={e => e.stopPropagation()}>

          {ctxMenu.appId ? (() => {
            const isPinned = pinnedApps.includes(ctxMenu.appId!);
            const isFolder = ctxMenu.appId?.startsWith('folder_');
            return (
              <>
                <div className="px-3 py-1 text-[10px] font-semibold text-slate-400 uppercase tracking-wider">{isFolder ? '文件夹选项' : '应用选项'}</div>
                {isFolder ? (
                  <>
                    <button className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-slate-700 hover:bg-blue-50 hover:text-blue-700 transition-colors font-medium"
                      onClick={() => { setRenameId(ctxMenu.appId!); setCtxMenu(m => ({ ...m, visible: false })); }}>
                      <ClipboardList className="w-4 h-4 text-slate-400" />重命名文件夹
                    </button>
                    <button className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-red-600 hover:bg-red-50 transition-colors"
                      onClick={() => { handleDeleteFolder(ctxMenu.appId!); setCtxMenu(m => ({ ...m, visible: false })); }}>
                      <Trash2 className="w-4 h-4 text-red-400" />删除文件夹
                    </button>
                  </>
                ) : (
                  <button className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-slate-700 hover:bg-blue-50 hover:text-blue-700 transition-colors" onClick={() => { handleTogglePin(ctxMenu.appId!); setCtxMenu(m => ({ ...m, visible: false })); }}>
                    {isPinned ? <Minus className="w-4 h-4 text-slate-400" /> : <Plus className="w-4 h-4 text-slate-400" />}
                    {isPinned ? '取消固定至任务栏' : '固定至任务栏'}
                  </button>
                )}
              </>
            )
          })() : (
            <>
              <div className="px-3 py-1 text-[10px] font-semibold text-slate-400 uppercase tracking-wider">桌面操作</div>
              <button className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-slate-700 hover:bg-blue-50 hover:text-blue-700 transition-colors font-medium"
                onClick={() => { setShowFavoriteManager(true); setCtxMenu(m => ({ ...m, visible: false })); }}>
                <Grid3X3 className="w-4 h-4 text-blue-500" />管理常用应用
              </button>
              <button className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-slate-700 hover:bg-blue-50 hover:text-blue-700 transition-colors font-medium"
                onClick={() => { handleCreateFolder(ctxMenu.x, ctxMenu.y); setCtxMenu(m => ({ ...m, visible: false })); }}>
                <FolderPlus className="w-4 h-4 text-blue-500" />新建文件夹
              </button>

              {/* 添加小组件子菜单 */}
              <div className="relative group">
                <button className="w-full flex items-center justify-between px-4 py-2.5 text-sm text-slate-700 hover:bg-blue-50 hover:text-blue-700 transition-colors font-medium">
                  <div className="flex items-center gap-3">
                    <Grid3X3 className="w-4 h-4 text-purple-500" />添加桌面小组件
                  </div>
                  <span className="text-[10px] opacity-40">▶</span>
                </button>
                <div className={`absolute top-0 hidden group-hover:block bg-white/90 backdrop-blur-xl border border-slate-200 rounded-xl shadow-2xl py-1.5 min-w-[140px] z-[1000] ${ctxMenu.x > window.innerWidth - 400 ? 'right-full mr-1' : 'left-full ml-1'}`}>
                  <button className="w-full flex items-center gap-3 px-4 py-2 text-sm text-slate-700 hover:bg-blue-50 hover:text-blue-700 transition-colors whitespace-nowrap"
                    onClick={() => { handleAddWidget('clock', ctxMenu.x, ctxMenu.y); setCtxMenu(m => ({ ...m, visible: false })); }}>
                    时钟日历 (2x1)
                  </button>
                  <button className="w-full flex items-center gap-3 px-4 py-2 text-sm text-slate-700 hover:bg-blue-50 hover:text-blue-700 transition-colors whitespace-nowrap"
                    onClick={() => { handleAddWidget('calendar', ctxMenu.x, ctxMenu.y); setCtxMenu(m => ({ ...m, visible: false })); }}>
                    工作月历 (2x2)
                  </button>
                  <button className="w-full flex items-center gap-3 px-4 py-2 text-sm text-slate-700 hover:bg-blue-50 hover:text-blue-700 transition-colors whitespace-nowrap"
                    onClick={() => { handleAddWidget('weather', ctxMenu.x, ctxMenu.y); setCtxMenu(m => ({ ...m, visible: false })); }}>
                    实时天气 (2x1)
                  </button>
                </div>
              </div>

              <button className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-slate-700 hover:bg-slate-50 transition-colors" onClick={() => { handleAlignToGrid(); setCtxMenu(m => ({ ...m, visible: false })); }}>
                <Grid3X3 className="w-4 h-4 text-slate-400" />对齐图标网格
              </button>
              <button className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-slate-700 hover:bg-slate-50 transition-colors" onClick={() => { handleResetLayout(); setCtxMenu(m => ({ ...m, visible: false })); }}>
                <Monitor className="w-4 h-4 text-slate-400" />重置图标默认排列
              </button>
              <div className="my-1 border-t border-slate-100" />
              <div className="px-3 py-1 text-[10px] font-semibold text-slate-400 uppercase tracking-wider">个性化</div>
              <button className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-slate-700 hover:bg-purple-50 hover:text-purple-700 transition-colors" onClick={() => { wallpaperInputRef.current?.click(); setCtxMenu(m => ({ ...m, visible: false })); }}>
                <Image className="w-4 h-4 text-purple-500" />自定义上传壁纸…
              </button>
              <button className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-slate-700 hover:bg-indigo-50 hover:text-indigo-700 transition-colors" onClick={() => { handleToggleWallpaperLock(); setCtxMenu(m => ({ ...m, visible: false })); }}>
                <div className={`w-4 h-4 flex items-center justify-center ${isWallpaperLocked ? 'text-indigo-600' : 'text-slate-400'}`}>
                  {isWallpaperLocked ? '🔒' : '🔓'}
                </div>
                {isWallpaperLocked ? '取消固定当前壁纸' : '固定当前壁纸'}
              </button>
              <button className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-slate-500 hover:bg-slate-50 transition-colors" onClick={() => { handleResetWallpaper(); setCtxMenu(m => ({ ...m, visible: false })); }}>
                <Image className="w-4 h-4 text-slate-400" />随机更换壁纸
              </button>
            </>
          )}
        </div>
      )}

      {showFavoriteManager && (
        <div className="fixed inset-0 z-[1001] bg-slate-950/55 backdrop-blur-sm flex items-center justify-center p-4" onClick={() => setShowFavoriteManager(false)}>
          <div className="w-full max-w-3xl max-h-[78vh] bg-white rounded-2xl shadow-2xl overflow-hidden" onClick={e => e.stopPropagation()}>
            <div className="flex items-start justify-between px-6 py-5 border-b border-slate-100">
              <div>
                <h2 className="text-lg font-black text-slate-800">管理{getDesktopDefinition(activeDesktop)?.label || '桌面'}应用</h2>
                <p className="mt-1 text-sm text-slate-500">勾选的应用会显示在当前桌面；新建桌面默认空白，可按需添加。</p>
              </div>
              <button type="button" onClick={() => setShowFavoriteManager(false)} className="w-8 h-8 rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-700 flex items-center justify-center">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="p-6 overflow-y-auto max-h-[52vh] grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {apps.map(app => {
                const selected = desktopAppIds.includes(app.id);
                return (
                  <label key={app.id} className={`flex items-center gap-3 rounded-xl border p-3 cursor-pointer transition-colors ${selected ? 'border-blue-300 bg-blue-50' : 'border-slate-200 hover:bg-slate-50'}`}>
                    <input type="checkbox" checked={selected} onChange={() => handleToggleDesktopApp(app.id)} className="w-4 h-4 accent-blue-600" />
                    <span className={`w-8 h-8 shrink-0 rounded-lg ${app.color} flex items-center justify-center shadow-sm`}><app.icon className="w-4 h-4 text-white" /></span>
                    <span className="text-sm font-semibold text-slate-700">{app.label}</span>
                  </label>
                );
              })}
            </div>
            <div className="flex items-center justify-between gap-3 px-6 py-4 border-t border-slate-100 bg-slate-50">
              <div className="flex items-center gap-4">
                {getDesktopDefinition(activeDesktop)?.template === 'favorites' && <><button type="button" onClick={handleOrganizeFavoriteLayout} className="text-sm font-semibold text-slate-600 hover:text-slate-800">按场景整理</button><button type="button" onClick={handleRestoreFavoriteLayout} className="text-sm font-semibold text-blue-600 hover:text-blue-700">恢复推荐布局</button></>}
              </div>
              <button type="button" onClick={() => setShowFavoriteManager(false)} className="px-5 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-sm font-bold shadow-sm">完成</button>
            </div>
          </div>
        </div>
      )}

      <footer data-preview-ignore className="h-16 w-full shrink-0 z-50 fixed bottom-0 left-0 bg-slate-900/60 backdrop-blur-2xl border-t border-white/10 flex items-center px-6 shadow-[0_-10px_40px_rgba(0,0,0,0.3)]" onContextMenu={e => e.preventDefault()}>
        <div className="flex-1 flex items-center justify-start"></div>

        <div className="flex-none h-full">
          <Taskbar
            apps={[
              ...pinnedApps.map(id => apps.find(a => a.id === id)).filter(Boolean),
              ...apps.filter((a: any) => allOpenTabIds.includes(a.id as ModuleType) && !pinnedApps.includes(a.id))
            ]}
            openTabIds={allOpenTabIds}
            pinnedApps={pinnedApps}
            onTaskbarClick={handleOpenApp}
            renderBadge={(id: string) => {
              const done = renderBadge(id);
              if (done) return done;
              if (id === 'prediction') return renderPredictionBadge(false);
              if (id === 'news') return renderNewsBadge();
              return null;
            }}
            onShowDesktop={() => setWindows(prev => prev.map(w => w.desktopId === activeDesktop ? { ...w, isMinimized: true } : w))}
            onDockAction={handleDockAction}
            onUnpin={handleTogglePin}
            onReorder={handleReorderPinned}
            username={username}
            onEnterAdmin={onEnterAdmin}
            activeDesktop={activeDesktop}
            desktopSettings={desktopSettings}
            onBuildDesktopPreview={buildDesktopPreview}
            onSaveDesktopSettings={handleSaveDesktopSettings}
            onAddDesktop={handleAddDesktop}
            onDeleteDesktop={handleDeleteDesktop}
            onReorderDesktops={handleReorderDesktops}
            onSelectDesktop={(desktop: DesktopId) => {
              setShowFavoriteManager(false);
              setCtxMenu(m => ({ ...m, visible: false }));
              handleSelectDesktop(desktop);
            }}
          />
        </div>

        {/* 右侧系统托盘/状态区 */}
        <div className="flex-1 flex justify-end items-center gap-3 relative">
          <div className="flex items-center gap-1.5 h-10 px-2 hover:bg-white/5 rounded-xl transition-colors">
            {/* 头像/个人中心入口 */}
            <div
              className="w-10 h-10 rounded-xl bg-gradient-to-tr from-blue-400 to-indigo-500 flex items-center justify-center text-[13px] font-bold text-white shadow-sm shrink-0 cursor-pointer hover:scale-105 active:scale-95 transition-all overflow-hidden border border-white/20"
              onClick={(e) => { e.stopPropagation(); handleOpenApp('profile'); }}
              title="个人中心"
            >
              {userProfile.avatar_url
                ? <img src={userProfile.avatar_url} className="w-full h-full object-cover" alt="avatar" />
                : (userProfile.display_name?.charAt(0) || username?.charAt(0) || 'U').toUpperCase()
              }
            </div>

            {/* 时钟/日历入口 */}
            <div
              className="flex flex-col items-end px-2 py-1 cursor-pointer hover:bg-white/10 rounded-lg transition-colors group"
              onClick={(e) => { e.stopPropagation(); setShowCalendar(!showCalendar); }}
              title="显示日历"
            >
              <div className="text-white/90 text-[13px] font-bold leading-tight">
                {currentDate.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}
              </div>
              <div className="text-white/60 text-[11px] font-medium hidden sm:block leading-tight">
                {currentDate.toLocaleDateString('zh-CN', { year: 'numeric', month: 'numeric', day: 'numeric' })}
              </div>
            </div>
          </div>

          {/* 右下角日历弹出面板 */}
          {showCalendar && (
            <div
              className="absolute bottom-full right-0 mb-4 bg-slate-900/90 backdrop-blur-3xl border border-white/20 rounded-2xl p-5 w-80 shadow-[0_20px_60px_-15px_rgba(0,0,0,0.8)] z-50 ctx-animate cursor-default"
              onClick={e => e.stopPropagation()}
            >
              <div className="text-white mb-6">
                <div className="text-4xl font-light mb-1">{currentDate.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</div>
                <div className="text-blue-400 font-medium text-sm">{currentDate.toLocaleDateString('zh-CN', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}</div>
              </div>

              {/* 微型月历演示 */}
              <div className="grid grid-cols-7 gap-1 text-center">
                {['日', '一', '二', '三', '四', '五', '六'].map(d => (
                  <div key={d} className="text-xs font-bold text-slate-400 py-2">{d}</div>
                ))}
                {/* 简单的占位铺设 (以当月月初开始) */}
                {(() => {
                  const y = currentDate.getFullYear(), m = currentDate.getMonth(), d = currentDate.getDate();
                  const firstDay = new Date(y, m, 1).getDay();
                  const daysInMonth = new Date(y, m + 1, 0).getDate();
                  const days = [];
                  for (let i = 0; i < firstDay; i++) days.push(<div key={`empty-${i}`} className="p-2" />);
                  for (let i = 1; i <= daysInMonth; i++) {
                    const isToday = i === d;
                    days.push(
                      <div key={`day-${i}`} className={`p-2 hover:bg-white/10 rounded-full cursor-pointer text-sm flex items-center justify-center transition-colors w-9 h-9 mx-auto ${isToday ? 'bg-blue-600 text-white font-bold hover:bg-blue-500' : 'text-slate-300'}`}>
                        {i}
                      </div>
                    );
                  }
                  return days;
                })()}
              </div>
            </div>
          )}

          <div className="w-px h-6 bg-white/20 mx-1" />

          {/* 通知中心入口 */}
          <NotificationCenter
            notifications={notifications}
            onItemClick={(n) => {
              handleOpenApp(n.appId as ModuleType);
              setNotifications(prev => prev.map(item => item.id === n.id ? { ...item, isRead: true } : item));
              fetchWithAuth(`/api/notifications/${n.id}/read`, { method: 'PUT' });
            }}
            onMarkAsRead={(id) => {
              setNotifications(prev => prev.map(n => n.id === id ? { ...n, isRead: true } : n));
              fetchWithAuth(`/api/notifications/${id}/read`, { method: 'PUT' });
            }}
            onDelete={(id) => {
              setNotifications(prev => prev.filter(n => n.id !== id));
              fetchWithAuth(`/api/notifications/${id}`, { method: 'DELETE' });
            }}
            onClearAll={() => {
              setNotifications([]);
              fetchWithAuth('/api/notifications', { method: 'DELETE' });
            }}
          />

          <div className="w-px h-6 bg-white/20 mx-1" />
          <button onClick={onLogout} className="w-10 h-10 rounded-xl hover:bg-red-500 text-white/70 hover:text-white flex items-center justify-center transition-colors shadow-sm bg-white/5 border border-white/10" title="退出登录">
            <LogOut className="w-4 h-4" />
          </button>
        </div>
      </footer>

      {/* 底部任务栏询问确认弹窗 */}
      {pinPromptApp && (
        <div className="fixed inset-0 z-[1000] flex items-center justify-center bg-black/40 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="bg-white rounded-2xl shadow-2xl p-6 max-w-sm w-full mx-4 border border-white/20">
            <h3 className="text-lg font-black text-slate-800 mb-2">固定到任务栏</h3>
            <p className="text-slate-600 text-sm mb-6">是否要将【<span className="font-bold text-blue-600">{pinPromptApp.label}</span>】固定至下方任务栏快捷访问？</p>
            <div className="flex gap-3">
              <button onClick={() => setPinPromptApp(null)} className="flex-1 py-2.5 rounded-xl border border-slate-200 text-slate-600 font-bold text-sm hover:bg-slate-50 transition-colors">取消</button>
              <button
                onClick={() => { handleTogglePin(pinPromptApp.id); setPinPromptApp(null); }}
                className="flex-1 py-2.5 rounded-xl bg-blue-600 text-white font-bold text-sm hover:bg-blue-700 transition-colors shadow-lg shadow-blue-500/30">
                确认固定
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 全局统一系统弹窗拦截 */}
      {sysDialog && (
        <div className="fixed inset-0 z-[2000] flex items-center justify-center bg-black/40 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="bg-white rounded-2xl shadow-2xl p-6 max-w-sm w-full mx-4 border border-white/20">
            <h3 className="text-lg font-black text-slate-800 mb-2">系统提示</h3>
            <p className="text-slate-600 text-sm mb-6">{sysDialog.message}</p>
            <div className="flex gap-3">
              {sysDialog.type === 'confirm' && (
                <button onClick={() => setSysDialog(null)} className="flex-1 py-2.5 rounded-xl border border-slate-200 text-slate-600 font-bold text-sm hover:bg-slate-50 transition-colors">取消</button>
              )}
              <button
                onClick={() => {
                  if (sysDialog.onConfirm) sysDialog.onConfirm();
                  setSysDialog(null);
                }}
                className="flex-1 py-2.5 rounded-xl bg-blue-600 text-white font-bold text-sm hover:bg-blue-700 transition-colors shadow-lg shadow-blue-500/30">
                {sysDialog.type === 'confirm' ? '确认' : '我知道了'}
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
};
