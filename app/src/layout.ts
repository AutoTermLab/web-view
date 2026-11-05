// Sizing the glacier view's side panel.

const MIN_PANEL = 288, MIN_MAP = 320; // px

/** The panel width to use for a requested one: never below MIN_PANEL, and leaving the map at least MIN_MAP. */
export function clampPanel(width: number, viewport: number): number {
  return Math.round(Math.max(MIN_PANEL, Math.min(width, viewport - MIN_MAP)));
}
