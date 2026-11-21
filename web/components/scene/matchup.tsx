"use client";

/**
 * The two players at center court, picking by clicking a player, and the pick's cinematic
 * (DESIGN.md section 4), one GSAP timeline per pick:
 *
 *   the other player fades out while the camera swings round the picked one, in one
 *   continuous move (an orbit about his feet with a gentle pull-back at its midpoint, after the
 *   lions-share site's screen changes, flowing into a slow drift toward the rim) to a side-on shot: him in one half of the frame, the real basket at
 *   that end of the court in the other (pick the left player and the view swings right, the right
 *   one and it swings left) -> he turns to the basket and the hoop lights up -> jump shot, the
 *   ball leaves his hands at the release frame -> it goes in if the pick is right (swish / back
 *   iron / rattle by confidence) or misses if it's wrong (rim out / off the front), the camera
 *   easing in as it flies -> flash and sparks on a make, a head shake on a miss -> he turns back,
 *   the other player returns, the camera settles on him -> results. On the results screen the
 *   camera frames whichever team is being viewed.
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

import { BASKET_X } from "./arena";
import { cameraOverride, resetCameraOverride } from "./camera-override";
import { Ball, BALL_RADIUS_M, Burst, type BurstHandle, Hoop, type HoopHandle, RIM_HEIGHT_M, Trail, type TrailHandle } from "./cinematic-props";
import { FloorMark } from "./floor-mark";
import { Player } from "./player";

const LEFT_HAND_BONE = "mixamorigLeftHand";
/** The middle fingers' second joints: the ball sits on the fingers, not at the wrists. */
const FINGERS = ["mixamorigLeftHandMiddle2", "mixamorigRightHandMiddle2"] as const;
/** Timeline marks, in seconds (DESIGN.md section 4). */
const T = { vanish: 0.05, swing: 0.05, swingFor: 0.95, turn: 0.3, hoop: 0.45, shot: 1.0 };
/** The swing's midpoint: how far the camera pulls back (share of its distance), rises (m) and widens (deg). */
const SWING = { pull: 0.15, rise: 0.35, fov: 3 };
/** How long the camera takes to settle on the results shot after the shot is decided. */
const HERO_S = 0.85;
const HERO_FOV = 32;
/** Hover: how much a player grows, and how far (m) he steps toward the camera. */
const HOVER_SCALE = 0.035;
const HOVER_STEP = 0.15;

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

/** A camera pose in polar form about a pivot on the floor: angle from +z, horizontal radius, height (and its target's). */
interface Polar {
  a: number;
  r: number;
  y: number;
  ta: number;
  tr: number;
  ty: number;
  fov: number;
}

function toPolar(pivot: THREE.Vector3, pos: THREE.Vector3, tgt: THREE.Vector3, fov: number): Polar {
  const p = pos.clone().sub(pivot);
  const t = tgt.clone().sub(pivot);
  return { a: Math.atan2(p.x, p.z), r: Math.hypot(p.x, p.z), y: p.y, ta: Math.atan2(t.x, t.z), tr: Math.hypot(t.x, t.z), ty: t.y, fov };
}

/** The signed shortest turn from angle a to b. */
const turnTo = (a: number, b: number) => THREE.MathUtils.euclideanModulo(b - a + Math.PI, Math.PI * 2) - Math.PI;

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
/** Cosine ease in and out: starts and ends at rest, no sudden change in speed anywhere. */
const smooth = (x: number) => 0.5 - 0.5 * Math.cos(Math.PI * clamp01(x));
/** Eases in over the first second, then keeps a steady speed: the drift never stops abruptly. */
const ramp = (t: number) => (t <= 0 ? 0 : t < 1 ? (t * t) / 2 : t - 0.5);

interface ShotCamera {
  pivot: THREE.Vector3;
  A: Polar;
  B: Polar;
  startTgt: THREE.Vector3;
  view: { position: THREE.Vector3; target: THREE.Vector3; fov: number };
  rim: THREE.Vector3;
  hero: { position: THREE.Vector3; target: THREE.Vector3 };
  /** Seconds: when the swing starts, how long it takes, when the drift starts, when the results shot begins. */
  swingAt: number;
  swingFor: number;
  driftAt: number;
  heroAt: number;
}

const tmpPos = new THREE.Vector3();
const tmpTgt = new THREE.Vector3();
const toRim = new THREE.Vector3();

/**
 * The whole shot's camera as one path in time, so it never stops and starts: it swings round the
 * shooter's feet from the home framing to the side-on shot (angles turning the short way, a gentle
 * pull-back and rise at the midpoint), then, before the swing has quite finished, drifts slowly on
 * toward the rim while the ball flies, and finally blends into the results shot while still
 * drifting. Every part eases in and out, and they overlap, so the speed never jumps.
 */
function placeShotCamera(c: ShotCamera, t: number) {
  const lerp = THREE.MathUtils.lerp;
  const { A, B, pivot } = c;
  const k = smooth((t - c.swingAt) / c.swingFor);
  const bump = Math.sin(Math.PI * k);
  const a = A.a + turnTo(A.a, B.a) * k;
  const r = lerp(A.r, B.r, k) * (1 + SWING.pull * bump);
  tmpPos.set(pivot.x + Math.sin(a) * r, pivot.y + lerp(A.y, B.y, k) + SWING.rise * bump, pivot.z + Math.cos(a) * r);
  tmpTgt.lerpVectors(c.startTgt, c.view.target, k);
  tmpTgt.y += SWING.rise * 0.5 * bump;
  let fov = lerp(A.fov, B.fov, k) + SWING.fov * bump;
  // The drift: toward the rim, a few tens of centimeters a second, the view leaning to the rim.
  const d = ramp(t - c.driftAt);
  toRim.copy(c.rim).sub(tmpPos).setY(0).normalize();
  tmpPos.addScaledVector(toRim, 0.22 * d);
  tmpTgt.lerp(c.rim, Math.min(0.15, 0.025 * d));
  fov -= Math.min(4, 0.6 * d);
  // The results shot, blended in over HERO_S.
  const h = smooth((t - c.heroAt) / HERO_S);
  const o = cameraOverride;
  o.position.lerpVectors(tmpPos, c.hero.position, h);
  o.target.lerpVectors(tmpTgt, c.hero.target, h);
  o.fov = lerp(fov, HERO_FOV, h);
}

/**
 * The side-on shot: the shooter (feet at ``feet``) in one half of the frame, the rim in the other.
 * ``side`` is -1 for the left player (the camera stands behind his left shoulder and looks right,
 * down the court) and +1 for the right one. Solved for a 16:10 screen and for a phone.
 */
function shotView(feet: THREE.Vector3, rim: THREE.Vector3, side: number, aspect: number) {
  const portrait = aspect < 1;
  const offset = portrait ? new THREE.Vector3(side * 5.75, 2.4, 1.0) : new THREE.Vector3(side * 3.25, 2.0, 3.25);
  const position = feet.clone().add(offset);
  const target = new THREE.Vector3(feet.x + (rim.x - feet.x) * 0.2, 1.0 + (rim.y - 1.0) * 0.2, 0);
  return { position, target, fov: portrait ? 50 : 46 };
}

/**
 * The results shot for one side: close on him, his upper body (waist to just over his head)
 * filling his half of the screen, the stats on the other half. Phones: his upper body in the top
 * half, the stats scrolling below.
 */
function heroShot(sideX: number, wx: number, aspect: number) {
  if (aspect < 1) {
    return { position: new THREE.Vector3(wx, 1.95, 3.9), target: new THREE.Vector3(wx, 1.2, 0) };
  }
  const distance = 2.55;
  const halfWidth = distance * Math.tan(((HERO_FOV / 2) * Math.PI) / 180) * aspect;
  // Centered in his half: half of that half off the screen's middle.
  const x = wx - sideX * halfWidth * 0.5;
  return { position: new THREE.Vector3(x, 1.5, distance), target: new THREE.Vector3(x, 1.4, 0) };
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
  // Each player's presence: the other one collapses into the floor during the shot.
  const awayHere = useRef<THREE.Group>(null);
  const homeHere = useRef<THREE.Group>(null);
  const camera = useThree((s) => s.camera);
  const hoopRoot = useRef<THREE.Group>(null);
  // The shot's props (hoop, ball, trail, sparks), hidden until the shot.
  const propsRoot = useRef<THREE.Group>(null);
  const gl = useThree((s) => s.gl);
  const scene = useThree((s) => s.scene);
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

  // Warm the shot's props up once they exist: compile their shaders and upload their textures
  // now, off-screen, instead of the first time they're drawn (that cost a 300 ms freeze right as
  // the ball appeared, in the middle of the camera's move). Three only compiles what's visible,
  // so they're shown for the compile and hidden again.
  useEffect(() => {
    const root = propsRoot.current;
    if (!root) return;
    let live = true;
    const hidden: THREE.Object3D[] = [];
    root.traverse((o) => {
      if (!o.visible) {
        hidden.push(o);
        o.visible = true;
      }
      const mat = (o as THREE.Mesh).material as THREE.Material | THREE.Material[] | undefined;
      for (const m of Array.isArray(mat) ? mat : mat ? [mat] : []) {
        const map = (m as THREE.MeshStandardMaterial).map;
        if (map) gl.initTexture(map);
      }
    });
    gl.compileAsync(root, camera, scene)
      .catch(() => {})
      .finally(() => {
        if (live) for (const o of hidden) o.visible = false;
      });
    return () => {
      live = false;
      for (const o of hidden) o.visible = false;
    };
  }, [gl, camera, scene]);

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
    const showAll = () => {
      for (const g of [awayHere.current, homeHere.current]) {
        if (!g) continue;
        g.visible = true;
        g.scale.set(1, 1, 1);
      }
    };

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
      showAll();
      return;
    }

    if (phase === "revealing" && !r.timeline && spin && shooter) {
      const wx = shooter.x * playerX;
      const feet = new THREE.Vector3(wx, 0, 0);
      // The basket at the far end of the court from him: the left player shoots at the right one.
      r.rim.set(-shooter.x * BASKET_X, RIM_HEIGHT_M, 0);
      r.facing.copy(r.rim).sub(feet).setY(0).normalize();
      // He turns to face it (the model faces +z at rest, inside his resting turn).
      const faceYaw = Math.atan2(r.facing.x, r.facing.z) - shooter.turn;
      hoopRoot.current?.position.copy(r.rim);
      hoopRoot.current?.rotation.set(0, Math.atan2(-r.facing.x, -r.facing.z), 0);
      const left = spin.getObjectByName(FINGERS[0]) ?? spin.getObjectByName(LEFT_HAND_BONE);
      const rightHand = spin.getObjectByName(FINGERS[1]) ?? spin.getObjectByName(HAND_BONE);
      r.hands = left && rightHand ? [left, rightHand] : null;
      // In if the pick is right, out if it's wrong (judged by the final score once there is one).
      const correct = verdict(game, shooter.side)?.right ?? true;
      const outcome = pickShot(correct, winProb(game, shooter.side) ?? 0.5);
      // A long shot: more time in the air and a higher arc than a two.
      const distance = Math.abs(r.rim.x - feet.x);
      const flightS = 0.95 + Math.max(0, distance - 6.8) * 0.07;
      const apexM = 2.5 + Math.max(0, distance - 6.8) * 0.2;
      // Durations depend only on the outcome and the flight; the real path is computed at release.
      const plan = shotPath(r.rim, r.rim, outcome, flightS, apexM);
      const colors = [shooter.color, shooter.jersey.trim];

      // Start from exactly where the home camera is, then swing round him to the side-on shot.
      const o = cameraOverride;
      const cam = camera as THREE.PerspectiveCamera;
      const startPos = cam.position.clone();
      const forward = cam.getWorldDirection(new THREE.Vector3());
      const startTgt = startPos.clone().addScaledVector(forward, Math.abs(startPos.z / (forward.z || -1)));
      o.position.copy(startPos);
      o.target.copy(startTgt);
      o.fov = cam.fov;
      o.weight = 1;
      const view = shotView(feet, r.rim, shooter.x, aspect);
      const A = toPolar(feet, startPos, startTgt, cam.fov);
      const B = toPolar(feet, view.position, view.target, view.fov);
      const hero = heroShot(shooter.x, wx, aspect);
      const showHoop = (opacity: number, duration: number, at: gsap.Position, tl: gsap.core.Timeline) =>
        tl.to(r.hoop, { opacity, duration, onUpdate: () => hoop.current?.setOpacity(r.hoop.opacity) }, at);

      const release = T.shot + JUMPSHOT_RELEASE_TIME;
      const decided = release + plan.decidedAt;
      const resultsAt = decided + 0.55;
      // One clock drives the camera for the whole shot (placeShotCamera), so it moves as one piece.
      const path: ShotCamera = {
        pivot: feet,
        A,
        B,
        startTgt,
        view,
        rim: r.rim.clone(),
        hero,
        swingAt: T.swing,
        swingFor: T.swingFor,
        driftAt: T.swing + T.swingFor * 0.65,
        heroAt: resultsAt,
      };
      const clock = { t: 0 };
      const camEnd = resultsAt + HERO_S;
      const tl = gsap.timeline();
      tl.addLabel("reveal", 0)
        .to(clock, { t: camEnd, duration: camEnd, ease: "none", onUpdate: () => placeShotCamera(path, clock.t) }, 0)
        .to(spin.rotation, { y: faceYaw, duration: 0.6, ease: "sine.inOut" }, T.turn);
      showHoop(1, 0.4, T.hoop, tl)
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
        .addLabel("release", release)
        .call(
          () => {
            r.held = false;
            const from = ball.current ? ball.current.position.clone() : r.rim.clone();
            r.path = shotPath(from, r.rim, outcome, flightS, apexM);
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
        .call(() => setShooterClip(plan.made ? CLIPS.celebrate[0] : CLIPS.miss), [], "decided+=0.2")
        .to(spin.rotation, { y: 0, duration: 0.6, ease: "power2.inOut" }, "decided+=0.3")
        .addLabel("results", resultsAt)
        .call(() => send({ type: "shotDone" }), [], "results");
      showHoop(0, 0.5, "results+=0.2", tl);
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
      showAll();
      tl.call(() => setShooterClip(CLIPS.idle[0]), [], 0)
        .to(cameraOverride, { weight: 0, duration: 0.7, ease: "power2.inOut" }, 0)
        .to(r.hoop, { opacity: 0, duration: 0.4, onUpdate: () => hoop.current?.setOpacity(r.hoop.opacity) }, 0);
      if (spin) {
        // Back to rest the short way round.
        spin.rotation.y %= Math.PI * 2;
        tl.to(spin.rotation, { y: spin.rotation.y > Math.PI ? Math.PI * 2 : 0, duration: 0.6, ease: "power2.inOut" }, 0);
      }
      r.timeline = tl;
    }
  }, [phase, pick, shooter, game, playerX, aspect, send, camera]);

  // Results screen: frame whichever team is being viewed (the shooter first; the corner button
  // switches, and only the viewed team's player is shown, the other fading out as the camera
  // glides across). With reduced motion there's no camera move; the stats just change.
  useEffect(() => {
    if (phase !== "results" || !viewing || reducedMotion) return;
    const r = run.current;
    if (r.timeline && r.timeline.isActive() && r.timeline.time() < r.timeline.labels.results + HERO_S) return;
    const side = sides.find((s) => s.side === viewing)!;
    const hero = heroShot(side.x, side.x * playerX, aspect);
    const o = cameraOverride;
    // One glide across to the other player while one fades out and the other fades in.
    const glide = { duration: 0.85, ease: "sine.inOut" };
    const tl = gsap.timeline();
    tl.to(o, { weight: 1, fov: HERO_FOV, ...glide }, 0)
      .to(o.position, { x: hero.position.x, y: hero.position.y, z: hero.position.z, ...glide }, 0)
      .to(o.target, { x: hero.target.x, y: hero.target.y, z: hero.target.z, ...glide }, 0);
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
      // Between the fingers, resting on top of them (a ball's radius up), a touch in front.
      b.position.copy(a).add(c).multiplyScalar(0.5).addScaledVector(r.facing, 0.04);
      b.position.y += BALL_RADIUS_M * 0.9;
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
        // Standing still apart from breathing and small shifts: one calm idle, no stretches or extras.
        const clip = phase !== "idle" && side === pick ? shooterClip : "Idle";
        // Who's on the court: both at home; only the shooter during the shot; only the viewed team's
        // player on the results screen. The others fade out (and back in), never sink.
        const present =
          phase === "idle" || phase === "returning" ? true : phase === "results" ? side === viewing : side === pick;
        return (
          <group key={side} position={[x * playerX, 0, 0]}>
            <group ref={side === "home" ? homeHere : awayHere}>
              <group ref={side === "home" ? homeRoot : awayRoot}>
              <FloorMark color={color} active={hovered} still={reducedMotion} presence={present ? 1 : 0} />
              <group ref={side === "home" ? homeSpin : awaySpin}>
                <Player
                  rotation={[0, turn, 0]}
                  colors={jersey}
                  chestText={team.jersey.chest_text}
                  number={team.jersey.number}
                  hologram={color}
                  intensity={dimmed ? 0.3 : hovered ? 1.15 : shaded ? 0.6 : 1}
                  highlight={hovered ? 1 : 0}
                  opacity={present ? 1 : 0}
                  paused={reducedMotion}
                  timeOffset={offset}
                  clip={clip}
                  idleVariety={false}
                  lookAt={phase === "idle" && !reducedMotion}
                />
                </group>
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
      <group ref={propsRoot}>
        <group ref={hoopRoot}>
          <Hoop ref={hoop} color={shooter?.color ?? "#ffffff"} />
        </group>
        <Ball ref={ball} />
        <Trail ref={trail} color={shooter?.color ?? "#ffffff"} />
        <Burst ref={burst} />
      </group>
    </>
  );
}
