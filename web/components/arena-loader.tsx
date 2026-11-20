import { BallMark } from "@/components/ball-mark";

import "./arena-loader.css";

/**
 * The loading screen: the site's basketball dribbling on the arena's navy glow, a mono label and
 * a red hairline sweeping under it. It fades in after a beat, so quick loads never flash it.
 * `backdrop={false}` drops the room's background (for loaders inside a page section).
 */
export function ArenaLoader({ label, backdrop = true }: { label: string; backdrop?: boolean }) {
  return (
    <div className="arena-loader" data-backdrop={backdrop} role="status">
      <div className="arena-loader__court" aria-hidden>
        <span className="arena-loader__ball">
          <BallMark className="arena-loader__mark" />
        </span>
        <span className="arena-loader__shadow" />
      </div>
      <p className="arena-loader__label">{label}</p>
      <span className="arena-loader__line" aria-hidden />
    </div>
  );
}
