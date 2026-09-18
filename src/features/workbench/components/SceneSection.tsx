/**
 * 业务场景区（工作台首页模块 5）
 *
 * 依据：06_前端页面详细PRD §1.2 —— 6 个场景；卡片里禁止密集列出全部技能
 *      §2 场景总览 —— 每张卡只显示：图标、名称、一句说明、技能数量（可选）
 *
 * 插画：6 个场景各一张内联 SVG（不引入图片资源，避免上线带外链与体积）。
 */
import { ArrowRight } from 'lucide-react';
import { Link, useNavigate } from 'react-router-dom';
import { SCENES, SCENE_TONE } from '../../../config/scenes';
import { cn } from '../../../components/ui/cn';
import type { SceneKey } from '../../../types/domain';

/* ============================================================
   场景插画（统一 64×64 画布 / 扁平双色，用透明度做层次）
   导出复用：场景总览页（/scenes）用同一套插画保持视觉一致。
   ============================================================ */
export function SceneArt({ scene }: { scene: SceneKey }) {
  const common = { width: 68, height: 68, viewBox: '0 0 64 64', fill: 'none' } as const;

  switch (scene) {
    case 'market':
      return (
        <svg {...common} aria-hidden="true">
          <rect x="8" y="38" width="13" height="18" rx="4" fill="#2F6BFF" opacity="0.4" />
          <rect x="26" y="26" width="13" height="30" rx="4" fill="#2F6BFF" opacity="0.68" />
          <rect x="44" y="12" width="13" height="44" rx="4" fill="#2F6BFF" />
          <path d="M10 30 L30 18 L46 24" stroke="#2F6BFF" strokeOpacity="0.5" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
          <circle cx="46" cy="24" r="3.4" fill="#FFFFFF" stroke="#2F6BFF" strokeWidth="2.2" />
        </svg>
      );

    case 'contract':
      return (
        <svg {...common} aria-hidden="true">
          <rect x="13" y="6" width="30" height="46" rx="7" fill="#12B76A" opacity="0.16" />
          <rect x="20" y="2" width="30" height="46" rx="7" fill="#12B76A" opacity="0.9" />
          <path d="M27 20h16M27 28h11" stroke="#FFFFFF" strokeWidth="2.6" strokeLinecap="round" />
          <circle cx="44" cy="48" r="11" fill="#12B76A" />
          <path d="M39.5 48.2l3.2 3.2 6-6.4" stroke="#FFFFFF" strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      );

    case 'supply':
      return (
        <svg {...common} aria-hidden="true">
          <path d="M32 8 L52 19 L32 30 L12 19 Z" fill="#F79009" opacity="0.95" />
          <path d="M12 19 L32 30 L32 54 L12 43 Z" fill="#F79009" opacity="0.62" />
          <path d="M52 19 L52 43 L32 54 L32 30 Z" fill="#F79009" opacity="0.38" />
          <path d="M22 13.5 L42 24.5" stroke="#FFFFFF" strokeOpacity="0.5" strokeWidth="2" strokeLinecap="round" />
        </svg>
      );

    case 'content':
      return (
        <svg {...common} aria-hidden="true">
          <rect x="6" y="11" width="52" height="42" rx="9" fill="#F25C9C" opacity="0.88" />
          <circle cx="22" cy="26" r="5.2" fill="#FFFFFF" opacity="0.95" />
          <path d="M6 48 L24 33 L38 45 L46 38 L58 47 L58 53 L6 53 Z" fill="#FFFFFF" opacity="0.92" />
        </svg>
      );

    case 'knowledge':
      return (
        <svg {...common} aria-hidden="true">
          <path d="M32 16 C26 10 16 9 9 11 L9 48 C16 46 26 47 32 53 Z" fill="#8B5CF6" opacity="0.9" />
          <path d="M32 16 C38 10 48 9 55 11 L55 48 C48 46 38 47 32 53 Z" fill="#8B5CF6" opacity="0.5" />
          <path d="M32 16 L32 53" stroke="#FFFFFF" strokeWidth="2.2" strokeLinecap="round" />
          <path d="M16 23 L26 25 M16 32 L26 34" stroke="#FFFFFF" strokeOpacity="0.7" strokeWidth="2.2" strokeLinecap="round" />
        </svg>
      );

    case 'analysis':
      return (
        <svg {...common} aria-hidden="true">
          <circle cx="32" cy="32" r="21" fill="#06A4B5" opacity="0.22" />
          <path d="M32 11 A21 21 0 0 1 52.5 38.5 L32 32 Z" fill="#06A4B5" opacity="0.72" />
          <path d="M32 32 L52.5 38.5 A21 21 0 0 1 18 50.7 L32 32 Z" fill="#06A4B5" opacity="0.95" />
          <circle cx="32" cy="32" r="6" fill="#FFFFFF" />
        </svg>
      );

    default:
      return null;
  }
}

/* ============================================================
   场景卡
   ============================================================ */
function SceneCard({ sceneKey }: { sceneKey: SceneKey }) {
  const scene = SCENES.find((s) => s.key === sceneKey)!;
  const tone = SCENE_TONE[sceneKey];
  const navigate = useNavigate();

  return (
    <div
      role="link"
      tabIndex={0}
      aria-label={`进入场景 ${scene.name}`}
      onClick={() => navigate(`/scenes/${scene.key}`)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') navigate(`/scenes/${scene.key}`);
      }}
      className={cn(
        'group relative flex min-h-[96px] cursor-pointer flex-col overflow-hidden rounded-[14px] p-[14px]',
        'bg-gradient-to-br transition-all duration-200',
        'hover:-translate-y-0.5 hover:shadow-panel-hover',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-300',
        tone.surface,
      )}
    >
      <div className="relative z-10 flex flex-col">
        <h3 className="text-subhead text-ink">{scene.name}</h3>
        <p className="mt-[3px] line-clamp-2 text-caption leading-[18px] text-ink-soft">
          {scene.summary}
        </p>
      </div>

      <span
        className={cn(
          'relative z-10 mt-auto flex h-[26px] w-[26px] items-center justify-center rounded-full bg-white text-ink-soft shadow-[0_1px_3px_rgba(16,24,40,0.12)]',
          'transition-colors group-hover:text-ink',
        )}
      >
        <ArrowRight
          size={15}
          strokeWidth={2.2}
          className="transition-transform group-hover:translate-x-0.5"
        />
      </span>

      {/* 插画 */}
      <span className="pointer-events-none absolute right-[14px] top-1/2 -translate-y-1/2 opacity-95 transition-transform duration-300 group-hover:scale-[1.06]">
        <SceneArt scene={sceneKey} />
      </span>
    </div>
  );
}

/* ============================================================
   区块（标题行 + 6 张卡）
   ============================================================ */
export function SceneSection() {
  return (
    <section aria-label="业务场景">
      <div className="mb-3 flex items-baseline justify-between">
        <h2 className="text-heading text-ink">业务场景</h2>
        <Link
          to="/scenes"
          className="inline-flex items-center gap-1 text-caption text-primary-500 transition-colors hover:text-primary-600"
        >
          查看全部场景
          <ArrowRight size={14} />
        </Link>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {SCENES.map((s) => (
          <SceneCard key={s.key} sceneKey={s.key} />
        ))}
      </div>
    </section>
  );
}
