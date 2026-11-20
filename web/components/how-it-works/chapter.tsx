"use client";

import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { createContext, type CSSProperties, type PointerEvent, type ReactNode, useContext, useEffect, useRef, useState } from "react";

/** How far the reader has scrolled through the current chapter, 0 to 1 (1 with reduced motion). */
const ProgressContext = createContext(0);
export const useChapterProgress = () => useContext(ProgressContext);

/**
 * One chapter of the scroll story. On wide screens it pins (text and visual stay put) while the
 * reader scrolls through it, and the visual plays forward and back with the scroll. On narrow
 * screens it scrolls normally and the visual plays as it passes. Reduced motion shows every
 * visual in its finished state.
 *
 * No boxes: a huge outlined step number drifts behind the text with the scroll, and the visual
 * sits straight on the page over a soft glow that follows the pointer (and tilts a little toward
 * it, except with reduced motion).
 */
export function Chapter({
  id,
  step,
  name,
  title,
  figure,
  visual,
  children,
}: {
  id: string;
  step: number;
  /** The step's one-word name, e.g. "Data". */
  name: string;
  title: string;
  /** The chapter's big number (a client component reading the progress), if any. */
  figure?: ReactNode;
  visual: ReactNode;
  children: ReactNode;
}) {
  const ref = useRef<HTMLElement>(null);
  const [progress, setProgress] = useState(0);
  const visualBox = useRef<HTMLDivElement>(null);

  // The glow under the visual follows the pointer; CSS reads the position (and the tilt) from vars.
  const onPointer = (e: PointerEvent<HTMLDivElement>) => {
    const el = visualBox.current;
    if (!el || e.pointerType === "touch") return;
    const r = el.getBoundingClientRect();
    el.style.setProperty("--mx", `${((e.clientX - r.left) / r.width) * 100}%`);
    el.style.setProperty("--my", `${((e.clientY - r.top) / r.height) * 100}%`);
    el.style.setProperty("--tx", `${((e.clientX - r.left) / r.width - 0.5).toFixed(3)}`);
    el.style.setProperty("--ty", `${((e.clientY - r.top) / r.height - 0.5).toFixed(3)}`);
    el.dataset.hot = "";
  };
  const onLeave = () => {
    const el = visualBox.current;
    if (!el) return;
    el.style.setProperty("--tx", "0");
    el.style.setProperty("--ty", "0");
    delete el.dataset.hot;
  };

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    gsap.registerPlugin(ScrollTrigger);
    const mm = gsap.matchMedia();
    mm.add(
      {
        // gsap only runs the callback when a condition matches, so one always does.
        any: "all",
        reduce: "(prefers-reduced-motion: reduce)",
        // Must match the pinned layout in story.css.
        pinned: "(min-width: 1024px) and (min-height: 640px)",
      },
      (ctx) => {
        const { reduce, pinned } = ctx.conditions ?? {};
        if (reduce) {
          setProgress(1);
          return;
        }
        const update = (s: ScrollTrigger) => setProgress(s.progress);
        ScrollTrigger.create({
          trigger: el,
          // Pinned: play across the pinned stretch. Flowing: from entering the screen to the
          // visual being well in view.
          start: pinned ? "top top" : "top 85%",
          end: pinned ? "bottom bottom" : "center 40%",
          onUpdate: update,
          onRefresh: update,
        });
      },
    );
    return () => mm.revert();
  }, []);

  return (
    <section
      ref={ref}
      id={id}
      className="story-chapter"
      aria-labelledby={`${id}-title`}
      data-accent={step % 2 ? "blue" : "red"}
      style={{ "--p": progress.toFixed(3) } as CSSProperties}
    >
      <div className="story-chapter__stage">
        <span className="story-chapter__ghost" aria-hidden>
          {String(step).padStart(2, "0")}
        </span>
        <div className="story-chapter__text">
          <p className="story-step">
            <span className="story-step__n" aria-hidden>
              {step}
            </span>
            <span className="sr-only">Step {step} of 5: </span>
            {name}
          </p>
          <h2 id={`${id}-title`} className="story-title">
            {title}
          </h2>
          <ProgressContext value={progress}>
            {figure}
            <div className="story-body">{children}</div>
          </ProgressContext>
        </div>
        <div ref={visualBox} className="story-chapter__visual" onPointerMove={onPointer} onPointerLeave={onLeave}>
          <div className="story-chapter__tilt">
            <ProgressContext value={progress}>{visual}</ProgressContext>
          </div>
        </div>
      </div>
    </section>
  );
}
