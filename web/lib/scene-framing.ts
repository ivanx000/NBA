/**
 * Camera framing for the home scene: make the two players as big as possible inside the part of
 * the screen the UI leaves free (right of the game wheel on desktop, above the wheel and Predict
 * button on phones).
 */

export interface Viewport {
  width: number;
  height: number;
}

/** Screen space (CSS px) the players may use; the rest is covered by UI. */
export interface FreeRegion {
  left: number;
  top: number;
  bottom: number;
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

/** Both players, feet on the floor: about 2 m tall, plus room for raised arms. */
const BOX_HEIGHT = 2.3;
const BOX_CENTER_Y = 1.1;
/** Width of one player with arms at rest, and the gap between them. */
const PLAYER_WIDTH = 0.8;

export function freeRegion({ width }: Viewport): FreeRegion {
  // Desktop: wheel on the left; header and team names on top; Predict at the bottom.
  if (width >= 1024) return { left: 380, top: 150, bottom: 130 };
  // Phones and tablets: header and team names on top; Predict and the wheel at the bottom.
  return { left: 0, top: 140, bottom: 350 };
}

export function frameCamera(viewport: Viewport, fovDeg: number, region = freeRegion(viewport)): Framing {
  const { width: W, height: H } = viewport;
  const w = Math.max(1, W - region.left);
  const h = Math.max(1, H - region.top - region.bottom);
  const t = Math.tan(((fovDeg / 2) * Math.PI) / 180);
  const aspect = W / H;
  // Narrow regions bring the players closer together.
  const playerX = Math.min(0.95, Math.max(0.55, (w / h) * 0.45));
  const boxWidth = 2 * playerX + PLAYER_WIDTH;
  // Closest distance at which the box fits both the region's height and its width.
  const distance = Math.max((BOX_HEIGHT * H) / (2 * t * h), (boxWidth * H) / (2 * t * w));
  // Shift the camera so the box's center lands on the region's center.
  const cx = ((region.left + w / 2) / W) * 2 - 1;
  const cy = 1 - ((region.top + h / 2) / H) * 2;
  return {
    distance,
    x: -cx * distance * t * aspect,
    y: BOX_CENTER_Y - cy * distance * t,
    playerX,
  };
}
