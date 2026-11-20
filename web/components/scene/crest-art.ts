/**
 * Draws a team's center-court crest (lib/crests.ts) onto a canvas: its shape filled in the team's
 * primary color with an edge in its accent color, one of four layouts of the city, nickname or
 * abbreviation in the site's own type, and its symbol. Symbols are simple geometric drawings,
 * never a team's mark. The canvas is transparent outside the shape.
 */
import type { Crest, CrestMotif, CrestShape } from "@/lib/crests";

export interface CrestColors {
  /** The field (the team's primary color). */
  field: string;
  /** The edge, ribbon and symbol (the team's most contrasting other color). */
  accent: string;
  /** Lettering (a soft white that doesn't bloom). */
  ink: string;
}

export interface CrestText {
  city: string;
  name: string;
  abbr: string;
  font: string;
}

type Ctx = CanvasRenderingContext2D;
const TAU = Math.PI * 2;

/* --- Shapes (centered at 0,0, radius r) ------------------------------------------------------ */

function polygon(ctx: Ctx, r: number, n: number, turn: number) {
  for (let i = 0; i < n; i++) {
    const a = turn + (i / n) * TAU;
    if (i === 0) ctx.moveTo(Math.cos(a) * r, Math.sin(a) * r);
    else ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r);
  }
  ctx.closePath();
}

function shapePath(ctx: Ctx, shape: CrestShape, r: number) {
  ctx.beginPath();
  switch (shape) {
    case "circle":
    case "roundel":
      ctx.arc(0, 0, r, 0, TAU);
      break;
    case "shield": {
      const w = r * 0.86;
      ctx.moveTo(-w, -r * 0.82);
      ctx.quadraticCurveTo(0, -r * 1.02, w, -r * 0.82);
      ctx.lineTo(w, r * 0.05);
      ctx.bezierCurveTo(w, r * 0.55, r * 0.35, r * 0.82, 0, r);
      ctx.bezierCurveTo(-r * 0.35, r * 0.82, -w, r * 0.55, -w, r * 0.05);
      ctx.closePath();
      break;
    }
    case "diamond":
      polygon(ctx, r, 4, -Math.PI / 2);
      break;
    case "hexagon":
      polygon(ctx, r, 6, 0);
      break;
    case "octagon":
      polygon(ctx, r, 8, Math.PI / 8);
      break;
    case "square": {
      const h = r * 0.8;
      const c = r * 0.16;
      ctx.roundRect(-h, -h, 2 * h, 2 * h, c);
      break;
    }
    case "badge": {
      // A scalloped seal: 20 shallow bumps round the edge.
      const n = 20;
      for (let i = 0; i <= n * 8; i++) {
        const a = (i / (n * 8)) * TAU;
        const rr = r * (0.94 + 0.06 * Math.cos(a * n));
        if (i === 0) ctx.moveTo(Math.cos(a) * rr, Math.sin(a) * rr);
        else ctx.lineTo(Math.cos(a) * rr, Math.sin(a) * rr);
      }
      ctx.closePath();
      break;
    }
  }
}

/* --- Symbols (centered at 0,0, half-size s, in the current fill and stroke) --------------------- */

function star(ctx: Ctx, x: number, y: number, r: number, points = 5, inner = 0.45) {
  ctx.beginPath();
  for (let i = 0; i < points * 2; i++) {
    const a = -Math.PI / 2 + (i * Math.PI) / points;
    const rr = i % 2 ? r * inner : r;
    ctx.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
  }
  ctx.closePath();
  ctx.fill();
}

function hex(ctx: Ctx, x: number, y: number, r: number) {
  ctx.beginPath();
  for (let i = 0; i < 6; i++) ctx.lineTo(x + Math.cos((i * TAU) / 6) * r, y + Math.sin((i * TAU) / 6) * r);
  ctx.closePath();
}

const MOTIFS: Record<CrestMotif, (ctx: Ctx, s: number, field: string) => void> = {
  feather(ctx, s, field) {
    ctx.save();
    ctx.rotate(-0.5);
    ctx.beginPath();
    ctx.moveTo(0, -s);
    ctx.bezierCurveTo(s * 0.55, -s * 0.6, s * 0.45, s * 0.4, 0, s * 0.7);
    ctx.bezierCurveTo(-s * 0.45, s * 0.4, -s * 0.55, -s * 0.6, 0, -s);
    ctx.fill();
    ctx.strokeStyle = field;
    ctx.lineWidth = s * 0.07;
    ctx.beginPath();
    ctx.moveTo(0, -s * 0.85);
    ctx.lineTo(0, s);
    ctx.stroke();
    // Notches in the vane.
    for (const [y, side] of [[-0.2, 1], [0.15, -1], [0.35, 1]] as const) {
      ctx.beginPath();
      ctx.moveTo(side * s * 0.5, y * s - s * 0.1);
      ctx.lineTo(side * s * 0.12, y * s + s * 0.06);
      ctx.stroke();
    }
    ctx.restore();
  },
  knot(ctx, s) {
    ctx.lineWidth = s * 0.14;
    for (let i = 0; i < 3; i++) {
      const a = -Math.PI / 2 + (i * TAU) / 3;
      ctx.beginPath();
      ctx.arc(Math.cos(a) * s * 0.4, Math.sin(a) * s * 0.4, s * 0.5, 0, TAU);
      ctx.stroke();
    }
    ctx.beginPath();
    ctx.arc(0, 0, s * 0.95, 0, TAU);
    ctx.stroke();
  },
  net(ctx, s) {
    ctx.lineWidth = s * 0.07;
    ctx.beginPath();
    ctx.ellipse(0, -s * 0.75, s * 0.85, s * 0.2, 0, 0, TAU);
    ctx.stroke();
    for (let i = -4; i <= 4; i++) {
      const top = (i / 4) * s * 0.85;
      const bot = (i / 4) * s * 0.45;
      ctx.beginPath();
      ctx.moveTo(top, -s * 0.7);
      ctx.lineTo(bot + s * 0.25, s);
      ctx.moveTo(top, -s * 0.7);
      ctx.lineTo(bot - s * 0.25, s);
      ctx.stroke();
    }
  },
  honeycomb(ctx, s) {
    const r = s * 0.34;
    const dx = r * 1.5;
    const dy = r * Math.sqrt(3);
    const cells: [number, number][] = [[0, 0], [0, -dy], [0, dy], [dx, -dy / 2], [dx, dy / 2], [-dx, -dy / 2], [-dx, dy / 2]];
    ctx.lineWidth = s * 0.08;
    cells.forEach(([x, y], i) => {
      hex(ctx, x, y, r * 0.92);
      if (i % 3 === 0) ctx.fill();
      else ctx.stroke();
    });
  },
  star6(ctx, s) {
    star(ctx, 0, 0, s, 6, 0.55);
  },
  chevrons(ctx, s) {
    ctx.lineWidth = s * 0.2;
    ctx.lineJoin = "miter";
    for (const y of [-0.55, 0, 0.55]) {
      ctx.beginPath();
      ctx.moveTo(-s * 0.85, (y - 0.3) * s);
      ctx.lineTo(0, (y + 0.25) * s);
      ctx.lineTo(s * 0.85, (y - 0.3) * s);
      ctx.stroke();
    }
  },
  horseshoe(ctx, s, field) {
    // A lucky horseshoe, open at the top: from upper right, round the bottom, to upper left.
    const R = s * 0.62;
    const a0 = -Math.PI / 5;
    const a1 = Math.PI + Math.PI / 5;
    ctx.lineWidth = s * 0.3;
    ctx.beginPath();
    ctx.arc(0, -s * 0.05, R, a0, a1, false);
    ctx.stroke();
    ctx.fillStyle = field;
    for (let i = 0; i < 6; i++) {
      const a = a0 + 0.25 + (i / 5) * (a1 - a0 - 0.5);
      ctx.beginPath();
      ctx.arc(Math.cos(a) * R, -s * 0.05 + Math.sin(a) * R, s * 0.05, 0, TAU);
      ctx.fill();
    }
  },
  gem(ctx, s, field) {
    ctx.beginPath();
    ctx.moveTo(-s * 0.55, -s * 0.6);
    ctx.lineTo(s * 0.55, -s * 0.6);
    ctx.lineTo(s * 0.95, -s * 0.15);
    ctx.lineTo(0, s * 0.95);
    ctx.lineTo(-s * 0.95, -s * 0.15);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = field;
    ctx.lineWidth = s * 0.05;
    ctx.beginPath();
    ctx.moveTo(-s * 0.95, -s * 0.15);
    ctx.lineTo(s * 0.95, -s * 0.15);
    for (const x of [-0.55, 0, 0.55]) {
      ctx.moveTo(x * s, -s * 0.6);
      ctx.lineTo(x * s * 0.6, -s * 0.15);
      ctx.lineTo(0, s * 0.95);
    }
    ctx.stroke();
  },
  gear(ctx, s, field) {
    ctx.beginPath();
    const teeth = 10;
    for (let i = 0; i < teeth * 2; i++) {
      const a0 = (i / (teeth * 2)) * TAU;
      const a1 = ((i + 1) / (teeth * 2)) * TAU;
      const rr = i % 2 ? s * 0.78 : s;
      ctx.arc(0, 0, rr, a0, a1);
    }
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = field;
    ctx.beginPath();
    ctx.arc(0, 0, s * 0.35, 0, TAU);
    ctx.fill();
  },
  waves(ctx, s) {
    ctx.lineWidth = s * 0.16;
    ctx.lineCap = "round";
    for (const y of [-0.5, 0, 0.5]) {
      ctx.beginPath();
      for (let i = 0; i <= 40; i++) {
        const x = -s + (i / 40) * 2 * s;
        ctx.lineTo(x, y * s + Math.sin((i / 40) * TAU * 1.5) * s * 0.16);
      }
      ctx.stroke();
    }
  },
  orbit(ctx, s) {
    ctx.lineWidth = s * 0.1;
    ctx.beginPath();
    ctx.ellipse(0, 0, s, s * 0.38, -0.45, 0, TAU);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(0, 0, s * 0.32, 0, TAU);
    ctx.fill();
    star(ctx, s * 0.72, -s * 0.62, s * 0.2, 4, 0.35);
  },
  checker(ctx, s) {
    const cols = 5;
    const rows = 4;
    const w = (2 * s * 0.85) / cols;
    const h = (s * 1.3) / rows;
    for (let c = 0; c < cols; c++)
      for (let r = 0; r < rows; r++) if ((c + r) % 2 === 0) ctx.fillRect(-s * 0.85 + c * w, -s * 0.75 + r * h, w, h);
    ctx.lineWidth = s * 0.06;
    ctx.strokeRect(-s * 0.85, -s * 0.75, 2 * s * 0.85, s * 1.3);
  },
  sail(ctx, s) {
    ctx.beginPath();
    ctx.moveTo(-s * 0.05, -s);
    ctx.lineTo(-s * 0.05, s * 0.45);
    ctx.lineTo(-s * 0.8, s * 0.45);
    ctx.closePath();
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(s * 0.08, -s * 0.75);
    ctx.lineTo(s * 0.75, s * 0.45);
    ctx.lineTo(s * 0.08, s * 0.45);
    ctx.closePath();
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(-s * 0.95, s * 0.6);
    ctx.lineTo(s * 0.95, s * 0.6);
    ctx.lineTo(s * 0.7, s * 0.9);
    ctx.lineTo(-s * 0.7, s * 0.9);
    ctx.closePath();
    ctx.fill();
  },
  palm(ctx, s) {
    ctx.lineWidth = s * 0.13;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(-s * 0.1, s);
    ctx.quadraticCurveTo(s * 0.15, s * 0.1, 0, -s * 0.45);
    ctx.stroke();
    for (const a of [-2.7, -2.1, -1.57, -1.05, -0.45]) {
      ctx.beginPath();
      ctx.moveTo(0, -s * 0.45);
      const ex = Math.cos(a) * s * 0.85;
      const ey = -s * 0.45 + Math.sin(a) * s * 0.55 + s * 0.15;
      ctx.quadraticCurveTo(Math.cos(a) * s * 0.45, -s * 0.45 + Math.sin(a) * s * 0.6, ex, ey + s * 0.25);
      ctx.stroke();
    }
  },
  claws(ctx, s) {
    for (const x of [-0.5, 0, 0.5]) {
      ctx.beginPath();
      ctx.moveTo((x + 0.32) * s, -s);
      ctx.quadraticCurveTo((x + 0.05) * s, 0, (x - 0.3) * s, s);
      ctx.quadraticCurveTo((x + 0.15) * s, 0, (x + 0.32) * s, -s);
      ctx.fill();
    }
  },
  sunrays(ctx, s) {
    ctx.beginPath();
    ctx.arc(0, 0, s * 0.42, 0, TAU);
    ctx.fill();
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * TAU;
      ctx.beginPath();
      ctx.moveTo(Math.cos(a - 0.12) * s * 0.55, Math.sin(a - 0.12) * s * 0.55);
      ctx.lineTo(Math.cos(a) * s, Math.sin(a) * s);
      ctx.lineTo(Math.cos(a + 0.12) * s * 0.55, Math.sin(a + 0.12) * s * 0.55);
      ctx.fill();
    }
  },
  diamonds(ctx, s) {
    for (const [x, k] of [[-0.62, 0.5], [0, 0.85], [0.62, 0.5]] as const) {
      ctx.beginPath();
      ctx.moveTo(x * s, -k * s);
      ctx.lineTo(x * s + k * s * 0.5, 0);
      ctx.lineTo(x * s, k * s);
      ctx.lineTo(x * s - k * s * 0.5, 0);
      ctx.closePath();
      ctx.fill();
    }
  },
  moon(ctx, s, field) {
    ctx.beginPath();
    ctx.arc(0, 0, s * 0.8, 0, TAU);
    ctx.fill();
    ctx.fillStyle = field;
    ctx.beginPath();
    ctx.arc(s * 0.35, -s * 0.2, s * 0.7, 0, TAU);
    ctx.fill();
    ctx.fillStyle = ctx.strokeStyle; // back to the symbol's color (motif() sets both)
    star(ctx, s * 0.55, s * 0.35, s * 0.18, 4, 0.35);
  },
  fleur(ctx, s) {
    // Center petal.
    ctx.beginPath();
    ctx.moveTo(0, -s);
    ctx.bezierCurveTo(s * 0.32, -s * 0.55, s * 0.25, -s * 0.05, 0, s * 0.15);
    ctx.bezierCurveTo(-s * 0.25, -s * 0.05, -s * 0.32, -s * 0.55, 0, -s);
    ctx.fill();
    // Side petals curling out and down.
    for (const k of [-1, 1]) {
      ctx.beginPath();
      ctx.moveTo(k * s * 0.08, s * 0.1);
      ctx.bezierCurveTo(k * s * 0.2, -s * 0.5, k * s * 0.95, -s * 0.55, k * s * 0.8, -s * 0.05);
      ctx.bezierCurveTo(k * s * 0.7, s * 0.2, k * s * 0.45, s * 0.05, k * s * 0.45, -s * 0.12);
      ctx.bezierCurveTo(k * s * 0.35, s * 0.05, k * s * 0.25, s * 0.2, k * s * 0.08, s * 0.25);
      ctx.fill();
    }
    // The band, and the stem below it.
    ctx.fillRect(-s * 0.5, s * 0.22, s, s * 0.14);
    ctx.beginPath();
    ctx.moveTo(-s * 0.18, s * 0.36);
    ctx.lineTo(s * 0.18, s * 0.36);
    ctx.lineTo(0, s * 0.95);
    ctx.closePath();
    ctx.fill();
  },
  stars(ctx, s) {
    // Five stars in an arc over the top, clear of the lettering below.
    for (let i = 0; i < 5; i++) {
      const a = Math.PI * (1.17 + (i / 4) * 0.66);
      star(ctx, Math.cos(a) * s * 0.8, Math.sin(a) * s * 0.8, s * 0.2);
    }
  },
  bolt(ctx, s) {
    ctx.beginPath();
    ctx.moveTo(s * 0.25, -s);
    ctx.lineTo(-s * 0.55, s * 0.12);
    ctx.lineTo(-s * 0.02, s * 0.12);
    ctx.lineTo(-s * 0.3, s);
    ctx.lineTo(s * 0.6, -s * 0.2);
    ctx.lineTo(s * 0.05, -s * 0.2);
    ctx.closePath();
    ctx.fill();
  },
  sparkle(ctx, s) {
    star(ctx, -s * 0.1, s * 0.05, s * 0.85, 4, 0.22);
    star(ctx, s * 0.62, -s * 0.6, s * 0.3, 4, 0.25);
  },
  stripes(ctx, s) {
    const n = 7;
    const h = (2 * s * 0.8) / (2 * n - 1);
    for (let i = 0; i < n; i++) ctx.fillRect(-s * 0.9, -s * 0.8 + i * 2 * h, s * 1.8, h);
  },
  cactus(ctx, s) {
    const arm = (x: number, y0: number, y1: number, w: number) => {
      ctx.beginPath();
      ctx.roundRect(x - w / 2, y0, w, y1 - y0, w / 2);
      ctx.fill();
    };
    arm(0, -s, s, s * 0.34);
    arm(-s * 0.55, -s * 0.55, s * 0.05, s * 0.24);
    ctx.fillRect(-s * 0.55, -s * 0.12, s * 0.5, s * 0.22);
    arm(s * 0.55, -s * 0.75, -s * 0.12, s * 0.24);
    ctx.fillRect(s * 0.05, -s * 0.36, s * 0.5, s * 0.22);
  },
  pines(ctx, s) {
    for (const [x, k] of [[-0.55, 0.7], [0, 1], [0.55, 0.75]] as const) {
      ctx.beginPath();
      ctx.moveTo(x * s, s * (0.8 - 1.7 * k));
      ctx.lineTo(x * s + s * 0.38 * k, s * 0.8);
      ctx.lineTo(x * s - s * 0.38 * k, s * 0.8);
      ctx.closePath();
      ctx.fill();
    }
    ctx.fillRect(-s * 0.05, s * 0.8, s * 0.1, s * 0.2);
  },
  laurel(ctx, s) {
    for (const k of [-1, 1]) {
      for (let i = 0; i < 7; i++) {
        const a = Math.PI * (0.62 + i * 0.1);
        const x = k * Math.cos(a) * -s * 0.8;
        const y = Math.sin(a) * s * 0.8 - s * 0.05;
        ctx.save();
        ctx.translate(x, y);
        ctx.rotate(k * (a - Math.PI / 2) + (k > 0 ? 0.6 : -0.6));
        ctx.beginPath();
        ctx.ellipse(0, 0, s * 0.09, s * 0.22, 0, 0, TAU);
        ctx.fill();
        ctx.restore();
      }
    }
  },
  lonestar(ctx, s, field) {
    star(ctx, 0, s * 0.05, s);
    ctx.fillStyle = field;
    star(ctx, 0, s * 0.05, s * 0.55);
    ctx.fillStyle = ctx.strokeStyle; // back to the symbol's color (motif() sets both)
    star(ctx, 0, s * 0.05, s * 0.4);
  },
  leaf(ctx, s) {
    // A maple leaf: the national symbol, simplified to a polygon.
    const pts = [
      [0, -1], [0.18, -0.62], [0.42, -0.72], [0.36, -0.3], [0.85, -0.42], [0.72, -0.12], [0.95, 0.02],
      [0.42, 0.32], [0.48, 0.5], [0.08, 0.42], [0.06, 0.95], [-0.06, 0.95], [-0.08, 0.42], [-0.48, 0.5],
      [-0.42, 0.32], [-0.95, 0.02], [-0.72, -0.12], [-0.85, -0.42], [-0.36, -0.3], [-0.42, -0.72], [-0.18, -0.62],
    ];
    ctx.beginPath();
    pts.forEach(([x, y], i) => (i ? ctx.lineTo(x * s, y * s) : ctx.moveTo(x * s, y * s)));
    ctx.closePath();
    ctx.fill();
  },
  equalizer(ctx, s) {
    const heights = [0.45, 0.8, 1.2, 1.7, 1.25, 0.9, 0.55];
    const w = (2 * s) / (heights.length * 1.5);
    heights.forEach((h, i) => {
      const x = -s + i * w * 1.5 + w * 0.25;
      ctx.beginPath();
      ctx.roundRect(x, s * 0.85 - h * s, w, h * s, w * 0.3);
      ctx.fill();
    });
  },
  obelisk(ctx, s) {
    ctx.beginPath();
    ctx.moveTo(0, -s);
    ctx.lineTo(s * 0.2, -s * 0.72);
    ctx.lineTo(s * 0.3, s * 0.75);
    ctx.lineTo(-s * 0.3, s * 0.75);
    ctx.lineTo(-s * 0.2, -s * 0.72);
    ctx.closePath();
    ctx.fill();
    ctx.fillRect(-s * 0.75, s * 0.8, s * 1.5, s * 0.16);
  },
};

function motif(ctx: Ctx, kind: CrestMotif, x: number, y: number, s: number, color: string, field: string, alpha = 1) {
  ctx.save();
  ctx.translate(x, y);
  ctx.globalAlpha = alpha;
  ctx.fillStyle = color;
  ctx.strokeStyle = color;
  MOTIFS[kind](ctx, s, field);
  ctx.restore();
}

/* --- Lettering --------------------------------------------------------------------------------- */

function text(ctx: Ctx, t: CrestText, str: string, x: number, y: number, size: number, maxW: number, opts: { slant?: number; squeeze?: number; spaced?: boolean } = {}) {
  ctx.save();
  ctx.translate(x, y);
  // Slanted or condensed by transform, so it works in every browser's canvas.
  ctx.transform(opts.squeeze ?? 1, 0, -(opts.slant ?? 0), 1, 0, 0);
  ctx.font = `900 ${size}px ${t.font}`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  const s = opts.spaced ? str.split("").join(" ") : str;
  ctx.fillText(s, 0, 0, maxW / (opts.squeeze ?? 1));
  ctx.restore();
}

/** City letters along the top of a circle, reading left to right. */
function arcText(ctx: Ctx, t: CrestText, str: string, r: number, size: number) {
  ctx.save();
  ctx.font = `800 ${size}px ${t.font}`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  const chars = str.split("");
  const step = (size * 0.95) / r;
  let a = -Math.PI / 2 - ((chars.length - 1) * step) / 2;
  for (const c of chars) {
    ctx.save();
    ctx.rotate(a + Math.PI / 2);
    ctx.fillText(c, 0, -r);
    ctx.restore();
    a += step;
  }
  ctx.restore();
}

/** Draws the crest centered on a square canvas of ``size`` px. */
export function drawCrest(ctx: Ctx, size: number, crest: Crest, colors: CrestColors, t: CrestText) {
  const r = size * 0.47;
  const city = t.city.toUpperCase();
  const name = t.name.toUpperCase();
  ctx.save();
  ctx.translate(size / 2, size / 2);

  // Field, then everything inside clipped to the shape.
  shapePath(ctx, crest.shape, r);
  ctx.fillStyle = colors.field;
  ctx.fill();
  ctx.save();
  ctx.clip();
  if (crest.shape === "roundel") {
    // A roundel's second ring, under the lettering.
    ctx.beginPath();
    ctx.arc(0, 0, r * 0.78, 0, TAU);
    ctx.lineWidth = size * 0.008;
    ctx.strokeStyle = colors.accent;
    ctx.stroke();
  }

  ctx.fillStyle = colors.ink;
  switch (crest.layout) {
    case "stacked":
      motif(ctx, crest.motif, 0, -r * 0.42, r * 0.26, colors.accent, colors.field);
      ctx.fillStyle = colors.ink;
      text(ctx, t, name, 0, r * 0.06, r * 0.3, r * 1.45);
      text(ctx, t, city, 0, r * 0.4, r * 0.11, r * 1.1, { spaced: true });
      break;
    case "ring":
      motif(ctx, crest.motif, 0, 0, r * 0.62, colors.accent, colors.field, 0.28);
      ctx.fillStyle = colors.ink;
      // Closer in on a diamond, whose edge comes in fast either side of the top.
      arcText(ctx, t, city, r * (crest.shape === "diamond" ? 0.58 : 0.66), r * 0.12);
      text(ctx, t, name, 0, r * 0.08, r * 0.3, r * 1.4, { slant: 0.2 });
      break;
    case "banner": {
      motif(ctx, crest.motif, 0, -r * 0.47, r * 0.24, colors.accent, colors.field);
      // A ribbon across the middle, its ends notched.
      const bw = r * 1.2;
      const bh = r * 0.36;
      ctx.fillStyle = colors.accent;
      ctx.beginPath();
      ctx.moveTo(-bw, -bh / 2);
      ctx.lineTo(bw, -bh / 2);
      ctx.lineTo(bw - bh * 0.35, 0);
      ctx.lineTo(bw, bh / 2);
      ctx.lineTo(-bw, bh / 2);
      ctx.lineTo(-bw + bh * 0.35, 0);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = colors.field;
      text(ctx, t, name, 0, r * 0.01, r * 0.25, bw * 1.55, { squeeze: 0.86 });
      ctx.fillStyle = colors.ink;
      text(ctx, t, city, 0, r * 0.42, r * 0.11, r * 1.1, { spaced: true });
      break;
    }
    case "monogram":
      motif(ctx, crest.motif, 0, -r * 0.05, r * 0.6, colors.accent, colors.field, 0.45);
      ctx.fillStyle = colors.ink;
      text(ctx, t, t.abbr, 0, -r * 0.04, r * 0.48, r * 1.4, { squeeze: 0.9 });
      text(ctx, t, name, 0, r * 0.47, r * 0.12, r * 1.1, { spaced: true });
      break;
  }
  ctx.restore();

  // The edge: a thick accent border with a thin inner line, and a second ring for a roundel.
  shapePath(ctx, crest.shape, r);
  ctx.lineWidth = size * 0.028;
  ctx.strokeStyle = colors.accent;
  ctx.stroke();
  ctx.save();
  ctx.scale(0.9, 0.9);
  shapePath(ctx, crest.shape, r);
  ctx.lineWidth = size * 0.007;
  ctx.strokeStyle = colors.ink;
  ctx.stroke();
  ctx.restore();
  ctx.restore();
}
