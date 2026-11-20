import type { PointerEvent } from "react";

/**
 * Pointer handlers that tilt an element toward the pointer: spread them on the element along with
 * `data-tilt` (globals.css turns --tx/--ty, each -0.5..0.5, into a small 3D rotation). Mouse and
 * pen only; the CSS ignores it with reduced motion.
 */
export function tiltHandlers() {
  return {
    onPointerMove(e: PointerEvent<HTMLElement>) {
      if (e.pointerType === "touch") return;
      const el = e.currentTarget;
      const r = el.getBoundingClientRect();
      el.style.setProperty("--tx", ((e.clientX - r.left) / r.width - 0.5).toFixed(3));
      el.style.setProperty("--ty", ((e.clientY - r.top) / r.height - 0.5).toFixed(3));
    },
    onPointerLeave(e: PointerEvent<HTMLElement>) {
      e.currentTarget.style.setProperty("--tx", "0");
      e.currentTarget.style.setProperty("--ty", "0");
    },
  };
}
