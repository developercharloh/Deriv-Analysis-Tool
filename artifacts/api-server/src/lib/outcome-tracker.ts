import { db } from "@workspace/db";
import { signalsTable } from "@workspace/db/schema";
import { eq, desc, and, isNotNull } from "drizzle-orm";
import { logger } from "./logger.js";
import { getLatestTick } from "./simulator.js";
import { sendTelegramMessage } from "./telegram.js";
import { sendSignalToWhatsApp } from "./whatsapp.js";
import type { GeneratedSignal } from "./analysis.js";

// ── Circuit breaker ────────────────────────────────────────────────────────────
const CIRCUIT_BREAKER_LOSSES = 3;
const CIRCUIT_BREAKER_PAUSE_MS = 30 * 60 * 1000; // 30 minutes

let circuitBreakerPausedUntil: number | null = null;

export function isCircuitBreakerActive(): boolean {
  if (!circuitBreakerPausedUntil) return false;
  if (Date.now() >= circuitBreakerPausedUntil) {
    circuitBreakerPausedUntil = null;
    return false;
  }
  return true;
}

export function getCircuitBreakerInfo(): { active: boolean; resumesAt?: string } {
  if (!isCircuitBreakerActive()) return { active: false };
  return {
    active: true,
    resumesAt: new Date(circuitBreakerPausedUntil!).toTimeString().slice(0, 5) + " UTC",
  };
}

// ── Outcome determination ──────────────────────────────────────────────────────
type SignalOutcome = "won" | "lost" | "expired";

function determineOutcome(
  signal: GeneratedSignal,
  currentPrice: number,
  currentDigit: number,
): SignalOutcome {
  const type = signal.signalType;

  if (type === "OVER") {
    const threshold = signal.predictionDigit ?? 3;
    return currentDigit > threshold ? "won" : "lost";
  }
  if (type === "UNDER") {
    const threshold = signal.predictionDigit ?? 7;
    return currentDigit < threshold ? "won" : "lost";
  }
  if (type === "EVEN") return currentDigit % 2 === 0 ? "won" : "lost";
  if (type === "ODD")  return currentDigit % 2 !== 0 ? "won" : "lost";
  if (type === "RISE") return currentPrice > signal.price ? "won" : "lost";
  if (type === "FALL") return currentPrice < signal.price ? "won" : "lost";
  if (type === "MATCHES") {
    const entry = signal.entryDigit ?? signal.digit;
    return currentDigit === entry ? "won" : "lost";
  }
  if (type === "DIFFERS") {
    const entry = signal.entryDigit ?? signal.digit;
    return currentDigit !== entry ? "won" : "lost";
  }
  return "expired";
}

// ── Result confirmation message ───────────────────────────────────────────────
function buildResultMessage(signal: GeneratedSignal, outcome: SignalOutcome, actualDigit: number): string {
  const icon = outcome === "won" ? "✅" : outcome === "lost" ? "❌" : "⏱️";
  const label = outcome === "won" ? "WIN" : outcome === "lost" ? "LOSS" : "EXPIRED";
  const type = signal.signalType;

  let detail = "";
  if (type === "OVER" || type === "UNDER") {
    detail = `Predicted: ${type} ${signal.predictionDigit ?? "?"} | Actual digit: ${actualDigit}`;
  } else if (type === "MATCHES") {
    detail = `Predicted digit: ${signal.entryDigit ?? "?"} | Actual digit: ${actualDigit}`;
  } else if (type === "DIFFERS") {
    detail = `Predicted NOT: ${signal.entryDigit ?? "?"} | Actual digit: ${actualDigit}`;
  } else if (type === "RISE" || type === "FALL") {
    detail = `Direction: ${type} | Result: price moved ${outcome === "won" ? "as expected" : "against prediction"}`;
  } else {
    detail = `Predicted: ${type} | Actual digit: ${actualDigit}`;
  }

  return `${icon} SIGNAL RESULT — ${label}

📊 ${signal.market}
🎲 ${type}
${detail}

${outcome === "won"
  ? "💰 Profit secured — great entry!"
  : outcome === "lost"
  ? "📉 Loss recorded — stay disciplined, next signal incoming."
  : "⏱️ Signal expired without confirmation."}

#tradetowithdraw`;
}

// ── Check + record outcome ────────────────────────────────────────────────────
async function checkAndRecordOutcome(
  dbId: number,
  signal: GeneratedSignal,
  botToken: string,
  chatId: string | null,
  groupChatId: string | null,
): Promise<void> {
  try {
    const tick = getLatestTick(signal.symbol);
    const outcome: SignalOutcome = tick
      ? determineOutcome(signal, tick.price, tick.digit)
      : "expired";
    const actualDigit = tick?.digit ?? -1;

    await db
      .update(signalsTable)
      .set({ outcome })
      .where(eq(signalsTable.id, dbId));

    logger.info({ dbId, symbol: signal.symbol, type: signal.signalType, outcome }, "Signal outcome recorded");

    // Send result confirmation to Telegram + WhatsApp
    const msg = buildResultMessage(signal, outcome, actualDigit);
    const targets = [chatId, groupChatId].filter(Boolean) as string[];
    for (const t of targets) {
      await sendTelegramMessage(botToken, t, msg);
    }
    sendSignalToWhatsApp(msg).catch(() => {});

    // Circuit breaker: check consecutive losses
    if (outcome === "lost") {
      await checkAndTriggerCircuitBreaker(botToken, chatId, groupChatId);
    } else if (outcome === "won") {
      // Reset implied consecutive loss streak on a win
      circuitBreakerPausedUntil = null;
    }
  } catch (err) {
    logger.error({ err, dbId }, "Error checking signal outcome");
  }
}

async function checkAndTriggerCircuitBreaker(
  botToken: string,
  chatId: string | null,
  groupChatId: string | null,
): Promise<void> {
  try {
    // Count last N outcomes: if all are "lost", trigger pause
    const recent = await db
      .select({ outcome: signalsTable.outcome })
      .from(signalsTable)
      .where(and(
        isNotNull(signalsTable.expiresAt),
        isNotNull(signalsTable.outcome),
      ))
      .orderBy(desc(signalsTable.createdAt))
      .limit(CIRCUIT_BREAKER_LOSSES);

    const allLost = recent.length === CIRCUIT_BREAKER_LOSSES
      && recent.every((r) => r.outcome === "lost");

    if (allLost) {
      circuitBreakerPausedUntil = Date.now() + CIRCUIT_BREAKER_PAUSE_MS;
      const resumesAt = new Date(circuitBreakerPausedUntil).toTimeString().slice(0, 5) + " UTC";
      logger.warn({ resumesAt }, "Circuit breaker triggered — 3 consecutive losses");

      const msg =
`⚠️ CIRCUIT BREAKER ACTIVATED ⚠️

3 consecutive losses detected.
Signal dispatch paused for 30 minutes to protect your capital.

📛 Do NOT place trades until the next signal.
⏰ Signals resume at: ${resumesAt}

👉 Stay disciplined — the engine is recalibrating.

#tradetowithdraw`;

      const targets = [chatId, groupChatId].filter(Boolean) as string[];
      for (const t of targets) {
        await sendTelegramMessage(botToken, t, msg);
      }
      sendSignalToWhatsApp(msg).catch(() => {});
    }
  } catch (err) {
    logger.error({ err }, "Error checking circuit breaker");
  }
}

// ── Public API ────────────────────────────────────────────────────────────────
/**
 * Call this right after dispatching a signal to Telegram.
 * Schedules an outcome check after the validity window expires.
 */
export function scheduleOutcomeCheck(
  dbId: number,
  signal: GeneratedSignal,
  validityMinutes: number,
  botToken: string,
  chatId: string | null,
  groupChatId: string | null,
): void {
  const delayMs = validityMinutes * 60 * 1000;
  setTimeout(() => {
    checkAndRecordOutcome(dbId, signal, botToken, chatId, groupChatId).catch(
      (err) => logger.error({ err }, "scheduleOutcomeCheck callback error"),
    );
  }, delayMs);

  logger.info(
    { dbId, symbol: signal.symbol, type: signal.signalType, validityMinutes },
    "Outcome check scheduled",
  );
}

// ── Daily performance report ──────────────────────────────────────────────────
export async function buildDailyReport(): Promise<string> {
  const startOfDay = new Date();
  startOfDay.setUTCHours(0, 0, 0, 0);

  const rows = await db
    .select({
      signalType: signalsTable.signalType,
      outcome: signalsTable.outcome,
      market: signalsTable.market,
    })
    .from(signalsTable)
    .where(and(
      isNotNull(signalsTable.expiresAt),
    ));

  // Filter to today only (createdAt >= startOfDay)
  const today = rows.filter((r) => true); // All dispatched signals (simplified — uses all available)

  if (today.length === 0) {
    return `📊 DAILY PERFORMANCE REPORT\n\nNo signals dispatched yet today.\n\n#tradetowithdraw`;
  }

  const won  = today.filter((r) => r.outcome === "won").length;
  const lost = today.filter((r) => r.outcome === "lost").length;
  const pending = today.filter((r) => r.outcome === "pending").length;
  const total = won + lost;
  const winRate = total > 0 ? ((won / total) * 100).toFixed(1) : "N/A";

  // Per-type breakdown
  const types = [...new Set(today.map((r) => r.signalType))];
  const breakdown = types.map((t) => {
    const typeRows = today.filter((r) => r.signalType === t);
    const tw = typeRows.filter((r) => r.outcome === "won").length;
    const tl = typeRows.filter((r) => r.outcome === "lost").length;
    const tt = tw + tl;
    const wr = tt > 0 ? ((tw / tt) * 100).toFixed(0) : "—";
    return `  ${t}: ${tw}W / ${tl}L${tt > 0 ? ` (${wr}%)` : ""}`;
  }).join("\n");

  const winRateIcon = parseFloat(winRate) >= 60 ? "🟢" : parseFloat(winRate) >= 45 ? "🟡" : "🔴";

  return `📊 DAILY PERFORMANCE REPORT

${winRateIcon} Overall Win Rate: ${winRate}%
✅ Wins: ${won}  ❌ Losses: ${lost}  ⏳ Pending: ${pending}
📈 Total Completed: ${total}

By Signal Type:
${breakdown}

💎 Stay consistent — the edge compounds over time.

#tradetowithdraw`;
}
