"use client";

import { useEffect } from "react";

/**
 * Tracks the pointer for the site's pointer effects (globals.css): a soft glow that follows it
 * across the page, and the spotlight inside every glass panel. It only writes two CSS variables
 * (and a flag) on <html>, never on page content, so it can't disturb hydration of streamed parts.
 *
 * Touch screens and reduced motion get neither. (Scroll reveals are pure CSS; tilt is lib/tilt.ts.)
 */
export function Interactions() {
  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    if (!window.matchMedia("(pointer: fine)").matches) return;
    const root = document.documentElement;
    let frame = 0;
    let x = -999;
    let y = -999;
    const apply = () => {
      frame = 0;
      root.style.setProperty("--px", `${x}px`);
      root.style.setProperty("--py", `${y}px`);
    };
    const onMove = (e: PointerEvent) => {
      if (e.pointerType === "touch") return;
      x = e.clientX;
      y = e.clientY;
      if (!frame) frame = requestAnimationFrame(apply);
    };
    const onLeave = () => {
      x = y = -999;
      if (!frame) frame = requestAnimationFrame(apply);
    };
    root.dataset.pointer = "";
    window.addEventListener("pointermove", onMove, { passive: true });
    document.documentElement.addEventListener("pointerleave", onLeave);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("pointermove", onMove);
      document.documentElement.removeEventListener("pointerleave", onLeave);
      delete root.dataset.pointer;
    };
  }, []);

  return <div className="cursor-glow" aria-hidden />;
}
