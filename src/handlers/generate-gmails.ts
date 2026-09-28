import { Composer, InputFile } from "grammy";
import type { Ctx } from "../bot.js";
import { adminChatId, inlineButton, inlineKeyboard, registerMainMenuItem, requireOwner, type OwnerAwareCtx } from "../toolkit/index.js";
import { generateMockGmailPackage, now, trimForTelegram, workflowSession } from "../workflow.js";

registerMainMenuItem({ label: "Generate mock Gmail accounts", data: "generate:gmails", order: 40 });

const CHOICE = "Choose a mode. Mock creates 10 placeholder Gmail-style accounts for testing and never contacts Google. Live requires owner approval and still does not create accounts automatically.";
const LIVE_WARNING = "Live mode is restricted. Google may prohibit automated consumer-account creation, and automation can expose you to account or legal risk. Manual approval and compliance confirmation are required. This bot will not create real accounts automatically.";

const composer = new Composer<Ctx>();
const ownerContext = (ctx: Ctx): OwnerAwareCtx => ctx as unknown as OwnerAwareCtx;

composer.command("generate_gmails", async (ctx) => {
  workflowSession(ctx).gmailMode = "choose";
  await ctx.reply(CHOICE, {
    reply_markup: inlineKeyboard([
      [inlineButton("Mock (default)", "generate:mock")],
      [inlineButton("Live (manual approval)", "generate:live")],
      [inlineButton("Back to menu", "menu:main")],
    ]),
  });
});

composer.callbackQuery("generate:gmails", async (ctx) => {
  await ctx.answerCallbackQuery();
  workflowSession(ctx).gmailMode = "choose";
  await ctx.editMessageText(CHOICE, {
    reply_markup: inlineKeyboard([
      [inlineButton("Mock (default)", "generate:mock")],
      [inlineButton("Live (manual approval)", "generate:live")],
      [inlineButton("Back to menu", "menu:main")],
    ]),
  });
});

composer.callbackQuery("generate:mock", async (ctx) => {
  await ctx.answerCallbackQuery();
  workflowSession(ctx).gmailMode = undefined;
  try {
    const result = generateMockGmailPackage();
    await ctx.replyWithDocument(new InputFile(result.packageBytes, "gmail-mock-accounts.zip"));
    await ctx.reply(trimForTelegram(result.report), {
      reply_markup: inlineKeyboard([[inlineButton("Back to menu", "menu:main")]]),
    });
  } catch {
    await ctx.reply("I couldn't generate the placeholder accounts securely. Try again later.");
  }
});

function configValue(ctx: Ctx, names: readonly string[]): boolean {
  const workerEnv = (ctx as Ctx & { env?: Record<string, unknown> }).env;
  const nodeEnv = typeof process === "undefined" ? undefined : process.env as Record<string, unknown>;
  return names.some((name) => [workerEnv?.[name], nodeEnv?.[name]].some((value) => value === true || value === "true" || value === "1"));
}

function liveConfigReady(ctx: Ctx): boolean {
  return configValue(ctx, ["GMAIL_LIVE_ENABLED"]) && configValue(ctx, ["GMAIL_LIVE_MANUAL_APPROVED"]);
}

composer.callbackQuery("generate:live", async (ctx) => {
  await ctx.answerCallbackQuery();
  if (!(await requireOwner(ownerContext(ctx)))) return;
  if (!liveConfigReady(ctx)) {
    await ctx.reply("Live mode isn't enabled for this bot. Mock mode is the only available option.", {
      reply_markup: inlineKeyboard([[inlineButton("Mock (default)", "generate:mock")]]),
    });
    return;
  }
  workflowSession(ctx).gmailMode = "live_warning";
  await ctx.editMessageText(`${LIVE_WARNING}\n\nConfirm that you accept responsibility for manual, policy-compliant processing.`, {
    reply_markup: inlineKeyboard([
      [inlineButton("I accept and request review", "generate:live_confirm")],
      [inlineButton("Use Mock mode", "generate:mock")],
    ]),
  });
});

composer.callbackQuery("generate:live_confirm", async (ctx) => {
  await ctx.answerCallbackQuery();
  if (!(await requireOwner(ownerContext(ctx)))) return;
  if (!liveConfigReady(ctx)) {
    await ctx.reply("Live mode isn't enabled for this bot. Mock mode is the only available option.");
    return;
  }
  const session = workflowSession(ctx);
  const taskId = `gmail-review-${now().toString(36)}`;
  session.gmailTasks = [
    ...(session.gmailTasks ?? []),
    { id: taskId, status: "queued" as const, createdAt: now(), summary: "Manual Gmail provisioning review requested; no accounts were created." },
  ].slice(-20);
  session.gmailMode = undefined;
  const owner = adminChatId(ctx as unknown as { env?: Record<string, unknown> });
  await ctx.reply(`Manual review task ${taskId} is queued. No Gmail accounts were created. An administrator must complete any compliant provisioning manually; this bot does not automate Google account creation.${owner ? "" : " Owner notifications are not configured."}`, {
    reply_markup: inlineKeyboard([[inlineButton("Back to menu", "menu:main")]]),
  });
});

export default composer;
