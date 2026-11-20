"use client";

import { useEffect, useRef, useState } from "react";

const ease = (t: number) => 1 - (1 - t) ** 3;

/**
 * A number that counts up when it first scrolls into view, and glides to its new value when it
 * changes (e.g. switching seasons). Screen readers and reduced motion get the final value only.
 */
export function CountUp({
  value,
  format,
  duration = 900,
  className,
}: {
  value: number;
  format: (n: number) => string;
  duration?: number;
  className?: string;
}) {
  const ref = useRef<HTMLSpanElement>(null);
  // The in-between number while animating; null shows ``value`` itself.
  const [between, setBetween] = useState<number | null>(null);
  const at = useRef(value);
  const seen = useRef(false);

  useEffect(() => {
    const el = ref.current;
    if (!el || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    let frame = 0;
    const run = (start: number) => {
      const t0 = performance.now();
      const step = (now: number) => {
        const t = Math.min(1, (now - t0) / duration);
        at.current = start + (value - start) * ease(t);
        setBetween(t < 1 ? at.current : null);
        if (t < 1) frame = requestAnimationFrame(step);
      };
      frame = requestAnimationFrame(step);
    };
    if (seen.current) {
      run(at.current);
      return () => cancelAnimationFrame(frame);
    }
    // The first time: count up from zero once it's on screen.
    const io = new IntersectionObserver(([e]) => {
      if (!e.isIntersecting) return;
      io.disconnect();
      seen.current = true;
      run(0);
    });
    io.observe(el);
    return () => {
      io.disconnect();
      cancelAnimationFrame(frame);
    };
  }, [value, duration]);

  return (
    <span ref={ref} className={className}>
      <span aria-hidden>{format(between ?? value)}</span>
      <span className="sr-only">{format(value)}</span>
    </span>
  );
}
