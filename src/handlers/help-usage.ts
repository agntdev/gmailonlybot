import { Composer } from "grammy";
import type { Ctx } from "../bot.js";
import { inlineButton, inlineKeyboard, registerMainMenuItem } from "../toolkit/index.js";

registerMainMenuItem({ label: "Help", data: "help:usage", order: 90 });
const composer = new Composer<Ctx>();
const HELP = "Send a GitHub HTTPS URL or upload a .zip repository. The bot removes Wolt-specific code, consolidates Gmail account-generation logic, and returns a ZIP with a change report. Temporary files are kept for 24 hours; audit summaries are kept for 30 days.";
composer.callbackQuery("help:usage", async (ctx) => {
  await ctx.answerCallbackQuery();
  await ctx.editMessageText(HELP, { reply_markup: inlineKeyboard([[inlineButton("Back to menu", "menu:main")]]) });
});
export default composer;
