import { db } from "@workspace/db";
import { botSettingsTable, signalsTable, subscribersTable } from "@workspace/db/schema";
import { desc, eq } from "drizzle-orm";
import { logger } from "./logger.js";
import { sendTelegramMessage, formatWarningMessage, formatHourlySignalBatch } from "./telegram.js";
import { buildDailyReport } from "./outcome-tracker.js";
import type { GeneratedSignal } from "./analysis.js";

// ── Broadcast to all active paid subscribers ───────────────────────────────────
async function broadcastToSubscribers(botToken: string, text: string, isPreAlert: boolean): Promise<void> {
  try {
    const now = new Date();
    const subs = await db.select().from(subscribersTable).where(eq(subscribersTable.status, "active"));
    for (const sub of subs) {
      // Auto-expire overdue subscriptions
      if (sub.endDate < now) {
        await db.update(subscribersTable).set({ status: "expired" }).where(eq(subscribersTable.id, sub.id));
        continue;
      }
      if (isPreAlert && !sub.receivePreAlert) continue;
      if (sub.telegramChatId) {
        sendTelegramMessage(botToken, sub.telegramChatId, text).catch((err) =>
          logger.warn({ err, subId: sub.id }, "Failed to send scheduled signal to subscriber via Telegram"),
        );
      }
      if (sub.whatsappJid) {
        import("./whatsapp.js").then(({ sendWhatsAppMessage }) =>
          sendWhatsAppMessage([sub.whatsappJid!], text).catch((err) =>
            logger.warn({ err, subId: sub.id }, "Failed to send scheduled signal to subscriber via WhatsApp"),
          ),
        );
      }
    }
  } catch (err) {
    logger.error({ err }, "Error broadcasting scheduled signal to subscribers");
  }
}

let warningTimeout: NodeJS.Timeout | null = null;
let signalTimeout: NodeJS.Timeout | null = null;
let matchesInterval: NodeJS.Timeout | null = null;

let nextScheduledAt: number = 0;
let scheduledIntervalMinutes: number = 20;
export function getNextScheduledAt() {
  return { nextSignalAt: nextScheduledAt, intervalMinutes: scheduledIntervalMinutes };
}

type SettingsGetter = () => Promise<{
  telegramBotToken: string | null;
  telegramChatId: string | null;
  telegramGroupChatId: string | null;
  enableTelegram: boolean;
  isRunning: boolean;
  signalIntervalMinutes: number;
  lastRealTimeDispatchAt?: number;
}>;

type SignalCollector = () => GeneratedSignal[];
type MatchesDispatcher = () => Promise<{ success: boolean; message: string; skippedReason?: string }>;
type DispatchNotifier = (ts: number) => void;

let getSettingsFn: SettingsGetter;
let collectHighSignalsFn: SignalCollector;
let matchesDispatcherFn: MatchesDispatcher | null = null;
let notifyDispatchFn: DispatchNotifier = () => {};

export function initScheduler(settingsGetter: SettingsGetter, signalCollector: SignalCollector, dispatchNotifier?: DispatchNotifier): void {
  getSettingsFn = settingsGetter;
  collectHighSignalsFn = signalCollector;
  if (dispatchNotifier) notifyDispatchFn = dispatchNotifier;
}

export function registerMatchesDispatcher(fn: MatchesDispatcher): void {
  matchesDispatcherFn = fn;
}

async function sendToAll(botToken: string, chatId: string | null, groupChatId: string | null, text: string): Promise<void> {
  const targets = [chatId, groupChatId].filter(Boolean) as string[];
  for (const target of targets) {
    await sendTelegramMessage(botToken, target, text);
  }
}

async function getRecentHighFromDb(limit: number): Promise<GeneratedSignal[]> {
  const rows = await db
    .select()
    .from(signalsTable)
    .where(eq(signalsTable.confidence, "HIGH"))
    .orderBy(desc(signalsTable.createdAt))
    .limit(limit);

  return rows.map((r) => ({
    signalType: r.signalType as GeneratedSignal["signalType"],
    confidence: r.confidence as GeneratedSignal["confidence"],
    digit: r.digit,
    price: r.price,
    symbol: r.symbol,
    market: r.market,
  }));
}

async function fireHourlySignals(intervalMinutes: number): Promise<void> {
  try {
    const settings = await getSettingsFn();
    if (!settings.isRunning || !settings.enableTelegram || !settings.telegramBotToken) return;

    // If the real-time path already dispatched a signal within this interval window,
    // skip the scheduled batch entirely to prevent duplicates.
    // Use <= so that a real-time dispatch at the exact interval boundary also blocks us.
    const intervalMs = intervalMinutes * 60 * 1000;
    const lastRt = settings.lastRealTimeDispatchAt ?? 0;
    if (lastRt > 0 && Date.now() - lastRt <= intervalMs) {
      logger.info({ sinceLastRtMs: Date.now() - lastRt }, "Scheduler: skipping batch — real-time already fired in this window");
      return;
    }

    // Only use in-memory buffer — never fall back to DB to avoid re-sending
    // signals that were already dispatched by the real-time flow.
    const signals = collectHighSignalsFn();

    if (signals.length === 0) {
      logger.info("No un-dispatched HIGH signals in buffer — nothing to send");
      return;
    }

    // Send exactly ONE signal per cycle to avoid flooding the channel.
    const [best] = signals.slice(0, 1);
    const msg = formatHourlySignalBatch([best])[0];
    await sendToAll(settings.telegramBotToken, settings.telegramChatId, settings.telegramGroupChatId, msg);
    // Forward the same signal to all active paid subscribers
    broadcastToSubscribers(settings.telegramBotToken, msg, false).catch((err) =>
      logger.error({ err }, "Subscriber broadcast error (scheduled signal)"),
    );
    // Update the shared dispatch tracker so real-time won't fire again this cycle.
    notifyDispatchFn(Date.now());
    logger.info({ symbol: best.symbol, type: best.signalType }, "Scheduled signal sent (1 per cycle)");
  } catch (err) {
    logger.error({ err }, "Error firing scheduled signals");
  }
}

async function sendWarning(minutesLeft: number): Promise<void> {
  try {
    const settings = await getSettingsFn();
    if (!settings.isRunning || !settings.enableTelegram || !settings.telegramBotToken) return;

    const signalTime = new Date(Date.now() + minutesLeft * 60 * 1000);
    const signalTimeStr = signalTime.toLocaleTimeString("en-US", { hour12: false });
    const text = formatWarningMessage(minutesLeft, signalTimeStr);
    await sendToAll(settings.telegramBotToken, settings.telegramChatId, settings.telegramGroupChatId, text);
    // Also send pre-alert to subscribers who opted in
    broadcastToSubscribers(settings.telegramBotToken, text, true).catch((err) =>
      logger.error({ err }, "Subscriber broadcast error (pre-alert)"),
    );
    logger.info({ minutesLeft }, "Warning message sent");
  } catch (err) {
    logger.error({ err }, "Error sending warning");
  }
}

function scheduleNextCycle(intervalMinutes: number): void {
  if (warningTimeout) clearTimeout(warningTimeout);
  if (signalTimeout) clearTimeout(signalTimeout);

  const intervalMs = intervalMinutes * 60 * 1000;
  const warningMs = intervalMs - 10 * 60 * 1000;

  if (warningMs > 0) {
    warningTimeout = setTimeout(() => {
      sendWarning(10).catch((err) => logger.error({ err }, "Warning send error"));
    }, warningMs);
  }

  signalTimeout = setTimeout(async () => {
    await fireHourlySignals(intervalMinutes);
    const settings = await getSettingsFn().catch(() => ({ signalIntervalMinutes: intervalMinutes, isRunning: true }));
    if (settings.isRunning) {
      scheduleNextCycle(settings.signalIntervalMinutes ?? intervalMinutes);
    }
  }, intervalMs);

  const nextTime = new Date(Date.now() + intervalMs);
  nextScheduledAt = nextTime.getTime();
  scheduledIntervalMinutes = intervalMinutes;
  logger.info({ nextSignalAt: nextTime.toISOString(), intervalMinutes }, "Next scheduled signal");
}

export async function startScheduler(): Promise<void> {
  const settings = await getSettingsFn();
  const intervalMinutes = settings.signalIntervalMinutes ?? 60;
  scheduleNextCycle(intervalMinutes);
  logger.info({ intervalMinutes }, "Hourly signal scheduler started");
}

export function stopScheduler(): void {
  if (warningTimeout) { clearTimeout(warningTimeout); warningTimeout = null; }
  if (signalTimeout) { clearTimeout(signalTimeout); signalTimeout = null; }
}

const MATCHES_INTERVAL_MS = 15 * 60 * 1000; // 15 minutes

export function startMatchesSchedule(): void {
  if (matchesInterval) return;
  logger.info({ intervalMinutes: 15 }, "Matches auto-dispatch schedule started (every 15 min)");

  matchesInterval = setInterval(async () => {
    if (!matchesDispatcherFn) return;
    try {
      const result = await matchesDispatcherFn();
      if (result.success) {
        logger.info({ message: result.message }, "Scheduled MATCHES dispatch sent");
      } else {
        logger.info({ reason: result.skippedReason, message: result.message }, "Scheduled MATCHES dispatch skipped");
      }
    } catch (err) {
      logger.error({ err }, "Error in scheduled MATCHES dispatch");
    }
  }, MATCHES_INTERVAL_MS);
}

export function stopMatchesSchedule(): void {
  if (matchesInterval) {
    clearInterval(matchesInterval);
    matchesInterval = null;
  }
}

// ── Daily performance report at 20:00 UTC ─────────────────────────────────────
let dailyReportTimeout: NodeJS.Timeout | null = null;
let dailyReportInterval: NodeJS.Timeout | null = null;

function msUntilNext20UTC(): number {
  const now = new Date();
  const target = new Date();
  target.setUTCHours(20, 0, 0, 0);
  if (target.getTime() <= now.getTime()) {
    target.setUTCDate(target.getUTCDate() + 1);
  }
  return target.getTime() - now.getTime();
}

async function fireDailyReport(): Promise<void> {
  try {
    const settings = await getSettingsFn();
    if (!settings.isRunning || !settings.enableTelegram || !settings.telegramBotToken) return;

    const report = await buildDailyReport();
    await sendToAll(settings.telegramBotToken, settings.telegramChatId, settings.telegramGroupChatId, report);
    logger.info("Daily performance report sent");
  } catch (err) {
    logger.error({ err }, "Error sending daily performance report");
  }
}

export function startDailyReportSchedule(): void {
  if (dailyReportTimeout || dailyReportInterval) return;

  const delayMs = msUntilNext20UTC();
  const nextRunAt = new Date(Date.now() + delayMs);
  logger.info({ nextRunAt: nextRunAt.toISOString() }, "Daily report scheduled for 20:00 UTC");

  dailyReportTimeout = setTimeout(() => {
    fireDailyReport().catch((err) => logger.error({ err }, "Daily report error"));
    // After the first fire, run every 24 hours
    dailyReportInterval = setInterval(() => {
      fireDailyReport().catch((err) => logger.error({ err }, "Daily report error"));
    }, 24 * 60 * 60 * 1000);
  }, delayMs);
}

export function stopDailyReportSchedule(): void {
  if (dailyReportTimeout) { clearTimeout(dailyReportTimeout); dailyReportTimeout = null; }
  if (dailyReportInterval) { clearInterval(dailyReportInterval); dailyReportInterval = null; }
}

// ── Daily subscriber expiry check ──────────────────────────────────────────────
let expiryCheckInterval: NodeJS.Timeout | null = null;

async function runSubscriberExpiryCheck(): Promise<void> {
  try {
    const now = new Date();
    const activeSubs = await db.select().from(subscribersTable).where(eq(subscribersTable.status, "active"));
    let expiredCount = 0;
    for (const sub of activeSubs) {
      if (sub.endDate < now) {
        await db.update(subscribersTable).set({ status: "expired" }).where(eq(subscribersTable.id, sub.id));
        expiredCount++;
      }
    }
    if (expiredCount > 0) {
      logger.info({ expiredCount }, "Subscriber expiry check: marked expired");
    }
  } catch (err) {
    logger.error({ err }, "Error running subscriber expiry check");
  }
}

export function startSubscriberExpiryCheck(): void {
  if (expiryCheckInterval) return;
  runSubscriberExpiryCheck(); // Run immediately on start
  expiryCheckInterval = setInterval(runSubscriberExpiryCheck, 6 * 60 * 60 * 1000); // Every 6 hours
  logger.info("Subscriber expiry check scheduled (every 6 hours)");
}

export async function sendTestBatch(count: number = 5): Promise<boolean> {
  try {
    const settings = await getSettingsFn();
    if (!settings.telegramBotToken) return false;

    // Use in-memory buffer only — no DB fallback to avoid sending stale signals
    const signals = collectHighSignalsFn().slice(0, count);
    if (signals.length === 0) return false;

    const messages = formatHourlySignalBatch(signals);
    const targets = [settings.telegramChatId, settings.telegramGroupChatId].filter(Boolean) as string[];
    for (const msg of messages) {
      for (const target of targets) {
        await sendTelegramMessage(settings.telegramBotToken, target, msg);
      }
    }
    return true;
  } catch (err) {
    logger.error({ err }, "Error sending test batch");
    return false;
  }
}
