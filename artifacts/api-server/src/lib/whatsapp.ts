import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";
import { db } from "@workspace/db";
import { botSettingsTable } from "@workspace/db/schema";
import makeWASocket, {
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion,
  makeCacheableSignalKeyStore,
  type WASocket,
} from "@whiskeysockets/baileys";
import { Boom } from "@hapi/boom";
import QRCode from "qrcode";
import { logger as baseLogger } from "./logger.js";

const logger = baseLogger.child({ module: "whatsapp" });

// Auth state stored in a persistent directory
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const AUTH_DIR = path.resolve(__dirname, "../../whatsapp-auth");

// ── State ──────────────────────────────────────────────────────────────────────
export type WAStatus = "disconnected" | "awaiting_qr" | "connected";

let sock: WASocket | null = null;
let currentStatus: WAStatus = "disconnected";
let currentQrBase64: string | null = null;
let reconnectTimer: NodeJS.Timeout | null = null;
let isStarting = false;

// ── Public state accessors ────────────────────────────────────────────────────
export function getWhatsAppStatus(): WAStatus {
  return currentStatus;
}

export function getWhatsAppQR(): string | null {
  return currentQrBase64;
}

export function isWhatsAppConnected(): boolean {
  return currentStatus === "connected";
}

// ── Send message ──────────────────────────────────────────────────────────────
/**
 * Send a text message to one or more JIDs.
 * Supports:
 *   personal chats  → @s.whatsapp.net
 *   groups          → @g.us
 *   channels        → @newsletter  (linked account must be channel admin/owner)
 */
export async function sendWhatsAppMessage(jids: string[], text: string): Promise<{ sent: number; failed: number }> {
  if (!sock || currentStatus !== "connected") {
    logger.warn("WhatsApp not connected — message not sent");
    return { sent: 0, failed: jids.length };
  }

  let sent = 0;
  let failed = 0;

  for (const jid of jids) {
    try {
      if (jid.endsWith("@newsletter")) {
        // Channels require the newsletter send method
        await (sock as any).newsletterSendMessage(jid, { text });
      } else {
        await sock.sendMessage(jid, { text });
      }
      sent++;
      logger.info({ jid }, "WhatsApp message sent");
    } catch (err) {
      failed++;
      logger.error({ err, jid }, "Failed to send WhatsApp message");
    }
  }

  return { sent, failed };
}

/**
 * Resolve a WhatsApp group invite link (e.g. https://chat.whatsapp.com/XXXX)
 * to a group JID (@g.us).
 */
export async function resolveGroupInvite(inviteLink: string): Promise<string | null> {
  if (!sock || currentStatus !== "connected") {
    throw new Error("WhatsApp not connected — scan QR code first");
  }

  try {
    const match = inviteLink.match(/chat\.whatsapp\.com\/([A-Za-z0-9]+)/);
    if (!match) throw new Error("Invalid invite link format");
    const inviteCode = match[1];

    const info = await sock.groupGetInviteInfo(inviteCode);
    return info.id;
  } catch (err) {
    logger.error({ err, inviteLink }, "Failed to resolve group invite");
    throw err;
  }
}

/**
 * Resolve a WhatsApp Channel invite link (e.g. https://whatsapp.com/channel/XXXX)
 * to a newsletter JID (@newsletter).
 * The linked account must be the channel owner/admin to post to it.
 */
export async function resolveChannelInvite(inviteLink: string): Promise<string | null> {
  if (!sock || currentStatus !== "connected") {
    throw new Error("WhatsApp not connected — scan QR code first");
  }

  try {
    // Channel links: https://whatsapp.com/channel/XXXX or https://www.whatsapp.com/channel/XXXX
    const match = inviteLink.match(/whatsapp\.com\/channel\/([A-Za-z0-9_-]+)/i);
    if (!match) throw new Error("Invalid channel link format — expected https://whatsapp.com/channel/...");
    const inviteCode = match[1];

    const info = await (sock as any).newsletterMetadata("invite", inviteCode);
    logger.info({ channelName: info?.name, jid: info?.id }, "Channel resolved");
    return info?.id ?? null;
  } catch (err) {
    logger.error({ err, inviteLink }, "Failed to resolve channel invite");
    throw err;
  }
}

// ── Core Baileys socket ───────────────────────────────────────────────────────
async function createSocket(): Promise<void> {
  if (isStarting) return;
  isStarting = true;

  try {
    const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR);
    const { version } = await fetchLatestBaileysVersion();

    sock = makeWASocket({
      version,
      auth: {
        creds: state.creds,
        keys: makeCacheableSignalKeyStore(state.keys, baseLogger as any),
      },
      printQRInTerminal: false,
      logger: baseLogger.child({ level: "silent" }) as any,
      browser: ["Deriv Signal Bot", "Chrome", "1.0.0"],
      generateHighQualityLinkPreview: false,
      syncFullHistory: false,
    });

    sock.ev.on("creds.update", saveCreds);

    sock.ev.on("connection.update", async (update) => {
      const { connection, lastDisconnect, qr } = update;

      if (qr) {
        currentStatus = "awaiting_qr";
        try {
          currentQrBase64 = await QRCode.toDataURL(qr, { margin: 2, width: 256 });
          logger.info("QR code generated — waiting for scan");
        } catch (e) {
          logger.error({ e }, "QR code generation failed");
        }
      }

      if (connection === "open") {
        currentStatus = "connected";
        currentQrBase64 = null;
        isStarting = false;
        logger.info("WhatsApp connected ✅");
      }

      if (connection === "close") {
        currentStatus = "disconnected";
        isStarting = false;
        const statusCode = (lastDisconnect?.error as Boom)?.output?.statusCode;
        const shouldReconnect = statusCode !== DisconnectReason.loggedOut;

        logger.warn({ statusCode, shouldReconnect }, "WhatsApp connection closed");

        if (shouldReconnect) {
          if (reconnectTimer) clearTimeout(reconnectTimer);
          reconnectTimer = setTimeout(() => {
            createSocket().catch((err) => logger.error({ err }, "WhatsApp reconnect failed"));
          }, 20_000);
        } else {
          // Logged out — clear QR so user re-scans
          currentQrBase64 = null;
          logger.info("WhatsApp logged out — re-scan QR to reconnect");
        }
      }
    });
  } catch (err) {
    isStarting = false;
    logger.error({ err }, "Failed to create WhatsApp socket");
  }
}

// ── Lifecycle ─────────────────────────────────────────────────────────────────
export async function startWhatsApp(): Promise<void> {
  logger.info({ authDir: AUTH_DIR }, "Starting WhatsApp client");
  await createSocket();
}

export function stopWhatsApp(): void {
  if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
  if (sock) {
    sock.end(undefined);
    sock = null;
  }
  currentStatus = "disconnected";
  currentQrBase64 = null;
  isStarting = false;
  logger.info("WhatsApp client stopped");
}

/** Force a fresh QR code by closing and restarting the socket. */
export async function refreshQR(): Promise<void> {
  stopWhatsApp();
  await new Promise((r) => setTimeout(r, 500));
  await startWhatsApp();
}

/**
 * Wipe all stored credentials and start a completely fresh session.
 * Use this when "device couldn't link" appears — it removes the old
 * fingerprint so WhatsApp treats this as a brand-new device.
 */
export async function resetSession(): Promise<void> {
  stopWhatsApp();

  // Delete every file inside the auth directory (keep the directory itself)
  try {
    const entries = fs.readdirSync(AUTH_DIR);
    for (const entry of entries) {
      fs.rmSync(path.join(AUTH_DIR, entry), { recursive: true, force: true });
    }
    logger.info({ authDir: AUTH_DIR }, "WhatsApp session credentials cleared");
  } catch (err) {
    logger.warn({ err }, "Could not clear auth dir (may already be empty)");
  }

  await new Promise((r) => setTimeout(r, 1000));
  await startWhatsApp();
}

/**
 * Convenience function — dispatches to ALL enabled WhatsApp channels:
 *   1. Baileys (QR-linked session)
 *   2. Meta WhatsApp Cloud API
 *   3. CallMeBot
 * Each method is attempted independently; failures in one do not block others.
 */
export async function sendSignalToWhatsApp(text: string): Promise<void> {
  // ── 1. Baileys (QR) ───────────────────────────────────────────────────────
  try {
    if (isWhatsAppConnected()) {
      const settings = await db.select().from(botSettingsTable).limit(1).then(r => r[0]);
      if (settings?.whatsappEnabled) {
        const jids = (settings.whatsappTargetJids || "")
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean);
        if (jids.length > 0) await sendWhatsAppMessage(jids, text);
      }
    }
  } catch (err) {
    logger.error({ err }, "sendSignalToWhatsApp (Baileys) error");
  }

  // ── 2. Meta Cloud API ─────────────────────────────────────────────────────
  try {
    const { sendSignalViaCloud } = await import("./whatsapp-cloud.js");
    await sendSignalViaCloud(text);
  } catch (err) {
    logger.error({ err }, "sendSignalToWhatsApp (Cloud API) error");
  }

  // ── 3. CallMeBot ──────────────────────────────────────────────────────────
  try {
    const { sendSignalViaCallMeBot } = await import("./callmebot.js");
    await sendSignalViaCallMeBot(text);
  } catch (err) {
    logger.error({ err }, "sendSignalToWhatsApp (CallMeBot) error");
  }
}
