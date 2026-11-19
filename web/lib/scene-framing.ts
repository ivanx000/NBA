/**
 * Camera framing for the home scene: the two players centered on screen and as big as possible
 * between the team names (top) and the pick hint (bottom), each standing on its platform under
 * its team name, with both fully visible.
 */

export interface Viewport {
  width: number;
  height: number;
}

/** Screen space (CSS px) kept clear of the players. */
export interface FreeRegion {
  top: number;
  bottom: number;
  /** Margin left and right. */
  side: number;
}

export interface Framing {
  /** Distance from the camera to the players' plane (z = 0). */
  distance: number;
  /** Camera x and y; it looks straight down -z at (x, y, 0). */
  x: number;
  y: number;
  /** Half the distance between the two players' centers. */
  playerX: number;
}

/** From the bottom of the platform (0.16 m) to just over the head (1.98 m model). */
const BOX_BOTTOM = -0.18;
const BOX_HEIGHT = 2.06 - BOX_BOTTOM;
/** Width of one player with arms at rest. */
const PLAYER_WIDTH = 0.8;

export function freeRegion({ width }: Viewport): FreeRegion {
  // Nav, matchup line and the (small) team names on top; a one-line hint at the bottom.
  if (width >= 1024) return { top: 132, bottom: 44, side: 40 };
  if (width >= 640) return { top: 124, bottom: 44, side: 24 };
  return { top: 112, bottom: 44, side: 18 };
}

/**
 * Where the team names' centers sit: this many CSS px left and right of the screen's center
 * (two equal columns in a container up to 1100 px wide, px-4 / sm:px-10, gap-4).
 */
export function labelOffset(width: number): number {
  const pad = width >= 640 ? 40 : 16;
  return (Math.min(width, 1100) - 2 * pad) / 4 + 4;
}

export function frameCamera(viewport: Viewport, fovDeg: number, region = freeRegion(viewport)): Framing {
  const { width: W, height: H } = viewport;
  const h = Math.max(1, H - region.top - region.bottom);
  const t = Math.tan(((fovDeg / 2) * Math.PI) / 180);
  const aspect = W / H;
  const offset = labelOffset(W);
  // Closest distance where the box fits the region's height...
  const byHeight = (BOX_HEIGHT * H) / (2 * t * h);
  // ...and where each player, centered under its name, stays inside the side margins.
  const room = Math.max(1, W / 2 - region.side - offset);
  const byWidth = ((PLAYER_WIDTH / 2) * (W / 2)) / (room * t * aspect);
  const distance = Math.max(byHeight, byWidth);
  // Put each player's center under its team name.
  const playerX = (offset / (W / 2)) * distance * t * aspect;
  // Shift the camera so the box's center lands on the region's center.
  const cy = 1 - ((region.top + h / 2) / H) * 2;
  return {
    distance,
    x: 0,
    y: BOX_BOTTOM + BOX_HEIGHT / 2 - cy * distance * t,
    playerX,
  };
}
