"use client";

import { useEffect, useRef } from "react";

/** Magnification at the lens's middle and the ripple's size, matching the 3D lens (scene/lens-effect.ts). */
const ZOOM = 1.14;
const RIPPLE = 0.035;
/** Lens radius in CSS px at a 1080 px tall window (the 3D lens uses the same). */
const RADIUS_AT_1080 = 60;
const MAP = 256;

/**
 * A displacement map for one lens: red is the x shift, green the y shift (0.5 = none). Inside the
 * circle each pixel reads from closer to the middle (the magnification) plus a ring ripple, fading
 * to no shift at the rim, exactly like the 3D lens. Returns the map and the largest shift (px).
 */
function lensMap(radius: number): { url: string; maxShift: number } {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = MAP;
  const ctx = canvas.getContext("2d")!;
  const img = ctx.createImageData(MAP, MAP);
  const maxShift = radius * ((1 - 1 / ZOOM) + RIPPLE) * 1.05;
  for (let y = 0; y < MAP; y++) {
    for (let x = 0; x < MAP; x++) {
      const dx = (x + 0.5) / MAP * 2 - 1;
      const dy = (y + 0.5) / MAP * 2 - 1;
      const r = Math.hypot(dx, dy);
      let k = Math.max(0, 1 - r * r * (3 - 2 * Math.min(1, r))); // 1 - smoothstep(0, 1, r)
      if (r >= 1) k = 0;
      k = k * k * (3 - 2 * k);
      const ripple = Math.sin(r * 9) * RIPPLE;
      const n = r > 1e-5 ? 1 / r : 0;
      // Shift in px: toward the middle by the magnification, along the radius by the ripple.
      const sx = (-dx * radius * (1 - 1 / ZOOM) + dx * n * ripple * radius) * k;
      const sy = (-dy * radius * (1 - 1 / ZOOM) + dy * n * ripple * radius) * k;
      const i = (y * MAP + x) * 4;
      img.data[i] = Math.round((0.5 + sx / (2 * maxShift)) * 255);
      img.data[i + 1] = Math.round((0.5 + sy / (2 * maxShift)) * 255);
      img.data[i + 2] = 128;
      img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return { url: canvas.toDataURL(), maxShift };
}

/**
 * The cursor lens over the home screen's page layers (the matchup line, team names, nav, games
 * drawer, hint), so the whole Predict screen swims under the cursor, not just the 3D scene. Each
 * layer marked `data-lens` (and the site header) gets its own SVG filter whose displacement map
 * follows the cursor: the same magnification and ripple as the 3D lens (without its color split,
 * which would thicken the text's edges). The filter is only attached while the lens is showing,
 * so the layers are untouched the rest of the time. The results panel isn't a target: a filter on
 * it would turn off its frosted-glass blur. Mouse only; off with reduced motion.
 */
export function UiLens() {
  const svg = useRef<SVGSVGElement>(null);
  useEffect(() => {
    const host = svg.current;
    if (!host) return;
    if (!window.matchMedia("(pointer: fine)").matches) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const NS = "http://www.w3.org/2000/svg";
    const targets = () =>
      [document.querySelector<HTMLElement>("header"), ...document.querySelectorAll<HTMLElement>("[data-lens]")].filter(
        (el): el is HTMLElement => el !== null,
      );

    let radius = 0;
    let map = { url: "", maxShift: 1 };
    const remap = () => {
      radius = RADIUS_AT_1080 * (window.innerHeight / 1080);
      map = lensMap(radius);
    };
    remap();

    // One filter per layer (each needs the cursor in its own coordinates).
    const filters = new Map<HTMLElement, { id: string; image: SVGFEImageElement; map: SVGFEDisplacementMapElement; url: string }>();
    const filterFor = (el: HTMLElement) => {
      let f = filters.get(el);
      if (f) return f;
      const id = `ui-lens-${filters.size}`;
      const filter = document.createElementNS(NS, "filter");
      filter.setAttribute("id", id);
      filter.setAttribute("filterUnits", "userSpaceOnUse");
      filter.setAttribute("primitiveUnits", "userSpaceOnUse");
      filter.setAttribute("color-interpolation-filters", "sRGB");
      filter.setAttribute("x", "-50");
      filter.setAttribute("y", "-50");
      filter.setAttribute("width", "100000");
      filter.setAttribute("height", "100000");
      // A neutral map everywhere, the lens map laid over it at the cursor.
      filter.innerHTML = `
        <feFlood flood-color="rgb(128,128,128)" result="neutral" />
        <feImage preserveAspectRatio="none" result="lens" />
        <feComposite in="lens" in2="neutral" operator="over" result="map" />
        <feDisplacementMap in="SourceGraphic" in2="map" xChannelSelector="R" yChannelSelector="G" />`;
      host.querySelector("defs")!.appendChild(filter);
      f = { id, image: filter.querySelector("feImage")!, map: filter.querySelector("feDisplacementMap")!, url: "" };
      filters.set(el, f);
      return f;
    };

    let x = -9999;
    let y = -9999;
    let movedAt = -1e9;
    let strength = 0;
    let frame = 0;
    let last = performance.now();
    let attached = false;
    const tick = (now: number) => {
      frame = requestAnimationFrame(tick);
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      const live = now - movedAt < 1200;
      strength += ((live ? 1 : 0) - strength) * Math.min(1, dt * 6);
      const els = targets();
      if (strength < 0.01) {
        if (attached) for (const el of els) el.style.filter = "";
        attached = false;
        return;
      }
      attached = true;
      // The ripple breathes like the 3D one.
      const scale = 2 * map.maxShift * strength * (1 + 0.12 * Math.sin(now / 1000 * 3));
      for (const el of els) {
        const f = filterFor(el);
        const box = el.getBoundingClientRect();
        if (f.url !== map.url) {
          f.image.setAttribute("href", map.url);
          f.url = map.url;
        }
        f.image.setAttribute("x", String(x - box.left - radius));
        f.image.setAttribute("y", String(y - box.top - radius));
        f.image.setAttribute("width", String(2 * radius));
        f.image.setAttribute("height", String(2 * radius));
        f.map.setAttribute("scale", String(scale));
        const want = `url(#${f.id})`;
        if (el.style.filter !== want) el.style.filter = want;
      }
    };
    const onMove = (e: PointerEvent) => {
      if (e.pointerType !== "mouse") return;
      x = e.clientX;
      y = e.clientY;
      movedAt = performance.now();
    };
    const onLeave = () => (movedAt = -1e9);
    window.addEventListener("pointermove", onMove, { passive: true });
    window.addEventListener("resize", remap);
    document.documentElement.addEventListener("pointerleave", onLeave);
    frame = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("resize", remap);
      document.documentElement.removeEventListener("pointerleave", onLeave);
      for (const el of filters.keys()) el.style.filter = "";
    };
  }, []);

  return (
    <svg ref={svg} width="0" height="0" aria-hidden className="pointer-events-none absolute">
      <defs />
    </svg>
  );
}
