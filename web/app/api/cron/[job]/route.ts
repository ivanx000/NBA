import { authorized, cronJob, dispatchWorkflow } from "@/lib/cron";

// Called by the Vercel Schedules in vercel.json (POST, `Authorization: Bearer $CRON_SECRET`).
// Starts the matching GitHub workflow now; see lib/cron.ts for why.
export async function POST(request: Request, ctx: RouteContext<"/api/cron/[job]">) {
  if (!authorized(request.headers.get("authorization"), process.env.CRON_SECRET)) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }
  const { job: name } = await ctx.params;
  const job = cronJob(name);
  if (!job) return Response.json({ error: `unknown job ${name}` }, { status: 404 });

  const token = process.env.GITHUB_DISPATCH_TOKEN;
  if (!token) {
    console.error(`cron ${name}: GITHUB_DISPATCH_TOKEN is not set`);
    return Response.json({ error: "GITHUB_DISPATCH_TOKEN is not set" }, { status: 500 });
  }

  const result = await dispatchWorkflow(job, token);
  if (!result.ok) {
    console.error(`cron ${name}: GitHub answered ${result.status}: ${result.message}`);
    return Response.json(
      { error: "dispatch failed", status: result.status, message: result.message },
      { status: 502 },
    );
  }
  console.log(`cron ${name}: dispatched ${job.workflow}`);
  return Response.json({ dispatched: job.workflow, inputs: job.inputs ?? {} });
}
