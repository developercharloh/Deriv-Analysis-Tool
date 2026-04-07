import { logger as baseLogger } from "./logger.js";

const logger = baseLogger.child({ module: "callmebot" });

const CALLMEBOT_URL = "https://api.callmebot.com/whatsapp.php";

/**
 * Send a message via the CallMeBot WhatsApp API.
 *
 * Setup: on your phone, send the message
 *   "I allow callmebot to send me messages"
 * to +34 644 59 11 51 on WhatsApp.
 * You will receive your API key in seconds.
 *
 * phone   — your WhatsApp number in E.164 without + (e.g. "2547XXXXXXXX")
 * apiKey  — the key received from CallMeBot
 * text    — message body
 */
export async function sendViaCallMeBot(
  phone: string,
  apiKey: string,
  text: string,
): Promise<boolean> {
  try {
    const params = new URLSearchParams({
      phone,
      text,
      apikey: apiKey,
    });

    const res = await fetch(`${CALLMEBOT_URL}?${params.toString()}`);
    const body = await res.text();

    if (!res.ok || body.toLowerCase().includes("error")) {
      logger.error({ phone, status: res.status, body }, "CallMeBot send failed");
      return false;
    }

    logger.info({ phone }, "CallMeBot message sent");
    return true;
  } catch (err) {
    logger.error({ err, phone }, "CallMeBot fetch error");
    return false;
  }
}

/**
 * Reads settings from the DB and dispatches via CallMeBot if enabled.
 * No-ops silently when disabled or credentials are missing.
 */
export async function sendSignalViaCallMeBot(text: string): Promise<void> {
  try {
    const { db } = await import("@workspace/db");
    const { botSettingsTable } = await import("@workspace/db/schema");
    const settings = await db.select().from(botSettingsTable).limit(1).then(r => r[0]);

    if (!settings?.callmebotEnabled) return;
    if (!settings.callmebotPhone || !settings.callmebotApiKey) return;

    await sendViaCallMeBot(settings.callmebotPhone, settings.callmebotApiKey, text);
  } catch (err) {
    logger.error({ err }, "sendSignalViaCallMeBot error");
  }
}
