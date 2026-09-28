import { Composer } from "grammy";
import type { Ctx } from "../bot.js";
import { inlineButton, inlineKeyboard, requireOwner, type OwnerAwareCtx } from "../toolkit/index.js";
import { workflowSession } from "../workflow.js";

// Owner actions are callback-only and always pass through the platform-injected
// owner gate. There is deliberately no claim-admin or first-user fallback.
const composer = new Composer<Ctx>();
const ownerContext = (ctx: Ctx): OwnerAwareCtx => ctx as unknown as OwnerAwareCtx;

composer.callbackQuery("admin:open", async (ctx) => {
  await ctx.answerCallbackQuery();
  if (!(await requireOwner(ownerContext(ctx)))) return;
  const jobs = workflowSession(ctx).jobs ?? [];
  await ctx.reply(jobs.length ? `Owner desk: ${jobs.length} recent job(s).` : "Owner desk is empty.", {
    reply_markup: inlineKeyboard([[inlineButton("Audit summary", "admin:audit")], [inlineButton("Back to menu", "menu:main")]]),
  });
});

composer.callbackQuery("admin:audit", async (ctx) => {
  await ctx.answerCallbackQuery();
  if (!(await requireOwner(ownerContext(ctx)))) return;
  const jobs = workflowSession(ctx).jobs ?? [];
  await ctx.reply(jobs.length ? jobs.map((job) => `${job.id}: ${job.status} · ${job.mode === "edit_only" ? "edit only" : "full build"} — ${job.summary}`).join("\n") : "No audit entries are available.");
});

composer.callbackQuery(/^admin:cancel:(.+)$/, async (ctx) => {
  await ctx.answerCallbackQuery();
  if (!(await requireOwner(ownerContext(ctx)))) return;
  const id = ctx.match[1];
  const job = (workflowSession(ctx).jobs ?? []).find((item) => item.id === id);
  if (!job || !["queued", "running"].includes(job.status)) {
    await ctx.reply("That job is no longer running.");
    return;
  }
  job.status = "failed";
  job.summary = "Cancelled by the owner.";
  await ctx.reply("The job was cancelled.");
});

composer.callbackQuery("admin:toggle_snippets", async (ctx) => {
  await ctx.answerCallbackQuery();
  if (!(await requireOwner(ownerContext(ctx)))) return;
  const session = workflowSession(ctx);
  session.returnOriginalSnippets = !session.returnOriginalSnippets;
  await ctx.reply(`Original snippets will ${session.returnOriginalSnippets ? "be" : "not be"} included in flagged reports.`);
});

export default composer;
