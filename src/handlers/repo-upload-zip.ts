import { Composer, InputFile } from "grammy";
import type { Ctx } from "../bot.js";
import { inlineButton, inlineKeyboard, registerMainMenuItem } from "../toolkit/index.js";
import { nextJobId, now, rememberJob, transformZip, trimForTelegram, workflowSession, type Job } from "../workflow.js";

registerMainMenuItem({ label: "Upload ZIP", data: "repo:upload_zip", order: 10 });
const composer = new Composer<Ctx>();

composer.callbackQuery("repo:upload_zip", async (ctx) => {
  await ctx.answerCallbackQuery();
  const session = workflowSession(ctx);
  session.awaitingUpload = true;
  session.awaitingUrl = false;
  session.inputMode = "full_build";
  await ctx.editMessageText("Upload a .zip repository file to begin.", {
    reply_markup: inlineKeyboard([
      [inlineButton("Edit only — return code (no build)", "edit_only:open")],
      [inlineButton("Back to menu", "menu:main")],
    ]),
  });
});

// A user who selected edit-only can explicitly switch back before sending the
// repository. This keeps the mode choice reversible and avoids accidental
// omission of the requested build workflow.
composer.callbackQuery("repo:full_build", async (ctx) => {
  await ctx.answerCallbackQuery();
  const session = workflowSession(ctx);
  session.awaitingUpload = true;
  session.awaitingUrl = false;
  session.inputMode = "full_build";
  await ctx.editMessageText("Upload a .zip repository file to begin.", {
    reply_markup: inlineKeyboard([
      [inlineButton("Edit only — return code (no build)", "edit_only:open")],
      [inlineButton("Back to menu", "menu:main")],
    ]),
  });
});

composer.on("message:document", async (ctx, next) => {
  const session = workflowSession(ctx);
  if (!session.awaitingUpload) return next();
  session.awaitingUpload = false;
  const document = ctx.message.document;
  const maxBytes = session.maxRepoBytes ?? 50 * 1024 * 1024;
  if (!document.file_name?.toLowerCase().endsWith(".zip")) {
    await ctx.reply("That file is not a ZIP archive. Upload a .zip repository file and try again.");
    return;
  }
  if ((document.file_size ?? 0) > maxBytes) {
    await ctx.reply("That repository is too large. Upload a smaller ZIP and try again.");
    return;
  }
  await ctx.reply("Received — processing");
  const job: Job = { id: nextJobId(ctx), source: "upload", mode: "full_build", name: document.file_name, status: "running", summary: "Static analysis is running.", flags: [], createdAt: now() };
  rememberJob(ctx, job);
  try {
    const remote = await ctx.api.getFile(document.file_id);
    if (!remote.file_path) throw new Error("file_unavailable");
    const downloaded = await fetch(`https://api.telegram.org/file/bot${ctx.api.token}/${remote.file_path}`);
    if (!downloaded.ok) throw new Error("file_unavailable");
    const transformed = await transformZip(new Uint8Array(await downloaded.arrayBuffer()));
    job.status = transformed.scan.flags.length ? "manual_review_required" : "complete";
    job.flags = transformed.scan.flags;
    job.summary = transformed.scan.flags.length ? "Wolt dependencies need manual review." : "Wolt code removed and Gmail logic consolidated.";
    await ctx.replyWithDocument(new InputFile(transformed.packageBytes, `${document.file_name.replace(/\.zip$/i, "")}-sanitized.zip`));
    await ctx.reply(trimForTelegram(transformed.scan.report));
  } catch {
    job.status = "failed";
    job.summary = "The ZIP could not be unpacked or transformed.";
    await ctx.reply("I couldn't process that ZIP. Make sure it opens normally, contains source files, and is under the size limit, then try again.");
  }
});
export default composer;
