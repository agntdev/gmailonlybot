import { Composer, InputFile } from "grammy";
import type { Ctx } from "../bot.js";
import { inlineButton, inlineKeyboard } from "../toolkit/index.js";
import { githubUrl, nextJobId, now, rememberJob, transformZip, trimForTelegram, workflowSession, type Job } from "../workflow.js";

const composer = new Composer<Ctx>();
const PROMPT = "Send a public GitHub HTTPS URL to begin.";
composer.command("submit_url", async (ctx) => {
  const input = ctx.match.trim();
  if (!input) {
    const session = workflowSession(ctx);
    session.awaitingUrl = true;
    session.awaitingUpload = false;
    session.inputMode = "full_build";
    await ctx.reply(PROMPT, {
      reply_markup: inlineKeyboard([
        [inlineButton("Edit only — return code (no build)", "edit_only:open")],
        [inlineButton("Back to menu", "menu:main")],
      ]),
    });
    return;
  }
  await acceptUrl(ctx, input);
});
composer.on("message:text", async (ctx, next) => {
  if (!workflowSession(ctx).awaitingUrl) return next();
  workflowSession(ctx).awaitingUrl = false;
  workflowSession(ctx).inputMode = undefined;
  await acceptUrl(ctx, ctx.message.text.trim());
});

async function acceptUrl(ctx: Ctx, input: string): Promise<void> {
  const parsed = githubUrl(input);
  if (!parsed.ok) {
    await ctx.reply("That URL is not a public GitHub HTTPS address. Check it and try again.");
    return;
  }
  await ctx.reply("Received — processing");
  const job: Job = { id: nextJobId(ctx), source: "git_url", mode: "full_build", name: parsed.name, status: "queued", summary: "Public repository queued for static analysis.", flags: [], createdAt: now() };
  rememberJob(ctx, job);
  try {
    const metadata = await fetch(`https://api.github.com/repos/${parsed.name}`, { headers: { accept: "application/vnd.github+json", "user-agent": "repo-sanitizer" } });
    if (!metadata.ok) throw new Error("unreachable");
    const details = (await metadata.json()) as { default_branch?: string; private?: boolean };
    if (details.private || !details.default_branch) throw new Error("private_repo");
    const branch = encodeURIComponent(details.default_branch);
    const response = await fetch(`https://github.com/${parsed.name}/archive/refs/heads/${branch}.zip`, { redirect: "follow" });
    if (!response.ok) throw new Error("unreachable");
    const size = Number(response.headers.get("content-length") ?? 0);
    if (size > 50 * 1024 * 1024) throw new Error("too_large");
    const transformed = await transformZip(new Uint8Array(await response.arrayBuffer()));
    job.status = transformed.scan.flags.length ? "manual_review_required" : "complete";
    job.flags = transformed.scan.flags;
    job.summary = transformed.scan.flags.length ? "Wolt dependencies need manual review." : "Wolt code removed and Gmail logic consolidated.";
    await ctx.replyWithDocument(new InputFile(transformed.packageBytes, `${parsed.name.replace("/", "-")}-sanitized.zip`));
    await ctx.reply(trimForTelegram(transformed.scan.report));
  } catch (error) {
    job.status = "failed";
    const reason = error instanceof Error ? error.message : "";
    if (reason === "private_repo") {
      job.summary = "The repository is private.";
      await ctx.reply("That repository is private. Submit a public GitHub repository or upload its ZIP instead.");
    } else if (reason === "too_large") {
      job.summary = "The repository exceeds the size limit.";
      await ctx.reply("That repository is too large. Upload a smaller ZIP and try again.");
    } else {
      job.summary = "GitHub could not provide this public repository.";
      await ctx.reply("I couldn't reach that repository. Check that it is public and the URL is correct, then try again.");
    }
  }
}

// The full-build URL flow remains available after an edit-only selection.
// This callback is intentionally local to the URL feature so the two typed
// input paths cannot leave each other with stale session state.
composer.callbackQuery("url:full_build", async (ctx) => {
  await ctx.answerCallbackQuery();
  const session = workflowSession(ctx);
  session.awaitingUrl = true;
  session.awaitingUpload = false;
  session.inputMode = "full_build";
  await ctx.editMessageText(PROMPT, {
    reply_markup: inlineKeyboard([
      [inlineButton("Edit only — return code (no build)", "edit_only:open")],
      [inlineButton("Back to menu", "menu:main")],
    ]),
  });
});
export default composer;
