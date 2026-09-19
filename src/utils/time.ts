/**
 * 时间展示工具
 *
 * 为什么单独抽出来：
 *   工作台「最近任务 / 我的待办」、通知面板都要显示「N 小时前」这类相对时间，
 *   原先 NotificationsBell 里有一份私有实现，其它地方就各自硬编码 —— 统一到这里。
 */

/** 相对时间：刚刚 / N 分钟前 / N 小时前 / 昨天 HH:mm / N 天前 / M月D日 */
export function fmtRelative(iso?: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';

  const diff = Date.now() - d.getTime();
  if (diff < 0) return '刚刚'; // 时钟偏差兜底

  const MIN = 60_000;
  const HOUR = 60 * MIN;
  const DAY = 24 * HOUR;

  if (diff < MIN) return '刚刚';
  if (diff < HOUR) return `${Math.floor(diff / MIN)} 分钟前`;
  if (diff < DAY) return `${Math.floor(diff / HOUR)} 小时前`;

  const hhmm = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  if (diff < 2 * DAY) return `昨天 ${hhmm}`;
  if (diff < 7 * DAY) return `${Math.floor(diff / DAY)} 天前`;
  return `${d.getMonth() + 1}月${d.getDate()}日`;
}
