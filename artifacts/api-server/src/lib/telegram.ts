import { logger } from "./logger.js";
import type { GeneratedSignal } from "./analysis.js";

export async function sendTelegramMessage(botToken: string, chatId: string, text: string): Promise<boolean> {
  try {
    const response = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text, parse_mode: "HTML" }),
    });
    const data = (await response.json()) as { ok: boolean; description?: string };
    if (!data.ok) logger.warn({ description: data.description }, "Telegram send failed");
    return data.ok;
  } catch (err) {
    logger.error({ err }, "Error sending Telegram message");
    return false;
  }
}

function getNextHourGMT3(): string {
  const now = new Date();
  const gmt3 = new Date(now.getTime() + 3 * 60 * 60 * 1000);
  gmt3.setMinutes(0, 0, 0);
  gmt3.setHours(gmt3.getHours() + 1);
  return gmt3.toTimeString().slice(0, 5) + " (GMT+3)";
}


export function formatSignalMessage(signal: GeneratedSignal, validityMinutes = 5, marketBot?: string): string {
  const type = signal.signalType;
  const nextSignal = getNextHourGMT3();
  const expiresAt = new Date(Date.now() + validityMinutes * 60000).toTimeString().slice(0, 5) + " UTC";

  const isOverUnder = type === "OVER" || type === "UNDER";
  const isEvenOdd   = type === "EVEN" || type === "ODD";
  const trendArrow  = ["OVER", "RISE", "EVEN", "DIFFERS", "MATCHES"].includes(type) ? "📈" : "📉";

  const predDigit  = signal.predictionDigit ?? (type === "OVER" ? 3 : 8);
  const tradeLabel = isOverUnder ? `${type} ${predDigit}` : type;

  const isMatchesDiffers = type === "MATCHES" || type === "DIFFERS";

  let entryBlock = "";
  if (isOverUnder) {
    entryBlock = `\n📍 Entry Confirmation:\nPredictionDigit → ${predDigit}\n\nEntry point → ${signal.entryDigit ?? predDigit} 🟩\n`;
  } else if (isEvenOdd && signal.entryDigit !== undefined) {
    entryBlock = `\n📍 Entry Confirmation:\nPredictionDigit → ${type}\n\nEntry point → ${signal.entryDigit} 🟩\n`;
  } else if (isMatchesDiffers && signal.entryDigit !== undefined) {
    const mdNote = type === "MATCHES"
      ? `(digit ${signal.entryDigit} expected to repeat)`
      : `(digit ${signal.entryDigit} expected NOT to repeat)`;
    entryBlock = `\n📍 Entry Confirmation:\nPredictionDigit → ${signal.entryDigit}\n${mdNote}\n\nEntry point → ${signal.entryDigit} 🟩\n`;
  }

  const botLine = marketBot?.trim()
    ? `\n🤖 Recommended Bot: ${marketBot.trim()}\n`
    : "";

  return `🚨 SIGNAL ALERT 🚨

🔐 Access: https://elitestrategylab.site
🤖 Activate: Elite Entry Scanner Bot 🔥🔥

${trendArrow} Execution Plan
📊 Trade Strategy: ${signal.market}
🎲 Trade Type: ${tradeLabel}
${entryBlock}${botLine}
⏳ Signal Validity: ${validityMinutes} minutes
🕐 Expires at: ${expiresAt}

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

🌟 Next Signal: ${nextSignal}`;
}

export function formatHourlySignalBatchWithBots(signals: GeneratedSignal[], marketBots: Record<string, string>): string[] {
  return signals.map(s => formatSignalMessage(s, 10, marketBots[s.symbol]));
}

export function formatWarningMessage(minutesLeft: number, _nextSignalTime: string): string {
  return `🚨🔥 Traders get ready, signal is dripping in ${minutesLeft} minute${minutesLeft === 1 ? "" : "s"} time from now ⏳

🔐 Access: https://elitestrategylab.site
🤖 Activate: Elite Entry Scanner Bot 🔥🔥

👉 Stay disciplined
👉 Wait for confirmation
👉 Protect capital first

🚀 @strategylabfx`;
}

export function formatHourlySignalBatch(signals: GeneratedSignal[]): string[] {
  return signals.map(s => formatSignalMessage(s));
}
