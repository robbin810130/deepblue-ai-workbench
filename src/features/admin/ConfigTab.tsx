/**
 * 管理后台 · 系统配置页签
 *
 *   GET   /api/admin/config/health                 数据库连通检测
 *   GET   /api/admin/config/news_keywords          资讯关键词词库
 *   PATCH /api/admin/config/news_keywords/:id/toggle
 *   GET   /api/admin/config/marketing              出海营销参考数据
 *   GET   /api/admin/config/beautyrnd              美妆研发参考数据
 *
 * 参考数据（语种/平台/风格/目标市场…）是技能运行时的下拉来源，
 * 本页只读展示，便于管理员确认「技能里能选到的东西」是否符合当前业务。
 */
import { useEffect, useState } from 'react';
import { Database, RefreshCw } from 'lucide-react';
import { cn } from '../../components/ui/cn';
import { api, type NewsKeywordGroup, type RefList } from '../../api/client';
import { Banner, Panel, PrimaryButton, SubButton, errText } from './ui';

export function ConfigTab() {
  const [keywords, setKeywords] = useState<NewsKeywordGroup[] | null>(null);
  const [marketing, setMarketing] = useState<RefList[]>([]);
  const [beauty, setBeauty] = useState<RefList[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [health, setHealth] = useState<{ ok: boolean; ms: number | null; at: string } | null>(null);
  const [checking, setChecking] = useState(false);

  const loadKeywords = () => {
    api.admin
      .newsKeywords()
      .then(setKeywords)
      .catch((e) => {
        setKeywords([]);
        setError(errText(e));
      });
  };

  useEffect(() => {
    loadKeywords();
    api.admin
      .marketingConfig()
      .then(setMarketing)
      .catch(() => setMarketing([]));
    api.admin
      .beautyRndConfig()
      .then(setBeauty)
      .catch(() => setBeauty([]));
  }, []);

  const checkHealth = async () => {
    setChecking(true);
    setError(null);
    const t0 = performance.now();
    try {
      await api.admin.configHealth();
      setHealth({
        ok: true,
        ms: Math.round(performance.now() - t0),
        at: new Date().toLocaleTimeString('zh-CN', { hour12: false }),
      });
    } catch (e) {
      setHealth({ ok: false, ms: null, at: new Date().toLocaleTimeString('zh-CN', { hour12: false }) });
      setError(errText(e));
    } finally {
      setChecking(false);
    }
  };

  const toggleKeyword = async (g: NewsKeywordGroup) => {
    setError(null);
    setNotice(null);
    try {
      await api.admin.toggleNewsKeyword(g.id);
      setNotice(`词库分组「${g.group_name}」已${g.is_active ? '停用' : '启用'}。`);
      loadKeywords();
    } catch (e) {
      setError(errText(e));
    }
  };

  return (
    <>
      <Panel
        title="服务状态"
        hint="数据库连通性检测；失败通常意味着 PostgreSQL 未就绪或连接串错误。"
        actions={
          <PrimaryButton onClick={checkHealth} loading={checking}>
            <RefreshCw size={14} /> 检测
          </PrimaryButton>
        }
      >
        {error && <Banner tone="error" onClose={() => setError(null)}>{error}</Banner>}
        {notice && <Banner tone="success" onClose={() => setNotice(null)}>{notice}</Banner>}
        {health ? (
          <div className="flex items-center gap-3">
            <span
              className={cn(
                'inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-caption font-medium',
                health.ok ? 'bg-success-soft text-success' : 'bg-danger-soft text-danger',
              )}
            >
              <span className={cn('h-1.5 w-1.5 rounded-full', health.ok ? 'bg-success' : 'bg-danger')} />
              {health.ok ? '数据库连通正常' : '数据库连接异常'}
            </span>
            {health.ms !== null && <span className="text-caption text-ink-soft">往返 {health.ms} ms</span>}
            <span className="text-caption text-ink-faint">检测于 {health.at}</span>
          </div>
        ) : (
          <p className="flex items-center gap-1.5 text-caption text-ink-faint">
            <Database size={13} /> 尚未检测。
          </p>
        )}
      </Panel>

      <Panel title="资讯关键词词库" hint="决定「每日资讯」抓取与摘要的选题方向；停用的分组不再参与抓取。">
        {keywords === null && <p className="py-6 text-center text-caption text-ink-faint">加载中…</p>}
        {keywords && keywords.length === 0 && (
          <p className="py-6 text-center text-caption text-ink-faint">暂无词库分组。</p>
        )}
        {keywords && keywords.length > 0 && (
          <div className="space-y-2.5">
            {keywords.map((g) => (
              <div key={g.id} className="rounded-lg border border-line px-4 py-3">
                <div className="flex items-center justify-between gap-3">
                  <span className="flex items-center gap-2">
                    <span className="text-lead font-medium text-ink">{g.group_name}</span>
                    <span
                      className={cn(
                        'rounded-md px-1.5 py-0.5 text-[10px]',
                        g.is_active ? 'bg-success-soft text-success' : 'bg-surface-sunken text-ink-soft',
                      )}
                    >
                      {g.is_active ? '启用中' : '已停用'}
                    </span>
                  </span>
                  <SubButton onClick={() => toggleKeyword(g)}>{g.is_active ? '停用' : '启用'}</SubButton>
                </div>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {(Array.isArray(g.keyword) ? g.keyword : []).map((k) => (
                    <span key={k} className="rounded-full bg-page px-2 py-0.5 text-[10px] text-ink-soft">
                      {k}
                    </span>
                  ))}
                  {(!Array.isArray(g.keyword) || g.keyword.length === 0) && (
                    <span className="text-[11px] text-ink-faint">该分组下没有关键词</span>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </Panel>

      {[
        { title: '出海营销参考数据', hint: '「出海营销」技能生成报告时可选项的来源。', data: marketing },
        { title: '美妆研发参考数据', hint: '「美妆研发」技能的可选参数来源。', data: beauty },
      ].map((block) => (
        <Panel key={block.title} title={block.title} hint={block.hint}>
          {block.data.length === 0 ? (
            <p className="py-4 text-center text-caption text-ink-faint">暂无参考数据。</p>
          ) : (
            <div className="grid grid-cols-2 gap-4">
              {block.data.map((r) => (
                <div key={r.id}>
                  <p className="text-caption font-medium text-ink">{r.label}</p>
                  {r.description && <p className="mt-0.5 text-[11px] text-ink-faint">{r.description}</p>}
                  <div className="mt-1.5 flex flex-wrap gap-1.5">
                    {r.name.map((n) => (
                      <span key={n} className="rounded-full bg-page px-2 py-0.5 text-[10px] text-ink-soft">
                        {n}
                      </span>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </Panel>
      ))}
    </>
  );
}
