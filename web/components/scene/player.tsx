"use client";

import { useAnimations, useGLTF, useTexture } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { clone as cloneSkinned } from "three/addons/utils/SkeletonUtils.js";

import { CLIPS, type ClipName, PLAYER_HEIGHT_M, PLAYER_MODEL_URL, UNIFORM_MASK_URL } from "@/lib/scene-config";
import type { JerseyColorway } from "@/lib/teams";

import { makeTintMaterial } from "./tint-material";

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
  hologramInk = null,
  intensity = 1,
  paused = false,
  clip = "Idle",
  extraClips,
  idleVariety = true,
  timeOffset = 0,
  speed = 1,
  ...group
}: {
  colors: JerseyColorway;
  chestText: string;
  number: string;
  /** Paint the uniform mask channels instead of the uniform (dev only). */
  debugMask?: boolean;
  /** Draw the player as a hologram in this color (null: normal shading). */
  hologram?: string | null;
  /** Color the hologram's lettering glows in (default white). */
  hologramInk?: string | null;
  /** Hologram brightness, 0 to 1 (eased toward this value, e.g. to dim the loser). */
  intensity?: number;
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
} & Omit<React.ComponentProps<"group">, "children">) {
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
        hologramInk,
      }),
    [instance, mask, base, trim, text, shorts, chestText, number, debugMask, hologram, hologramInk],
  );
  const shown = useRef({ intensity, time: 0 });
  useFrame((_, dt) => {
    const state = shown.current;
    state.intensity += (intensity - state.intensity) * Math.min(1, dt * 6);
    if (!paused) state.time += dt;
    material.tick(state.time, state.intensity);
  });

  const root = useRef<THREE.Group>(null);
  useEffect(() => {
    const mesh = root.current ? findSkinned(root.current) : null;
    let depthOnly: THREE.SkinnedMesh | null = null;
    if (mesh) {
      mesh.material = material.material;
      mesh.castShadow = !hologram; // a hologram has no body to block light
      if (hologram && mesh.parent) {
        // Depth pre-pass: an invisible copy on the same skeleton writes depth first, so the
        // additive hologram only draws the surface facing the camera (no back number showing
        // through the chest).
        depthOnly = new THREE.SkinnedMesh(mesh.geometry, new THREE.MeshBasicMaterial({ colorWrite: false }));
        depthOnly.bind(mesh.skeleton, mesh.bindMatrix);
        depthOnly.frustumCulled = false;
        depthOnly.renderOrder = -1;
        mesh.parent.add(depthOnly);
      }
    }
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
    current.time = timeOffset % current.getClip().duration;
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
    // Idle variety: after each loop, cross-fade to another idle clip.
    const onLoop = (e: { action: THREE.AnimationAction }) => {
      if (e.action !== current) return;
      const options = CLIPS.idle.filter((c) => c !== current!.getClip().name && actions[c]);
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

  return (
    <group {...group}>
      <primitive ref={root} object={instance.scene} />
    </group>
  );
}

useGLTF.preload(PLAYER_MODEL_URL);
