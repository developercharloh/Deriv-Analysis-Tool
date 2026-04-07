import { Router, type IRouter, type Request, type Response } from "express";
import { db } from "@workspace/db";
import { botSettingsTable } from "@workspace/db/schema";
import {
  getWhatsAppStatus,
  getWhatsAppQR,
  isWhatsAppConnected,
  resolveGroupInvite,
  resolveChannelInvite,
  sendWhatsAppMessage,
  refreshQR,
  resetSession,
} from "../lib/whatsapp.js";
import { sendViaCloudAPI } from "../lib/whatsapp-cloud.js";
import { sendViaCallMeBot } from "../lib/callmebot.js";

const router: IRouter = Router();

/** GET /api/whatsapp/status — current connection state + QR code if waiting */
router.get("/whatsapp/status", (_req: Request, res: Response) => {
  res.json({
    status: getWhatsAppStatus(),
    connected: isWhatsAppConnected(),
    qr: getWhatsAppQR(),
  });
});

/** POST /api/whatsapp/refresh-qr — soft restart (same credentials) */
router.post("/whatsapp/refresh-qr", async (_req: Request, res: Response) => {
  try {
    await refreshQR();
    res.json({ success: true, message: "QR refresh initiated — check status in a moment" });
  } catch (err) {
    res.status(500).json({ success: false, message: String(err) });
  }
});

/** POST /api/whatsapp/reset-session — wipe credentials + fresh QR (fixes "device couldn't link") */
router.post("/whatsapp/reset-session", async (_req: Request, res: Response) => {
  try {
    await resetSession();
    res.json({ success: true, message: "Session cleared — new QR generating, scan it with WhatsApp." });
  } catch (err) {
    res.status(500).json({ success: false, message: String(err) });
  }
});

/** POST /api/whatsapp/resolve-group — resolve group invite link → JID */
router.post("/whatsapp/resolve-group", async (req: Request, res: Response) => {
  try {
    const { inviteLink } = req.body as { inviteLink?: string };
    if (!inviteLink) {
      res.status(400).json({ success: false, message: "inviteLink is required" });
      return;
    }
    const jid = await resolveGroupInvite(inviteLink);
    res.json({ success: true, jid });
  } catch (err) {
    res.status(500).json({ success: false, message: String(err) });
  }
});

/** POST /api/whatsapp/resolve-channel — resolve channel invite link → newsletter JID */
router.post("/whatsapp/resolve-channel", async (req: Request, res: Response) => {
  try {
    const { inviteLink } = req.body as { inviteLink?: string };
    if (!inviteLink) {
      res.status(400).json({ success: false, message: "inviteLink is required" });
      return;
    }
    const jid = await resolveChannelInvite(inviteLink);
    res.json({ success: true, jid });
  } catch (err) {
    res.status(500).json({ success: false, message: String(err) });
  }
});

/** POST /api/whatsapp/test — send a test message to all configured JIDs */
router.post("/whatsapp/test", async (_req: Request, res: Response) => {
  try {
    const settings = await db.select().from(botSettingsTable).limit(1).then(r => r[0]);
    if (!settings?.whatsappEnabled) {
      res.status(400).json({ success: false, message: "WhatsApp is not enabled in settings" });
      return;
    }
    if (!isWhatsAppConnected()) {
      res.status(400).json({ success: false, message: "WhatsApp not connected — scan the QR code first" });
      return;
    }

    const jids = (settings.whatsappTargetJids || "").split(",").map(s => s.trim()).filter(Boolean);
    if (jids.length === 0) {
      res.status(400).json({ success: false, message: "No WhatsApp targets configured" });
      return;
    }

    const testMsg =
`🧪 TEST MESSAGE — Deriv Signal Bot

✅ WhatsApp integration is working correctly!
Your trading signals will appear here alongside Telegram.

#tradetowithdraw`;

    const { sent, failed } = await sendWhatsAppMessage(jids, testMsg);
    res.json({ success: sent > 0, sent, failed, targets: jids.length });
  } catch (err) {
    res.status(500).json({ success: false, message: String(err) });
  }
});

/** POST /api/whatsapp/settings — save WhatsApp enabled flag + target JIDs */
router.post("/whatsapp/settings", async (req: Request, res: Response) => {
  try {
    const { whatsappEnabled, whatsappTargetJids } = req.body as {
      whatsappEnabled?: boolean;
      whatsappTargetJids?: string;
    };

    const existing = await db.select().from(botSettingsTable).limit(1).then(r => r[0]);
    if (!existing) {
      res.status(404).json({ success: false, message: "Settings not found" });
      return;
    }

    await db.update(botSettingsTable).set({
      whatsappEnabled: whatsappEnabled ?? existing.whatsappEnabled,
      whatsappTargetJids: whatsappTargetJids ?? existing.whatsappTargetJids,
      updatedAt: new Date(),
    }).where(/* all rows */ undefined as any);

    res.json({ success: true, message: "WhatsApp settings saved" });
  } catch (err) {
    res.status(500).json({ success: false, message: String(err) });
  }
});

// ─── Meta WhatsApp Cloud API ──────────────────────────────────────────────────

/** POST /api/whatsapp/cloud/settings — save Cloud API credentials */
router.post("/whatsapp/cloud/settings", async (req: Request, res: Response) => {
  try {
    const { waCloudEnabled, waCloudPhoneNumberId, waCloudAccessToken, waCloudRecipients } = req.body as {
      waCloudEnabled?: boolean;
      waCloudPhoneNumberId?: string;
      waCloudAccessToken?: string;
      waCloudRecipients?: string;
    };

    const existing = await db.select().from(botSettingsTable).limit(1).then(r => r[0]);
    if (!existing) { res.status(404).json({ success: false, message: "Settings not found" }); return; }

    await db.update(botSettingsTable).set({
      waCloudEnabled: waCloudEnabled ?? existing.waCloudEnabled,
      waCloudPhoneNumberId: waCloudPhoneNumberId ?? existing.waCloudPhoneNumberId,
      waCloudAccessToken: waCloudAccessToken ?? existing.waCloudAccessToken,
      waCloudRecipients: waCloudRecipients ?? existing.waCloudRecipients,
      updatedAt: new Date(),
    }).where(undefined as any);

    res.json({ success: true, message: "Cloud API settings saved" });
  } catch (err) {
    res.status(500).json({ success: false, message: String(err) });
  }
});

/** POST /api/whatsapp/cloud/test — send a test message via Cloud API */
router.post("/whatsapp/cloud/test", async (_req: Request, res: Response) => {
  try {
    const settings = await db.select().from(botSettingsTable).limit(1).then(r => r[0]);
    if (!settings?.waCloudPhoneNumberId || !settings.waCloudAccessToken) {
      res.status(400).json({ success: false, message: "Phone Number ID and Access Token are required" });
      return;
    }

    const recipients = (settings.waCloudRecipients ?? "")
      .split(",").map(s => s.trim()).filter(Boolean);
    if (recipients.length === 0) {
      res.status(400).json({ success: false, message: "No recipient numbers configured" });
      return;
    }

    const testMsg = `🧪 TEST — Deriv Signal Bot (Cloud API)\n\n✅ Meta WhatsApp Cloud API is working!\nSignals will appear here.\n\n#tradetowithdraw`;
    const { sent, failed } = await sendViaCloudAPI(settings.waCloudPhoneNumberId, settings.waCloudAccessToken, recipients, testMsg);
    res.json({ success: sent > 0, sent, failed });
  } catch (err) {
    res.status(500).json({ success: false, message: String(err) });
  }
});

// ─── CallMeBot ────────────────────────────────────────────────────────────────

/** POST /api/whatsapp/callmebot/settings — save CallMeBot credentials */
router.post("/whatsapp/callmebot/settings", async (req: Request, res: Response) => {
  try {
    const { callmebotEnabled, callmebotPhone, callmebotApiKey } = req.body as {
      callmebotEnabled?: boolean;
      callmebotPhone?: string;
      callmebotApiKey?: string;
    };

    const existing = await db.select().from(botSettingsTable).limit(1).then(r => r[0]);
    if (!existing) { res.status(404).json({ success: false, message: "Settings not found" }); return; }

    await db.update(botSettingsTable).set({
      callmebotEnabled: callmebotEnabled ?? existing.callmebotEnabled,
      callmebotPhone: callmebotPhone ?? existing.callmebotPhone,
      callmebotApiKey: callmebotApiKey ?? existing.callmebotApiKey,
      updatedAt: new Date(),
    }).where(undefined as any);

    res.json({ success: true, message: "CallMeBot settings saved" });
  } catch (err) {
    res.status(500).json({ success: false, message: String(err) });
  }
});

/** POST /api/whatsapp/callmebot/test — send a test message via CallMeBot */
router.post("/whatsapp/callmebot/test", async (_req: Request, res: Response) => {
  try {
    const settings = await db.select().from(botSettingsTable).limit(1).then(r => r[0]);
    if (!settings?.callmebotPhone || !settings.callmebotApiKey) {
      res.status(400).json({ success: false, message: "Phone number and API key are required" });
      return;
    }

    const testMsg = `🧪 TEST — Deriv Signal Bot (CallMeBot)\n\n✅ CallMeBot API is working!\nSignals will appear here.\n\n#tradetowithdraw`;
    const ok = await sendViaCallMeBot(settings.callmebotPhone, settings.callmebotApiKey, testMsg);
    res.json({ success: ok, message: ok ? "Test sent successfully" : "CallMeBot returned an error — check your phone & API key" });
  } catch (err) {
    res.status(500).json({ success: false, message: String(err) });
  }
});

export default router;
