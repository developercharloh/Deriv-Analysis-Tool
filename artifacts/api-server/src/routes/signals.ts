import { Router, type IRouter, type Request, type Response } from "express";
import { db } from "@workspace/db";
import { signalsTable } from "@workspace/db/schema";
import { getSignals, addSseClient, getSettings, peekHighSignals, consumeSignalFromBuffer } from "../lib/bot.js";
import { sendTestBatch } from "../lib/scheduler.js";
import { getAnalysisStats } from "../lib/analysis.js";
import { sendTelegramMessage, formatSignalMessage } from "../lib/telegram.js";
import { isCircuitBreakerActive, getCircuitBreakerInfo, scheduleOutcomeCheck } from "../lib/outcome-tracker.js";
import { sendSignalToWhatsApp } from "../lib/whatsapp.js";

// ── Cooldown gate state (in-memory, resets on restart) ─────────────────────────
// The cooldown window is driven by signalIntervalMinutes from the bot settings.
// Default: 60 minutes (matches the scheduler default).

interface CooldownState {
  lastSentAt: number;        // epoch ms
  lastSentScore: number;     // combined score of last dispatch
  lastSentSymbol: string;
}

let cooldown: CooldownState | null = null;

const MARKET_NAMES: Record<string, string> = {
  "1HZ10V": "Volatility 10 (1s)", "1HZ15V": "Volatility 15 (1s)",
  "1HZ25V": "Volatility 25 (1s)", "1HZ30V": "Volatility 30 (1s)",
  "1HZ50V": "Volatility 50 (1s)", "1HZ75V": "Volatility 75 (1s)",
  "1HZ90V": "Volatility 90 (1s)", "1HZ100V": "Volatility 100 (1s)",
};

function candidateScore(s: { matchesProb?: number; ensembleScore?: number }): number {
  return (s.ensembleScore ?? 0) * 0.6 + Math.min((s.matchesProb ?? 0) * 5, 100) * 0.4;
}

function predictedValidity(score: number): number {
  if (score >= 80) return 5;
  if (score >= 65) return 5;
  if (score >= 50) return 5;
  return 3;
}

function expiryTime(minutesFromNow: number): string {
  return new Date(Date.now() + minutesFromNow * 60000).toTimeString().slice(0, 5) + " UTC";
}

function nextHourLabel(): string {
  const d = new Date(Date.now() + 3 * 3600000);
  d.setMinutes(0, 0, 0);
  d.setHours(d.getHours() + 1);
  return d.toTimeString().slice(0, 5) + " (GMT+3)";
}

export interface DispatchResult {
  success: boolean;
  message: string;
  skippedReason?: "cooldown" | "score_gate" | "no_candidates" | "warming_up" | "no_token" | "circuit_breaker";
  signal?: { symbol: string; market: string; signalType: string; validityMinutes: number; combinedScore: number };
  cooldownRemainingMs?: number;
}

/**
 * Core dispatch function — shared by the API endpoint and the 15-min scheduler.
 * Checks the real-time HIGH signal buffer first (all types: OVER/UNDER/RISE/FALL/EVEN/ODD/MATCHES/DIFFERS).
 * Falls back to the MATCHES ensemble analysis when the buffer is empty.
 * force=true bypasses the cooldown and score gate (manual override only).
 */
export async function dispatchBestSignalIfReady(force = false): Promise<DispatchResult> {
  const settings = await getSettings();
  if (!settings.telegramBotToken) {
    return { success: false, message: "Telegram bot token not configured", skippedReason: "no_token" };
  }

  // ── 0. CIRCUIT BREAKER gate ─────────────────────────────────────────────────
  if (!force && isCircuitBreakerActive()) {
    const info = getCircuitBreakerInfo();
    return {
      success: false,
      skippedReason: "circuit_breaker",
      message: `Circuit breaker active — 3 consecutive losses detected. Signal dispatch resumes at ${info.resumesAt}.`,
    };
  }

  // ── 1. COOLDOWN gate (checked before both paths) ────────────────────────────
  const cooldownMs = (settings.signalIntervalMinutes ?? 60) * 60 * 1000;
  if (!force && cooldown) {
    const elapsed = Date.now() - cooldown.lastSentAt;
    if (elapsed < cooldownMs) {
      const remaining = cooldownMs - elapsed;
      return {
        success: false,
        skippedReason: "cooldown",
        cooldownRemainingMs: remaining,
        message: `Cooldown active — ${Math.ceil(remaining / 60000)} min remaining since last signal (${cooldown.lastSentSymbol}).`,
      };
    }
  }

  // ── 2. BUFFER path — any HIGH signal from the live analysis (all types) ─────
  const buffered = peekHighSignals();
  if (buffered.length > 0) {
    // Take the most recent buffered signal (last element = newest)
    const signal = buffered[buffered.length - 1];
    const bufferScore = 75; // buffered HIGH signals are pre-approved by the analysis engine

    // Score gate: only send if at least as good as the last sent signal
    if (!force && cooldown && bufferScore < cooldown.lastSentScore) {
      return {
        success: false,
        skippedReason: "score_gate",
        message: `Score gate: buffered signal score ${bufferScore} is below last sent score ${cooldown.lastSentScore.toFixed(1)} — holding.`,
      };
    }

    const validityMinutes = 5; // analysis-approved HIGH signals warrant full validity
    const targets = [settings.telegramChatId, settings.telegramGroupChatId].filter(Boolean) as string[];
    const bufferMsg = formatSignalMessage(signal, validityMinutes);
    let sent = 0;
    for (const t of targets) {
      const ok = await sendTelegramMessage(settings.telegramBotToken, t, bufferMsg);
      if (ok) sent++;
    }
    // Mirror to WhatsApp simultaneously
    if (sent > 0) sendSignalToWhatsApp(bufferMsg).catch(() => {});

    if (sent > 0) {
      consumeSignalFromBuffer(signal.symbol, signal.signalType);
      cooldown = { lastSentAt: Date.now(), lastSentScore: bufferScore, lastSentSymbol: `${signal.symbol}:${signal.signalType}` };

      // Insert a dispatch record so the outcome can be tracked
      try {
        const expiresAt = new Date(Date.now() + validityMinutes * 60_000);
        const [dispatched] = await db
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
            validityMinutes,
            expiresAt,
          })
          .returning();
        scheduleOutcomeCheck(
          dispatched.id,
          signal,
          validityMinutes,
          settings.telegramBotToken,
          settings.telegramChatId,
          settings.telegramGroupChatId,
        );
      } catch (err) {
        // Non-critical — log but don't fail the dispatch
        console.error("Failed to insert dispatch record for outcome tracking:", err);
      }
    }

    return {
      success: sent > 0,
      message: `${signal.signalType} signal for ${signal.market} sent to ${sent} chat(s)`,
      signal: { symbol: signal.symbol, market: signal.market, signalType: signal.signalType, validityMinutes, combinedScore: bufferScore },
    };
  }

  // ── 3. ENSEMBLE fallback — MATCHES analysis when buffer is empty ─────────────
  const stats = getAnalysisStats();
  const allWarmed = Object.entries(stats).filter(([, s]) => s.tickCount >= 150);

  if (allWarmed.length === 0) {
    const top = Object.entries(stats).sort(([, a], [, b]) => b.tickCount - a.tickCount)[0];
    return {
      success: false,
      skippedReason: "warming_up",
      message: `Buffer empty & engine warming up — best at ${top?.[1]?.tickCount ?? 0}/150 ticks needed.`,
    };
  }

  const warmedCandidates = Object.entries(stats)
    .filter(([, s]) => s.tickCount >= 150 && s.matchesEntry !== undefined
      && (s.ensembleScore ?? 0) >= 55 && (s.matchesProb ?? 0) >= 10)
    .sort(([, a], [, b]) => candidateScore(b) - candidateScore(a));

  if (warmedCandidates.length === 0) {
    const best = allWarmed
      .filter(([, s]) => s.matchesEntry !== undefined)
      .sort(([, a], [, b]) => candidateScore(b) - candidateScore(a))[0];
    return {
      success: false,
      skippedReason: "no_candidates",
      message: best
        ? `No buffered signal & no MATCHES candidate strong enough. Best: ${best[0]} — score ${candidateScore(best[1]).toFixed(1)} (need ensemble≥55, prob≥10%).`
        : "Buffer empty and no symbol meets minimum quality yet.",
    };
  }

  const [bestSymbol, bestStats] = warmedCandidates[0];
  const combined = candidateScore(bestStats);

  // Score gate for ensemble fallback
  if (!force && cooldown && combined < cooldown.lastSentScore) {
    return {
      success: false,
      skippedReason: "score_gate",
      message: `Score gate: MATCHES ensemble score ${combined.toFixed(1)} is below last sent score ${cooldown.lastSentScore.toFixed(1)} — holding.`,
    };
  }

  const market = MARKET_NAMES[bestSymbol] ?? bestSymbol;
  const entryDigit = bestStats.matchesEntry!;
  const validityMinutes = predictedValidity(combined);

  const msg =
`🚨 SIGNAL ALERT 🚨

🔐 Access: https://elitestrategylab.site
🤖 Activate: Elite Entry Scanner Bot 🔥🔥

📈 Execution Plan
📊 Trade Strategy: ${market}
🎲 Trade Type: MATCHES

📍 Entry Confirmation:
Predicted Digit → ${entryDigit}

Entry point → ${entryDigit} 🟩

⏳ Signal Validity: ${validityMinutes} minutes
🕐 Expires at: ${expiryTime(validityMinutes)}

⚠️ Entry Rule:
• Select MATCHES and enter digit ${entryDigit}

🚪 Exit Rules:
• Stop after 3 consecutive losses
• Secure profit at TP

💎 Capital Protection Framework
⚖️ Risk 1–3% per trade
🎯 Target 10% of your initial account balance per cycle

👉 Stay disciplined
👉 Wait for confirmation
👉 Protect capital first

📈 Consistency = Growth

#tradetowithdraw

🌟 Next Signal: ${nextHourLabel()}`;

  const targets = [settings.telegramChatId, settings.telegramGroupChatId].filter(Boolean) as string[];
  let sent = 0;
  for (const t of targets) {
    const ok = await sendTelegramMessage(settings.telegramBotToken, t, msg);
    if (ok) sent++;
  }
  // Mirror to WhatsApp simultaneously
  if (sent > 0) sendSignalToWhatsApp(msg).catch(() => {});

  if (sent > 0) {
    cooldown = { lastSentAt: Date.now(), lastSentScore: combined, lastSentSymbol: bestSymbol };

    // Insert a dispatch record so the outcome can be tracked
    try {
      const expiresAt = new Date(Date.now() + validityMinutes * 60_000);
      const ensembleSignal = {
        market,
        symbol: bestSymbol,
        digit: entryDigit,
        price: 0,
        signalType: "MATCHES" as const,
        confidence: "HIGH" as const,
        entryDigit,
      };
      const [dispatched] = await db
        .insert(signalsTable)
        .values({
          market,
          symbol: bestSymbol,
          digit: entryDigit,
          price: 0,
          signalType: "MATCHES",
          confidence: "HIGH",
          predictionDigit: null,
          entryDigit,
          validityMinutes,
          expiresAt,
        })
        .returning();
      scheduleOutcomeCheck(
        dispatched.id,
        ensembleSignal,
        validityMinutes,
        settings.telegramBotToken,
        settings.telegramChatId,
        settings.telegramGroupChatId,
      );
    } catch (err) {
      console.error("Failed to insert dispatch record for outcome tracking (ensemble):", err);
    }
  }

  return {
    success: sent > 0,
    message: `MATCHES ensemble signal for ${market} sent to ${sent} chat(s)`,
    signal: { symbol: bestSymbol, market, signalType: "MATCHES", validityMinutes, combinedScore: parseFloat(combined.toFixed(1)) },
  };
}

const router: IRouter = Router();

router.get("/signals", async (req: Request, res: Response) => {
  const limit = parseInt((req.query.limit as string) || "50") || 50;
  const signals = await getSignals(Math.min(limit, 200));
  res.json(signals);
});

router.get("/signals/stream", (req: Request, res: Response) => {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.flushHeaders();
  res.write(`data: ${JSON.stringify({ type: "connected" })}\n\n`);
  addSseClient(res);
});

router.post("/signals/test-batch", async (_req: Request, res: Response) => {
  const success = await sendTestBatch(5);
  res.json({
    success,
    message: success ? "5 test signals sent to Telegram!" : "Failed — no HIGH signals buffered yet, try again in a few seconds.",
  });
});

// Returns the live analysis state for every symbol — tick count + ensemble scores
router.get("/signals/analysis-status", (_req: Request, res: Response) => {
  const stats = getAnalysisStats();
  res.json(stats);
});

// Manual trigger — respects cooldown by default; pass ?force=true to override
router.post("/signals/send-live-matches", async (req: Request, res: Response) => {
  try {
    const force = req.query.force === "true";
    const result = await dispatchBestSignalIfReady(force);
    res.json(result);
  } catch (err) {
    res.status(500).json({ success: false, message: String(err) });
  }
});

export default router;
