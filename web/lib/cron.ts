import { timingSafeEqual } from "node:crypto";

/**
 * Vercel Schedules start the pipeline's GitHub workflows at fixed ET times.
 *
 * GitHub runs this repo's scheduled workflows hours late and drops most hourly slots (seen
 * 2026-11-16..21: 5-11 hours late, about two runs a day), while a workflow_dispatch starts at once.
 * So each schedule in vercel.json calls /api/cron/<job>, which asks GitHub to run the workflow
 * now. The workflows' own cron stays as a backstop; every job is idempotent (`--if-needed`, the
 * refresh runs once a day), so a duplicate run does nothing. The site still never runs the model.
 */

export const REPO = "ivanx000/NBA";
export const REF = "main";

export type CronJob = {
  workflow: string;
  inputs?: Record<string, string>;
};

export const CRON_JOBS = {
  // First publish of the day, with the 09:00 ET injury report.
  morning: { workflow: "daily.yml" },
  // Alert (GitHub emails) if a game still lacks a prediction.
  freshness: { workflow: "freshness-check.yml" },
  // A second chance if the morning run failed; does nothing once today is published.
  midday: { workflow: "daily.yml" },
  // Re-publish games that haven't started with the 17:45 ET report (needs the run after 17:45).
  refresh: { workflow: "daily.yml", inputs: { refresh: "true" } },
} satisfies Record<string, CronJob>;

export type CronJobName = keyof typeof CRON_JOBS;

export function cronJob(name: string): CronJob | undefined {
  return Object.hasOwn(CRON_JOBS, name) ? CRON_JOBS[name as CronJobName] : undefined;
}

/** True only for `Bearer <CRON_SECRET>` with a secret of at least 16 characters. */
export function authorized(header: string | null, secret: string | undefined): boolean {
  if (!header || !secret || secret.length < 16) return false;
  const got = Buffer.from(header);
  const want = Buffer.from(`Bearer ${secret}`);
  return got.length === want.length && timingSafeEqual(got, want);
}

export type DispatchResult = { ok: true } | { ok: false; status: number; message: string };

/** POST the workflow_dispatch event. GitHub answers 204 (or 200 with run details). */
export async function dispatchWorkflow(
  job: CronJob,
  token: string,
  fetchImpl: typeof fetch = fetch,
): Promise<DispatchResult> {
  const url = `https://api.github.com/repos/${REPO}/actions/workflows/${job.workflow}/dispatches`;
  const res = await fetchImpl(url, {
    method: "POST",
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      "User-Agent": "nba-game-predictor-cron",
      "X-GitHub-Api-Version": "2022-11-28",
    },
    body: JSON.stringify({ ref: REF, inputs: job.inputs ?? {} }),
    cache: "no-store",
  });
  if (res.ok) return { ok: true };
  // GitHub's error body is a short JSON message; it never echoes the token.
  const text = (await res.text()).slice(0, 300);
  return { ok: false, status: res.status, message: text };
}
