/**
 * 欢迎区（工作台首页模块 2）
 *
 * 依据：06_前端页面详细PRD §1.2 —— 简短问候 + 一句话价值说明
 * 禁止：大面积 AI 宣传文案、模型选择器、Token
 */

/** 右侧插画：浅蓝渐变 + 科技感装饰 + 手写标语（纯 SVG，不依赖图片资源） */
function HeroArt() {
  return (
    <div className="relative hidden h-[124px] w-[42%] min-w-[300px] max-w-[520px] shrink-0 overflow-hidden rounded-[14px] lg:block">
      <svg
        viewBox="0 0 420 132"
        preserveAspectRatio="xMidYMid slice"
        className="absolute inset-0 h-full w-full"
        aria-hidden="true"
      >
        <defs>
          <linearGradient id="hero-bg" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#E3ECFF" />
            <stop offset="52%" stopColor="#F2F6FF" />
            <stop offset="100%" stopColor="#FFFFFF" />
          </linearGradient>
          <radialGradient id="hero-glow" cx="0.8" cy="0.35" r="0.6">
            <stop offset="0%" stopColor="#6E9BFF" stopOpacity="0.42" />
            <stop offset="100%" stopColor="#6E9BFF" stopOpacity="0" />
          </radialGradient>
          <linearGradient id="hero-cube" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#6E9BFF" />
            <stop offset="100%" stopColor="#2F6BFF" />
          </linearGradient>
        </defs>

        <rect width="420" height="132" fill="url(#hero-bg)" />
        <rect width="420" height="132" fill="url(#hero-glow)" />

        {/* 同心圆环（右侧视觉锚点） */}
        <circle cx="336" cy="66" r="78" fill="none" stroke="#9BBBFF" strokeOpacity="0.38" strokeWidth="1.2" />
        <circle cx="336" cy="66" r="54" fill="none" stroke="#9BBBFF" strokeOpacity="0.28" strokeWidth="1.2" />

        {/* 立体方块组 —— 代表 AI 处理文档 */}
        <g transform="translate(288 30)">
          <rect x="0" y="14" width="34" height="34" rx="9" fill="url(#hero-cube)" opacity="0.95" />
          <rect x="8" y="6" width="34" height="34" rx="9" fill="#FFFFFF" opacity="0.9" />
          <rect x="8" y="6" width="34" height="34" rx="9" fill="none" stroke="#C7D9FF" strokeWidth="1" />
          <path d="M17 20h16M17 27h11" stroke="#6E9BFF" strokeWidth="2.2" strokeLinecap="round" />
        </g>

        {/* 散点装饰 */}
        <g fill="#2F6BFF">
          <circle cx="272" cy="22" r="2.6" opacity="0.5" />
          <circle cx="392" cy="104" r="3.2" opacity="0.35" />
          <circle cx="256" cy="106" r="2" opacity="0.3" />
        </g>

        {/* 斜向细线 */}
        <path
          d="M234 118 L268 92"
          stroke="#9BBBFF"
          strokeOpacity="0.5"
          strokeWidth="1.4"
          strokeLinecap="round"
        />
      </svg>

      {/* 手写标语 */}
      <span
        className="absolute left-[26px] top-[30px] -rotate-[3deg] text-[17px] font-medium leading-[1.35] text-primary-500/85"
        style={{ fontFamily: '"Bradley Hand", "Segoe Script", "Kaiti SC", cursive' }}
      >
        AI 让工作
        <br />
        更简单一点
      </span>

      {/* 左下角闪光 */}
      <svg
        viewBox="0 0 24 24"
        className="absolute bottom-[18px] left-[30px] h-5 w-5 text-primary-400"
        fill="currentColor"
        aria-hidden="true"
      >
        <path d="M12 2l1.9 6.1L20 10l-6.1 1.9L12 18l-1.9-6.1L4 10l6.1-1.9z" />
      </svg>
    </div>
  );
}

export function GreetingHero({ username }: { username: string }) {
  return (
    <section className="flex items-stretch justify-between gap-8">
      <div className="flex min-w-0 flex-col justify-center py-1">
        <h1 className="text-display text-ink">
          你好，<span className="text-primary-500">{username}</span>
        </h1>
        <p className="mt-2 text-lead text-ink-soft">
          把重复的工作交给 AI，让你专注更有价值的事。
        </p>
      </div>

      <HeroArt />
    </section>
  );
}
