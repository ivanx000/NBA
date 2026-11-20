import type { CSSProperties, ReactNode } from "react";

import "./skeleton.css";

/** One placeholder bar. */
export function Bone({ w = "100%", h = "0.9rem", className = "", style }: {
  w?: string; h?: string; className?: string; style?: CSSProperties;
}) { // prettier-ignore
  return <span className={`bone ${className}`} style={{ width: w, height: h, ...style }} aria-hidden />;
}

function Skeleton({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="skeleton" role="status" aria-busy="true">
      <span className="sr-only">{label}</span>
      {children}
    </div>
  );
}

function Panel({ children }: { children: ReactNode }) {
  return <div className="skeleton__panel holo-panel">{children}</div>;
}

function Tiles({ n }: { n: number }) {
  return (
    <div className="skeleton__tiles">
      {Array.from({ length: n }, (_, i) => (
        <div key={i} className="skeleton__tile">
          <Bone w="45%" h="0.55rem" />
          <Bone w="60%" h="1.1rem" />
        </div>
      ))}
    </div>
  );
}

/** /game/[id] while the game loads: the breakdown's shape. */
export function GameSkeleton() {
  return (
    <Skeleton label="Loading the game">
      <Bone w="11rem" h="0.7rem" />
      <Bone w="min(36rem, 90%)" h="3.2rem" className="skeleton__title" />
      <Bone w="min(22rem, 70%)" h="3.2rem" />
      <Panel>
        <Bone w="6rem" h="0.6rem" />
        <div className="skeleton__split">
          <Bone w="5rem" h="1.6rem" />
          <Bone w="5rem" h="1.6rem" />
        </div>
        <Bone h="0.6rem" />
        <Bone w="80%" h="0.7rem" />
        {[90, 70, 55].map((w) => (
          <Bone key={w} w={`${w}%`} h="0.5rem" />
        ))}
      </Panel>
      <div className="skeleton__two">
        {[0, 1].map((i) => (
          <Panel key={i}>
            <Bone w="40%" h="0.6rem" />
            <Bone w="55%" h="1.8rem" />
            <Tiles n={9} />
          </Panel>
        ))}
      </div>
    </Skeleton>
  );
}

/** /performance while the graded games load: headline, tiles and a chart. */
export function PerformanceSkeleton() {
  return (
    <Skeleton label="Loading the report card">
      <Bone w="8rem" h="2rem" style={{ borderRadius: "999px" }} />
      <Bone w="min(30rem, 90%)" h="1.4rem" className="skeleton__title" />
      <Bone w="min(24rem, 75%)" h="0.7rem" />
      <div className="skeleton__four">
        {[0, 1, 2, 3].map((i) => (
          <Panel key={i}>
            <Bone w="50%" h="0.55rem" />
            <Bone w="65%" h="2rem" />
            <Bone w="80%" h="0.55rem" />
          </Panel>
        ))}
      </div>
      <Panel>
        <Bone w="10rem" h="0.6rem" />
        <Bone h="14rem" className="skeleton__chart" />
      </Panel>
    </Skeleton>
  );
}
