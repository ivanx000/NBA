"use client";

/**
 * The two players at center court, picking by clicking a player, and the pick's cinematic
 * (DESIGN.md section 4), one GSAP timeline per pick:
 *
 *   push-in over the picked player's shoulder, he turns to the hoop -> hoop lights up ->
 *   jump shot, the ball leaves his hands at the release frame -> it goes in if the pick is right
 *   (swish / back iron / rattle by confidence) or misses if it's wrong (rim out / off the front) ->
 *   flash and sparks on a make, a head shake on a miss -> he turns back while the camera settles
 *   on him -> results. On the results screen the camera frames whichever team is being viewed.
 *
 * The timeline sends the scene store's events (revealDone at the shot, shotDone at results), so
 * the page's UI follows it. Skip/Esc jump it to the results label; Home plays the return.
 */
import { type ThreeEvent, useFrame, useThree } from "@react-three/fiber";
import gsap from "gsap";
import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";

import { CLIPS, HAND_BONE, JUMPSHOT_RELEASE_TIME } from "@/lib/scene-config";
import { type Phase, type Side, useScene } from "@/lib/scene-store";
import { pickShot, shotPath, type ShotPath } from "@/lib/shot-path";
import { type SlateGame, verdict, winProb } from "@/lib/slate";
import { hologramMatchup } from "@/lib/team-colors";
import { requireTeam } from "@/lib/teams";

import { cameraOverride, resetCameraOverride } from "./camera-override";
import { Ball, Burst, type BurstHandle, Hoop, type HoopHandle, RIM_HEIGHT_M, Trail, type TrailHandle } from "./cinematic-props";
import { FloorMark } from "./floor-mark";
import { Player } from "./player";

/** Release to rim, along the floor (a long two). */
const SHOT_DISTANCE_M = 6.8;
const LEFT_HAND_BONE = "mixamorigLeftHand";
/** Timeline marks, in seconds (DESIGN.md section 4). */
const T = { pushIn: 0.4, turn: 0.6, hoop: 1.2, shot: 1.8 };
const HERO_FOV = 35;
/** Hover: how much a player grows, and how far (m) he steps toward the camera. */
const HOVER_SCALE = 0.08;
const HOVER_STEP = 0.35;

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
  /** Eased hover amount per side, 0 to 1 (he grows and steps toward the camera). */
  grow: Record<Side, number>;
}

/** The results shot for one side: his whole body, in his half of the screen, clear of the panel. */
function heroShot(sideX: number, wx: number, aspect: number) {
  if (aspect < 1) {
    // Phones: the panel is a sheet at the bottom; put him in the upper part, centered.
    return { position: new THREE.Vector3(wx, 1.9, 6.8), target: new THREE.Vector3(wx, 0.35, 0) };
  }
  const distance = 5.6;
  const halfWidth = distance * Math.tan(((HERO_FOV / 2) * Math.PI) / 180) * aspect;
  const x = wx - sideX * halfWidth * 0.48;
  return { position: new THREE.Vector3(x, 1.3, distance), target: new THREE.Vector3(x, 1.0, 0) };
}

export function Matchup({
  game,
  phase,
  pick,
  viewing,
  pickable,
  reducedMotion,
  playerX,
}: {
  game: SlateGame;
  phase: Phase;
  pick: Side | null;
  viewing: Side | null;
  pickable: boolean;
  reducedMotion: boolean;
  playerX: number;
}) {
  const send = useScene((s) => s.send);
  const setCinematic = useScene((s) => s.setCinematic);
  const hover = useScene((s) => s.hover);
  const setHover = useScene((s) => s.setHover);
  const aspect = useThree((s) => s.size.width / s.size.height);
  const sides = useMemo(() => {
    const home = requireTeam(game.home.teamId);
    const away = requireTeam(game.away.teamId);
    const holo = hologramMatchup(home, away);
    return [
      { side: "away", team: away, ...holo.away, x: -1, turn: 0.22, offset: 0 },
      { side: "home", team: home, ...holo.home, x: 1, turn: -0.22, offset: 2.7 },
    ] as const;
  }, [game]);
  const shooter = sides.find((s) => s.side === pick) ?? null;

  const [shooterClip, setShooterClip] = useState<string>(CLIPS.idle[0]);
  const awaySpin = useRef<THREE.Group>(null);
  const homeSpin = useRef<THREE.Group>(null);
  const awayRoot = useRef<THREE.Group>(null);
  const homeRoot = useRef<THREE.Group>(null);
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
    grow: { away: 0, home: 0 },
  });

  // While mounted, the cinematic drives the phases (the page's fallback timers stand down).
  useEffect(() => {
    const r = run.current;
    setCinematic(true);
    return () => {
      setCinematic(false);
      setHover(null);
      r.timeline?.kill();
      resetCameraOverride();
    };
  }, [setCinematic, setHover]);

  // A pointer cursor over a pickable player.
  useEffect(() => {
    const body = document.body;
    body.style.cursor = pickable && hover ? "pointer" : "";
    return () => {
      body.style.cursor = "";
    };
  }, [pickable, hover]);

  useEffect(() => {
    const r = run.current;
    const spin = pick === "home" ? homeSpin.current : awaySpin.current;

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

    if (phase === "revealing" && !r.timeline && spin && shooter) {
      const turn = shooter.turn;
      const wx = shooter.x * playerX;
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
      // In if the pick is right, out if it's wrong (judged by the final score once there is one).
      const correct = verdict(game, shooter.side)?.right ?? true;
      const outcome = pickShot(correct, winProb(game, shooter.side) ?? 0.5);
      // Durations depend only on the outcome; the real path is computed at release.
      const plan = shotPath(r.rim, r.rim, outcome);
      const colors = [shooter.color, shooter.jersey.trim];

      // Over his right shoulder looking down at the hoop.
      const o = cameraOverride;
      o.position.copy(feet).addScaledVector(r.facing, -3.6).addScaledVector(right, 0.8).setY(2.2);
      o.target.copy(feet).addScaledVector(r.facing, 4).setY(1.95);
      o.fov = 42;
      o.weight = 0;
      const shotLook = r.rim.clone().setY(RIM_HEIGHT_M - 0.1);
      const hero = heroShot(shooter.x, wx, aspect);
      const showHoop = (opacity: number, duration: number, at: gsap.Position, tl: gsap.core.Timeline) =>
        tl.to(r.hoop, { opacity, duration, onUpdate: () => hoop.current?.setOpacity(r.hoop.opacity) }, at);

      const release = T.shot + JUMPSHOT_RELEASE_TIME;
      const decided = release + plan.decidedAt;
      const tl = gsap.timeline();
      tl.addLabel("reveal", 0)
        .to(o, { weight: 1, duration: 1.2, ease: "power2.inOut" }, T.pushIn)
        .to(spin.rotation, { y: Math.PI, duration: 0.7, ease: "power2.inOut" }, T.turn);
      showHoop(1, 0.6, T.hoop, tl)
        .addLabel("shot", T.shot)
        .call(
          () => {
            send({ type: "revealDone" });
            setShooterClip(CLIPS.shot);
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
        .addLabel("decided", decided)
        .call(
          () => {
            if (!plan.made) return;
            burst.current?.burst(r.rim, colors);
            hoop.current?.wobble();
          },
          [],
          "decided",
        )
        // A clank shakes less than a make.
        .fromTo(o, { shake: plan.made ? 1 : 0.45 }, { shake: 0, duration: 0.35, ease: "power1.out" }, "decided")
        .call(() => setShooterClip(plan.made ? CLIPS.celebrate[0] : CLIPS.miss), [], "decided+=0.35")
        .to(spin.rotation, { y: Math.PI * 2, duration: 0.8, ease: "power2.inOut" }, "decided+=0.3")
        .addLabel("results", decided + 0.7)
        .call(() => send({ type: "shotDone" }), [], "results")
        .to(o.position, { x: hero.position.x, y: hero.position.y, z: hero.position.z, duration: 1.1, ease: "power2.inOut" }, "results")
        .to(o.target, { x: hero.target.x, y: hero.target.y, z: hero.target.z, duration: 1.1, ease: "power2.inOut" }, "results")
        .to(o, { fov: HERO_FOV, duration: 1.1, ease: "power2.inOut" }, "results");
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
      tl.call(() => setShooterClip(CLIPS.idle[0]), [], 0)
        .to(cameraOverride, { weight: 0, duration: 1, ease: "power2.inOut" }, 0)
        .to(r.hoop, { opacity: 0, duration: 0.4, onUpdate: () => hoop.current?.setOpacity(r.hoop.opacity) }, 0);
      if (spin) {
        // Back to rest the short way round.
        spin.rotation.y %= Math.PI * 2;
        tl.to(spin.rotation, { y: spin.rotation.y > Math.PI ? Math.PI * 2 : 0, duration: 0.8, ease: "power2.inOut" }, 0);
      }
      r.timeline = tl;
    }
  }, [phase, pick, shooter, game, playerX, aspect, send]);

  // Results screen: frame whichever team is being viewed (the shooter first; the corner button
  // switches). With reduced motion there's no camera move; the panel just changes.
  useEffect(() => {
    if (phase !== "results" || !viewing || reducedMotion) return;
    const r = run.current;
    if (r.timeline && r.timeline.isActive() && r.timeline.time() < r.timeline.labels.results + 1.1) return;
    const side = sides.find((s) => s.side === viewing)!;
    const hero = heroShot(side.x, side.x * playerX, aspect);
    const o = cameraOverride;
    const tl = gsap.timeline();
    tl.to(o, { weight: 1, fov: HERO_FOV, duration: 0.9, ease: "power2.inOut" }, 0)
      .to(o.position, { x: hero.position.x, y: hero.position.y, z: hero.position.z, duration: 0.9, ease: "power2.inOut" }, 0)
      .to(o.target, { x: hero.target.x, y: hero.target.y, z: hero.target.z, duration: 0.9, ease: "power2.inOut" }, 0);
    return () => void tl.kill();
  }, [phase, viewing, sides, playerX, aspect, reducedMotion]);

  const tmp = useRef({ a: new THREE.Vector3(), b: new THREE.Vector3() });
  useFrame((_, dt) => {
    const r = run.current;
    // Hover: the player pops out, growing and stepping toward the camera (eased, with a little
    // overshoot so it feels springy).
    for (const [side, root] of [["away", awayRoot.current], ["home", homeRoot.current]] as const) {
      const target = pickable && hover === side ? 1 : 0;
      r.grow[side] += (target - r.grow[side]) * Math.min(1, dt * 9);
      const g = r.grow[side];
      const spring = g + Math.sin(g * Math.PI) * 0.08;
      root?.scale.setScalar(1 + HOVER_SCALE * spring);
      root?.position.set(0, 0, HOVER_STEP * spring);
    }
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

  const onOver = (side: Side) => (e: ThreeEvent<PointerEvent>) => {
    e.stopPropagation();
    if (!pickable) return;
    setHover(side);
  };
  const onOut = () => setHover(null);
  const onClick = (side: Side) => (e: ThreeEvent<MouseEvent>) => {
    e.stopPropagation();
    if (!pickable) return;
    onOut();
    send({ type: "predict", pick: side });
  };

  return (
    <>
      {sides.map(({ side, team, jersey, color, x, turn, offset }) => {
        // Who's lit: the picked player during the shot, the viewed team on the results screen.
        const focus = phase === "results" ? viewing : phase === "idle" ? null : pick;
        const dimmed = focus !== null && focus !== side;
        const hovered = pickable && hover === side;
        // While one player is hovered, the other steps back into the shade a little.
        const shaded = pickable && hover !== null && hover !== side;
        const clip = phase !== "idle" && side === pick ? shooterClip : dimmed ? "Idle_Look" : "Idle";
        return (
          <group key={side} position={[x * playerX, 0, 0]}>
            <group ref={side === "home" ? homeRoot : awayRoot}>
              <FloorMark color={color} active={hovered} still={reducedMotion} />
              <group ref={side === "home" ? homeSpin : awaySpin}>
                <Player
                  rotation={[0, turn, 0]}
                  colors={jersey}
                  chestText={team.jersey.chest_text}
                  number={team.jersey.number}
                  hologram={color}
                  intensity={dimmed ? 0.3 : hovered ? 1.15 : shaded ? 0.6 : 1}
                  highlight={hovered ? 1 : 0}
                  paused={reducedMotion}
                  timeOffset={offset}
                  clip={clip}
                  idleVariety={clip === "Idle"}
                  lookAt={phase === "idle" && !reducedMotion}
                />
              </group>
            </group>
            {/* An easy-to-hit invisible column around the player, for hover and click. */}
            <mesh position={[0, 1.05, 0]} onPointerOver={onOver(side)} onPointerOut={onOut} onClick={onClick(side)}>
              <cylinderGeometry args={[0.5, 0.5, 2.2, 12]} />
              <meshBasicMaterial visible={false} />
            </mesh>
          </group>
        );
      })}
      <group ref={hoopRoot}>
        <Hoop ref={hoop} color={shooter?.color ?? "#ffffff"} />
      </group>
      <Ball ref={ball} />
      <Trail ref={trail} color={shooter?.color ?? "#ffffff"} />
      <Burst ref={burst} />
    </>
  );
}
