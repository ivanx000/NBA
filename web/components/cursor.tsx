"use client";

import { useEffect, useRef } from "react";

import { useScene } from "@/lib/scene-store";

const CLICKABLE = 'a, button, [role="button"], [tabindex]:not([tabindex="-1"]), summary, label, select';

/**
 * The cursor for mouse users, after the lions-share site: a thin ring with a small dot, both
 * exactly on the pointer. Over anything clickable the ring grows and turns red; over a player
 * who can be picked it grows further and reads PICK; it tightens while the button is down.
 * Touch screens and reduced motion keep the system cursor.
 */
export function Cursor() {
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = root.current;
    if (!el) return;
    if (!window.matchMedia("(pointer: fine)").matches) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const html = document.documentElement;
    html.classList.add("has-cursor");
    const parts = Array.from(el.children) as HTMLElement[];
    let target: Element | null = null;
    let pick = false;
    const label = el.querySelector<HTMLElement>(".cursor__label")!;

    const onMove = (e: PointerEvent) => {
      if (e.pointerType !== "mouse") return;
      const at = `translate3d(${e.clientX}px, ${e.clientY}px, 0)`;
      for (const p of parts) p.style.transform = at;
      target = e.target as Element;
      el.classList.add("is-on");
      update();
    };
    const update = () => {
      const control = target?.closest?.(CLICKABLE) ?? null;
      const disabled = !!control && (control as HTMLButtonElement).disabled === true;
      el.classList.toggle("is-hot", (!!control && !disabled) || pick);
      el.classList.toggle("is-blocked", disabled);
      el.classList.toggle("has-label", pick);
      label.textContent = pick ? "Pick" : "";
    };
    // A player under the pointer (the scene reports hover only while picking is possible).
    const unsubscribe = useScene.subscribe((s) => {
      const next = s.hover !== null && s.phase === "idle";
      if (next !== pick) {
        pick = next;
        update();
      }
    });
    const onLeave = () => el.classList.remove("is-on");
    const onDown = () => el.classList.add("is-down");
    const onUp = () => el.classList.remove("is-down");
    window.addEventListener("pointermove", onMove, { passive: true });
    html.addEventListener("pointerleave", onLeave);
    window.addEventListener("pointerdown", onDown);
    window.addEventListener("pointerup", onUp);
    return () => {
      unsubscribe();
      html.classList.remove("has-cursor");
      window.removeEventListener("pointermove", onMove);
      html.removeEventListener("pointerleave", onLeave);
      window.removeEventListener("pointerdown", onDown);
      window.removeEventListener("pointerup", onUp);
    };
  }, []);

  return (
    <div ref={root} className="cursor" aria-hidden>
      <span className="cursor__ring" />
      <span className="cursor__dot" />
      <span className="cursor__label" />
    </div>
  );
}
