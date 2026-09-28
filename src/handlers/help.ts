import { Composer } from "grammy";
import type { Ctx } from "../bot.js";
import { inlineButton, inlineKeyboard } from "../toolkit/index.js";
const composer = new Composer<Ctx>();
const HELP = "Send a GitHub HTTPS URL or upload a .zip repository. The bot removes Wolt-specific code, consolidates Gmail-related logic, and returns modified source with a change report. Choose Edit only to skip builds and receive source code only; you can also say ‘tôi không yêu cầu build’. You can also generate 10 placeholder Gmail-style accounts in safe Mock mode; Live mode never creates accounts automatically. Temporary files are kept for 24 hours; audit summaries are kept for 30 days.";
composer.command("help", async (ctx) => { await ctx.reply(HELP); });
composer.callbackQuery("menu:help", async (ctx) => { await ctx.answerCallbackQuery(); await ctx.editMessageText(HELP, { reply_markup: inlineKeyboard([[inlineButton("Back to menu", "menu:main")]]) }); });
export default composer;
