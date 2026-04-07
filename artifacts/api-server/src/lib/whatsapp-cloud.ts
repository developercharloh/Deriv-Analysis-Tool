import { logger as baseLogger } from "./logger.js";

const logger = baseLogger.child({ module: "whatsapp-cloud" });

const GRAPH_API = "https://graph.facebook.com/v20.0";

/**
 * Send a text message via the Meta WhatsApp Cloud API.
 * phoneNumberId  — the Phone Number ID from Meta Business dashboard
 * accessToken    — the permanent / long-lived system user access token
 * recipients     — array of E.164 phone numbers (e.g. ["2547XXXXXXXX"])
 * text           — the message body
 */
export async function sendViaCloudAPI(
  phoneNumberId: string,
  accessToken: string,
  recipients: string[],
  text: string,
): Promise<{ sent: number; failed: number }> {
  let sent = 0;
  let failed = 0;

  for (const to of recipients) {
    try {
      const res = await fetch(`${GRAPH_API}/${phoneNumberId}/messages`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({
          messaging_product: "whatsapp",
          to,
          type: "text",
          text: { body: text },
        }),
      });

      const json = await res.json() as any;

      if (!res.ok || json.error) {
        logger.error({ to, status: res.status, err: json.error }, "Cloud API send failed");
        failed++;
      } else {
        logger.info({ to, messageId: json.messages?.[0]?.id }, "Cloud API message sent");
        sent++;
      }
    } catch (err) {
      logger.error({ err, to }, "Cloud API fetch error");
      failed++;
    }
  }

  return { sent, failed };
}

/**
 * Reads settings from the DB and dispatches via Cloud API if enabled.
 * No-ops silently when disabled or credentials are missing.
 */
export async function sendSignalViaCloud(text: string): Promise<void> {
  try {
    const { db } = await import("@workspace/db");
    const { botSettingsTable } = await import("@workspace/db/schema");
    const settings = await db.select().from(botSettingsTable).limit(1).then(r => r[0]);

    if (!settings?.waCloudEnabled) return;
    if (!settings.waCloudPhoneNumberId || !settings.waCloudAccessToken) return;

    const recipients = (settings.waCloudRecipients ?? "")
      .split(",")
      .map(s => s.trim())
      .filter(Boolean);

    if (recipients.length === 0) return;

    await sendViaCloudAPI(
      settings.waCloudPhoneNumberId,
      settings.waCloudAccessToken,
      recipients,
      text,
    );
  } catch (err) {
    logger.error({ err }, "sendSignalViaCloud error");
  }
}
