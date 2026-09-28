import { Composer } from "grammy";
import type { Ctx } from "../bot.js";
import { inlineButton, inlineKeyboard, registerMainMenuItem } from "../toolkit/index.js";
import { now, workflowSession } from "../workflow.js";

registerMainMenuItem({ label: "My recent jobs", data: "jobs:list_recent", order: 30 });
const composer = new Composer<Ctx>();
composer.callbackQuery("jobs:list_recent", async (ctx) => {
  await ctx.answerCallbackQuery();
  const jobs = (workflowSession(ctx).jobs ?? []).filter((job) => now() - job.createdAt < 30 * 24 * 60 * 60 * 1000);
  if (!jobs.length) {
    await ctx.editMessageText("No recent jobs yet — tap Upload ZIP or submit a GitHub URL to begin.", { reply_markup: inlineKeyboard([[inlineButton("Back to menu", "menu:main")]]) });
    return;
  }
  const lines = jobs.map((job) => `${job.id} · ${job.status}\n${job.name} — ${job.summary}`);
  await ctx.editMessageText(`Recent jobs:\n\n${lines.join("\n\n")}`, { reply_markup: inlineKeyboard([[inlineButton("Back to menu", "menu:main")]]) });
});
export default composer;
