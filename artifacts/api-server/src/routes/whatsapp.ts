import { Router, type IRouter, type Request, type Response } from "express";
import { db } from "@workspace/db";
import { botSettingsTable } from "@workspace/db/schema";
import {
  getWhatsAppStatus,
  getWhatsAppQR,
  isWhatsAppConnected,
  resolveGroupInvite,
  sendWhatsAppMessage,
  refreshQR,
} from "../lib/whatsapp.js";

const router: IRouter = Router();

/** GET /api/whatsapp/status — current connection state + QR code if waiting */
router.get("/whatsapp/status", (_req: Request, res: Response) => {
  res.json({
    status: getWhatsAppStatus(),
    connected: isWhatsAppConnected(),
    qr: getWhatsAppQR(),
  });
});

/** POST /api/whatsapp/refresh-qr — force a new QR code */
router.post("/whatsapp/refresh-qr", async (_req: Request, res: Response) => {
  try {
    await refreshQR();
    res.json({ success: true, message: "QR refresh initiated — check status in a moment" });
  } catch (err) {
    res.status(500).json({ success: false, message: String(err) });
  }
});

/** POST /api/whatsapp/resolve-group — resolve invite link → JID */
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

export default router;
