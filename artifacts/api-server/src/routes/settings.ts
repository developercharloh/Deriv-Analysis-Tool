import { Router, type IRouter, type Request, type Response } from "express";
import { getSettings, updateSettings } from "../lib/bot.js";
import { sendTelegramMessage } from "../lib/telegram.js";

const router: IRouter = Router();

router.get("/settings", async (_req: Request, res: Response) => {
  const settings = await getSettings();
  res.json(settings);
});

router.put("/settings", async (req: Request, res: Response) => {
  const body = req.body;
  const updated = await updateSettings({
    ...body,
    telegramGroupChatId: body.telegramGroupChatId,
    signalIntervalMinutes: body.signalIntervalMinutes,
    preAlertEnabled: body.preAlertEnabled,
    preAlertMinutes: body.preAlertMinutes,
    marketBots: body.marketBots,
  });
  res.json(updated);
});

router.post("/settings/test-telegram", async (_req: Request, res: Response) => {
  const settings = await getSettings();
  if (!settings.telegramBotToken || !settings.telegramChatId) {
    res.json({ success: false, message: "Telegram bot token and chat ID are required" });
    return;
  }
  const success = await sendTelegramMessage(
    settings.telegramBotToken,
    settings.telegramChatId,
    "✅ <b>Deriv Signal Generator</b>\n\nTest message successful! Your bot is connected."
  );
  res.json({
    success,
    message: success ? "Test message sent successfully!" : "Failed to send test message. Check your bot token and chat ID.",
  });
});

export default router;
