import { Composer } from "grammy";
import type { Ctx } from "../bot.js";
import { inlineButton, inlineKeyboard } from "../toolkit/index.js";
const composer = new Composer<Ctx>();
const HELP = "Send a GitHub HTTPS URL or upload a .zip repository. The bot removes Wolt-specific code, consolidates Gmail account-generation logic, and returns modified source with a change report. Edit only skips builds and returns no build artifacts. Temporary files are kept for 24 hours; audit summaries are kept for 30 days.";
composer.command("help", async (ctx) => { await ctx.reply(HELP); });
composer.callbackQuery("menu:help", async (ctx) => { await ctx.answerCallbackQuery(); await ctx.editMessageText(HELP, { reply_markup: inlineKeyboard([[inlineButton("Back to menu", "menu:main")]]) }); });
export default composer;
