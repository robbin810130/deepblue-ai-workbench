/**
 * 场景详情（/scenes/:sceneKey）—— 场景信息 + 技能清单
 */
import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowLeft, PlayCircle, ServerCrash } from 'lucide-react';
import { api, type ApiScene, type ApiSkill } from '../../api/client';

function LiveTag({ live }: { live: boolean }) {
  return live ? (
    <span className="rounded bg-success-soft px-1.5 py-0.5 text-caption text-success">可用</span>
  ) : (
    <span className="rounded bg-surface-sunken px-1.5 py-0.5 text-caption text-ink-faint">筹备中</span>
  );
}

export function SceneDetailPage() {
  const { sceneKey = '' } = useParams();
  const [scene, setScene] = useState<(ApiScene & { skills: ApiSkill[] }) | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.getScene(sceneKey).then(setScene).catch((e: Error) => setError(e.message));
  }, [sceneKey]);

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 rounded-xl bg-surface py-24 text-ink-soft">
        <ServerCrash className="h-8 w-8" />
        <p className="text-body">{error}</p>
        <Link to="/scenes" className="text-caption text-primary-600 hover:underline">
          ← 返回场景总览
        </Link>
      </div>
    );
  }
  if (!scene) return <div className="h-64 animate-pulse rounded-xl bg-surface-sunken" />;

  return (
    <div className="flex flex-col gap-5">
      <Link to="/scenes" className="inline-flex w-fit items-center gap-1 text-caption text-ink-soft hover:text-primary-600">
        <ArrowLeft className="h-3.5 w-3.5" /> 返回场景总览
      </Link>

      <header className="flex items-center gap-4 rounded-xl border border-line bg-surface p-5">
        <span className="h-10 w-1.5 rounded-full" style={{ background: scene.theme_color }} />
        <div className="min-w-0">
          <h1 className="text-title font-semibold text-ink">{scene.name}</h1>
          <p className="mt-0.5 text-caption text-ink-soft">{scene.summary}</p>
        </div>
        <span className="ml-auto shrink-0 text-caption text-ink-faint">{scene.skills.length} 个技能</span>
      </header>

      <div className="grid grid-cols-2 gap-4">
        {scene.skills.map((sk) => (
          <div key={sk.skill_key} className="flex items-start gap-3 rounded-xl border border-line bg-surface p-4">
            <span className="mt-1 h-2 w-2 shrink-0 rounded-full" style={{ background: scene.theme_color }} />
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <h3 className="truncate text-body font-medium text-ink">{sk.name}</h3>
                <LiveTag live={sk.live} />
                {sk.requires_confirmation && (
                  <span className="rounded bg-warning-soft px-1.5 py-0.5 text-caption text-warning">需确认</span>
                )}
              </div>
              <p className="mt-1 line-clamp-2 text-caption leading-relaxed text-ink-soft">{sk.summary}</p>
              <div className="mt-2 flex items-center gap-3 text-caption text-ink-faint">
                <span>{sk.execution_mode === 'blocking' ? '同步返回' : '后台执行'}</span>
                {sk.supported_files && sk.supported_files.length > 0 && (
                  <span>支持 {sk.supported_files.join(' / ')}</span>
                )}
              </div>
            </div>
            {sk.live && (
              <Link
                to={`/skills/${sk.skill_key}`}
                className="inline-flex shrink-0 items-center gap-1 rounded-lg bg-primary-500 px-3 py-1.5 text-caption font-medium text-white hover:bg-primary-600"
              >
                <PlayCircle className="h-3.5 w-3.5" /> 立即使用
              </Link>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
