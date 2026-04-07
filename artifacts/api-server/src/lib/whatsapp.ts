import path from "path";
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
 * jids can be personal (@s.whatsapp.net) or group (@g.us).
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
      await sock.sendMessage(jid, { text });
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
    // Extract the invite code from the link
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
          }, 5000);
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
 * Convenience function — reads WhatsApp targets from the DB and sends to all.
 * Call this from every signal dispatch point instead of reading settings manually.
 * No-ops silently if WhatsApp is disabled or not connected.
 */
export async function sendSignalToWhatsApp(text: string): Promise<void> {
  try {
    if (!isWhatsAppConnected()) return;

    const settings = await db.select().from(botSettingsTable).limit(1).then(r => r[0]);
    if (!settings?.whatsappEnabled) return;

    const jids = (settings.whatsappTargetJids || "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);

    if (jids.length === 0) return;

    await sendWhatsAppMessage(jids, text);
  } catch (err) {
    logger.error({ err }, "sendSignalToWhatsApp error");
  }
}
