// Auto-album job handlers (port of lp_api::albums_tags::auto_albums
// run_generate / run_titles): albums.auto_generate and albums.auto_titles,
// payload {user_id}, tracked as a LongRunningJob like lrj.complete() / lrj.fail(e).
import { lrjFail, lrjFinish, lrjSetTarget, lrjStart, registerJob, type JobCtx } from "~/lib/jobs";
import { applyEventGroup, eventGroups, GENERATE, retitle, TITLES, titleTargets } from "./auto_albums";

function userId(ctx: JobCtx): number {
  const id = ctx.payload?.user_id;
  if (typeof id !== "number" || !Number.isInteger(id)) throw new Error("payload has no user_id");
  return id;
}

async function tracked(ctx: JobCtx, body: () => Promise<void>) {
  if (ctx.lrjId) await lrjStart(ctx.lrjId);
  try {
    await body();
  } catch (e) {
    if (ctx.lrjId) await lrjFail(ctx.lrjId, e instanceof Error ? e.message : String(e));
    throw e;
  }
  await ctx.progress.flush();
  if (ctx.lrjId) await lrjFinish(ctx.lrjId);
}

registerJob(GENERATE, async (ctx) => {
  const owner = userId(ctx);
  await tracked(ctx, async () => {
    const groups = await eventGroups(owner);
    if (ctx.lrjId) await lrjSetTarget(ctx.lrjId, groups.length);
    for (const g of groups) {
      await applyEventGroup(owner, g);
      await ctx.progress.inc(1);
    }
  });
});

registerJob(TITLES, async (ctx) => {
  const owner = userId(ctx);
  await tracked(ctx, async () => {
    const albums = await titleTargets(owner);
    if (ctx.lrjId) await lrjSetTarget(ctx.lrjId, albums.length);
    for (const [id, ts] of albums) {
      await retitle(id, ts);
      await ctx.progress.inc(1);
    }
  });
});
