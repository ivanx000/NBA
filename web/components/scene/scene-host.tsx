"use client";

import dynamic from "next/dynamic";
import { Component, type ReactNode, useSyncExternalStore } from "react";

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

let webglSupport: boolean | undefined;
function detectWebGL(): boolean {
  if (webglSupport === undefined) {
    // `?webgl=0` forces the 2D fallback, for checking it on any device.
    if (new URLSearchParams(window.location.search).get("webgl") === "0") return (webglSupport = false);
    try {
      const canvas = document.createElement("canvas");
      webglSupport = Boolean(canvas.getContext("webgl2") ?? canvas.getContext("webgl"));
    } catch {
      webglSupport = false;
    }
  }
  return webglSupport;
}
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
