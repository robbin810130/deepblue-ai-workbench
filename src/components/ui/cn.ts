/**
 * 类名拼接工具
 *
 * 刻意不引入 clsx / tailwind-merge —— 保持依赖零变更（见重构规划 §3 阶段 1）。
 * 组件内部的类顺序是受控的，调用方传入的 className 放在最后以覆盖默认值。
 */
export function cn(...classes: Array<string | false | null | undefined>): string {
  return classes.filter(Boolean).join(' ');
}
