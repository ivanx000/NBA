"use client";

import dynamic from "next/dynamic";
import { Component, type ReactNode, useSyncExternalStore } from "react";

import { detectWebGL } from "@/lib/webgl";

import type { ArenaSceneProps } from "./arena-scene";
import { Fallback2D } from "./fallback-2d";

function Loader() {
  return (
    <div className="grid h-full place-items-center" role="status" aria-label="Loading the arena">
      <span className="basketball-loader" aria-hidden />
    </div>
  );
}

const ArenaScene = dynamic(() => import("./arena-scene"), { ssr: false, loading: Loader });

const noop = () => () => {};

class SceneErrorBoundary extends Component<{ fallback: ReactNode; children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}

/** The 3D arena, or 2D team panels when WebGL is unavailable or the scene crashes (PRD F8). */
export function SceneHost(props: ArenaSceneProps) {
  const webgl = useSyncExternalStore<boolean | null>(noop, detectWebGL, () => null);
  const fallback = <Fallback2D game={props.game} winner={props.phase === "idle" ? null : props.pick} />;
  if (webgl === null) return <Loader />;
  if (!webgl) return fallback;
  return (
    <SceneErrorBoundary fallback={fallback}>
      <ArenaScene {...props} />
    </SceneErrorBoundary>
  );
}
