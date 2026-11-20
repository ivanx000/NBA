"use client";

import { type CSSProperties, useEffect, useState } from "react";

export interface Step {
  id: string;
  name: string;
}

/**
 * The story's progress bar: it slides in under the nav once the first chapter is reached, one
 * segment per step. Each segment fills as its chapter is read, the current one is lit, and
 * clicking one jumps to it.
 */
export function StoryProgress({ steps }: { steps: readonly Step[] }) {
  const [fill, setFill] = useState<number[]>(() => steps.map(() => 0));
  const [shown, setShown] = useState(false);

  useEffect(() => {
    let frame = 0;
    const measure = () => {
      frame = 0;
      const vh = window.innerHeight;
      const y = window.scrollY;
      // The page can't scroll past its end, so the last chapter's bottom never reaches mid-screen:
      // each segment is full by the time the page is scrolled to the bottom.
      const maxY = Math.max(0, document.documentElement.scrollHeight - vh);
      const next = steps.map(({ id }) => {
        const el = document.getElementById(id);
        if (!el) return 0;
        const r = el.getBoundingClientRect();
        // From the chapter's top reaching mid-screen to its bottom doing the same.
        const start = Math.min(r.top + y - vh * 0.5, maxY - 1);
        const end = Math.min(r.bottom + y - vh * 0.5, maxY);
        return Math.min(1, Math.max(0, (y - start) / Math.max(1, end - start)));
      });
      setFill((old) => (old.every((v, i) => Math.abs(v - next[i]) < 0.004) ? old : next));
      const first = document.getElementById(steps[0].id);
      setShown(first ? first.getBoundingClientRect().top < vh * 0.6 : false);
    };
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(measure);
    };
    measure();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
      cancelAnimationFrame(frame);
    };
  }, [steps]);

  // The current step: the last one that has started.
  const current = fill.reduce((at, f, i) => (f > 0 ? i : at), -1);

  return (
    <nav aria-label="Story progress" className="story-progress" data-shown={shown || undefined}>
      <ol>
        {steps.map((s, i) => (
          <li key={s.id}>
            <a
              href={`#${s.id}`}
              aria-current={i === current ? "step" : undefined}
              data-done={fill[i] >= 0.98 || undefined}
              style={{ "--f": fill[i].toFixed(3) } as CSSProperties}
            >
              <span className="story-progress__n" aria-hidden>
                {String(i + 1).padStart(2, "0")}
              </span>
              <span className="story-progress__name">{s.name}</span>
              <i aria-hidden />
            </a>
          </li>
        ))}
      </ol>
    </nav>
  );
}
