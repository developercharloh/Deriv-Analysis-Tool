import { Router, type IRouter, type Request, type Response } from "express";
import { randomUUID } from "node:crypto";
import { db } from "@workspace/db";
import { subscribersTable, botSettingsTable, subscriberSessionsTable } from "@workspace/db/schema";
import { eq, desc, count } from "drizzle-orm";
import { sendTelegramMessage, formatSignalMessage } from "../lib/telegram.js";
import { sendWhatsAppMessage } from "../lib/whatsapp.js";

const MAX_DEVICES = 2;

function generateAccessKey(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const seg = () => Array.from({ length: 4 }, () => chars[Math.floor(Math.random() * chars.length)]).join("");
  return `ELITE-${seg()}-${seg()}-${seg()}`;
}

const router: IRouter = Router();

const TIER_DAYS: Record<string, number> = {
  weekly: 7,
  monthly: 30,
  "6months": 180,
  yearly: 365,
};

function endDateForTier(tier: string, from = new Date()): Date {
  const days = TIER_DAYS[tier] ?? 30;
  const d = new Date(from);
  d.setDate(d.getDate() + days);
  return d;
}

async function autoExpire(): Promise<void> {
  const now = new Date();
  const activeSubs = await db.select().from(subscribersTable).where(eq(subscribersTable.status, "active"));
  for (const sub of activeSubs) {
    if (sub.endDate < now) {
      await db.update(subscribersTable).set({ status: "expired" }).where(eq(subscribersTable.id, sub.id));
    }
  }
}

async function clearSessions(subscriberId: number): Promise<void> {
  await db.delete(subscriberSessionsTable).where(eq(subscriberSessionsTable.subscriberId, subscriberId));
}

// ── Subscriber CRUD ─────────────────────────────────────────────────────────

// GET /api/subscribers — list all with device count
router.get("/subscribers", async (_req: Request, res: Response) => {
  try {
    await autoExpire();
    const rows = await db.select().from(subscribersTable).orderBy(desc(subscribersTable.createdAt));

    // Count active sessions per subscriber
    const sessionCounts = await db
      .select({ subscriberId: subscriberSessionsTable.subscriberId, cnt: count() })
      .from(subscriberSessionsTable)
      .groupBy(subscriberSessionsTable.subscriberId);

    const countMap = Object.fromEntries(sessionCounts.map((r) => [r.subscriberId, Number(r.cnt)]));

    const result = rows.map((r) => ({ ...r, activeDevices: countMap[r.id] ?? 0 }));
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// GET /api/subscribers/active — used by signal forwarding
router.get("/subscribers/active", async (_req: Request, res: Response) => {
  try {
    await autoExpire();
    const rows = await db.select().from(subscribersTable).where(eq(subscribersTable.status, "active"));
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// POST /api/subscribers — create
router.post("/subscribers", async (req: Request, res: Response) => {
  try {
    const { name, telegramChatId, whatsappJid, tier, notes, receivePreAlert } = req.body as {
      name: string;
      telegramChatId?: string;
      whatsappJid?: string;
      tier: "weekly" | "monthly" | "6months" | "yearly";
      notes?: string;
      receivePreAlert?: boolean;
    };

    if (!name || !tier) return res.status(400).json({ error: "name and tier are required" });

    const startDate = new Date();
    const endDate = endDateForTier(tier, startDate);

    const [created] = await db
      .insert(subscribersTable)
      .values({
        name,
        telegramChatId: telegramChatId || null,
        whatsappJid: whatsappJid || null,
        tier,
        status: "active",
        startDate,
        endDate,
        notes: notes || null,
        receivePreAlert: receivePreAlert ?? true,
        accessKey: generateAccessKey(),
      })
      .returning();

    res.status(201).json({ ...created, activeDevices: 0 });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// PUT /api/subscribers/:id — update
router.put("/subscribers/:id", async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id);
    const { name, telegramChatId, whatsappJid, tier, status, notes, receivePreAlert } = req.body as {
      name?: string;
      telegramChatId?: string;
      whatsappJid?: string;
      tier?: "weekly" | "monthly" | "6months" | "yearly";
      status?: "active" | "expired" | "suspended";
      notes?: string;
      receivePreAlert?: boolean;
    };

    const updateData: Partial<typeof subscribersTable.$inferInsert> = {};
    if (name !== undefined) updateData.name = name;
    if (telegramChatId !== undefined) updateData.telegramChatId = telegramChatId || null;
    if (whatsappJid !== undefined) updateData.whatsappJid = whatsappJid || null;
    if (tier !== undefined) updateData.tier = tier;
    if (status !== undefined) updateData.status = status;
    if (notes !== undefined) updateData.notes = notes || null;
    if (receivePreAlert !== undefined) updateData.receivePreAlert = receivePreAlert;

    const [updated] = await db.update(subscribersTable).set(updateData).where(eq(subscribersTable.id, id)).returning();
    if (!updated) return res.status(404).json({ error: "Subscriber not found" });
    res.json(updated);
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// POST /api/subscribers/:id/renew — extend subscription
router.post("/subscribers/:id/renew", async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id);
    const { tier } = req.body as { tier?: "weekly" | "monthly" | "6months" | "yearly" };

    const [sub] = await db.select().from(subscribersTable).where(eq(subscribersTable.id, id));
    if (!sub) return res.status(404).json({ error: "Subscriber not found" });

    const newTier = tier || sub.tier;
    const base = sub.endDate > new Date() ? sub.endDate : new Date();
    const newEndDate = endDateForTier(newTier, base);

    const [renewed] = await db
      .update(subscribersTable)
      .set({ tier: newTier, endDate: newEndDate, status: "active" })
      .where(eq(subscribersTable.id, id))
      .returning();

    res.json(renewed);
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// POST /api/subscribers/:id/regenerate-key — new key + clear all sessions (forces re-login)
router.post("/subscribers/:id/regenerate-key", async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id);
    const newKey = generateAccessKey();
    await clearSessions(id);
    const [updated] = await db
      .update(subscribersTable)
      .set({ accessKey: newKey })
      .where(eq(subscribersTable.id, id))
      .returning();
    if (!updated) return res.status(404).json({ error: "Subscriber not found" });
    res.json({ accessKey: newKey });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// POST /api/subscribers/:id/revoke — suspend + clear sessions + new key
router.post("/subscribers/:id/revoke", async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id);
    const newKey = generateAccessKey();
    await clearSessions(id);
    const [updated] = await db
      .update(subscribersTable)
      .set({ status: "suspended", accessKey: newKey })
      .where(eq(subscribersTable.id, id))
      .returning();
    if (!updated) return res.status(404).json({ error: "Subscriber not found" });
    res.json(updated);
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// DELETE /api/subscribers/:id
router.delete("/subscribers/:id", async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id);
    await clearSessions(id);
    await db.delete(subscribersTable).where(eq(subscribersTable.id, id));
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// ── Access / Session ─────────────────────────────────────────────────────────

// Helper: extract real client IP
function getClientIp(req: Request): string {
  const forwarded = req.headers["x-forwarded-for"];
  if (forwarded) {
    const first = (typeof forwarded === "string" ? forwarded : forwarded[0]).split(",")[0].trim();
    if (first) return first;
  }
  return req.socket?.remoteAddress ?? req.ip ?? "unknown";
}

// GET /api/subscribers/:id/sessions — list active sessions with device info
router.get("/subscribers/:id/sessions", async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id);
    const sessions = await db
      .select()
      .from(subscriberSessionsTable)
      .where(eq(subscriberSessionsTable.subscriberId, id));
    res.json(sessions);
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// POST /api/access/verify — validate key + device, return session token
router.post("/access/verify", async (req: Request, res: Response) => {
  try {
    const { key, deviceId, deviceName } = req.body as { key?: string; deviceId?: string; deviceName?: string };
    if (!key) return res.status(400).json({ error: "key is required" });
    if (!deviceId) return res.status(400).json({ error: "deviceId is required" });

    const [sub] = await db
      .select()
      .from(subscribersTable)
      .where(eq(subscribersTable.accessKey, key.trim().toUpperCase()));

    if (!sub) return res.status(401).json({ error: "Invalid access key" });

    const now = new Date();
    if (sub.status === "suspended") return res.status(403).json({ error: "Access has been revoked. Contact your provider." });
    if (sub.endDate < now) {
      await db.update(subscribersTable).set({ status: "expired" }).where(eq(subscribersTable.id, sub.id));
      return res.status(403).json({ error: "Subscription expired" });
    }

    // Check existing sessions for this subscriber
    const sessions = await db
      .select()
      .from(subscriberSessionsTable)
      .where(eq(subscriberSessionsTable.subscriberId, sub.id));

    const clientIp = getClientIp(req);

    // If this device already has a session, update & return it
    const existing = sessions.find((s) => s.deviceId === deviceId);
    if (existing) {
      await db
        .update(subscriberSessionsTable)
        .set({ lastSeen: now, ipAddress: clientIp, ...(deviceName ? { deviceName } : {}) })
        .where(eq(subscriberSessionsTable.id, existing.id));
      return res.json({
        sessionToken: existing.sessionToken,
        name: sub.name,
        tier: sub.tier,
        endDate: sub.endDate,
        status: sub.status,
      });
    }

    // New device — check limit
    if (sessions.length >= MAX_DEVICES) {
      // 3rd device: revoke all sessions + regenerate key (security measure)
      const newKey = generateAccessKey();
      await clearSessions(sub.id);
      await db.update(subscribersTable).set({ accessKey: newKey }).where(eq(subscribersTable.id, sub.id));
      return res.status(403).json({
        error: "Device limit reached (max 2 devices). For security, your access key has been reset. Contact your provider for a new key.",
        keyReset: true,
      });
    }

    // Create new session
    const sessionToken = randomUUID();
    await db.insert(subscriberSessionsTable).values({
      subscriberId: sub.id,
      deviceId,
      sessionToken,
      deviceName: deviceName ?? null,
      ipAddress: clientIp,
      lastSeen: now,
    });

    return res.json({
      sessionToken,
      name: sub.name,
      tier: sub.tier,
      endDate: sub.endDate,
      status: sub.status,
    });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// GET /api/access/me — validate session token (used for heartbeat)
router.get("/access/me", async (req: Request, res: Response) => {
  try {
    const token = (req.headers.authorization ?? "").replace("Bearer ", "").trim();
    if (!token) return res.status(401).json({ error: "No session token" });

    const [session] = await db
      .select()
      .from(subscriberSessionsTable)
      .where(eq(subscriberSessionsTable.sessionToken, token));

    if (!session) return res.status(401).json({ error: "Session expired or revoked" });

    // Update heartbeat
    await db
      .update(subscriberSessionsTable)
      .set({ lastSeen: new Date() })
      .where(eq(subscriberSessionsTable.id, session.id));

    const [sub] = await db.select().from(subscribersTable).where(eq(subscribersTable.id, session.subscriberId));
    if (!sub) return res.status(401).json({ error: "Subscriber not found" });
    if (sub.status === "suspended") return res.status(403).json({ error: "Access revoked" });
    if (sub.endDate < new Date()) return res.status(403).json({ error: "Subscription expired" });

    return res.json({ valid: true, name: sub.name, tier: sub.tier, endDate: sub.endDate, status: sub.status });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// POST /api/access/logout — remove session
router.post("/access/logout", async (req: Request, res: Response) => {
  try {
    const token = (req.headers.authorization ?? "").replace("Bearer ", "").trim();
    if (token) {
      await db.delete(subscriberSessionsTable).where(eq(subscriberSessionsTable.sessionToken, token));
    }
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// ── Test signal ──────────────────────────────────────────────────────────────

// POST /api/subscribers/:id/test — send a test signal to one subscriber
router.post("/subscribers/:id/test", async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id);
    const [sub] = await db.select().from(subscribersTable).where(eq(subscribersTable.id, id));
    if (!sub) return res.status(404).json({ error: "Subscriber not found" });

    const settings = await db.select().from(botSettingsTable).limit(1).then((r) => r[0]);
    if (!settings?.telegramBotToken) {
      return res.status(400).json({ error: "Telegram bot token not configured in Settings" });
    }

    const sampleSignal = {
      symbol: "1HZ100V",
      market: "Volatility 100 (1s) Index",
      signalType: "OVER" as const,
      confidence: "HIGH" as const,
      digit: 7,
      price: 1234.56,
      predictionDigit: 3,
      entryDigit: 7,
    };
    const testMsg = formatSignalMessage(sampleSignal, 10);
    const results: string[] = [];

    if (sub.telegramChatId) {
      try {
        await sendTelegramMessage(settings.telegramBotToken, sub.telegramChatId, testMsg);
        results.push("Telegram ✅");
      } catch (err) {
        results.push(`Telegram ❌ (${String(err).slice(0, 80)})`);
      }
    }

    if (sub.whatsappJid) {
      try {
        await sendWhatsAppMessage([sub.whatsappJid], testMsg);
        results.push("WhatsApp ✅");
      } catch (err) {
        results.push(`WhatsApp ❌ (${String(err).slice(0, 80)})`);
      }
    }

    if (results.length === 0) {
      return res.status(400).json({ error: "No channels configured for this subscriber" });
    }

    res.json({ success: true, results });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

export default router;
