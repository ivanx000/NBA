// Draws the site's icons from the basketball mark (components/ball-mark.tsx; keep BALL_SEAMS in
// step with it). Run from web/: `node scripts/make-icons.mjs`.
//   app/icon.svg          black ball, white in dark mode (the browser tab)
//   app/favicon.ico       16/32/48 px, black ball with a thin white edge (readable on any tab)
//   app/apple-icon.png    180 px, black ball on white
//   public/brand/avatar.png  512 px, black ball on white (upload as the Vercel project avatar)
import { writeFileSync } from "node:fs";
import sharp from "sharp";

const SEAMS = [
  "M-4.9 30.5 C 24.3 18.4, 43.8 18.2, 64.4 29.4",
  "M9.2 6.7 C 25.4 7.6, 35.9 12.5, 35.5 22.8 C 35.1 32.9, 21.6 43.3, 0.6 53.6",
  "M32.6 -0.4 C 41.4 5.2, 44.6 14, 44.5 29 C 44.4 41, 41.6 52, 27.3 64.4",
  "M55.6 6 C 53.7 12, 51.3 19, 51.9 25.5 C 52.5 32, 55.9 38, 57.3 53.6",
];

/** The mark as an SVG; `inset` shrinks the ball inside the 64 box, `halo` adds a white edge. */
function svg({ fill = "#000", style = "", background = "", inset = 2, halo = 0 } = {}) {
  const r = 32 - inset;
  const s = r / 30; // seams are drawn for r = 30
  const seams = SEAMS.map((d) => `<path d="${d}"/>`).join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">${style}
  <mask id="m"><rect width="64" height="64" fill="#fff"/><g fill="none" stroke="#000" stroke-width="3.6" transform="translate(32 32) scale(${s}) translate(-32 -32)">${seams}</g></mask>
  ${background ? `<rect width="64" height="64" fill="${background}"/>` : ""}${halo ? `<circle cx="32" cy="32" r="${r + halo}" fill="#fff"/>` : ""}
  <circle class="ball" cx="32" cy="32" r="${r}" fill="${fill}" mask="url(#m)"/>
</svg>
`;
}

const png = (s, size) => sharp(Buffer.from(s), { density: 72 * (size / 64) * 2 }).resize(size, size).png().toBuffer();

// Browser tab: follows the system's light or dark mode.
writeFileSync(
  "app/icon.svg",
  svg({ style: "<style>.ball{fill:#000}@media (prefers-color-scheme:dark){.ball{fill:#fff}}</style>" }),
);

// favicon.ico: PNG images inside an ICO container.
const sizes = [16, 32, 48];
const images = await Promise.all(sizes.map((n) => png(svg({ inset: 3, halo: 1.6 }), n)));
const header = Buffer.alloc(6 + 16 * sizes.length);
header.writeUInt16LE(0, 0);
header.writeUInt16LE(1, 2);
header.writeUInt16LE(sizes.length, 4);
let offset = header.length;
sizes.forEach((n, i) => {
  const e = 6 + 16 * i;
  header.writeUInt8(n % 256, e);
  header.writeUInt8(n % 256, e + 1);
  header.writeUInt16LE(1, e + 4);
  header.writeUInt16LE(32, e + 6);
  header.writeUInt32LE(images[i].length, e + 8);
  header.writeUInt32LE(offset, e + 12);
  offset += images[i].length;
});
writeFileSync("app/favicon.ico", Buffer.concat([header, ...images]));

writeFileSync("app/apple-icon.png", await png(svg({ background: "#fff", inset: 9 }), 180));
writeFileSync("public/brand/avatar.png", await png(svg({ background: "#fff", inset: 8 }), 512));
console.log("icons written");
