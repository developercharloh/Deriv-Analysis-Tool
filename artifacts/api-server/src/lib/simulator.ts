import { logger } from "./logger.js";
import type { DerivTick } from "./deriv.js";

type TickHandler = (tick: DerivTick) => void;

// All Synthetic Indices — Volatility, Jump, Boom, Crash, Step (Flat)
const SYMBOL_CONFIG: Record<string, { price: number; volatility: number }> = {
  // Volatility 1s Indices
  "1HZ10V":  { price: 9876.42,  volatility: 0.08 },
  "1HZ15V":  { price: 3817.29,  volatility: 0.12 },
  "1HZ25V":  { price: 4523.17,  volatility: 0.20 },
  "1HZ30V":  { price: 1543.76,  volatility: 0.25 },
  "1HZ50V":  { price: 2341.89,  volatility: 0.40 },
  "1HZ75V":  { price: 1876.55,  volatility: 0.60 },
  "1HZ90V":  { price: 782.43,   volatility: 0.80 },
  "1HZ100V": { price: 6432.11,  volatility: 0.90 },
  // Standard Volatility Indices
  R_10:      { price: 6432.18,  volatility: 0.08 },
  R_25:      { price: 2845.91,  volatility: 0.20 },
  R_50:      { price: 4123.57,  volatility: 0.40 },
  R_75:      { price: 1897.34,  volatility: 0.60 },
  R_100:     { price: 5621.73,  volatility: 0.90 },
  // Jump Indices
  JD10:      { price: 11432.10, volatility: 0.10 },
  JD25:      { price: 7823.45,  volatility: 0.25 },
  JD50:      { price: 5234.78,  volatility: 0.50 },
  JD75:      { price: 3145.92,  volatility: 0.75 },
  JD100:     { price: 1987.63,  volatility: 1.00 },
  // Boom Indices (periodic large upward spikes)
  BOOM300:   { price: 7234.56,  volatility: 0.35 },
  BOOM500:   { price: 8912.34,  volatility: 0.30 },
  BOOM1000:  { price: 5678.90,  volatility: 0.25 },
  // Crash Indices (periodic large downward spikes)
  CRASH300:  { price: 6543.21,  volatility: 0.35 },
  CRASH500:  { price: 4321.09,  volatility: 0.30 },
  CRASH1000: { price: 3456.78,  volatility: 0.25 },
  // Step Index (Flat — very small constant steps)
  stpRNG:    { price: 100.00,   volatility: 0.01 },
};

const lastPrices: Map<string, number> = new Map(
  Object.entries(SYMBOL_CONFIG).map(([sym, cfg]) => [sym, cfg.price])
);

// Simulate realistic price movement with trend bias
const trendBias: Map<string, number> = new Map();

function generateTick(symbol: string): DerivTick {
  const cfg = SYMBOL_CONFIG[symbol] || { price: 1000, volatility: 0.5 };
  const last = lastPrices.get(symbol) || cfg.price;

  // Slowly evolve trend bias
  let bias = trendBias.get(symbol) || 0;
  bias += (Math.random() - 0.5) * 0.1;
  bias = Math.max(-0.3, Math.min(0.3, bias));
  trendBias.set(symbol, bias);

  const change = (Math.random() - 0.5 + bias) * cfg.volatility;
  const newPrice = Math.max(0.01, last + change);
  lastPrices.set(symbol, newPrice);

  const priceStr = newPrice.toFixed(2);
  const digit = parseInt(priceStr.slice(-1));

  return {
    symbol,
    price: newPrice,
    digit,
    epoch: Date.now(),
  };
}

let simulatorInterval: NodeJS.Timeout | null = null;
const handlers: Map<string, Set<TickHandler>> = new Map();

export function registerSimulatorHandler(symbol: string, handler: TickHandler): void {
  if (!handlers.has(symbol)) handlers.set(symbol, new Set());
  handlers.get(symbol)!.add(handler);
}

export function unregisterSimulatorHandler(symbol: string, handler: TickHandler): void {
  handlers.get(symbol)?.delete(handler);
}

export function startSimulator(): void {
  if (simulatorInterval) return;
  logger.info("Starting tick simulator for all 1s Synthetic Indices");

  // Fire ticks every 1 second (1s indices tick every second)
  simulatorInterval = setInterval(() => {
    for (const symbol of handlers.keys()) {
      const tick = generateTick(symbol);
      const symbolHandlers = handlers.get(symbol);
      if (symbolHandlers && symbolHandlers.size > 0) {
        symbolHandlers.forEach((h) => h(tick));
      }
    }
  }, 1000);
}

export function stopSimulator(): void {
  if (simulatorInterval) {
    clearInterval(simulatorInterval);
    simulatorInterval = null;
  }
}

/** Returns the latest known price and digit for a symbol, or null if unseen. */
export function getLatestTick(symbol: string): { price: number; digit: number } | null {
  const price = lastPrices.get(symbol);
  if (price === undefined) return null;
  const digit = parseInt(price.toFixed(2).slice(-1));
  return { price, digit };
}
