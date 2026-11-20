import { type SVGProps, useId } from "react";

/**
 * The site's mark: a plain basketball, a solid ball with its seams cut out. The seams were traced
 * from the reference icon the user chose (measured band centers, fitted cubic curves). It takes the text
 * color (`currentColor`). `scripts/make-icons.mjs` draws the favicon and app icons from the same
 * paths, so keep the two in step.
 */
export const BALL_SEAMS = [
  "M-4.9 30.5 C 24.3 18.4, 43.8 18.2, 64.4 29.4",
  "M9.2 6.7 C 25.4 7.6, 35.9 12.5, 35.5 22.8 C 35.1 32.9, 21.6 43.3, 0.6 53.6",
  "M32.6 -0.4 C 41.4 5.2, 44.6 14, 44.5 29 C 44.4 41, 41.6 52, 27.3 64.4",
  "M55.6 6 C 53.7 12, 51.3 19, 51.9 25.5 C 52.5 32, 55.9 38, 57.3 53.6",
];

export function BallMark({ title, ...props }: SVGProps<SVGSVGElement> & { title?: string }) {
  const id = `ball-${useId().replace(/:/g, "")}`;
  return (
    <svg viewBox="0 0 64 64" role={title ? "img" : undefined} aria-hidden={title ? undefined : true} {...props}>
      {title && <title>{title}</title>}
      <mask id={id}>
        <rect width="64" height="64" fill="#fff" />
        <g fill="none" stroke="#000" strokeWidth="3.6">
          {BALL_SEAMS.map((d) => (
            <path key={d} d={d} />
          ))}
        </g>
      </mask>
      <circle cx="32" cy="32" r="30" fill="currentColor" mask={`url(#${id})`} />
    </svg>
  );
}
