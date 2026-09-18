/**
 * 业务场景总览（/scenes）—— 06 文档 §2 场景总览页
 * 数据源：GET /api/v1/scenes（后端唯一权威，不再用前端 mock）
 */
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, ServerCrash } from 'lucide-react';
import { api, type ApiScene } from '../../api/client';
import { sceneArtKey } from '../../api/sceneMap';
import { SceneArt } from '../workbench/components/SceneSection';

export function ScenesPage() {
  const [scenes, setScenes] = useState<ApiScene[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.listScenes(true)
      .then(setScenes)
      .catch((e: Error) => setError(e.message));
  }, []);

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 rounded-xl bg-surface py-24 text-ink-soft">
        <ServerCrash className="h-8 w-8" />
        <p className="text-body">场景加载失败：{error}</p>
      </div>
    );
  }

  const business = (scenes || []).filter((s) => s.is_business);

  return (
    <div className="flex flex-col gap-5">
      <header>
        <h1 className="text-title font-semibold text-ink">业务场景</h1>
        <p className="mt-1 text-caption text-ink-soft">
          按业务域组织的能力全景，每个场景下的技能都可发起可追踪的任务
        </p>
      </header>

      {!scenes ? (
        <div className="grid grid-cols-3 gap-4">
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="h-[150px] animate-pulse rounded-xl bg-surface-sunken" />
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-3 gap-4">
          {business.map((s) => (
            <Link
              key={s.scene_key}
              to={`/scenes/${s.scene_key}`}
              className="group flex items-center gap-4 rounded-xl border border-line bg-surface p-5 transition-shadow hover:shadow-md"
            >
              <SceneArt scene={sceneArtKey(s.scene_key)} />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: s.theme_color }} />
                  <h3 className="truncate text-body font-medium text-ink">{s.name}</h3>
                </div>
                <p className="mt-1 line-clamp-2 text-caption leading-relaxed text-ink-soft">{s.summary}</p>
                <p className="mt-2 text-caption text-ink-faint">{s.skill_count ?? 0} 个技能</p>
              </div>
              <ArrowRight className="h-4 w-4 shrink-0 text-ink-faint transition-transform group-hover:translate-x-0.5 group-hover:text-primary-500" />
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
