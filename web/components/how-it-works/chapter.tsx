"use client";

import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { createContext, type ReactNode, useContext, useEffect, useRef, useState } from "react";

/** How far the reader has scrolled through the current chapter, 0 to 1 (1 with reduced motion). */
const ProgressContext = createContext(0);
export const useChapterProgress = () => useContext(ProgressContext);

/**
 * One chapter of the scroll story. On wide screens it pins (text and visual stay put) while the
 * reader scrolls through it, and the visual plays forward and back with the scroll. On narrow
 * screens it scrolls normally and the visual plays as it passes. Reduced motion shows every
 * visual in its finished state.
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
    <section ref={ref} id={id} className="story-chapter" aria-labelledby={`${id}-title`}>
      <div className="story-chapter__stage">
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
        <div className="story-chapter__visual">
          <ProgressContext value={progress}>{visual}</ProgressContext>
        </div>
      </div>
    </section>
  );
}
