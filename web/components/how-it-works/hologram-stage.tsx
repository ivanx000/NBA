"use client";

import dynamic from "next/dynamic";
import { Component, type ReactNode, useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";

import { EXAMPLE } from "@/lib/story";
import { hologramMatchup } from "@/lib/team-colors";
import { requireTeam } from "@/lib/teams";
import { detectWebGL } from "@/lib/webgl";

import { useChapterProgress } from "./chapter";

const HologramCanvas = dynamic(() => import("./hologram-canvas"), { ssr: false });

function Loading() {
  return (
    <div className="story-holo__loading" role="status" aria-label="Loading the hologram">
      <span className="basketball-loader" aria-hidden />
    </div>
  );
}

const team = requireTeam(EXAMPLE.home);
const side = hologramMatchup(team, requireTeam(EXAMPLE.away)).home;

const reducedQuery = "(prefers-reduced-motion: reduce)";
function subscribeReduced(cb: () => void) {
  const mq = window.matchMedia(reducedQuery);
  mq.addEventListener("change", cb);
  return () => mq.removeEventListener("change", cb);
}
const noop = () => () => {};

class Boundary extends Component<{ fallback: ReactNode; children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}

/** Without WebGL: the jersey as a flat badge in the team's glow color. */
function Flat() {
  return (
    <div className="story-holo__flat" style={{ color: side.color }}>
      <span>{team.jersey.chest_text}</span>
      <b>{team.jersey.number}</b>
    </div>
  );
}

/**
 * Chapter 5's hologram. three.js loads only when the chapter comes near the screen, and the
 * player takes his shot once the chapter is well in view (or when asked to again).
 */
export function HologramStage() {
  const p = useChapterProgress();
  const box = useRef<HTMLDivElement>(null);
  const [near, setNear] = useState(false);
  const [ready, setReady] = useState(false);
  const onReady = useCallback(() => setReady(true), []);
  const webgl = useSyncExternalStore<boolean | null>(noop, detectWebGL, () => null);
  const still = useSyncExternalStore(subscribeReduced, () => window.matchMedia(reducedQuery).matches, () => true);
  // The first shot starts from the scroll; the button asks for another.
  const [asked, setAsked] = useState(false);
  const shooting = asked || (!still && p > 0.35);

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const io = new IntersectionObserver(([e]) => e.isIntersecting && setNear(true), { rootMargin: "400px 0px" });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  // A replay goes through idle for a frame, so the clip restarts.
  const [idleFrame, setIdleFrame] = useState(false);
  const again = () => {
    setIdleFrame(true);
    requestAnimationFrame(() => {
      setIdleFrame(false);
      setAsked(true);
    });
  };

  return (
    <figure className="story-panel story-holo">
      <div ref={box} className="story-holo__canvas">
        {webgl === false ? (
          <Flat />
        ) : near && webgl ? (
          <Boundary fallback={<Flat />}>
            <HologramCanvas team={team} side={side} shooting={shooting && !idleFrame} still={still} onReady={onReady} />
          </Boundary>
        ) : null}
        {webgl !== false && !ready && <Loading />}
      </div>
      <figcaption className="story-panel__head">
        <span>
          {team.city} {team.name} <span className="text-muted-foreground">#{team.jersey.number}</span>
        </span>
        {!still && webgl && (
          <button type="button" className="story-holo__again" onClick={again}>
            Take the shot
          </button>
        )}
      </figcaption>
    </figure>
  );
}
