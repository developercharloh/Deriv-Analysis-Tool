import { db } from "@workspace/db";
import { botSettingsTable, signalsTable, subscribersTable } from "@workspace/db/schema";
import { desc, eq } from "drizzle-orm";
import { logger } from "./logger.js";
import { derivClient, getMarketName, type DerivTick } from "./deriv.js";
import { analyzeTickAndGenerateSignals, type SignalType, type Confidence, type GeneratedSignal } from "./analysis.js";
import { sendTelegramMessage, formatSignalMessage, formatWarningMessage } from "./telegram.js";
import { startSimulator, registerSimulatorHandler, unregisterSimulatorHandler } from "./simulator.js";
import { initScheduler, startScheduler, startSubscriberExpiryCheck } from "./scheduler.js";
import { scheduleOutcomeCheck } from "./outcome-tracker.js";
import { sendSignalToWhatsApp } from "./whatsapp.js";
import type { Response } from "express";

// ── Real-time Telegram dispatch ────────────────────────────────────────────────
// Global single-dispatch lock: only one pre-alert + signal in flight at any time.
// With 8 markets running simultaneously, without this lock each market fires its
// own pre-alert independently, flooding the channel with repeated warnings.
let signalInFlight = false;

// Tracks when the last real-time signal was dispatched so we respect signalIntervalMinutes.
let lastRealTimeDispatchAt = Date.now();

/** Exposed so the scheduler can skip its batch when real-time already fired recently. */
export function getLastRealTimeDispatchAt(): number { return lastRealTimeDispatchAt; }

/** Called by the scheduler after it sends a signal so the real-time path won't double-fire. */
export function setLastDispatchAt(ts: number): void { lastRealTimeDispatchAt = ts; }

async function sendToAll(
  botToken: string,
  chatId: string | null,
  groupChatId: string | null,
  text: string,
): Promise<void> {
  const targets = [chatId, groupChatId].filter(Boolean) as string[];
  for (const target of targets) {
    await sendTelegramMessage(botToken, target, text);
  }
}

// ── Subscriber broadcast ───────────────────────────────────────────────────────
async function sendToActiveSubscribers(
  botToken: string,
  text: string,
  isPreAlert: boolean,
): Promise<void> {
  try {
    const now = new Date();
    const subs = await db.select().from(subscribersTable).where(eq(subscribersTable.status, "active"));

    for (const sub of subs) {
      // Auto-expire if past end date
      if (sub.endDate < now) {
        await db.update(subscribersTable).set({ status: "expired" }).where(eq(subscribersTable.id, sub.id));
        continue;
      }

      if (isPreAlert && !sub.receivePreAlert) continue;

      // Send via Telegram if chat ID set
      if (sub.telegramChatId) {
        sendTelegramMessage(botToken, sub.telegramChatId, text).catch((err) =>
          logger.warn({ err, subId: sub.id }, "Failed to send to subscriber via Telegram"),
        );
      }

      // Send via WhatsApp if JID set
      if (sub.whatsappJid) {
        const { sendWhatsAppMessage } = await import("./whatsapp.js");
        sendWhatsAppMessage([sub.whatsappJid], text).catch((err) =>
          logger.warn({ err, subId: sub.id }, "Failed to send to subscriber via WhatsApp"),
        );
      }
    }
  } catch (err) {
    logger.error({ err }, "Error broadcasting to active subscribers");
  }
}

const REALTIME_VALIDITY_MINUTES = 10;

async function dispatchSignalNow(signal: GeneratedSignal, dbId: number): Promise<void> {
  try {
    const settings = await db.select().from(botSettingsTable).limit(1).then(r => r[0]);
    if (!settings?.enableTelegram || !settings.telegramBotToken) return;

    const signalTypeBotsRaw = settings.marketBots;
    const signalTypeBots: Record<string, string> = signalTypeBotsRaw ? JSON.parse(signalTypeBotsRaw) : {};
    const marketBot = signalTypeBots[signal.signalType] ?? "";
    const msg = formatSignalMessage(signal, REALTIME_VALIDITY_MINUTES, marketBot);
    await sendToAll(
      settings.telegramBotToken,
      settings.telegramChatId,
      settings.telegramGroupChatId,
      msg,
    );
    // Mirror to WhatsApp simultaneously
    sendSignalToWhatsApp(msg).catch((err) => logger.error({ err }, "WhatsApp send error"));
    // Forward to paid subscribers
    sendToActiveSubscribers(settings.telegramBotToken, msg, false).catch(() => {});
    logger.info({ symbol: signal.symbol, type: signal.signalType }, "Real-time signal sent to Telegram + WhatsApp + subscribers");

    // Mark this signal in DB with its expiry window so outcome can be tracked
    const expiresAt = new Date(Date.now() + REALTIME_VALIDITY_MINUTES * 60_000);
    await db.update(signalsTable).set({ expiresAt, validityMinutes: REALTIME_VALIDITY_MINUTES }).where(eq(signalsTable.id, dbId));

    // Schedule outcome check after the validity window
    scheduleOutcomeCheck(
      dbId,
      signal,
      REALTIME_VALIDITY_MINUTES,
      settings.telegramBotToken,
      settings.telegramChatId,
      settings.telegramGroupChatId,
    );
  } catch (err) {
    logger.error({ err }, "Error dispatching real-time signal");
  }
}

async function scheduleSignalWithPreAlert(signal: GeneratedSignal, dbId: number): Promise<void> {
  // Global lock — if any pre-alert is already in flight, drop this one entirely.
  // This prevents the same warning being sent multiple times from different markets.
  if (signalInFlight) return;
  signalInFlight = true;

  const key = `${signal.symbol}:${signal.signalType}`;

  try {
    const settings = await db.select().from(botSettingsTable).limit(1).then(r => r[0]);
    if (!settings?.enableTelegram || !settings.telegramBotToken) {
      signalInFlight = false;
      return;
    }

    realTimeDispatchedKeys.add(key); // prevent scheduler from re-sending this signal

    const preAlertEnabled = settings.preAlertEnabled !== false;
    const preAlertMinutes = settings.preAlertMinutes ?? 2;

    if (preAlertEnabled && preAlertMinutes > 0) {
      // 1. Send the pre-alert
      const warningText = formatWarningMessage(preAlertMinutes, "");
      await sendToAll(
        settings.telegramBotToken,
        settings.telegramChatId,
        settings.telegramGroupChatId,
        warningText,
      );
      sendSignalToWhatsApp(warningText).catch(() => {});
      sendToActiveSubscribers(settings.telegramBotToken, warningText, true).catch(() => {});
      logger.info({ symbol: signal.symbol, type: signal.signalType, preAlertMinutes }, "Pre-alert sent");

      // 2. Fire the actual signal after preAlertMinutes, then release the lock
      setTimeout(async () => {
        try {
          await dispatchSignalNow(signal, dbId);
        } finally {
          signalInFlight = false;
        }
      }, preAlertMinutes * 60 * 1000);
    } else {
      // Pre-alert disabled — fire signal immediately
      logger.info({ symbol: signal.symbol, type: signal.signalType }, "Pre-alert disabled — firing signal immediately");
      try {
        await dispatchSignalNow(signal, dbId);
      } finally {
        signalInFlight = false;
      }
    }
  } catch (err) {
    signalInFlight = false;
    logger.error({ err }, "Error scheduling signal pre-alert");
  }
}

type SseClient = Response;

const sseClients: Set<SseClient> = new Set();

export function addSseClient(res: SseClient): void {
  sseClients.add(res);
  res.on("close", () => {
    sseClients.delete(res);
  });
}

function broadcastSignal(signal: object): void {
  const data = `data: ${JSON.stringify(signal)}\n\n`;
  for (const client of sseClients) {
    client.write(data);
  }
}

async function getOrCreateSettings() {
  const existing = await db.select().from(botSettingsTable).limit(1);
  if (existing.length > 0) return existing[0];
  const [created] = await db
    .insert(botSettingsTable)
    .values({
      enableTelegram: false,
      selectedMarkets: "1HZ10V,1HZ15V,1HZ25V,1HZ30V,1HZ50V,1HZ75V,1HZ90V,1HZ100V,JD10,JD25,JD50,JD75,JD100",
      signalTypes: "OVER,UNDER,EVEN,ODD,RISE,FALL,MATCHES,DIFFERS",
      minConfidence: "HIGH",
      isRunning: true,
      signalIntervalMinutes: 20,
    })
    .returning();
  return created;
}

// Rolling buffer of recent HIGH signals for the scheduler fallback.
// Signals successfully dispatched via real-time flow are excluded so the
// scheduler never re-sends something that was already sent.
const recentHighSignals: GeneratedSignal[] = [];
const realTimeDispatchedKeys = new Set<string>(); // symbol:signalType already sent in real-time

function collectHighSignals(): GeneratedSignal[] {
  // Only return signals that were NOT already sent by the real-time flow
  const undispatched = recentHighSignals.filter(
    (s) => !realTimeDispatchedKeys.has(`${s.symbol}:${s.signalType}`),
  );
  recentHighSignals.length = 0;
  realTimeDispatchedKeys.clear();
  return undispatched.slice(0, 10);
}

/** Read-only view of buffered HIGH signals not yet dispatched — does not clear the buffer. */
export function peekHighSignals(): GeneratedSignal[] {
  return recentHighSignals.filter(
    (s) => !realTimeDispatchedKeys.has(`${s.symbol}:${s.signalType}`),
  );
}

/** Mark a single buffered signal as dispatcher-sent so it won't be re-sent. */
export function consumeSignalFromBuffer(symbol: string, signalType: string): void {
  const idx = recentHighSignals.findIndex(
    (s) => s.symbol === symbol && s.signalType === signalType,
  );
  if (idx !== -1) recentHighSignals.splice(idx, 1);
  realTimeDispatchedKeys.add(`${symbol}:${signalType}`);
}

async function processTickForBot(tick: DerivTick): Promise<void> {
  try {
    const settings = await getOrCreateSettings();
    if (!settings.isRunning) return;

    const enabledTypes = (settings.signalTypes || "OVER,UNDER,EVEN,ODD,RISE,FALL,MATCHES,DIFFERS")
      .split(",")
      .map((s) => s.trim()) as SignalType[];

    const minConf = (settings.minConfidence || "HIGH") as Confidence;
    const confOrder: Confidence[] = ["LOW", "MEDIUM", "HIGH"];
    const minConfIdx = confOrder.indexOf(minConf);

    const market = getMarketName(tick.symbol);
    const signals = analyzeTickAndGenerateSignals(tick, market, enabledTypes);

    for (const signal of signals) {
      const sigConfIdx = confOrder.indexOf(signal.confidence);
      if (sigConfIdx < minConfIdx) continue;

      // Buffer HIGH signals for the scheduler — deduplicated by symbol:signalType.
      // Replace any existing entry for the same key so the buffer never accumulates
      // duplicates across thousands of ticks.
      if (signal.confidence === "HIGH") {
        const bufKey = `${signal.symbol}:${signal.signalType}`;
        const existing = recentHighSignals.findIndex(
          (s) => `${s.symbol}:${s.signalType}` === bufKey,
        );
        if (existing !== -1) {
          recentHighSignals[existing] = signal; // replace with freshest
        } else {
          recentHighSignals.push(signal);
          if (recentHighSignals.length > 20) recentHighSignals.shift();
        }
      }

      const [saved] = await db
        .insert(signalsTable)
        .values({
          market: signal.market,
          symbol: signal.symbol,
          digit: signal.digit,
          price: signal.price,
          signalType: signal.signalType as "OVER" | "UNDER" | "EVEN" | "ODD" | "RISE" | "FALL" | "MATCHES" | "DIFFERS",
          confidence: signal.confidence,
          predictionDigit: signal.predictionDigit ?? null,
          entryDigit: signal.entryDigit ?? null,
        })
        .returning();

      broadcastSignal(saved);

      // Real-time Telegram: gate dispatch by the configured signalIntervalMinutes.
      // Buffer the HIGH signal regardless; only send if the interval has elapsed.
      if (signal.confidence === "HIGH") {
        const intervalMs = (settings.signalIntervalMinutes ?? 60) * 60 * 1000;
        const now = Date.now();
        if (now - lastRealTimeDispatchAt >= intervalMs) {
          lastRealTimeDispatchAt = now;
          scheduleSignalWithPreAlert(signal, saved.id).catch((err) =>
            logger.error({ err }, "scheduleSignalWithPreAlert error"),
          );
        } else {
          const remainMin = Math.ceil((intervalMs - (now - lastRealTimeDispatchAt)) / 60000);
          logger.debug({ symbol: signal.symbol, type: signal.signalType, remainMin }, "Signal buffered — interval gate active");
        }
      }
    }
  } catch (err) {
    logger.error({ err }, "Error processing tick for bot");
  }
}

let currentSymbols: string[] = [];
const tickHandlers: Map<string, (tick: DerivTick) => void> = new Map();
let useSimulator = false;

async function syncSubscriptions(): Promise<void> {
  const settings = await getOrCreateSettings();
  const markets = (settings.selectedMarkets || "1HZ10V,1HZ15V,1HZ25V,1HZ30V,1HZ50V,1HZ75V,1HZ90V,1HZ100V,JD10,JD25,JD50,JD75,JD100").split(",").map((s) => s.trim());

  const toRemove = currentSymbols.filter((s) => !markets.includes(s));
  const toAdd = markets.filter((s) => !currentSymbols.includes(s));

  for (const sym of toRemove) {
    const handler = tickHandlers.get(sym);
    if (handler) {
      if (useSimulator) {
        unregisterSimulatorHandler(sym, handler);
      } else {
        derivClient.offTick(sym, handler);
      }
      tickHandlers.delete(sym);
    }
  }

  for (const sym of toAdd) {
    const handler = (tick: DerivTick) => processTickForBot(tick);
    tickHandlers.set(sym, handler);
    if (useSimulator) {
      registerSimulatorHandler(sym, handler);
    } else {
      derivClient.onTick(sym, handler);
    }
  }

  currentSymbols = markets;
}

let syncInterval: NodeJS.Timeout | null = null;

export async function startBot(): Promise<void> {
  let wsConnected = false;
  derivClient.connect();

  await new Promise<void>((resolve) => {
    const timeout = setTimeout(() => {
      if (!wsConnected) {
        logger.info("Deriv WebSocket unavailable, using tick simulator");
        useSimulator = true;
        startSimulator();
      }
      resolve();
    }, 3000);

    const checkInterval = setInterval(() => {
      const ws = (derivClient as any).ws;
      if (ws && ws.readyState === 1) {
        wsConnected = true;
        clearTimeout(timeout);
        clearInterval(checkInterval);
        resolve();
      }
    }, 200);
  });

  await syncSubscriptions();

  if (!syncInterval) {
    syncInterval = setInterval(() => {
      syncSubscriptions().catch((err) => logger.error({ err }, "Sync subscriptions error"));
    }, 10000);
  }

  // Init and start the hourly signal scheduler
  initScheduler(
    async () => {
      const s = await getOrCreateSettings();
      return {
        telegramBotToken: s.telegramBotToken,
        telegramChatId: s.telegramChatId,
        telegramGroupChatId: s.telegramGroupChatId,
        enableTelegram: s.enableTelegram,
        isRunning: s.isRunning,
        signalIntervalMinutes: s.signalIntervalMinutes ?? 20,
        lastRealTimeDispatchAt,
      };
    },
    collectHighSignals,
    setLastDispatchAt,
  );

  await startScheduler();
  startSubscriberExpiryCheck();
}

export async function getSettings() {
  const settings = await getOrCreateSettings();
  let marketBots: Record<string, string> = {};
  try {
    if (settings.marketBots) marketBots = JSON.parse(settings.marketBots);
  } catch {}
  return {
    ...settings,
    selectedMarkets: (settings.selectedMarkets || "1HZ10V,1HZ15V,1HZ25V,1HZ30V,1HZ50V,1HZ75V,1HZ90V,1HZ100V,JD10,JD25,JD50,JD75,JD100").split(",").map((s) => s.trim()),
    signalTypes: (settings.signalTypes || "OVER,UNDER,EVEN,ODD,RISE,FALL,MATCHES,DIFFERS").split(",").map((s) => s.trim()),
    marketBots,
  };
}

export async function updateSettings(input: {
  telegramBotToken?: string | null;
  telegramChatId?: string | null;
  telegramGroupChatId?: string | null;
  enableTelegram?: boolean;
  selectedMarkets?: string[];
  signalTypes?: string[];
  minConfidence?: string;
  isRunning?: boolean;
  signalIntervalMinutes?: number;
  preAlertEnabled?: boolean;
  preAlertMinutes?: number;
  marketBots?: Record<string, string>;
}) {
  const existing = await getOrCreateSettings();

  const updateData: Partial<typeof botSettingsTable.$inferSelect> = {
    updatedAt: new Date(),
  };

  if (input.telegramBotToken !== undefined) updateData.telegramBotToken = input.telegramBotToken;
  if (input.telegramChatId !== undefined) updateData.telegramChatId = input.telegramChatId;
  if (input.telegramGroupChatId !== undefined) updateData.telegramGroupChatId = input.telegramGroupChatId;
  if (input.enableTelegram !== undefined) updateData.enableTelegram = input.enableTelegram;
  if (input.selectedMarkets !== undefined) updateData.selectedMarkets = input.selectedMarkets.join(",");
  if (input.signalTypes !== undefined) updateData.signalTypes = input.signalTypes.join(",");
  if (input.minConfidence !== undefined) updateData.minConfidence = input.minConfidence;
  if (input.signalIntervalMinutes !== undefined) updateData.signalIntervalMinutes = input.signalIntervalMinutes;
  if (input.preAlertEnabled !== undefined) updateData.preAlertEnabled = input.preAlertEnabled;
  if (input.preAlertMinutes !== undefined) updateData.preAlertMinutes = input.preAlertMinutes;
  if (input.marketBots !== undefined) updateData.marketBots = JSON.stringify(input.marketBots);
  if (input.isRunning !== undefined) {
    updateData.isRunning = input.isRunning;
    if (input.isRunning && useSimulator) {
      startSimulator();
    }
  }

  const [updated] = await db
    .update(botSettingsTable)
    .set(updateData)
    .where(eq(botSettingsTable.id, existing.id))
    .returning();

  await syncSubscriptions();

  return {
    ...updated,
    selectedMarkets: (updated.selectedMarkets || "1HZ10V,1HZ15V,1HZ25V,1HZ30V,1HZ50V,1HZ75V,1HZ90V,1HZ100V,JD10,JD25,JD50,JD75,JD100").split(",").map((s) => s.trim()),
    signalTypes: (updated.signalTypes || "OVER,UNDER,EVEN,ODD,RISE,FALL,MATCHES,DIFFERS").split(",").map((s) => s.trim()),
  };
}

export async function getSignals(limit: number = 50) {
  return db.select().from(signalsTable).orderBy(desc(signalsTable.createdAt)).limit(limit);
}

export function getRecentHighSignals(): GeneratedSignal[] {
  return [...recentHighSignals];
}
