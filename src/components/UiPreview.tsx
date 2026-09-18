/**
 * 设计系统预览页（仅开发环境）
 *
 * 访问方式：npm run dev 后打开 http://localhost:8090/?ui-preview
 * 生产构建不含本文件（main.tsx 中以 import.meta.env.DEV 包裹动态引入）。
 */
import { useState, type ReactNode } from 'react';
import { Plus, Search, Trash2 } from 'lucide-react';
import {
  Button,
  Card,
  Checkbox,
  DataTable,
  Drawer,
  EmptyState,
  Input,
  Modal,
  Pagination,
  Select,
  Skeleton,
  SkeletonTable,
  SkeletonText,
  Tabs,
  Tag,
  Tooltip,
  toast,
  type Column,
  type TagTone,
} from './ui';

interface DemoRow extends Record<string, unknown> {
  id: number;
  name: string;
  owner: string;
  status: string;
  updatedAt: string;
}

const DEMO_ROWS: DemoRow[] = [
  { id: 1, name: '企业资质库-2026Q3', owner: '小陈', status: '已通过', updatedAt: '2026-09-18' },
  { id: 2, name: '物流费测算-华东仓', owner: '小董', status: '审核中', updatedAt: '2026-09-17' },
  { id: 3, name: '大客户档案-复星', owner: '小易', status: '已归档', updatedAt: '2026-09-15' },
];

const TONES: TagTone[] = ['neutral', 'brand', 'success', 'warning', 'danger', 'info'];

/** 色阶必须写成字面量类名，Tailwind 的 JIT 无法识别动态拼接的类名 */
const BRAND_STEPS = [
  { lv: '50', cls: 'bg-brand-50' },
  { lv: '100', cls: 'bg-brand-100' },
  { lv: '200', cls: 'bg-brand-200' },
  { lv: '300', cls: 'bg-brand-300' },
  { lv: '400', cls: 'bg-brand-400' },
  { lv: '500', cls: 'bg-brand-500' },
  { lv: '600', cls: 'bg-brand-600' },
  { lv: '700', cls: 'bg-brand-700' },
  { lv: '800', cls: 'bg-brand-800' },
];

function Section({
  title,
  hint,
  extra,
  children,
}: {
  title: string;
  hint?: string;
  extra?: ReactNode;
  children: ReactNode;
}) {
  return (
    <Card title={title} subtitle={hint} extra={extra} className="mb-4">
      {children}
    </Card>
  );
}

export function UiPreview() {
  const [modalOpen, setModalOpen] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [tab, setTab] = useState('a');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [checked, setChecked] = useState(true);
  const [keyword, setKeyword] = useState('');

  const columns: Array<Column<DemoRow>> = [
    { key: 'name', title: '名称' },
    { key: 'owner', title: '负责人', width: 100 },
    {
      key: 'status',
      title: '状态',
      width: 110,
      render: (row) => (
        <Tag
          size="sm"
          dot
          tone={row.status === '已通过' ? 'success' : row.status === '审核中' ? 'warning' : 'neutral'}
        >
          {row.status}
        </Tag>
      ),
    },
    { key: 'updatedAt', title: '更新时间', width: 120, align: 'right' },
  ];

  return (
    <div className="min-h-screen bg-slate-100 p-6">
      <div className="mx-auto max-w-4xl">
        <header className="mb-4">
          <h1 className="text-xl font-medium text-slate-800">设计系统预览</h1>
          <p className="mt-1 text-body text-slate-500">
            WebOS Pro · 阶段 1 基座 · 主色 indigo · 仅开发环境可见
          </p>
        </header>

        <Card title="设计 token" subtitle="主色 / 圆角 / 字号 / 阴影" className="mb-4">
          <div className="mb-4 flex flex-wrap gap-2">
            {BRAND_STEPS.map(({ lv, cls }) => (
              <div key={lv} className="text-center">
                <div className={`h-10 w-14 rounded-control ${cls}`} />
                <span className="mt-1 block text-2xs text-slate-500">{lv}</span>
              </div>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex h-10 w-24 items-center justify-center rounded-control bg-slate-100 text-caption">
              control
            </div>
            <div className="flex h-10 w-24 items-center justify-center rounded-card bg-slate-100 text-caption">
              card
            </div>
            <div className="flex h-10 w-24 items-center justify-center rounded-panel bg-slate-100 text-caption">
              panel
            </div>
            <div className="flex h-10 w-24 items-center justify-center rounded-card bg-white text-caption shadow-control">
              shadow-control
            </div>
            <div className="flex h-10 w-24 items-center justify-center rounded-card bg-white text-caption shadow-card">
              shadow-card
            </div>
            <div className="flex h-10 w-24 items-center justify-center rounded-card bg-white text-caption shadow-overlay">
              shadow-overlay
            </div>
          </div>
          <div className="mt-4 space-y-1">
            <p className="text-2xs text-slate-600">text-2xs · 11px · 标签角标</p>
            <p className="text-caption text-slate-600">text-caption · 12px · 辅助说明</p>
            <p className="text-body text-slate-600">text-body · 13px · 正文（默认）</p>
            <p className="text-lead text-slate-600">text-lead · 14px · 小标题</p>
            <p className="text-title text-slate-600">text-title · 16px · 页面标题</p>
          </div>
        </Card>

        <Section title="Button" hint="5 种 variant × 3 种 size">
          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <Button variant="primary">主要</Button>
              <Button variant="secondary">次要</Button>
              <Button variant="ghost">幽灵</Button>
              <Button variant="danger">危险</Button>
              <Button variant="text">文字</Button>
              <Button variant="primary" disabled>禁用</Button>
              <Button variant="primary" loading>加载中</Button>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button size="sm" variant="primary" icon={<Plus className="h-3.5 w-3.5" />}>小号</Button>
              <Button size="md" variant="primary" icon={<Plus className="h-4 w-4" />}>中号</Button>
              <Button size="lg" variant="primary" icon={<Plus className="h-4 w-4" />}>大号</Button>
              <Button variant="secondary" icon={<Trash2 className="h-4 w-4" />}>删除</Button>
            </div>
          </div>
        </Section>

        <Section title="表单控件" hint="Input / Select / Checkbox">
          <div className="grid gap-3 sm:grid-cols-2">
            <Input
              placeholder="默认输入框"
              prefixIcon={<Search className="h-4 w-4" />}
              value={keyword}
              onChange={(e) => setKeyword(e.target.value)}
            />
            <Input placeholder="校验失败态" invalid />
            <Input placeholder="禁用态" disabled />
            <Select
              placeholder="请选择"
              defaultValue=""
              options={[
                { value: 'a', label: '选项 A' },
                { value: 'b', label: '选项 B' },
              ]}
            />
            <div className="flex items-center gap-4">
              <Checkbox label="已勾选" checked={checked} onChange={(e) => setChecked(e.target.checked)} id="cb1" />
              <Checkbox label="未勾选" id="cb2" />
              <Checkbox label="禁用" disabled id="cb3" />
            </div>
          </div>
        </Section>

        <Section title="Tag" hint="6 种语义色 × 2 种尺寸">
          <div className="flex flex-wrap items-center gap-2">
            {TONES.map((t) => (
              <Tag key={t} tone={t}>{t}</Tag>
            ))}
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            {TONES.map((t) => (
              <Tag key={t} size="sm" tone={t} dot>{t}</Tag>
            ))}
          </div>
        </Section>

        <Section
          title="Card + DataTable + Pagination"
          hint="表格与分页的组合用法"
          extra={<Button size="sm" variant="primary" icon={<Plus className="h-3.5 w-3.5" />}>新建</Button>}
        >
          <DataTable columns={columns} data={DEMO_ROWS} rowKey={(r) => r.id} onRowClick={() => toast('点击了行', { tone: 'info' })} />
          <Pagination page={page} pageSize={pageSize} total={47} onChange={setPage} onPageSizeChange={setPageSize} />
        </Section>

        <Section title="Tabs" hint="line / pill 两种形态">
          <Tabs
            className="mb-3"
            value={tab}
            onChange={setTab}
            items={[
              { key: 'a', label: '全部', badge: 12 },
              { key: 'b', label: '待审核', badge: 3 },
              { key: 'c', label: '已归档' },
              { key: 'd', label: '禁用项', disabled: true },
            ]}
          />
          <Tabs
            variant="pill"
            value={tab}
            onChange={setTab}
            items={[
              { key: 'a', label: '全部' },
              { key: 'b', label: '待审核' },
              { key: 'c', label: '已归档' },
            ]}
          />
        </Section>

        <Section title="反馈组件" hint="Modal / Drawer / Toast / Tooltip / 空态 / 骨架屏">
          <div className="mb-4 flex flex-wrap items-center gap-2">
            <Button variant="primary" onClick={() => setModalOpen(true)}>打开弹窗</Button>
            <Button onClick={() => setDrawerOpen(true)}>打开抽屉</Button>
            <Button onClick={() => toast('操作成功', { tone: 'success' })}>成功提示</Button>
            <Button onClick={() => toast('权限不足，无法执行该操作', { tone: 'error' })}>错误提示</Button>
            <Tooltip content="这是提示文字">
              <Button variant="ghost">悬停查看提示</Button>
            </Tooltip>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="rounded-card border border-slate-200 p-3">
              <p className="mb-2 text-caption text-slate-500">EmptyState</p>
              <EmptyState title="暂无数据" description="调整筛选条件后重试" />
            </div>
            <div className="space-y-3 rounded-card border border-slate-200 p-3">
              <p className="text-caption text-slate-500">Skeleton</p>
              <Skeleton className="h-8 w-40" />
              <SkeletonText lines={2} />
              <SkeletonTable rows={2} columns={3} />
            </div>
          </div>
        </Section>

        <p className="pb-8 text-center text-2xs text-slate-400">
          预览页仅存在于开发环境，生产构建不包含。
        </p>
      </div>

      <Modal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        title="弹窗标题"
        footer={
          <>
            <Button onClick={() => setModalOpen(false)}>取消</Button>
            <Button variant="primary" onClick={() => { setModalOpen(false); toast('已保存', { tone: 'success' }); }}>
              确定
            </Button>
          </>
        }
      >
        <p>这里是弹窗正文内容。支持 ESC 关闭、点击遮罩关闭，超出高度自动滚动。</p>
        <p className="mt-2 text-slate-500">滚动测试：</p>
        <div className="mt-2 space-y-2">
          {Array.from({ length: 20 }).map((_, i) => (
            <p key={i} className="text-caption text-slate-400">占位段落 {i + 1}</p>
          ))}
        </div>
      </Modal>

      <Drawer
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        title="抽屉标题"
        footer={<Button variant="primary" onClick={() => setDrawerOpen(false)}>完成</Button>}
      >
        <p>右侧抽屉，适合承载筛选与详情。</p>
      </Drawer>
    </div>
  );
}

export default UiPreview;
