export interface WidgetPosition {
  x: number;
  y: number;
}

export interface WidgetSize {
  width: number;
  height: number;
}

export interface DesktopViewport {
  width: number;
  height: number;
}

export interface DesktopSafeArea {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(value, Math.max(min, max)));

export const clampWidgetPosition = (
  position: WidgetPosition,
  size: WidgetSize,
  viewport: DesktopViewport,
  safeArea: DesktopSafeArea,
): WidgetPosition => ({
  x: clamp(position.x, safeArea.left, viewport.width - safeArea.right - size.width),
  y: clamp(position.y, safeArea.top, viewport.height - safeArea.bottom - size.height),
});
