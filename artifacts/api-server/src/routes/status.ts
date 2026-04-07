import { Router, type IRouter, type Request, type Response } from "express";
import { getNextScheduledAt } from "../lib/scheduler.js";
import { db } from "@workspace/db";
import { signalsTable } from "@workspace/db/schema";
import { desc } from "drizzle-orm";

const router: IRouter = Router();

const SYNTH_1S_MARKETS = [
  { symbol: "1HZ10V",  label: "Volatility 10 (1s)" },
  { symbol: "1HZ15V",  label: "Volatility 15 (1s)" },
  { symbol: "1HZ25V",  label: "Volatility 25 (1s)" },
  { symbol: "1HZ30V",  label: "Volatility 30 (1s)" },
  { symbol: "1HZ50V",  label: "Volatility 50 (1s)" },
  { symbol: "1HZ75V",  label: "Volatility 75 (1s)" },
  { symbol: "1HZ90V",  label: "Volatility 90 (1s)" },
  { symbol: "1HZ100V", label: "Volatility 100 (1s)" },
  { symbol: "JD10",    label: "Jump 10 Index" },
  { symbol: "JD25",    label: "Jump 25 Index" },
  { symbol: "JD50",    label: "Jump 50 Index" },
  { symbol: "JD75",    label: "Jump 75 Index" },
  { symbol: "JD100",   label: "Jump 100 Index" },
];

router.get("/status", async (_req: Request, res: Response) => {
  const { nextSignalAt, intervalMinutes } = getNextScheduledAt();

  // Fetch last signal per market (last 200 signals should cover all markets)
  const recent = await db
    .select()
    .from(signalsTable)
    .orderBy(desc(signalsTable.createdAt))
    .limit(200);

  // Pick the most recent signal for each symbol
  const lastByMarket: Record<string, { signalType: string; createdAt: string; confidence: string }> = {};
  for (const sig of recent) {
    if (!lastByMarket[sig.symbol]) {
      lastByMarket[sig.symbol] = {
        signalType: sig.signalType,
        createdAt: sig.createdAt.toISOString(),
        confidence: sig.confidence,
      };
    }
  }

  const markets = SYNTH_1S_MARKETS.map(m => ({
    symbol: m.symbol,
    label: m.label,
    last: lastByMarket[m.symbol] ?? null,
  }));

  res.json({ nextSignalAt, intervalMinutes, markets });
});

export default router;
