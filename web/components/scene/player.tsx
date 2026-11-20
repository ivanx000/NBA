"use client";

import { useAnimations, useGLTF, useTexture } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import { use, useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { clone as cloneSkinned } from "three/addons/utils/SkeletonUtils.js";

import {
  CLIPS,
  type ClipName,
  IDLE_EXTRA_CHANCE,
  PLAYER_HEIGHT_M,
  PLAYER_MODEL_URL,
  UNIFORM_MASK_URL,
} from "@/lib/scene-config";
import type { JerseyColorway } from "@/lib/teams";

import { jerseyFontReady, makeTintMaterial } from "./tint-material";

function prepMask(tex: THREE.Texture) {
  tex.flipY = false; // glTF UV convention
  tex.colorSpace = THREE.NoColorSpace;
  // The UV islands are small and scattered: mipmapping the mask would blend island edges with
  // the gutter and leave untinted seams.
  tex.generateMipmaps = false;
  tex.minFilter = THREE.LinearFilter;
  tex.needsUpdate = true;
  return tex;
}

function findSkinned(root: THREE.Object3D): THREE.SkinnedMesh {
  let mesh: THREE.SkinnedMesh | undefined;
  root.traverse((o) => {
    if (!mesh && (o as THREE.SkinnedMesh).isSkinnedMesh) mesh = o as THREE.SkinnedMesh;
  });
  if (!mesh) throw new Error("player.glb has no skinned mesh");
  return mesh;
}

/**
 * The rigged player. Each instance gets its own skeleton and material. The uniform is the white
 * base uniform recolored in the shader (see tint-material.ts), so any team or alternate jersey
 * is free.
 */
export function Player({
  colors,
  chestText,
  number,
  debugMask = false,
  hologram = null,
  intensity = 1,
  highlight = 0,
  opacity = 1,
  paused = false,
  clip = "Idle",
  extraClips,
  idleVariety = true,
  timeOffset = 0,
  speed = 1,
  lookAt = false,
  ...group
}: {
  colors: JerseyColorway;
  chestText: string;
  number: string;
  /** Paint the uniform mask channels instead of the uniform (dev only). */
  debugMask?: boolean;
  /** Draw the player as a hologram with this glow color (null: plain shading). */
  hologram?: string | null;
  /** Hologram brightness, 0 to 1 (eased toward this value, e.g. to dim the loser). */
  intensity?: number;
  /** Hover highlight, 0 to 1 (eased): a brighter rim in the hologram color. */
  highlight?: number;
  /** 0 to 1 (eased, about half a second): he fades out and in rather than popping. */
  opacity?: number;
  /** Freeze animation and effects (prefers-reduced-motion). */
  paused?: boolean;
  /** Clip to play; idle clips rotate among the idle variants when ``idleVariety`` is on. */
  clip?: ClipName | (string & {});
  /** More clips to make playable (e.g. from the motion library); they target the same bones. */
  extraClips?: THREE.AnimationClip[];
  idleVariety?: boolean;
  /** Seconds to start into the clip, so two players don't move in lockstep. */
  timeOffset?: number;
  /** Playback speed of one-shot clips (1 = as captured). */
  speed?: number;
  /** Turn the head a little toward the cursor (DESIGN.md section 3, idle). */
  lookAt?: boolean;
} & Omit<React.ComponentProps<"group">, "children">) {
  // Suspends (with the model) until the jersey font has loaded, so the lettering is never drawn in
  // the fallback face.
  use(jerseyFontReady());
  const gltf = useGLTF(PLAYER_MODEL_URL);
  // One clone per player: its own skeleton, so two players can animate independently.
  const instance = useMemo(() => {
    const scene = cloneSkinned(gltf.scene);
    const mesh = findSkinned(scene);
    mesh.castShadow = true;
    mesh.frustumCulled = false; // bind-pose bounds don't follow the animation
    if (!mesh.geometry.boundingBox) mesh.geometry.computeBoundingBox();
    return {
      scene,
      source: mesh.material as THREE.MeshStandardMaterial,
      bounds: mesh.geometry.boundingBox!.clone(),
    };
  }, [gltf.scene]);

  // Depend on the color values, not the object, so an equal colorway doesn't rebuild the material.
  const { base, trim, text, shorts } = colors;
  const mask = useTexture(UNIFORM_MASK_URL);
  const material = useMemo(
    () =>
      makeTintMaterial(instance.source, {
        colors: { base, trim, text, shorts },
        chestText,
        number,
        mask: prepMask(mask),
        bounds: instance.bounds,
        heightM: PLAYER_HEIGHT_M,
        debugMask,
        hologram,
      }),
    [instance, mask, base, trim, text, shorts, chestText, number, debugMask, hologram],
  );
  const shown = useRef({ intensity, highlight, opacity, time: 0 });
  // The skinned mesh and its depth pre-pass (set in the effect below), for the fade.
  const meshes = useRef<{ body: THREE.SkinnedMesh | null; depth: THREE.SkinnedMesh | null }>({ body: null, depth: null });
  useFrame((_, dt) => {
    const state = shown.current;
    state.intensity += (intensity - state.intensity) * Math.min(1, dt * 6);
    state.highlight += (highlight - state.highlight) * Math.min(1, dt * 8);
    state.opacity += (opacity - state.opacity) * Math.min(1, dt * 5);
    if (!paused) state.time += dt;
    material.tick(state.time, state.intensity, state.highlight, state.opacity);
    // While fading, drop the depth pre-pass (it would cut an invisible hole in the crowd behind
    // him) and his shadow; once gone, stop drawing him at all.
    const { body, depth } = meshes.current;
    if (depth) depth.visible = state.opacity > 0.98;
    if (body) body.castShadow = state.opacity > 0.5;
    if (root.current) root.current.visible = state.opacity > 0.01;
  });

  const root = useRef<THREE.Group>(null);
  useEffect(() => {
    const mesh = root.current ? findSkinned(root.current) : null;
    let depthOnly: THREE.SkinnedMesh | null = null;
    if (mesh) {
      mesh.material = material.material;
      // Even as a hologram he casts a shadow: it is what stands him on the floor.
      mesh.castShadow = true;
      if (hologram && mesh.parent) {
        // Depth pre-pass: an invisible copy on the same skeleton writes depth first, so the
        // see-through hologram only draws the surface nearest the camera (no back number or far
        // arm showing through the chest).
        depthOnly = new THREE.SkinnedMesh(mesh.geometry, new THREE.MeshBasicMaterial({ colorWrite: false }));
        depthOnly.bind(mesh.skeleton, mesh.bindMatrix);
        depthOnly.frustumCulled = false;
        depthOnly.renderOrder = -1;
        mesh.parent.add(depthOnly);
      }
    }
    meshes.current = { body: mesh, depth: depthOnly };
    return () => {
      if (depthOnly) {
        depthOnly.removeFromParent();
        (depthOnly.material as THREE.Material).dispose();
      }
      material.material.dispose();
      material.textures.forEach((t) => t.dispose());
    };
  }, [material, hologram]);

  const clips = useMemo(
    () => (extraClips?.length ? [...gltf.animations, ...extraClips] : gltf.animations),
    [gltf.animations, extraClips],
  );
  const { actions, mixer } = useAnimations(clips, root);

  useEffect(() => {
    const idle = (CLIPS.idle as readonly string[]).includes(clip);
    let current = actions[clip];
    if (!current) return;
    current.reset().fadeIn(0.3).play();
    // Idles start partway in so two players don't move in lockstep; one-shots start at the top.
    if (idle) current.time = timeOffset % current.getClip().duration;
    current.setEffectiveTimeScale(paused ? 0 : idle ? 1 : speed);
    if (!idle) {
      current.setLoop(THREE.LoopOnce, 1);
      current.clampWhenFinished = true;
    }
    if (!idle) {
      // One-shot clips (shot, celebration): when done, blend back into the idle instead of
      // freezing on the last frame.
      const shot = current;
      const rest = actions[CLIPS.idle[0]];
      let resting = false;
      const onFinished = (e: { action: THREE.AnimationAction }) => {
        if (e.action !== shot || !rest) return;
        resting = true;
        rest.reset().setEffectiveTimeScale(1).play();
        shot.crossFadeTo(rest, 0.8, false);
      };
      mixer.addEventListener("finished", onFinished);
      return () => {
        mixer.removeEventListener("finished", onFinished);
        shot.fadeOut(0.3);
        if (resting) rest?.fadeOut(0.3);
      };
    }
    if (!idleVariety) {
      const playing = current;
      return () => void playing.fadeOut(0.3);
    }
    // Idle variety: after each loop, cross-fade to another idle. Mostly plain idles, with a livelier
    // one (a bounce, a stretch, a look up at the scoreboard) now and then, never two in a row.
    const extras: readonly string[] = CLIPS.idleExtras;
    const onLoop = (e: { action: THREE.AnimationAction }) => {
      if (e.action !== current) return;
      const now = current!.getClip().name;
      const pool: readonly string[] =
        !extras.includes(now) && Math.random() < IDLE_EXTRA_CHANCE ? extras : CLIPS.idle;
      const options = pool.filter((c) => c !== now && actions[c]);
      const next = actions[options[Math.floor(Math.random() * options.length)]];
      if (!next) return;
      next.reset().play();
      current!.crossFadeTo(next, 0.6, false);
      current = next;
    };
    mixer.addEventListener("loop", onLoop);
    return () => {
      mixer.removeEventListener("loop", onLoop);
      current?.fadeOut(0.3);
    };
  }, [actions, mixer, clip, idleVariety, timeOffset, speed, paused]);

  // Look-at: after the mixer has posed him (useAnimations' frame runs first), turn the head and
  // neck toward where the cursor points, a little, eased and clamped.
  const look = useRef({ yaw: 0, pitch: 0, head: null as THREE.Object3D | null, neck: null as THREE.Object3D | null });
  const tmp = useRef({ ray: new THREE.Raycaster(), plane: new THREE.Plane(new THREE.Vector3(0, 0, 1), -2.5), hit: new THREE.Vector3(), head: new THREE.Vector3(), q: new THREE.Quaternion(), e: new THREE.Euler() });
  useFrame(({ pointer, camera }, dt) => {
    const l = look.current;
    if (!l.head && root.current) {
      l.head = root.current.getObjectByName("mixamorigHead") ?? null;
      l.neck = root.current.getObjectByName("mixamorigNeck") ?? null;
    }
    if (!l.head) return;
    let yaw = 0;
    let pitch = 0;
    if (lookAt) {
      const t = tmp.current;
      // Where the cursor points, on a plane in front of the players.
      t.ray.setFromCamera(pointer, camera);
      if (t.ray.ray.intersectPlane(t.plane, t.hit)) {
        l.head.getWorldPosition(t.head);
        const d = t.hit.sub(t.head);
        // Relative to the way his body faces.
        root.current!.getWorldQuaternion(t.q);
        const facing = t.e.setFromQuaternion(t.q, "YXZ").y;
        yaw = THREE.MathUtils.clamp(Math.atan2(d.x, d.z) - facing, -0.45, 0.45);
        pitch = THREE.MathUtils.clamp(-Math.atan2(d.y, Math.hypot(d.x, d.z)), -0.25, 0.2);
      }
    }
    const k = Math.min(1, dt * 3);
    l.yaw += (yaw - l.yaw) * k;
    l.pitch += (pitch - l.pitch) * k;
    if (Math.abs(l.yaw) < 1e-4 && Math.abs(l.pitch) < 1e-4) return;
    // Split between neck and head so it reads as a natural turn.
    for (const [bone, share] of [[l.neck, 0.4], [l.head, 0.6]] as const) {
      if (!bone) continue;
      bone.rotateY(l.yaw * share);
      bone.rotateX(l.pitch * share);
    }
  });

  return (
    <group {...group}>
      <primitive ref={root} object={instance.scene} />
    </group>
  );
}

useGLTF.preload(PLAYER_MODEL_URL);
