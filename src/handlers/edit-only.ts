import { Composer, InputFile } from "grammy";
import type { Ctx } from "../bot.js";
import { inlineButton, inlineKeyboard, registerMainMenuItem } from "../toolkit/index.js";
import { githubUrl, nextJobId, now, rememberJob, transformZip, trimForTelegram, workflowSession, type Job } from "../workflow.js";

registerMainMenuItem({ label: "Edit only (send code, no build)", data: "edit_only:open", order: 20 });
const composer = new Composer<Ctx>();
const PROMPT = "Send a public GitHub HTTPS URL or upload a .zip repository. Edit-only mode returns modified source code and a change report; no build artifacts or further build steps are produced.";

function editOnlyKeyboard() {
  return inlineKeyboard([
    [inlineButton("Full processing", "edit_only:full_build")],
    [inlineButton("Back to menu", "menu:main")],
  ]);
}

function isNoBuildRequest(text: string): boolean {
  const normalized = text.trim().toLocaleLowerCase();
  return normalized.includes("tôi không yêu cầu build")
    || normalized.includes("toi khong yeu cau build")
    || normalized.includes("no build")
    || normalized.includes("without build")
    || normalized.includes("edit only")
    || normalized.includes("edit-only");
}

composer.command("edit_only", async (ctx) => {
  const input = ctx.match.trim();
  if (!input) {
    const session = workflowSession(ctx);
    session.awaitingUrl = true;
    session.awaitingUpload = true;
    session.inputMode = "edit_only";
    await ctx.reply(PROMPT, { reply_markup: editOnlyKeyboard() });
    return;
  }
  await acceptUrl(ctx, input);
});

composer.callbackQuery("edit_only:open", async (ctx) => {
  await ctx.answerCallbackQuery();
  const session = workflowSession(ctx);
  session.awaitingUpload = true;
  session.awaitingUrl = true;
  session.inputMode = "edit_only";
  await ctx.editMessageText(PROMPT, { reply_markup: editOnlyKeyboard() });
});

composer.on("message:text", async (ctx, next) => {
  const session = workflowSession(ctx);
  if (isNoBuildRequest(ctx.message.text) && session.inputMode !== "edit_only") {
    session.awaitingUrl = true;
    session.awaitingUpload = true;
    session.inputMode = "edit_only";
    await ctx.reply(PROMPT, { reply_markup: editOnlyKeyboard() });
    return;
  }
  if (!session.awaitingUrl || session.inputMode !== "edit_only") return next();
  session.awaitingUrl = false;
  session.inputMode = undefined;
  await acceptUrl(ctx, ctx.message.text.trim());
});

composer.callbackQuery("edit_only:full_build", async (ctx) => {
  await ctx.answerCallbackQuery();
  const session = workflowSession(ctx);
  session.awaitingUrl = true;
  session.awaitingUpload = true;
  session.inputMode = "full_build";
  await ctx.editMessageText("Choose an input: send a public GitHub HTTPS URL or upload a .zip repository.", {
    reply_markup: inlineKeyboard([
      [inlineButton("Upload ZIP", "repo:full_build")],
      [inlineButton("Back to menu", "menu:main")],
    ]),
  });
});

composer.on("message:document", async (ctx, next) => {
  const session = workflowSession(ctx);
  if (!session.awaitingUpload || session.inputMode !== "edit_only") return next();
  session.awaitingUpload = false;
  session.inputMode = undefined;
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
  await ctx.reply("Received — processing edit-only transformation");
  const job: Job = { id: nextJobId(ctx), source: "upload", mode: "edit_only", name: document.file_name, status: "running", summary: "Static analysis is running without build steps.", flags: [], createdAt: now() };
  rememberJob(ctx, job);
  try {
    const remote = await ctx.api.getFile(document.file_id);
    if (!remote.file_path) throw new Error("file_unavailable");
    const downloaded = await fetch(`https://api.telegram.org/file/bot${ctx.api.token}/${remote.file_path}`);
    if (!downloaded.ok) throw new Error("file_unavailable");
    await deliver(ctx, job, document.file_name.replace(/\.zip$/i, ""), new Uint8Array(await downloaded.arrayBuffer()));
  } catch {
    job.status = "failed";
    job.summary = "The ZIP could not be unpacked or transformed.";
    await ctx.reply("I couldn't process that ZIP. Make sure it opens normally, contains source files, and is under the size limit, then try again.");
  }
});

async function acceptUrl(ctx: Ctx, input: string): Promise<void> {
  const parsed = githubUrl(input);
  if (!parsed.ok) {
    await ctx.reply("That URL is not a public GitHub HTTPS address. Check it and try again.");
    return;
  }
  const session = workflowSession(ctx);
  session.awaitingUrl = false;
  session.awaitingUpload = false;
  session.inputMode = undefined;
  await ctx.reply("Received — processing edit-only transformation");
  const job: Job = { id: nextJobId(ctx), source: "git_url", mode: "edit_only", name: parsed.name, status: "queued", summary: "Public repository queued without build steps.", flags: [], createdAt: now() };
  rememberJob(ctx, job);
  try {
    const metadata = await fetch(`https://api.github.com/repos/${parsed.name}`, { headers: { accept: "application/vnd.github+json", "user-agent": "repo-sanitizer" } });
    if (!metadata.ok) throw new Error("unreachable");
    const details = (await metadata.json()) as { default_branch?: string; private?: boolean };
    if (details.private || !details.default_branch) throw new Error("private_repo");
    const response = await fetch(`https://github.com/${parsed.name}/archive/refs/heads/${encodeURIComponent(details.default_branch)}.zip`, { redirect: "follow" });
    if (!response.ok) throw new Error("unreachable");
    if (Number(response.headers.get("content-length") ?? 0) > 50 * 1024 * 1024) throw new Error("too_large");
    await deliver(ctx, job, parsed.name.replace("/", "-"), new Uint8Array(await response.arrayBuffer()));
  } catch (error) {
    job.status = "failed";
    const reason = error instanceof Error ? error.message : "";
    if (reason === "private_repo") await ctx.reply("That repository is private. Submit a public GitHub repository or upload its ZIP instead.");
    else if (reason === "too_large") await ctx.reply("That repository is too large. Upload a smaller ZIP and try again.");
    else await ctx.reply("I couldn't reach that repository. Check that it is public and the URL is correct, then try again.");
  }
}

async function deliver(ctx: Ctx, job: Job, name: string, input: Uint8Array): Promise<void> {
  const transformed = await transformZip(input);
  job.status = transformed.scan.flags.length ? "manual_review_required" : "complete";
  job.flags = transformed.scan.flags;
  job.summary = transformed.scan.flags.length ? "Wolt dependencies need manual review." : "Modified source returned; no build steps were run.";
  await ctx.replyWithDocument(new InputFile(transformed.packageBytes, `${name}-edited.zip`));
  await ctx.reply(trimForTelegram(`Edit-only result: modified source code and a change report. No build artifacts or further build steps were produced.\n\n${transformed.scan.report}`), {
    reply_markup: editOnlyKeyboard(),
  });
}

export default composer;
