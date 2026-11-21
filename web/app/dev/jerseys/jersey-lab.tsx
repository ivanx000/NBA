"use client";

import dynamic from "next/dynamic";
import { useEffect, useState } from "react";

import { POSTURE, type Posture } from "@/components/scene/posture";

import { CLIPS, type ClipName } from "@/lib/scene-config";

interface LibraryClip {
  name: string;
  seconds: number;
  driftM: number;
  inPlace: boolean;
  source: string;
}
import { teams } from "@/lib/teams";

const LabScene = dynamic(() => import("./lab-scene"), { ssr: false });

const CLIP_CHOICES: ClipName[] = [...CLIPS.idle, "JumpShot", ...CLIPS.celebrate];

function TeamSelect({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <label className="flex items-center gap-2">
      <span className="text-muted-foreground">{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="rounded-md border border-border bg-background px-2 py-1"
      >
        {teams.map((t) => (
          <option key={t.abbr} value={t.abbr}>
            {t.abbr}
          </option>
        ))}
      </select>
    </label>
  );
}

/** Dev tool: check any two teams' jerseys and the animation clips on the rigged player. */
export function JerseyLab() {
  const [clip, setClip] = useState<string>("Idle");
  const [library, setLibrary] = useState<LibraryClip[]>([]);
  useEffect(() => {
    fetch("/models/motion-library.json")
      .then((r) => r.json())
      .then(setLibrary)
      .catch(() => setLibrary([]));
  }, []);
  const [runId, setRunId] = useState(0);
  const [left, setLeft] = useState("BOS");
  const [right, setRight] = useState("LAL");
  const [alt, setAlt] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [look, setLook] = useState<"real" | "holo">("holo");
  const [pixel, setPixel] = useState(0);
  const [posture, setPosture] = useState<Posture>(POSTURE);
  const [compare, setCompare] = useState(true);
  return (
    <main id="main" className="flex flex-1 flex-col pt-14">
      <div className="flex flex-wrap items-center gap-3 px-4 py-3 text-sm">
        <span className="text-muted-foreground">Clip</span>
        {CLIP_CHOICES.map((c) => (
          <button
            key={c}
            type="button"
            onClick={() => {
              setClip(c);
              setRunId((n) => n + 1);
            }}
            className={`rounded-md border px-2.5 py-1 ${c === clip ? "border-primary bg-primary text-primary-foreground" : "border-border"}`}
          >
            {c.replace("Celebrate_", "Celebrate: ")}
          </button>
        ))}
        <label className="flex items-center gap-2">
          <span className="text-muted-foreground">Library</span>
          <select
            value={CLIP_CHOICES.includes(clip as ClipName) ? "" : clip}
            onChange={(e) => {
              if (!e.target.value) return;
              setClip(e.target.value);
              setRunId((n) => n + 1);
            }}
            className="max-w-56 rounded-md border border-border bg-background px-2 py-1"
          >
            <option value="">{library.length} more clips…</option>
            {library.map((c) => (
              <option key={c.name} value={c.name}>
                {c.name.replace(/_/g, " ")} ({c.seconds}s{c.inPlace ? "" : `, moves ${c.driftM} m`})
              </option>
            ))}
          </select>
        </label>
        <TeamSelect label="Left" value={left} onChange={setLeft} />
        <TeamSelect label="Right" value={right} onChange={setRight} />
        <label className="flex items-center gap-2">
          <span className="text-muted-foreground">Speed</span>
          <select
            value={speed}
            onChange={(e) => {
              setSpeed(Number(e.target.value));
              setRunId((n) => n + 1);
            }}
            className="rounded-md border border-border bg-background px-2 py-1"
          >
            {[1, 0.85, 0.7, 0.4, 0.25].map((v) => (
              <option key={v} value={v}>
                {v}x
              </option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-2">
          <span className="text-muted-foreground">Look</span>
          <select
            value={look}
            onChange={(e) => setLook(e.target.value as "real" | "holo")}
            className="rounded-md border border-border bg-background px-2 py-1"
          >
            <option value="real">Realistic</option>
            <option value="holo">Hologram</option>
          </select>
        </label>
        <label className="flex items-center gap-2">
          <span className="text-muted-foreground">Pixels</span>
          <select
            value={pixel}
            onChange={(e) => setPixel(Number(e.target.value))}
            className="rounded-md border border-border bg-background px-2 py-1"
          >
            {[0, 3, 5, 8].map((v) => (
              <option key={v} value={v}>
                {v === 0 ? "Off" : `${v}px`}
              </option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={alt} onChange={(e) => setAlt(e.target.checked)} />
          Alternate jerseys
        </label>
      </div>
      <div className="relative min-h-[75vh] flex-1">
        <LabScene
          clip={clip}
          runId={runId}
          teams={[left, right]}
          alt={alt}
          speed={speed}
          look={look}
          pixel={pixel}
          posture={posture}
          compare={compare}
        />
        {/* Posture correction (components/scene/posture.ts): copy the values into POSTURE. */}
        <div className="absolute top-3 right-3 z-10 w-64 rounded-md border border-border bg-background/85 p-3 text-xs">
          <p className="mb-2 font-mono uppercase">Posture (degrees)</p>
          {(Object.keys(posture) as (keyof Posture)[]).map((k) => (
            <label key={k} className="mb-1 grid grid-cols-[6.5rem_1fr_2rem] items-center gap-2">
              <span className="text-muted-foreground">{k}</span>
              <input
                type="range"
                min={-15}
                max={15}
                step={0.5}
                value={posture[k]}
                onChange={(e) => setPosture({ ...posture, [k]: Number(e.target.value) })}
                aria-label={k}
              />
              <span className="tabular text-right">{posture[k]}</span>
            </label>
          ))}
          <label className="mt-2 flex items-center gap-2">
            <input type="checkbox" checked={compare} onChange={(e) => setCompare(e.target.checked)} />
            Left player without it
          </label>
        </div>
      </div>
    </main>
  );
}
