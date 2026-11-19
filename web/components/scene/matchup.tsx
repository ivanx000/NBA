"use client";

/**
 * The two players, their pads, and the prediction cinematic (DESIGN.md section 4), driven by one
 * GSAP timeline per prediction:
 *
 *   reveal -> push-in over the winner's shoulder, he turns to the hoop -> hoop lights up ->
 *   jump shot, ball leaves his hands at the release frame -> flight and a confidence-based
 *   ending (swish / back iron / rattle) -> flash, sparks, net swings -> he turns back and
 *   celebrates while the camera settles on him -> results.
 *
 * The timeline sends the scene store's events (revealDone at the shot, shotDone at results), so
 * the page's UI follows it. Skip/Esc jump it to the results label; Back plays the return.
 */
import { useFrame } from "@react-three/fiber";
import gsap from "gsap";
import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";

import { CLIPS, HAND_BONE, JUMPSHOT_RELEASE_TIME } from "@/lib/scene-config";
import { useScene, type Phase } from "@/lib/scene-store";
import { shotOutcome, shotPath, type ShotPath } from "@/lib/shot-path";
import { winProb, type Side, type SlateGame } from "@/lib/slate";
import { hologramMatchup } from "@/lib/team-colors";
import { requireTeam } from "@/lib/teams";

import { cameraOverride, resetCameraOverride } from "./camera-override";
import { Ball, Burst, type BurstHandle, Hoop, type HoopHandle, RIM_HEIGHT_M, Trail, type TrailHandle } from "./cinematic-props";
import { Pad } from "./pad";
import { Player } from "./player";

/** Release to rim, along the floor (a long two). */
const SHOT_DISTANCE_M = 6.8;
const LEFT_HAND_BONE = "mixamorigLeftHand";
/** Timeline marks, in seconds (DESIGN.md section 4). */
const T = { pushIn: 0.4, turn: 0.6, hoop: 1.2, shot: 1.8 };

interface Run {
  timeline: gsap.core.Timeline | null;
  /** The ball rides in the shooter's hands until release. */
  held: boolean;
  hands: [THREE.Object3D, THREE.Object3D] | null;
  /** Shooter's facing direction once turned to the hoop. */
  facing: THREE.Vector3;
  rim: THREE.Vector3;
  path: ShotPath | null;
  flight: { t: number };
  ball: { scale: number };
  hoop: { opacity: number };
}

export function Matchup({
  game,
  phase,
  winner,
  reducedMotion,
  playerX,
}: {
  game: SlateGame;
  phase: Phase;
  winner: Side | null;
  reducedMotion: boolean;
  playerX: number;
}) {
  const send = useScene((s) => s.send);
  const setCinematic = useScene((s) => s.setCinematic);
  const sides = useMemo(() => {
    const home = requireTeam(game.home.teamId);
    const away = requireTeam(game.away.teamId);
    const holo = hologramMatchup(home, away);
    return [
      { side: "away", team: away, ...holo.away, x: -1, turn: 0.22, offset: 0 },
      { side: "home", team: home, ...holo.home, x: 1, turn: -0.22, offset: 2.7 },
    ] as const;
  }, [game]);
  const winnerSide = sides.find((s) => s.side === winner) ?? null;

  const [winnerClip, setWinnerClip] = useState<string>(CLIPS.idle[0]);
  const awaySpin = useRef<THREE.Group>(null);
  const homeSpin = useRef<THREE.Group>(null);
  const hoopRoot = useRef<THREE.Group>(null);
  const hoop = useRef<HoopHandle>(null);
  const ball = useRef<THREE.Mesh>(null);
  const trail = useRef<TrailHandle>(null);
  const burst = useRef<BurstHandle>(null);
  const run = useRef<Run>({
    timeline: null,
    held: false,
    hands: null,
    facing: new THREE.Vector3(0, 0, -1),
    rim: new THREE.Vector3(),
    path: null,
    flight: { t: 0 },
    ball: { scale: 0 },
    hoop: { opacity: 0 },
  });

  // While mounted, the cinematic drives the phases (the page's fallback timers stand down).
  useEffect(() => {
    const r = run.current;
    setCinematic(true);
    return () => {
      setCinematic(false);
      r.timeline?.kill();
      resetCameraOverride();
    };
  }, [setCinematic]);

  useEffect(() => {
    const r = run.current;
    const spin = winner === "home" ? homeSpin.current : awaySpin.current;

    const hideProps = () => {
      r.held = false;
      r.path = null;
      r.ball.scale = 0;
      if (ball.current) ball.current.visible = false;
      trail.current?.clear();
    };

    if (phase === "idle") {
      // A fresh start (first load, a new game, or after the return).
      r.timeline?.kill();
      r.timeline = null;
      hideProps();
      burst.current?.clear();
      r.hoop.opacity = 0;
      hoop.current?.setOpacity(0);
      resetCameraOverride();
      for (const g of [awaySpin.current, homeSpin.current]) if (g) g.rotation.y = 0;
      return;
    }

    if (phase === "revealing" && !r.timeline && spin && winnerSide) {
      const turn = winnerSide.turn;
      const wx = winnerSide.x * playerX;
      // Turned around to face the hoop: the model faces +z at rest, so after half a turn it faces
      // -z, a little to the side by its resting turn.
      r.facing.set(-Math.sin(turn), 0, -Math.cos(turn));
      const right = new THREE.Vector3(-r.facing.z, 0, r.facing.x);
      const feet = new THREE.Vector3(wx, 0, 0);
      r.rim.copy(feet).addScaledVector(r.facing, SHOT_DISTANCE_M).setY(RIM_HEIGHT_M);
      hoopRoot.current?.position.copy(r.rim);
      hoopRoot.current?.rotation.set(0, Math.atan2(-r.facing.x, -r.facing.z), 0);
      const left = spin.getObjectByName(LEFT_HAND_BONE);
      const rightHand = spin.getObjectByName(HAND_BONE);
      r.hands = left && rightHand ? [left, rightHand] : null;
      const outcome = shotOutcome(winProb(game, winnerSide.side) ?? 0.5);
      // Durations depend only on the outcome; the real path is computed at release.
      const plan = shotPath(r.rim, r.rim, outcome);
      const colors = [winnerSide.color, winnerSide.jersey.trim];

      // Shots: over his right shoulder looking down at the hoop, then a 3/4 hero shot in front.
      const o = cameraOverride;
      // Far enough back that his back and arms stay in frame below the hoop.
      o.position.copy(feet).addScaledVector(r.facing, -3.6).addScaledVector(right, 0.8).setY(2.2);
      o.target.copy(feet).addScaledVector(r.facing, 4).setY(1.95);
      o.fov = 42;
      o.weight = 0;
      const shotLook = r.rim.clone().setY(RIM_HEIGHT_M - 0.1);
      // Hero: his whole body, off to his side of the screen so the results panel (centered,
      // lower half) doesn't cover him.
      const hero = {
        position: new THREE.Vector3(wx * 0.2, 1.35, 5.4),
        target: new THREE.Vector3(wx * 0.2 - winnerSide.x * 0.9, 1.25, 0),
      };
      const showHoop = (opacity: number, duration: number, at: gsap.Position, tl: gsap.core.Timeline) =>
        tl.to(r.hoop, { opacity, duration, onUpdate: () => hoop.current?.setOpacity(r.hoop.opacity) }, at);

      const release = T.shot + JUMPSHOT_RELEASE_TIME;
      const make = release + plan.makeAt;
      const tl = gsap.timeline();
      tl.addLabel("reveal", 0)
        .to(o, { weight: 1, duration: 1.2, ease: "power2.inOut" }, T.pushIn)
        .to(spin.rotation, { y: Math.PI, duration: 0.7, ease: "power2.inOut" }, T.turn);
      showHoop(1, 0.6, T.hoop, tl)
        .addLabel("shot", T.shot)
        .call(
          () => {
            send({ type: "revealDone" });
            setWinnerClip(CLIPS.shot);
            r.held = true;
            if (ball.current) ball.current.visible = true;
          },
          [],
          "shot",
        )
        .fromTo(r.ball, { scale: 0 }, { scale: 1, duration: 0.25, ease: "back.out(2)" }, "shot")
        // Tilt up to follow the arc.
        .to(o.target, { x: shotLook.x, y: shotLook.y, z: shotLook.z, duration: 1.6, ease: "sine.inOut" }, "shot+=0.7")
        .to(o.position, { y: 2.4, duration: 1.6, ease: "sine.inOut" }, "shot+=0.7")
        .addLabel("release", release)
        .call(
          () => {
            r.held = false;
            const from = ball.current ? ball.current.position.clone() : r.rim.clone();
            r.path = shotPath(from, r.rim, outcome);
          },
          [],
          "release",
        )
        .fromTo(r.flight, { t: 0 }, { t: plan.duration, duration: plan.duration, ease: "none" }, "release")
        .addLabel("make", make)
        .call(
          () => {
            burst.current?.burst(r.rim, colors);
            hoop.current?.wobble();
          },
          [],
          "make",
        )
        .fromTo(o, { shake: 1 }, { shake: 0, duration: 0.35, ease: "power1.out" }, "make")
        .call(() => setWinnerClip(CLIPS.celebrate[0]), [], "make+=0.35")
        .to(spin.rotation, { y: Math.PI * 2, duration: 0.8, ease: "power2.inOut" }, "make+=0.3")
        .addLabel("results", make + 0.7)
        .call(() => send({ type: "shotDone" }), [], "results")
        .to(o.position, { ...hero.position, duration: 1.1, ease: "power2.inOut" }, "results")
        .to(o.target, { ...hero.target, duration: 1.1, ease: "power2.inOut" }, "results")
        .to(o, { fov: 35, duration: 1.1, ease: "power2.inOut" }, "results");
      showHoop(0, 0.8, "results+=0.4", tl);
      r.timeline = tl;
      return;
    }

    if (phase === "results" && r.timeline && r.timeline.time() < r.timeline.labels.results) {
      // Skip / Esc: jump to the results beat (callbacks on the way still fire, so the end state is right).
      r.timeline.seek("results", false);
      hideProps();
      return;
    }

    if (phase === "returning") {
      r.timeline?.kill();
      hideProps();
      const tl = gsap.timeline({ onComplete: () => send({ type: "returned" }) });
      tl.call(() => setWinnerClip(CLIPS.idle[0]), [], 0)
        .to(cameraOverride, { weight: 0, duration: 1, ease: "power2.inOut" }, 0)
        .to(r.hoop, { opacity: 0, duration: 0.4, onUpdate: () => hoop.current?.setOpacity(r.hoop.opacity) }, 0);
      if (spin) {
        // Back to rest the short way round.
        spin.rotation.y %= Math.PI * 2;
        tl.to(spin.rotation, { y: spin.rotation.y > Math.PI ? Math.PI * 2 : 0, duration: 0.8, ease: "power2.inOut" }, 0);
      }
      r.timeline = tl;
    }
  }, [phase, winner, winnerSide, game, playerX, send]);

  const tmp = useRef({ a: new THREE.Vector3(), b: new THREE.Vector3() });
  useFrame((_, dt) => {
    const r = run.current;
    const b = ball.current;
    if (!b) return;
    b.scale.setScalar(Math.max(r.ball.scale, 1e-3));
    if (r.held && r.hands) {
      // Between the hands, a little in front of them.
      const { a, b: c } = tmp.current;
      r.hands[0].getWorldPosition(a);
      r.hands[1].getWorldPosition(c);
      b.position.copy(a).add(c).multiplyScalar(0.5).addScaledVector(r.facing, 0.1);
    } else if (r.path) {
      const p = r.path.at(r.flight.t);
      b.position.set(p.x, p.y, p.z);
      b.rotateX(-dt * Math.PI * 4); // backspin, about 2 turns a second
      trail.current?.push(p);
      if (r.flight.t >= r.path.duration) {
        r.path = null;
        b.visible = false;
        trail.current?.clear();
      }
    }
  });

  const revealing = phase !== "idle" && phase !== "returning" && winner !== null;
  return (
    <>
      {sides.map(({ side, team, jersey, color, x, turn, offset }) => {
        const dimmed = revealing && winner !== side;
        const clip = phase !== "idle" && side === winner ? winnerClip : dimmed ? "Idle_Look" : "Idle";
        return (
          <group key={side} position={[x * playerX, 0, 0]}>
            <group ref={side === "home" ? homeSpin : awaySpin}>
              <Player
                rotation={[0, turn, 0]}
                colors={jersey}
                chestText={team.jersey.chest_text}
                number={team.jersey.number}
                hologram={color}
                intensity={dimmed ? 0.3 : 1}
                paused={reducedMotion}
                timeOffset={offset}
                clip={clip}
                idleVariety={clip === "Idle"}
              />
            </group>
            <Pad color={color} intensity={dimmed ? 0.3 : 1} still={reducedMotion} />
          </group>
        );
      })}
      <group ref={hoopRoot}>
        <Hoop ref={hoop} color={winnerSide?.color ?? "#ffffff"} />
      </group>
      <Ball ref={ball} />
      <Trail ref={trail} color={winnerSide?.color ?? "#ffffff"} />
      <Burst ref={burst} />
    </>
  );
}
