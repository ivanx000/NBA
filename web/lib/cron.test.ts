import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it, vi } from "vitest";

import { authorized, CRON_JOBS, cronJob, dispatchWorkflow, REF, REPO } from "./cron";

const SECRET = "0123456789abcdef0123";

describe("authorized", () => {
  it("accepts exactly Bearer <secret>", () => {
    expect(authorized(`Bearer ${SECRET}`, SECRET)).toBe(true);
  });

  it("rejects a missing, wrong or short secret", () => {
    expect(authorized(null, SECRET)).toBe(false);
    expect(authorized(`Bearer ${SECRET}x`, SECRET)).toBe(false);
    expect(authorized(SECRET, SECRET)).toBe(false);
    expect(authorized("Bearer undefined", undefined)).toBe(false);
    expect(authorized("Bearer short", "short")).toBe(false);
  });
});

describe("cronJob", () => {
  it("knows the four jobs and nothing else", () => {
    expect(cronJob("refresh")).toEqual({ workflow: "daily.yml", inputs: { refresh: "true" } });
    expect(cronJob("morning")?.workflow).toBe("daily.yml");
    expect(cronJob("toString")).toBeUndefined();
    expect(cronJob("deploy")).toBeUndefined();
  });
});

describe("dispatchWorkflow", () => {
  it("posts workflow_dispatch on main with the job's inputs", async () => {
    const fetchImpl = vi.fn(async () => new Response(null, { status: 204 }));
    const result = await dispatchWorkflow(CRON_JOBS.refresh, "tok", fetchImpl as typeof fetch);
    expect(result).toEqual({ ok: true });
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(
      `https://api.github.com/repos/${REPO}/actions/workflows/daily.yml/dispatches`,
    );
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer tok");
    expect(JSON.parse(init.body as string)).toEqual({ ref: REF, inputs: { refresh: "true" } });
  });

  it("reports GitHub's error", async () => {
    const fetchImpl = vi.fn(
      async () => new Response('{"message":"Bad credentials"}', { status: 401 }),
    );
    const result = await dispatchWorkflow(CRON_JOBS.morning, "tok", fetchImpl as typeof fetch);
    expect(result).toEqual({ ok: false, status: 401, message: '{"message":"Bad credentials"}' });
  });
});

describe("vercel.json", () => {
  const config = JSON.parse(readFileSync(path.join(__dirname, "..", "vercel.json"), "utf8")) as {
    schedules: Record<string, { schedule: string; timezone: string; path: string }>;
  };
  const schedules = Object.values(config.schedules);

  it("has one ET schedule per job, on that job's path", () => {
    expect(schedules.map((s) => s.path).sort()).toEqual(
      Object.keys(CRON_JOBS).map((name) => `/api/cron/${name}`).sort(),
    );
    for (const s of schedules) {
      expect(s.timezone).toBe("America/New_York");
      expect(s.schedule).toMatch(/^\d+ \d+ \* \* \*$/);
    }
  });

  it("starts the refresh after the 17:45 ET report and well before 7 PM tips", () => {
    const [minute, hour] = config.schedules["daily-refresh"].schedule.split(" ").map(Number);
    const at = hour * 60 + minute;
    expect(at).toBeGreaterThanOrEqual(17 * 60 + 50); // Hobby jitter is up to 15 minutes
    expect(at + 15).toBeLessThanOrEqual(18 * 60 + 30);
  });
});
