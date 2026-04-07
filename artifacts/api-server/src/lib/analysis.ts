import type { DerivTick } from "./deriv.js";

export type SignalType = "OVER" | "UNDER" | "EVEN" | "ODD" | "RISE" | "FALL" | "MATCHES" | "DIFFERS";
export type Confidence = "LOW" | "MEDIUM" | "HIGH";
export type MarketRegime = "TRENDING" | "RANGING" | "HIGH_VOLATILITY" | "LOW_VOLATILITY";
export type VolatilityRegime = "LOW" | "MEDIUM" | "HIGH";
export type SignalGrade = "A+" | "A" | "B";

export interface GeneratedSignal {
  signalType: SignalType;
  confidence: Confidence;
  confidenceScore?: number;
  grade?: SignalGrade;
  digit: number;
  price: number;
  symbol: string;
  market: string;
  entryDigit?: number;
  predictionDigit?: number;
  digitFrequencies?: number[];
  rsi?: number;
  adx?: number;
  trend?: "BULLISH" | "BEARISH";
  regime?: MarketRegime;
  volatilityRegime?: VolatilityRegime;
  modelAgreement?: number;
  tickWindowsAligned?: number;
  entropy?: number;
  hasAnomaly?: boolean;
  explanation?: string;
}

const HISTORY_SIZE = 1000;

interface SymbolState {
  ticks: DerivTick[];
  ema50: number;
  ema200: number;
  vwapSum: number;
  vwapCount: number;
  avgGain: number;
  avgLoss: number;
  rsiInitialized: boolean;
  prevDmPlus: number;
  prevDmMinus: number;
  prevTr: number;
  adxSmoothed: number;
  atrSmoothed: number;
  adxInitialized: boolean;
  dominanceCount: number;
  dominanceType: "OVER" | "UNDER" | null;
  awaitingEntry: boolean;
  awaitingEntryType: "OVER" | "UNDER" | null;
  consecutiveLosses: number;
  cusumPos: number;
  cusumNeg: number;
  markovCounts: number[][];
  markovMatrix: number[][];
  lastDigit: number;
  lastTickTime: number;
  tickRates: number[];
  lastSignalTimes: Partial<Record<SignalType, number>>;
}

const symbolStates = new Map<string, SymbolState>();

function getState(symbol: string): SymbolState {
  if (!symbolStates.has(symbol)) {
    symbolStates.set(symbol, {
      ticks: [],
      ema50: 0, ema200: 0,
      vwapSum: 0, vwapCount: 0,
      avgGain: 0, avgLoss: 0, rsiInitialized: false,
      prevDmPlus: 0, prevDmMinus: 0, prevTr: 0,
      adxSmoothed: 0, atrSmoothed: 0, adxInitialized: false,
      dominanceCount: 0, dominanceType: null,
      awaitingEntry: false, awaitingEntryType: null,
      consecutiveLosses: 0,
      cusumPos: 0, cusumNeg: 0,
      markovCounts: Array.from({ length: 10 }, () => new Array(10).fill(0)),
      markovMatrix: Array.from({ length: 10 }, () => new Array(10).fill(0.1)),
      lastDigit: -1,
      lastTickTime: 0, tickRates: [],
      lastSignalTimes: {},
    });
  }
  return symbolStates.get(symbol)!;
}

// ─── CORE INDICATORS ──────────────────────────────────────────────────────────

function calcEMA(price: number, prev: number, period: number): number {
  if (prev === 0) return price;
  return price * (2 / (period + 1)) + prev * (1 - 2 / (period + 1));
}

function updateRSI(state: SymbolState, price: number, prev: number): number {
  const change = price - prev;
  const gain = Math.max(change, 0);
  const loss = Math.max(-change, 0);
  const p = 14;
  if (!state.rsiInitialized) {
    state.avgGain = gain; state.avgLoss = loss;
    if (state.ticks.length >= p) state.rsiInitialized = true;
  } else {
    state.avgGain = (state.avgGain * (p - 1) + gain) / p;
    state.avgLoss = (state.avgLoss * (p - 1) + loss) / p;
  }
  if (state.avgLoss === 0) return 100;
  return 100 - 100 / (1 + state.avgGain / state.avgLoss);
}

function updateADXATR(state: SymbolState, price: number, prev: number): { adx: number; atr: number } {
  const p = 14;
  const change = price - prev;
  const dmPlus = Math.max(change, 0);
  const dmMinus = Math.max(-change, 0);
  const tr = Math.abs(change);
  if (!state.adxInitialized) {
    state.prevDmPlus = dmPlus; state.prevDmMinus = dmMinus; state.prevTr = tr;
    state.atrSmoothed = tr;
    if (state.ticks.length >= p) state.adxInitialized = true;
    return { adx: 0, atr: tr };
  }
  const sDmPlus = state.prevDmPlus - state.prevDmPlus / p + dmPlus;
  const sDmMinus = state.prevDmMinus - state.prevDmMinus / p + dmMinus;
  const sTr = state.prevTr - state.prevTr / p + tr;
  state.prevDmPlus = sDmPlus; state.prevDmMinus = sDmMinus; state.prevTr = sTr;
  state.atrSmoothed = (state.atrSmoothed * (p - 1) + tr) / p;
  if (sTr === 0) return { adx: state.adxSmoothed, atr: state.atrSmoothed };
  const diPlus = (sDmPlus / sTr) * 100;
  const diMinus = (sDmMinus / sTr) * 100;
  const dx = diPlus + diMinus > 0 ? (Math.abs(diPlus - diMinus) / (diPlus + diMinus)) * 100 : 0;
  state.adxSmoothed = state.adxSmoothed === 0 ? dx : (state.adxSmoothed * (p - 1) + dx) / p;
  return { adx: state.adxSmoothed, atr: state.atrSmoothed };
}

// ─── DATA QUALITY VALIDATION ──────────────────────────────────────────────────

function validateDataQuality(ticks: DerivTick[]): boolean {
  if (ticks.length < 50) return false;
  const recent = ticks.slice(-50);
  let gaps = 0;
  for (let i = 1; i < recent.length; i++) {
    if (recent[i].epoch - recent[i - 1].epoch > 8000) gaps++;
  }
  if (gaps > 8) return false;
  const prices = recent.map(t => t.price);
  const mean = prices.reduce((a, b) => a + b, 0) / prices.length;
  const std = Math.sqrt(prices.reduce((a, b) => a + (b - mean) ** 2, 0) / prices.length);
  if (std === 0) return true;
  const outliers = prices.filter(p => Math.abs(p - mean) > 4 * std).length;
  return outliers <= 3;
}

// ─── ENTROPY ──────────────────────────────────────────────────────────────────

function shannonEntropy(ticks: DerivTick[], window = 100): number {
  const sample = ticks.slice(-window);
  const counts = new Array(10).fill(0);
  for (const t of sample) counts[t.digit]++;
  const n = sample.length;
  let h = 0;
  for (const c of counts) {
    if (c > 0) { const p = c / n; h -= p * Math.log2(p); }
  }
  return h / Math.log2(10);
}

// ─── ANOMALY DETECTION ────────────────────────────────────────────────────────

function hasAnomalies(ticks: DerivTick[], window = 60): boolean {
  if (ticks.length < window) return false;
  const prices = ticks.slice(-window).map(t => t.price);
  const mean = prices.reduce((a, b) => a + b, 0) / prices.length;
  const std = Math.sqrt(prices.reduce((a, b) => a + (b - mean) ** 2, 0) / prices.length);
  if (std === 0) return false;
  return prices.filter(p => Math.abs(p - mean) > 3.5 * std).length > window * 0.04;
}

// ─── DIGIT FREQUENCIES ────────────────────────────────────────────────────────

function digitFreqs(ticks: DerivTick[], n = 1000): number[] {
  const sample = ticks.slice(-n);
  const counts = new Array(10).fill(0);
  for (const t of sample) counts[t.digit]++;
  return counts.map(c => parseFloat(((c / sample.length) * 100).toFixed(1)));
}

// ─── SAFE PREDICTION DIGIT ────────────────────────────────────────────────────
// Selects the most specific threshold that still passes its minimum win-prob gate.
// Scans from the most specific end first so OVER 3/2/1/0 and UNDER 6/7/8/9
// all get a fair chance based on the market's current digit distribution.
//
// Gate per threshold (OVER):
//   OVER 3 → wins if digit > 3 (4–9) → gate 72%
//   OVER 2 → wins if digit > 2 (3–9) → gate 74%
//   OVER 1 → wins if digit > 1 (2–9) → gate 78%
//   OVER 0 → wins if digit > 0 (1–9) → gate 82%
//
// Gate per threshold (UNDER):
//   UNDER 6 → wins if digit < 6 (0–5) → gate 72%
//   UNDER 7 → wins if digit < 7 (0–6) → gate 74%
//   UNDER 8 → wins if digit < 8 (0–7) → gate 78%
//   UNDER 9 → wins if digit < 9 (0–8) → gate 82%
//
// The first threshold that clears its gate is used. Falls back to the safest
// level (OVER 0 / UNDER 9). Rejects entirely when no level clears its gate.

const OVER_LEVELS  = [
  { n: 3, gate: 0.63 },   // OVER 3 → digits 4–9 win (base ~60%)
  { n: 2, gate: 0.72 },   // OVER 2 → digits 3–9 win (base ~70%)
  { n: 1, gate: 0.78 },   // OVER 1 → digits 2–9 win (base ~80%)
];
const UNDER_LEVELS = [
  { n: 6, gate: 0.63 },   // UNDER 6 → digits 0–5 win (base ~60%)
  { n: 7, gate: 0.72 },   // UNDER 7 → digits 0–6 win (base ~70%)
  { n: 8, gate: 0.78 },   // UNDER 8 → digits 0–7 win (base ~80%)
];

function safePredictionDigit(
  freqs: number[],           // 10-element array, each value is pct (sums ~100)
  type: "OVER" | "UNDER",
  markovRow: number[] | null // transition row for the current digit, or null
): { digit: number; winProb: number; valid: boolean } {
  const FREQ_W   = 0.90;
  const MARKOV_W = 0.10;

  const levels = type === "OVER" ? OVER_LEVELS : UNDER_LEVELS;

  for (const { n, gate } of levels) {
    let freqWin: number;
    let markovWin: number;

    if (type === "OVER") {
      freqWin   = freqs.slice(n + 1).reduce((a, b) => a + b, 0) / 100;
      markovWin = markovRow ? markovRow.slice(n + 1).reduce((a, b) => a + b, 0) : freqWin;
    } else {
      freqWin   = freqs.slice(0, n).reduce((a, b) => a + b, 0) / 100;
      markovWin = markovRow ? markovRow.slice(0, n).reduce((a, b) => a + b, 0) : freqWin;
    }

    const winProb = freqWin * FREQ_W + markovWin * MARKOV_W;
    if (winProb >= gate) {
      return { digit: n, winProb, valid: true };
    }
  }

  // Nothing cleared any gate — block the signal
  return { digit: type === "OVER" ? 1 : 8, winProb: 0, valid: false };
}

// ─── MARKOV CHAIN ─────────────────────────────────────────────────────────────

function updateMarkov(state: SymbolState, digit: number): void {
  if (state.lastDigit >= 0) {
    state.markovCounts[state.lastDigit][digit]++;
    const total = state.markovCounts[state.lastDigit].reduce((a, b) => a + b, 0);
    for (let j = 0; j < 10; j++) {
      state.markovMatrix[state.lastDigit][j] = state.markovCounts[state.lastDigit][j] / total;
    }
  }
  state.lastDigit = digit;
}

function markovScores(state: SymbolState): { over: number; under: number; repeat: number } {
  if (state.lastDigit < 0) return { over: 0.5, under: 0.5, repeat: 0.1 };
  const row = state.markovMatrix[state.lastDigit];
  return {
    over: row.slice(5).reduce((a, b) => a + b, 0),
    under: row.slice(0, 5).reduce((a, b) => a + b, 0),
    repeat: row[state.lastDigit],
  };
}

// ─── CUSUM DRIFT DETECTION ────────────────────────────────────────────────────

function updateCUSUM(state: SymbolState, value: number): boolean {
  const target = 0.5;
  const k = 0.5;
  const h = 6;
  state.cusumPos = Math.max(0, state.cusumPos + (value - target) - k);
  state.cusumNeg = Math.max(0, state.cusumNeg + (target - value) - k);
  return state.cusumPos > h || state.cusumNeg > h;
}

// ─── MARKET REGIME ────────────────────────────────────────────────────────────

function detectRegime(ticks: DerivTick[], atr: number, ema50: number, ema200: number): MarketRegime {
  if (ticks.length < 50) return "RANGING";
  const avgPrice = ticks.slice(-20).reduce((s, t) => s + t.price, 0) / 20;
  const atrRatio = atr / avgPrice;
  if (atrRatio > 0.005) return "HIGH_VOLATILITY";
  if (atrRatio < 0.0004) return "LOW_VOLATILITY";
  const emaDivergence = Math.abs(ema50 - ema200) / avgPrice;
  return emaDivergence > 0.0015 ? "TRENDING" : "RANGING";
}

function classifyVol(atr: number, price: number): VolatilityRegime {
  const r = atr / price;
  if (r < 0.0008) return "LOW";
  if (r > 0.004) return "HIGH";
  return "MEDIUM";
}

// ─── MULTI-WINDOW ANALYSIS ────────────────────────────────────────────────────

interface WindowResult {
  digitBias: "OVER" | "UNDER" | "NEUTRAL";
  priceBias: "UP" | "DOWN" | "NEUTRAL";
  evenOddBias: "EVEN" | "ODD" | "NEUTRAL";
}

function analyzeWindow(ticks: DerivTick[], size: number): WindowResult {
  const sample = ticks.slice(-size);
  if (sample.length < Math.floor(size * 0.5)) {
    return { digitBias: "NEUTRAL", priceBias: "NEUTRAL", evenOddBias: "NEUTRAL" };
  }
  const high = sample.filter(t => t.digit >= 5).length;
  const low = sample.length - high;
  const digitBias: "OVER" | "UNDER" | "NEUTRAL" =
    high / sample.length > 0.54 ? "OVER" : low / sample.length > 0.54 ? "UNDER" : "NEUTRAL";

  const first = sample[0].price;
  const last = sample[sample.length - 1].price;
  const pct = (last - first) / first;
  const priceBias: "UP" | "DOWN" | "NEUTRAL" =
    pct > 0.00008 ? "UP" : pct < -0.00008 ? "DOWN" : "NEUTRAL";

  const even = sample.filter(t => t.digit % 2 === 0).length;
  const evenOddBias: "EVEN" | "ODD" | "NEUTRAL" =
    even / sample.length > 0.54 ? "EVEN" : (sample.length - even) / sample.length > 0.54 ? "ODD" : "NEUTRAL";

  return { digitBias, priceBias, evenOddBias };
}

/**
 * Count how many of the most-recent ticks moved in the same direction.
 * direction "UP"   → each tick price > previous tick price
 * direction "DOWN" → each tick price < previous tick price
 * Returns the streak length (0 if fewer than 2 ticks available).
 */
function recentStreak(ticks: DerivTick[], direction: "UP" | "DOWN"): number {
  if (ticks.length < 2) return 0;
  let count = 0;
  for (let i = ticks.length - 1; i >= 1; i--) {
    const moved = direction === "UP"
      ? ticks[i].price > ticks[i - 1].price
      : ticks[i].price < ticks[i - 1].price;
    if (moved) count++;
    else break;
  }
  return count;
}

function windowConfluence(ticks: DerivTick[], bias: "OVER" | "UNDER" | "RISE" | "FALL" | "EVEN" | "ODD"): number {
  const sizes = [15, 75, 350, 750];
  let aligned = 0;
  for (const size of sizes) {
    const w = analyzeWindow(ticks, size);
    if ((bias === "OVER" && w.digitBias === "OVER") ||
      (bias === "UNDER" && w.digitBias === "UNDER") ||
      (bias === "RISE" && w.priceBias === "UP") ||
      (bias === "FALL" && w.priceBias === "DOWN") ||
      (bias === "EVEN" && w.evenOddBias === "EVEN") ||
      (bias === "ODD" && w.evenOddBias === "ODD")) aligned++;
  }
  return aligned;
}

// ─── ENSEMBLE MODELS ──────────────────────────────────────────────────────────

interface Ensemble {
  overScore: number; underScore: number;
  riseScore: number; fallScore: number;
  evenScore: number; oddScore: number;
  differsScore: number; matchesScore: number;
  agreement: number;
}

function runEnsemble(ticks: DerivTick[], state: SymbolState, rsi: number): Ensemble {
  const f500 = digitFreqs(ticks, 500);
  const f100 = digitFreqs(ticks, 100);
  const f20 = digitFreqs(ticks, 20);
  const mk = markovScores(state);

  const high500 = f500.slice(5).reduce((a, b) => a + b, 0) / 100;
  const low500 = f500.slice(0, 5).reduce((a, b) => a + b, 0) / 100;
  const high100 = f100.slice(5).reduce((a, b) => a + b, 0) / 100;
  const low100 = f100.slice(0, 5).reduce((a, b) => a + b, 0) / 100;
  const high20 = f20.slice(5).reduce((a, b) => a + b, 0) / 100;
  const low20 = f20.slice(0, 5).reduce((a, b) => a + b, 0) / 100;

  const even500 = [0, 2, 4, 6, 8].reduce((s, i) => s + f500[i], 0) / 100;
  const odd500 = 1 - even500;

  const rsiUp = rsi > 50 ? (rsi - 50) / 50 : 0;
  const rsiDown = rsi < 50 ? (50 - rsi) / 50 : 0;
  const emaBias = state.ema50 > state.ema200 ? 0.6 : 0.4;

  const overScore = high500 * 0.3 + mk.over * 0.25 + high100 * 0.25 + high20 * 0.2;
  const underScore = low500 * 0.3 + mk.under * 0.25 + low100 * 0.25 + low20 * 0.2;
  const riseScore = emaBias * 0.5 + rsiUp * 0.3 + high20 * 0.2;
  const fallScore = (1 - emaBias) * 0.5 + rsiDown * 0.3 + low20 * 0.2;

  const overVotes = [high500 > 0.53, mk.over > 0.53, high100 > 0.53, high20 > 0.53].filter(Boolean).length;
  const underVotes = [low500 > 0.53, mk.under > 0.53, low100 > 0.53, low20 > 0.53].filter(Boolean).length;
  const agreement = Math.max(overVotes, underVotes);

  return {
    overScore, underScore, riseScore, fallScore,
    evenScore: even500, oddScore: odd500,
    differsScore: 1 - mk.repeat, matchesScore: mk.repeat,
    agreement,
  };
}

// ─── SIGNAL SCORING ───────────────────────────────────────────────────────────

function calcScore(params: {
  adx: number; adxMin: number; windows: number; agreement: number;
  rsiBonus: number; entropy: number; anomaly: boolean; drift: boolean;
}): number {
  const base = 50;
  const adxBonus = Math.min(18, Math.max(0, (params.adx - params.adxMin) * 0.9));
  const winBonus = params.windows * 6;
  const modelBonus = params.agreement * 5;
  const entBonus = params.entropy < 0.88 ? 9 : params.entropy < 0.93 ? 5 : 2;
  const anomPenalty = params.anomaly ? -12 : 0;
  const driftPenalty = params.drift ? -6 : 0;
  return Math.min(100, Math.max(0, base + adxBonus + winBonus + modelBonus + params.rsiBonus + entBonus + anomPenalty + driftPenalty));
}

function grade(score: number): SignalGrade {
  return score >= 82 ? "A+" : score >= 68 ? "A" : "B";
}

function toConf(score: number): Confidence {
  return score >= 80 ? "HIGH" : score >= 65 ? "MEDIUM" : "LOW";
}

// ─── PRIMARY CONDITION: DOMINANT DIGIT POSITIONING ───────────────────────────
// THE first gate evaluated for every OVER/UNDER signal.
// No signal is generated unless BOTH the most-appearing digit (rank 1, green)
// AND the second-most-appearing digit (rank 2, blue) are positioned well clear
// of the predicted digit.
//
//   OVER  barrier b → rank-1 and rank-2 must each be ≥ b + 2
//     e.g. OVER 2 → both top digits must be in {4,5,6,7,8,9}
//     e.g. OVER 4 → both top digits must be in {6,7,8,9}
//
//   UNDER barrier b → rank-1 and rank-2 must each be ≤ b - 2
//     e.g. UNDER 5 → both top digits must be in {0,1,2,3}
//     e.g. UNDER 7 → both top digits must be in {0,1,2,3,4,5}
//
// Returns false (block the signal) if either condition fails.
function checkDominantDigitPosition(
  freqs: number[],              // 10-element pct array (values 0–100, sum ≈ 100)
  type: "OVER" | "UNDER",
  barrier: number,
): boolean {
  // Sort digits by descending frequency to find ranks 1 and 2
  const ranked = Array.from({ length: 10 }, (_, d) => d)
    .sort((a, b) => freqs[b] - freqs[a]);
  const rank1 = ranked[0]; // most appearing (green)
  const rank2 = ranked[1]; // second most appearing (blue)

  if (type === "OVER") {
    // Both dominant digits must sit at least 2 places ABOVE the barrier
    return rank1 >= barrier + 2 && rank2 >= barrier + 2;
  } else {
    // Both dominant digits must sit at least 2 places BELOW the barrier
    return rank1 <= barrier - 2 && rank2 <= barrier - 2;
  }
}

// ─── COMPULSORY CONDITION 2: LEAST-APPEARING DIGIT POSITION ──────────────────
// The red bar (rank-10 / least-appearing digit) must also sit well inside the
// WINNING side — at least 2 digits from the barrier — confirming the weakest
// digit in the market is still contributing to the winning outcome.
//
//   OVER  barrier b → least-appearing digit must be ≥ b + 2
//     e.g. OVER 1 → red bar must be in {3,4,5,6,7,8,9}  (above digit 2)
//     e.g. OVER 2 → red bar must be in {4,5,6,7,8,9}
//
//   UNDER barrier b → least-appearing digit must be ≤ b - 2
//     e.g. UNDER 5 → red bar must be in {0,1,2,3}
//     e.g. UNDER 7 → red bar must be in {0,1,2,3,4,5}
//
// Returns false (block the signal) if the condition fails.
function checkLeastAppearingPosition(
  freqs: number[],
  type: "OVER" | "UNDER",
  barrier: number,
): boolean {
  const ranked = Array.from({ length: 10 }, (_, d) => d)
    .sort((a, b) => freqs[b] - freqs[a]);
  const leastAppearing = ranked[9]; // rank 10 — red bar

  if (type === "OVER") {
    return leastAppearing >= barrier + 2;
  } else {
    return leastAppearing <= barrier - 2;
  }
}

// ─── COMPULSORY CONDITION 3: NO TIED FREQUENCIES ON LOSING SIDE ──────────────
// Losing-side digits must all have DISTINCT frequencies (no two share the same
// percentage, to 1 decimal place).  When losing digits compete at the same level
// there is no clear suppression on that side — the signal is blocked.
// Winning-side ties are irrelevant and are ignored.
//
//   OVER  barrier b → losing digits are 0 … b
//   UNDER barrier b → losing digits are b … 9
function checkNoTiedFrequencies(
  freqs: number[],              // 10-element pct array (values 0–100, sum ≈ 100)
  type: "OVER" | "UNDER",
  barrier: number,
): boolean {
  const losingDigits =
    type === "OVER"
      ? Array.from({ length: barrier + 1 }, (_, i) => i)          // 0 … barrier
      : Array.from({ length: 10 - barrier }, (_, i) => barrier + i); // barrier … 9

  const rounded = losingDigits.map(d => Math.round(freqs[d] * 10)); // 0.1% precision
  const seen = new Set<number>();
  for (const v of rounded) {
    if (seen.has(v)) return false;
    seen.add(v);
  }
  return true;
}

// ─── LOSING-SIDE DIGIT GUARD ─────────────────────────────────────────────────
// Every digit on the LOSING side of an OVER/UNDER contract must have a
// frequency strictly below `threshold` (default 10.2 %) in the 1 000-tick
// frequency array.  When a losing digit is unusually hot the signal is blocked.
//
//   OVER  n → winning digits n+1 … 9  →  losing digits 0 … n
//   UNDER n → winning digits 0 … n-1  →  losing digits n … 9
function losingDigitsBelowThreshold(
  freqs: number[],        // 10-element pct array (values 0–100, sum ≈ 100)
  type: "OVER" | "UNDER",
  barrier: number,
  threshold = 10.2,
): boolean {
  const losing =
    type === "OVER"
      ? Array.from({ length: barrier + 1 }, (_, i) => i)      // 0 … barrier
      : Array.from({ length: 10 - barrier }, (_, i) => barrier + i); // barrier … 9
  return losing.every(d => freqs[d] < threshold);
}

// ─── OVER/UNDER ENTRY TRIGGER: 3 CONSECUTIVE LOSING-SIDE TICKS ──────────────
// Before firing an OVER or UNDER signal the last N ticks (default 3) must all
// have landed on the LOSING side of the contract.
//
//   OVER  barrier b → losing digits are 0 … b   (digit ≤ barrier)
//   UNDER barrier b → losing digits are b … 9   (digit ≥ barrier)
//
// Rationale: three consecutive losing results indicate the market has been
// "stuck" on the wrong side and is primed for a reversal into the winning side.
function lastNTicksOnLosingSide(
  ticks: DerivTick[],
  type: "OVER" | "UNDER",
  barrier: number,
  n = 3,
): boolean {
  if (ticks.length < n) return false;
  const recent = ticks.slice(-n);
  return recent.every(t =>
    type === "OVER" ? t.digit <= barrier : t.digit >= barrier,
  );
}

// ─── EVEN / ODD STRENGTH GUARD ───────────────────────────────────────────────
// All conditions evaluated against the last 1 000 ticks.
// All three must pass before any other analysis is applied.
//
//   1. Green bar (most appearing), Blue bar (2nd most appearing), AND
//      Red bar (least appearing) must ALL belong to the signal side.
//      Red bar has no percentage requirement — membership only.
//   2. Green bar (most appearing) must have a frequency > 11.5 %.
//   3. At least 3 OTHER signal-side digits (excluding the green bar) must
//      each have a frequency > 10 %.
//
// All conditions must pass; any failure blocks the signal.
function checkEvenOddStrength(
  freqs1k: number[],     // 10-element pct array from last 1 000 ticks (values 0–100)
  side: "EVEN" | "ODD",
): boolean {
  const sideDigits = side === "EVEN" ? [0, 2, 4, 6, 8] : [1, 3, 5, 7, 9];

  // Rank all 10 digits by descending frequency
  const ranked = Array.from({ length: 10 }, (_, d) => d)
    .sort((a, b) => freqs1k[b] - freqs1k[a]);

  const mostAppearing  = ranked[0]; // green bar
  const secondMost     = ranked[1]; // blue bar
  const leastAppearing = ranked[9]; // red bar

  // 1. Green bar must be on signal side AND > 11.5 %
  if (!sideDigits.includes(mostAppearing) || freqs1k[mostAppearing] <= 11.5) return false;

  // 2. Blue bar (2nd most) must be on signal side (no % requirement)
  if (!sideDigits.includes(secondMost)) return false;

  // 3. Red bar (least appearing) must be on signal side (no % requirement)
  if (!sideDigits.includes(leastAppearing)) return false;

  // 4. At least 3 OTHER signal-side digits (excl. green bar) each > 10 %
  const othersAbove = sideDigits.filter(d => d !== mostAppearing && freqs1k[d] > 10);
  if (othersAbove.length < 3) return false;

  return true;
}

// ─── EVEN / ODD ENTRY TRIGGER ─────────────────────────────────────────────────
// Entry timing rule: a signal fires only when the last 2 consecutive ticks
// printed digits from the OPPOSITE side.
//
//   EVEN signal → last 2 ticks must be ODD  digits (1, 3, 5, 7, 9)
//   ODD  signal → last 2 ticks must be EVEN digits (0, 2, 4, 6, 8)
//
// Rationale: the market has just printed two opposite digits in a row,
// suggesting a brief deviation that is likely to revert to the dominant side.
function checkEvenOddRecency(
  ticks: DerivTick[],
  side: "EVEN" | "ODD",
): boolean {
  if (ticks.length < 2) return false;

  const getDigit = (t: DerivTick) => t.lastDigit ?? (Math.round(t.price * 10) % 10);

  // The two most-recent ticks must both be from the OPPOSITE side
  const isOpposite = (t: DerivTick) => {
    const d = getDigit(t);
    return side === "EVEN" ? d % 2 !== 0 : d % 2 === 0;
  };

  const last2 = ticks.slice(-2);
  return last2.every(isOpposite);
}

// ─── OPTIMAL OVER / UNDER BARRIER SELECTION ──────────────────────────────────
// Replaces the old cluster-based approach (0-4 vs 5-9).
// Scans every digit 0-9 INDIVIDUALLY from the last 1 000 ticks to find
// the cleanest, most data-supported barrier.
//
// For OVER B  – winning digits are B+1 … 9:
//   1. Every winning digit must individually appear ≥ 9.0 % (no dead-zones)
//   2. Collective win probability must be ≥ 62 %
//   3. The barrier digit B must sit in a relative valley — its frequency must
//      be below the average of its two immediate neighbours.  This ensures
//      the barrier sits at a natural low point in the distribution, not
//      cutting arbitrarily through a hot digit.
//   4. Scans from tightest (OVER 4 → win on 5-9) to loosest (OVER 1 → win on 2-9).
//      Returns the first barrier that satisfies all conditions, or null.
//
// For UNDER B – winning digits are 0 … B-1  (exact mirror of OVER).
//   Scans from tightest (UNDER 5 → win on 0-4) to loosest (UNDER 8 → win on 0-7).

interface BarrierResult {
  barrier: number;
  winProb: number;
  winDigits: number[];
}

function findOptimalOverBarrier(freqs: number[]): BarrierResult | null {
  for (let b = 4; b >= 1; b--) {
    const winDigits: number[] = [];
    for (let d = b + 1; d <= 9; d++) winDigits.push(d);

    // 1. Every winning digit individually strong
    if (!winDigits.every(d => freqs[d] >= 9.0)) continue;

    // 2. Collective win probability
    const winProb = winDigits.reduce((s, d) => s + freqs[d], 0) / 100;
    if (winProb < 0.62) continue;

    // 3. Barrier digit sits in a relative valley
    const leftNeighbour  = b > 0 ? freqs[b - 1] : freqs[b + 1];
    const rightNeighbour = freqs[b + 1];
    const valleyAvg      = (leftNeighbour + rightNeighbour) / 2;
    if (freqs[b] >= valleyAvg) continue;

    return { barrier: b, winProb, winDigits };
  }
  return null;
}

function findOptimalUnderBarrier(freqs: number[]): BarrierResult | null {
  for (let b = 5; b <= 8; b++) {
    const winDigits: number[] = [];
    for (let d = 0; d < b; d++) winDigits.push(d);

    // 1. Every winning digit individually strong
    if (!winDigits.every(d => freqs[d] >= 9.0)) continue;

    // 2. Collective win probability
    const winProb = winDigits.reduce((s, d) => s + freqs[d], 0) / 100;
    if (winProb < 0.62) continue;

    // 3. Barrier digit sits in a relative valley
    const leftNeighbour  = freqs[b - 1];
    const rightNeighbour = b < 9 ? freqs[b + 1] : freqs[b - 1];
    const valleyAvg      = (leftNeighbour + rightNeighbour) / 2;
    if (freqs[b] >= valleyAvg) continue;

    return { barrier: b, winProb, winDigits };
  }
  return null;
}

// ─── INTERNAL PROFIT SIMULATION ──────────────────────────────────────────────
// Final gate before any signal is allowed to fire or appear on the dashboard.
// Runs a retrospective win-rate simulation on the last 100 real ticks to verify
// the entry point would have been consistently profitable.  If the simulated
// rate falls below the per-signal threshold the signal is suppressed regardless
// of every other condition having already passed.
//
// Thresholds (chosen relative to the Deriv payout structure and baseline odds):
//   OVER / UNDER  ≥ 60 %   (baseline 60 % for a 4-digit winning range)
//   EVEN / ODD    ≥ 58 %   (baseline 50 %; must show clear edge)
//   MATCHES       ≥ 13 %   (baseline 10 %; must be historically elevated)
//   DIFFERS       ≥ 87 %   (baseline 90 %; must not be worse than random)
//   RISE / FALL   ≥ 54 %   (baseline 50 %; must show directional edge)

interface ProfitSimResult {
  valid: boolean;
  winRate: number;      // 0–1
  sampleSize: number;
  threshold: number;    // 0–1
}

function simulateSignalProfitability(
  ticks: DerivTick[],
  signalType: SignalType,
  params: { barrier?: number; entryDigit?: number } = {},
): ProfitSimResult {
  const N      = 100;
  const sample = ticks.slice(-N);
  const getD   = (t: DerivTick) => t.lastDigit ?? (Math.round(t.price * 10) % 10);

  switch (signalType) {
    case "OVER": {
      if (sample.length < 10 || params.barrier === undefined)
        return { valid: false, winRate: 0, sampleSize: 0, threshold: 0.60 };
      const wins = sample.filter(t => getD(t) > params.barrier!).length;
      const wr   = wins / sample.length;
      return { valid: wr >= 0.60, winRate: wr, sampleSize: sample.length, threshold: 0.60 };
    }
    case "UNDER": {
      if (sample.length < 10 || params.barrier === undefined)
        return { valid: false, winRate: 0, sampleSize: 0, threshold: 0.60 };
      const wins = sample.filter(t => getD(t) < params.barrier!).length;
      const wr   = wins / sample.length;
      return { valid: wr >= 0.60, winRate: wr, sampleSize: sample.length, threshold: 0.60 };
    }
    case "EVEN": {
      if (sample.length < 10)
        return { valid: false, winRate: 0, sampleSize: 0, threshold: 0.58 };
      const wins = sample.filter(t => getD(t) % 2 === 0).length;
      const wr   = wins / sample.length;
      return { valid: wr >= 0.58, winRate: wr, sampleSize: sample.length, threshold: 0.58 };
    }
    case "ODD": {
      if (sample.length < 10)
        return { valid: false, winRate: 0, sampleSize: 0, threshold: 0.58 };
      const wins = sample.filter(t => getD(t) % 2 !== 0).length;
      const wr   = wins / sample.length;
      return { valid: wr >= 0.58, winRate: wr, sampleSize: sample.length, threshold: 0.58 };
    }
    case "MATCHES": {
      // Win = the target digit appears. Must be elevated above the random 10% baseline.
      if (sample.length < 10 || params.entryDigit === undefined)
        return { valid: false, winRate: 0, sampleSize: 0, threshold: 0.13 };
      const wins = sample.filter(t => getD(t) === params.entryDigit).length;
      const wr   = wins / sample.length;
      return { valid: wr >= 0.13, winRate: wr, sampleSize: sample.length, threshold: 0.13 };
    }
    case "DIFFERS": {
      // Win = consecutive ticks produce different digits. Check last 99 pairs.
      if (sample.length < 11)
        return { valid: false, winRate: 0, sampleSize: 0, threshold: 0.87 };
      let differs = 0;
      for (let i = 1; i < sample.length; i++) {
        if (getD(sample[i]) !== getD(sample[i - 1])) differs++;
      }
      const pairs = sample.length - 1;
      const wr    = differs / pairs;
      return { valid: wr >= 0.87, winRate: wr, sampleSize: pairs, threshold: 0.87 };
    }
    case "RISE": {
      // Win = next tick price is strictly higher than previous tick price.
      if (sample.length < 11)
        return { valid: false, winRate: 0, sampleSize: 0, threshold: 0.54 };
      let rises = 0;
      for (let i = 1; i < sample.length; i++) {
        if (sample[i].price > sample[i - 1].price) rises++;
      }
      const pairs = sample.length - 1;
      const wr    = rises / pairs;
      return { valid: wr >= 0.54, winRate: wr, sampleSize: pairs, threshold: 0.54 };
    }
    case "FALL": {
      // Win = next tick price is strictly lower than previous tick price.
      if (sample.length < 11)
        return { valid: false, winRate: 0, sampleSize: 0, threshold: 0.54 };
      let falls = 0;
      for (let i = 1; i < sample.length; i++) {
        if (sample[i].price < sample[i - 1].price) falls++;
      }
      const pairs = sample.length - 1;
      const wr    = falls / pairs;
      return { valid: wr >= 0.54, winRate: wr, sampleSize: pairs, threshold: 0.54 };
    }
    default:
      return { valid: false, winRate: 0, sampleSize: 0, threshold: 0 };
  }
}

// ─── COOLDOWN CHECK ───────────────────────────────────────────────────────────

function onCooldown(state: SymbolState, type: SignalType, nowMs: number, cooldownMs = 300000): boolean {
  const last = state.lastSignalTimes[type];
  return last !== undefined && nowMs - last < cooldownMs;
}

// ─── MATCHES / DIFFERS 8-MODEL ENSEMBLE ────────────────────────────────────────
// Implements proxy versions of LSTM, GRU, Markov, XGBoost, Random Forest,
// HMM, Ensemble, and RL-adaptive weighting — all from raw tick history.
// Requires ≥ 2 models agreeing before a signal is emitted.

interface MDResult {
  matchesProb: number;
  differsProb: number;
  modelsForMatches: number;
  modelsForDiffers: number;
  dominant: "MATCHES" | "DIFFERS" | "NEUTRAL";
  ensembleScore: number;
  suggestedEntry: number;  // DIFFERS: digit least likely to appear next (avoid it)
  matchesEntry: number;    // MATCHES: digit most likely to appear next (target it)
}

function mdEnsemble(ticks: DerivTick[], state: SymbolState): MDResult {
  const n = ticks.length;
  const currentDigit = ticks[n - 1].digit;

  // ── M1: N-gram bigram (LSTM proxy) ─────────────────────────────────────
  // How often is currentDigit followed by itself in the last 300 ticks?
  let m1Total = 0, m1Repeat = 0;
  const m1Span = Math.min(300, n - 1);
  for (let i = n - m1Span - 1; i < n - 1; i++) {
    if (i >= 0 && ticks[i].digit === currentDigit) {
      m1Total++;
      if (ticks[i + 1].digit === currentDigit) m1Repeat++;
    }
  }
  const m1RepeatProb = m1Total >= 8 ? m1Repeat / m1Total : 0.10;

  // ── M2: EMA of consecutive pair rate (GRU proxy) ───────────────────────
  // Exponential-decay weighted recent repeat frequency — recent pairs count more
  let m2Ema = 0.10;
  const m2Alpha = 0.12;
  for (let i = Math.max(1, n - 150); i < n; i++) {
    const isRepeat = ticks[i].digit === ticks[i - 1].digit ? 1 : 0;
    m2Ema = m2Alpha * isRepeat + (1 - m2Alpha) * m2Ema;
  }
  const m2RepeatProb = m2Ema;

  // ── M3: Markov chain ───────────────────────────────────────────────────
  const m3RepeatProb = state.markovMatrix[currentDigit][currentDigit];

  // ── M4: Feature scoring (XGBoost proxy) ────────────────────────────────
  // Features: streak length, digit frequency bias, recent repeat velocity
  let streak = 0;
  for (let i = n - 1; i >= Math.max(0, n - 12) && ticks[i].digit === currentDigit; i--) streak++;
  const freqs1k = digitFreqs(ticks, 1000);
  const digitFreqBias = (freqs1k[currentDigit] / 100) - 0.10; // deviation from 10% base
  const recentRepeatVelocity = m2Ema - 0.10; // how much above baseline
  const m4Score = 0.10 + (streak * 0.04) + (digitFreqBias * 1.5) + (recentRepeatVelocity * 1.2);
  const m4RepeatProb = Math.max(0.02, Math.min(0.55, m4Score));

  // ── M5: Multi-window vote (Random Forest proxy) ─────────────────────────
  // 4 independent time windows each vote on repeat rate → ensemble vote
  const m5Windows = [15, 50, 150, 400];
  const m5Votes: number[] = [];
  for (const w of m5Windows) {
    const sample = ticks.slice(-Math.min(w, n));
    let reps = 0;
    for (let i = 1; i < sample.length; i++) {
      if (sample[i].digit === sample[i - 1].digit) reps++;
    }
    m5Votes.push(sample.length > 2 ? reps / (sample.length - 1) : 0.10);
  }
  const m5RepeatProb = m5Votes.reduce((a, b) => a + b, 0) / m5Votes.length;

  // ── M6: HMM regime detection ───────────────────────────────────────────
  // Stable repeat intervals = "repeat regime"; high variance = random phase
  const hmmSample = ticks.slice(-120);
  const gaps: number[] = [];
  let lastRepIdx = -1;
  for (let i = 1; i < hmmSample.length; i++) {
    if (hmmSample[i].digit === hmmSample[i - 1].digit) {
      if (lastRepIdx >= 0) gaps.push(i - lastRepIdx);
      lastRepIdx = i;
    }
  }
  let m6RepeatProb = 0.08;
  if (gaps.length >= 4) {
    const meanGap = gaps.reduce((a, b) => a + b, 0) / gaps.length;
    const variance = gaps.reduce((a, b) => a + (b - meanGap) ** 2, 0) / gaps.length;
    const cv = Math.sqrt(variance) / meanGap; // coefficient of variation
    // Low CV + short mean gap = regular repeat regime
    if (cv < 0.55 && meanGap < 12) m6RepeatProb = 0.25;
    else if (cv < 0.80 && meanGap < 20) m6RepeatProb = 0.14;
  }

  // ── M7: 3-level consecutive pattern (deep sequence memory proxy) ────────
  // Look for trigram: [A, A, ?] — two same in a row, does the third match?
  let m7Total = 0, m7Match = 0;
  const m7Span = Math.min(500, n - 2);
  for (let i = n - m7Span - 2; i < n - 2; i++) {
    if (i >= 0 && ticks[i].digit === ticks[i + 1].digit) {
      m7Total++;
      if (ticks[i + 2].digit === ticks[i].digit) m7Match++;
    }
  }
  const m7RepeatProb = m7Total >= 5 ? m7Match / m7Total : 0.10;

  // ── M8: RL-adaptive bias (reinforcement-learning proxy) ─────────────────
  // Penalise repeat probability when consecutive losses are high
  const rlBias = (state.consecutiveLosses ?? 0) > 2 ? -0.04 : 0;

  // ── Weighted Ensemble ───────────────────────────────────────────────────
  // Weights reflect model reliability for digit-repeat prediction:
  // M1(LSTM) 22%, M2(GRU) 15%, M3(Markov) 20%, M4(XGB) 13%,
  // M5(RF) 13%, M6(HMM) 8%, M7(SeqMem) 7%, M8(RL adj) applied flat
  const W = [0.22, 0.15, 0.20, 0.13, 0.13, 0.08, 0.07, 0.02];
  const probs = [m1RepeatProb, m2RepeatProb, m3RepeatProb, m4RepeatProb,
                 m5RepeatProb, m6RepeatProb, m7RepeatProb, 0.10];
  let ensembleRepeat = 0;
  for (let i = 0; i < 8; i++) ensembleRepeat += W[i] * probs[i];
  ensembleRepeat = Math.max(0, Math.min(1, ensembleRepeat + rlBias));

  const ensembleDiffers = 1 - ensembleRepeat;

  // Count model agreements (threshold: repeat > 0.15 signals MATCHES belief)
  const modelsForMatches = probs.filter(p => p > 0.15).length;
  const modelsForDiffers = probs.filter(p => p < 0.095).length;

  // Determine dominant prediction
  let dominant: "MATCHES" | "DIFFERS" | "NEUTRAL" = "NEUTRAL";
  if (ensembleRepeat > 0.28 && modelsForMatches >= 2) dominant = "MATCHES";
  else if (ensembleDiffers > 0.84 && modelsForDiffers >= 2) dominant = "DIFFERS";

  // Composite ensemble score (0-100)
  const extremeness = dominant === "MATCHES"
    ? Math.min(1, (ensembleRepeat - 0.10) / 0.40)
    : dominant === "DIFFERS"
    ? Math.min(1, (ensembleDiffers - 0.75) / 0.20)
    : 0;
  const agreeBonus = dominant === "MATCHES"
    ? modelsForMatches * 5
    : modelsForDiffers * 5;
  const ensembleScore = Math.min(100, Math.max(0, extremeness * 55 + agreeBonus + 20));

  // ── Best entry digit for MATCHES ────────────────────────────────────────
  // Score every digit 0–9 using three signals:
  //   1. Markov forward probability: P(currentDigit → d)  — strongest predictor
  //   2. Frequency in last 50 ticks                       — recent regime
  //   3. Frequency in last 200 ticks                      — long-term baseline
  // The digit with the highest combined score is the most statistically
  // likely to appear on the next tick — ideal MATCHES entry.
  const freqs50  = digitFreqs(ticks, Math.min(50, n));
  const freqs200 = digitFreqs(ticks, Math.min(200, n));

  let matchesEntry = currentDigit;
  let matchesEntryScore = -1;

  // DIFFERS: pick the digit with the LOWEST combined score (least likely to appear)
  let differsEntry = currentDigit;
  let differsEntryScore = 999;

  for (let d = 0; d <= 9; d++) {
    const markovFwd  = state.markovMatrix[currentDigit]?.[d] ?? 0.10;
    const freq50Norm = (freqs50[d]  ?? 10) / 100;
    const freq200Norm = (freqs200[d] ?? 10) / 100;

    // Weighted score: Markov transition dominates, recency confirms
    const score = (markovFwd * 0.55) + (freq50Norm * 0.30) + (freq200Norm * 0.15);

    if (score > matchesEntryScore) { matchesEntryScore = score; matchesEntry = d; }
    if (score < differsEntryScore) { differsEntryScore = score; differsEntry = d; }
  }

  return {
    matchesProb: ensembleRepeat,
    differsProb: ensembleDiffers,
    modelsForMatches,
    modelsForDiffers,
    dominant,
    ensembleScore,
    suggestedEntry: differsEntry,  // DIFFERS: avoid the digit least likely to appear
    matchesEntry,                  // MATCHES: target the digit most likely to appear
  };
}


// ─── MAIN ANALYSIS ────────────────────────────────────────────────────────────

export function analyzeTickAndGenerateSignals(
  tick: DerivTick,
  market: string,
  _enabledTypes: SignalType[]
): GeneratedSignal[] {
  const state = getState(tick.symbol);
  const signals: GeneratedSignal[] = [];
  const prevTick = state.ticks[state.ticks.length - 1];

  state.ticks.push(tick);
  if (state.ticks.length > HISTORY_SIZE) state.ticks.shift();

  updateMarkov(state, tick.digit);

  state.vwapSum += tick.price;
  state.vwapCount++;

  state.ema50 = calcEMA(tick.price, state.ema50, 50);
  state.ema200 = calcEMA(tick.price, state.ema200, 200);

  if (state.ticks.length < 50 || !prevTick) return signals;

  if (!validateDataQuality(state.ticks)) return signals;

  const rsi = updateRSI(state, tick.price, prevTick.price);
  const { adx, atr } = updateADXATR(state, tick.price, prevTick.price);
  const entropy = shannonEntropy(state.ticks, 100);
  const anomaly = hasAnomalies(state.ticks);
  const drift = updateCUSUM(state, tick.digit / 9);
  const regime = detectRegime(state.ticks, atr, state.ema50, state.ema200);
  const volRegime = classifyVol(atr, tick.price);
  const ensemble = runEnsemble(state.ticks, state, rsi);
  const entropyOk = entropy < 0.97;
  const adxMin = state.ticks.length < 100 ? 18 : 22;
  const now = tick.epoch;

  const digit = tick.digit;

  // Collect all candidate signals; at the end return the best-scoring one.
  // This ensures all 8 types compete fairly rather than later types being
  // blocked by an `signals.length === 0` gate or an impossible condition chain.
  const candidates: GeneratedSignal[] = [];

  // ─── OVER ────────────────────────────────────────────────────────────────
  // Entry barrier selected by scanning ALL 10 digits individually (0–9).
  // No cluster assumption.  The barrier sits at a natural valley in the
  // 1 000-tick distribution so every digit on the winning side is genuinely
  // elevated, not propped up by one or two outliers.
  if (!onCooldown(state, "OVER", now, 300000) && ensemble.overScore > 0.50 && !anomaly) {
    const freqs1k   = digitFreqs(state.ticks, 1000);
    const overEntry = findOptimalOverBarrier(freqs1k);
    if (overEntry !== null) {
      // ── COMPULSORY CONDITION 1: dominant digit positioning (checked first) ─
      // Both rank-1 (green) and rank-2 (blue) must be ≥ barrier+2.
      const dominantOk = checkDominantDigitPosition(freqs1k, "OVER", overEntry.barrier);
      // ── COMPULSORY CONDITION 2: least-appearing digit positioning ──────────
      // Red bar (rank-10) must also be ≥ barrier+2 (well inside winning side).
      const leastPosOk = checkLeastAppearingPosition(freqs1k, "OVER", overEntry.barrier);
      // ── COMPULSORY CONDITION 3: no tied frequencies on LOSING side ─────────
      // Losing-side digits (0…barrier) must all have distinct percentages.
      const noTiesOk   = checkNoTiedFrequencies(freqs1k, "OVER", overEntry.barrier);

      if (dominantOk && leastPosOk && noTiesOk) {
        const wins    = windowConfluence(state.ticks, "OVER");
        if (wins >= 1) {
          // Losing-side guard: every digit on the losing side (0 … barrier)
          // must be individually below 10 % — no hot losing digit allowed.
          const losingDigitsOk = losingDigitsBelowThreshold(freqs1k, "OVER", overEntry.barrier);
          const score     = calcScore({ adx, adxMin, windows: wins, agreement: ensemble.agreement, rsiBonus: rsi >= 50 ? 6 : 2, entropy, anomaly, drift });
          const conf      = toConf(score);
          const profitSim = simulateSignalProfitability(state.ticks, "OVER", { barrier: overEntry.barrier });
          if (conf !== "LOW" && losingDigitsOk && profitSim.valid) {
            candidates.push({
              signalType: "OVER", confidence: conf, confidenceScore: Math.round(score),
              grade: grade(score), digit, price: tick.price, symbol: tick.symbol, market,
              entryDigit: overEntry.barrier, predictionDigit: overEntry.barrier, digitFrequencies: freqs1k,
              rsi: Math.round(rsi), adx: Math.round(adx), trend: "BULLISH",
              regime, volatilityRegime: volRegime, modelAgreement: ensemble.agreement,
              tickWindowsAligned: wins, entropy: parseFloat(entropy.toFixed(3)), hasAnomaly: anomaly,
              explanation: `OVER ${overEntry.barrier} | Win digits: ${overEntry.winDigits.join(",")} | WinProb ${(overEntry.winProb * 100).toFixed(1)}% | ${wins}/4 windows | Sim WR ${(profitSim.winRate * 100).toFixed(1)}%`,
            });
          }
        }
      }
    }
  }

  // ─── UNDER ───────────────────────────────────────────────────────────────
  // Mirror of OVER: barrier selected by scanning all 10 digits individually.
  if (!onCooldown(state, "UNDER", now, 300000) && ensemble.underScore > 0.50 && !anomaly) {
    const freqs1k    = digitFreqs(state.ticks, 1000);
    const underEntry = findOptimalUnderBarrier(freqs1k);
    if (underEntry !== null) {
      // ── COMPULSORY CONDITION 1: dominant digit positioning (checked first) ─
      // Both rank-1 (green) and rank-2 (blue) must be ≤ barrier-2.
      const dominantOk = checkDominantDigitPosition(freqs1k, "UNDER", underEntry.barrier);
      // ── COMPULSORY CONDITION 2: least-appearing digit positioning ──────────
      // Red bar (rank-10) must also be ≤ barrier-2 (well inside winning side).
      const leastPosOk = checkLeastAppearingPosition(freqs1k, "UNDER", underEntry.barrier);
      // ── COMPULSORY CONDITION 3: no tied frequencies on LOSING side ─────────
      // Losing-side digits (barrier…9) must all have distinct percentages.
      const noTiesOk   = checkNoTiedFrequencies(freqs1k, "UNDER", underEntry.barrier);

      if (dominantOk && leastPosOk && noTiesOk) {
        const wins    = windowConfluence(state.ticks, "UNDER");
        if (wins >= 1) {
          // Losing-side guard: every digit on the losing side (barrier … 9)
          // must be individually below 10 % — no hot losing digit allowed.
          const losingDigitsOk = losingDigitsBelowThreshold(freqs1k, "UNDER", underEntry.barrier);
          const score     = calcScore({ adx, adxMin, windows: wins, agreement: ensemble.agreement, rsiBonus: rsi <= 50 ? 6 : 2, entropy, anomaly, drift });
          const conf      = toConf(score);
          const profitSim = simulateSignalProfitability(state.ticks, "UNDER", { barrier: underEntry.barrier });
          if (conf !== "LOW" && losingDigitsOk && profitSim.valid) {
            candidates.push({
              signalType: "UNDER", confidence: conf, confidenceScore: Math.round(score),
              grade: grade(score), digit, price: tick.price, symbol: tick.symbol, market,
              entryDigit: underEntry.barrier, predictionDigit: underEntry.barrier, digitFrequencies: freqs1k,
              rsi: Math.round(rsi), adx: Math.round(adx), trend: "BEARISH",
              regime, volatilityRegime: volRegime, modelAgreement: ensemble.agreement,
              tickWindowsAligned: wins, entropy: parseFloat(entropy.toFixed(3)), hasAnomaly: anomaly,
              explanation: `UNDER ${underEntry.barrier} | Win digits: ${underEntry.winDigits.join(",")} | WinProb ${(underEntry.winProb * 100).toFixed(1)}% | ${wins}/4 windows | Sim WR ${(profitSim.winRate * 100).toFixed(1)}%`,
            });
          }
        }
      }
    }
  }

  // ─── RISE ────────────────────────────────────────────────────────────────
  // Fires when price has been falling (2+ consecutive down moves) and the
  // rise ensemble score favours a bounce. No EMA-crossover or regime gate.
  if (!onCooldown(state, "RISE", now, 300000) && !anomaly && entropyOk) {
    const downStreak = recentStreak(state.ticks, "DOWN");
    if (downStreak >= 2 && ensemble.riseScore > 0.52) {
      const wins = windowConfluence(state.ticks, "RISE");
      if (wins >= 1) {
        const score = calcScore({ adx, adxMin, windows: wins, agreement: ensemble.agreement, rsiBonus: rsi >= 40 && rsi <= 75 ? 6 : 2, entropy, anomaly, drift });
        const conf = toConf(score);
        const profitSim = simulateSignalProfitability(state.ticks, "RISE");
        if (conf !== "LOW" && profitSim.valid) {
          candidates.push({
            signalType: "RISE", confidence: conf, confidenceScore: Math.round(score),
            grade: grade(score), digit, price: tick.price, symbol: tick.symbol, market,
            rsi: Math.round(rsi), adx: Math.round(adx), trend: "BULLISH",
            regime, volatilityRegime: volRegime, modelAgreement: ensemble.agreement,
            tickWindowsAligned: wins, entropy: parseFloat(entropy.toFixed(3)), hasAnomaly: anomaly,
            explanation: `RISE | ${downStreak} consecutive down-ticks → reversal | ${wins}/4 windows | RSI ${Math.round(rsi)} | Sim WR ${(profitSim.winRate * 100).toFixed(1)}%`,
          });
        }
      }
    }
  }

  // ─── FALL ────────────────────────────────────────────────────────────────
  if (!onCooldown(state, "FALL", now, 300000) && !anomaly && entropyOk) {
    const upStreak = recentStreak(state.ticks, "UP");
    if (upStreak >= 2 && ensemble.fallScore > 0.52) {
      const wins = windowConfluence(state.ticks, "FALL");
      if (wins >= 1) {
        const score = calcScore({ adx, adxMin, windows: wins, agreement: ensemble.agreement, rsiBonus: rsi >= 25 && rsi <= 60 ? 6 : 2, entropy, anomaly, drift });
        const conf = toConf(score);
        const profitSim = simulateSignalProfitability(state.ticks, "FALL");
        if (conf !== "LOW" && profitSim.valid) {
          candidates.push({
            signalType: "FALL", confidence: conf, confidenceScore: Math.round(score),
            grade: grade(score), digit, price: tick.price, symbol: tick.symbol, market,
            rsi: Math.round(rsi), adx: Math.round(adx), trend: "BEARISH",
            regime, volatilityRegime: volRegime, modelAgreement: ensemble.agreement,
            tickWindowsAligned: wins, entropy: parseFloat(entropy.toFixed(3)), hasAnomaly: anomaly,
            explanation: `FALL | ${upStreak} consecutive up-ticks → reversal | ${wins}/4 windows | RSI ${Math.round(rsi)} | Sim WR ${(profitSim.winRate * 100).toFixed(1)}%`,
          });
        }
      }
    }
  }

  // ─── EVEN / ODD ──────────────────────────────────────────────────────────
  // Fires when even or odd digits dominate the last 100 ticks (≥ 58%),
  // at least 2 windows agree, score passes MEDIUM threshold, AND the
  // 4-condition strength guard (1 000-tick based) passes.
  if (state.ticks.length >= 1000 && entropyOk && !anomaly && !drift) {
    const freqs100 = digitFreqs(state.ticks, 100);
    const freqs1k  = digitFreqs(state.ticks, 1000);
    const evenPct = [0, 2, 4, 6, 8].reduce((s, i) => s + freqs100[i], 0);
    const oddPct  = [1, 3, 5, 7, 9].reduce((s, i) => s + freqs100[i], 0);
    const bias    = evenPct > oddPct ? "EVEN" : "ODD";
    const winProb = Math.max(evenPct, oddPct) / 100;

    if (winProb >= 0.58 && !onCooldown(state, bias, now, 300000)) {
      const wins = windowConfluence(state.ticks, bias);
      if (wins >= 2) {
        // 4-condition strength guard evaluated on last 1 000 ticks
        const strengthOk = checkEvenOddStrength(freqs1k, bias);
        // Recency confirmation: pattern must still be active in the last 25 / 10 ticks
        const recencyOk  = checkEvenOddRecency(state.ticks, bias);
        const score = calcScore({ adx, adxMin, windows: wins, agreement: ensemble.agreement, rsiBonus: 5, entropy, anomaly, drift });
        const conf = toConf(score);
        const sideDigits = bias === "EVEN" ? [0, 2, 4, 6, 8] : [1, 3, 5, 7, 9];
        const entryDgt = sideDigits.reduce((best, d) => freqs1k[d] > freqs1k[best] ? d : best, sideDigits[0]);
        const profitSim = simulateSignalProfitability(state.ticks, bias);
        if (conf !== "LOW" && strengthOk && recencyOk && profitSim.valid) {
          candidates.push({
            signalType: bias,
            confidence: conf,
            confidenceScore: Math.round(score),
            grade: grade(score),
            digit, price: tick.price, symbol: tick.symbol, market,
            entryDigit: entryDgt, predictionDigit: entryDgt,
            digitFrequencies: freqs1k,
            rsi: Math.round(rsi), adx: Math.round(adx),
            regime, volatilityRegime: volRegime, modelAgreement: ensemble.agreement,
            tickWindowsAligned: wins, entropy: parseFloat(entropy.toFixed(3)), hasAnomaly: anomaly,
            explanation: `${bias} | ${(winProb * 100).toFixed(1)}% 100-tick bias | ${wins}/4 windows | Strength + Recency guards passed | Sim WR ${(profitSim.winRate * 100).toFixed(1)}% | Entry digit ${entryDgt}`,
          });
        }
      }
    }
  }

  // ─── MATCHES / DIFFERS (8-model ensemble) ────────────────────────────────
  // These compete alongside the other types rather than being fallback-only.
  if (state.ticks.length >= 150 && !anomaly) {
    const md = mdEnsemble(state.ticks, state);

    // DIFFERS: ensemble strongly says next digit won't repeat current
    if (
      md.dominant === "DIFFERS" &&
      md.modelsForDiffers >= 2 &&
      md.differsProb >= 0.82 &&
      md.ensembleScore >= 60 &&
      !onCooldown(state, "DIFFERS", now, 300000)
    ) {
      const conf = toConf(md.ensembleScore);
      const profitSimDiffers = simulateSignalProfitability(state.ticks, "DIFFERS");
      if (conf !== "LOW" && profitSimDiffers.valid) {
        candidates.push({
          signalType: "DIFFERS",
          confidence: conf,
          confidenceScore: Math.round(md.ensembleScore),
          grade: grade(md.ensembleScore),
          digit, price: tick.price, symbol: tick.symbol, market,
          entryDigit: md.suggestedEntry, predictionDigit: md.suggestedEntry,
          rsi: Math.round(rsi), adx: Math.round(adx),
          regime, volatilityRegime: volRegime, modelAgreement: md.modelsForDiffers,
          tickWindowsAligned: 4, entropy: parseFloat(entropy.toFixed(3)), hasAnomaly: anomaly,
          explanation: `DIFFERS | ${md.modelsForDiffers}/8 models | DiffersProb ${(md.differsProb * 100).toFixed(1)}% | Sim WR ${(profitSimDiffers.winRate * 100).toFixed(1)}% | Avoid digit ${md.suggestedEntry}`,
        });
      }
    }

    // MATCHES: ensemble detects a repeat-prone regime
    if (
      md.dominant === "MATCHES" &&
      md.modelsForMatches >= 3 &&
      md.matchesProb >= 0.22 &&
      md.ensembleScore >= 60 &&
      !onCooldown(state, "MATCHES", now, 300000)
    ) {
      const profitSimMatches = simulateSignalProfitability(state.ticks, "MATCHES", { entryDigit: md.matchesEntry });
      if (profitSimMatches.valid) {
        candidates.push({
          signalType: "MATCHES",
          confidence: "HIGH",
          confidenceScore: Math.round(md.ensembleScore),
          grade: grade(md.ensembleScore),
          digit, price: tick.price, symbol: tick.symbol, market,
          entryDigit: md.matchesEntry, predictionDigit: md.matchesEntry,
          rsi: Math.round(rsi), adx: Math.round(adx),
          regime, volatilityRegime: volRegime, modelAgreement: md.modelsForMatches,
          tickWindowsAligned: 4, entropy: parseFloat(entropy.toFixed(3)), hasAnomaly: anomaly,
          explanation: `MATCHES | ${md.modelsForMatches}/8 models | Entry ${md.matchesEntry} | MatchesProb ${(md.matchesProb * 100).toFixed(1)}% | Sim WR ${(profitSimMatches.winRate * 100).toFixed(1)}%`,
        });
      }
    }
  }

  // Pick the single highest-confidence candidate to avoid signal spam.
  // Ties broken by confidenceScore descending.
  if (candidates.length > 0) {
    candidates.sort((a, b) => {
      const confRank = (c: Confidence) => c === "HIGH" ? 2 : c === "MEDIUM" ? 1 : 0;
      const diff = confRank(b.confidence) - confRank(a.confidence);
      if (diff !== 0) return diff;
      return (b.confidenceScore ?? 0) - (a.confidenceScore ?? 0);
    });
    const best = candidates[0];
    state.lastSignalTimes[best.signalType] = now;
    signals.push(best);
  }

  return signals;
}

export function resetConsecutiveLosses(symbol: string): void {
  const s = symbolStates.get(symbol);
  if (s) { s.consecutiveLosses = 0; }
}

// ─── MARKET ANALYSIS SNAPSHOT ─────────────────────────────────────────────────
// Read-only diagnostic export. Does NOT affect any signal generation.
// Called by the /api/analysis-inspect endpoint to power the Analysis Panel UI.

const SYMBOL_DISPLAY_NAMES: Record<string, string> = {
  "1HZ10V":  "Volatility 10 (1s)",
  "1HZ15V":  "Volatility 15 (1s)",
  "1HZ25V":  "Volatility 25 (1s)",
  "1HZ30V":  "Volatility 30 (1s)",
  "1HZ50V":  "Volatility 50 (1s)",
  "1HZ75V":  "Volatility 75 (1s)",
  "1HZ90V":  "Volatility 90 (1s)",
  "1HZ100V": "Volatility 100 (1s)",
  "JD10":    "Jump 10 Index",
  "JD25":    "Jump 25 Index",
  "JD50":    "Jump 50 Index",
  "JD75":    "Jump 75 Index",
  "JD100":   "Jump 100 Index",
};

export interface SignalGateAudit {
  cooldownOk: boolean;
  cooldownSecondsRemaining: number;
  minTicksOk: boolean;
  minTicksRequired: number;
  ensembleOk: boolean;
  ensembleScore: number;
  anomalyOk: boolean;
  entropyOk: boolean;
  driftOk: boolean;
  windowsCount: number;
  windowsRequired: number;
  windowsOk: boolean;
  barrierFound: boolean | null;       // null = not applicable
  losingDigitsOk: boolean | null;
  strengthOk: boolean | null;
  recencyOk: boolean | null;
  streakOk: boolean | null;
  streakCount: number | null;
  profitSimWinRate: number | null;
  profitSimThreshold: number | null;
  profitSimOk: boolean;
  overallPassing: boolean;
  blockedBy: string[];
}

export interface MarketAnalysisSnapshot {
  symbol: string;
  displayName: string;
  tickCount: number;
  lastDigit: number;
  lastPrice: number;
  freqs30: number[];
  freqs100: number[];
  freqs1k: number[];
  rsi: number;
  adx: number;
  entropy: number;
  anomaly: boolean;
  drift: boolean;
  entropyOk: boolean;
  regime: string;
  volRegime: string;
  ensemble: {
    overScore: number; underScore: number;
    riseScore: number; fallScore: number;
    evenScore: number; oddScore: number;
    matchesScore: number; differsScore: number;
    agreement: number;
  };
  md: {
    matchesProb: number; differsProb: number;
    modelsForMatches: number; modelsForDiffers: number;
    ensembleScore: number; dominant: string;
    matchesEntry: number; differsEntry: number;
  };
  overBarrier: { barrier: number; winProb: number; winDigits: number[] } | null;
  underBarrier: { barrier: number; winProb: number; winDigits: number[] } | null;
  profitSims: Record<string, { valid: boolean; winRate: number; threshold: number; sampleSize: number } | null>;
  gateAudit: Record<SignalType, SignalGateAudit>;
  markovMatrix: number[][];
  lastSignalTimes: Partial<Record<SignalType, number>>;
}

export function getMarketAnalysisSnapshot(): MarketAnalysisSnapshot[] {
  const now = Date.now();
  const results: MarketAnalysisSnapshot[] = [];

  for (const [symbol, state] of symbolStates) {
    const n = state.ticks.length;
    if (n < 10) continue;

    try {
      const lastTick  = state.ticks[n - 1];
      const lastDigit = lastTick.lastDigit ?? (Math.round(lastTick.price * 10) % 10);

      // Frequency arrays
      const freqs30  = digitFreqs(state.ticks, 30);
      const freqs100 = digitFreqs(state.ticks, 100);
      const freqs1k  = digitFreqs(state.ticks, Math.min(1000, n));

      // Indicators
      const rsi = state.rsiInitialized && state.avgLoss > 0
        ? parseFloat((100 - 100 / (1 + state.avgGain / state.avgLoss)).toFixed(1))
        : 50;
      const adx     = parseFloat(state.adxSmoothed.toFixed(1));
      const entropy = parseFloat(shannonEntropy(state.ticks, 100).toFixed(3));
      const anomaly = hasAnomalies(state.ticks);
      const drift   = state.cusumPos > 6 || state.cusumNeg > 6;
      const entropyOk = entropy < 0.97;

      // Regime
      const regime    = n >= 50 ? detectRegime(state.ticks, state.atrSmoothed, state.ema50, state.ema200) : "RANGING";
      const volRegime = classifyVol(state.atrSmoothed, lastTick.price);

      // Ensemble
      let ensemble: Ensemble = { overScore: 0, underScore: 0, riseScore: 0, fallScore: 0, evenScore: 0, oddScore: 0, differsScore: 0, matchesScore: 0, agreement: 0 };
      if (n >= 50) {
        try { ensemble = runEnsemble(state.ticks, state, rsi); } catch { /* not enough data */ }
      }

      // Matches/Differs model
      let md = { matchesProb: 0, differsProb: 0, modelsForMatches: 0, modelsForDiffers: 0, ensembleScore: 0, dominant: "DIFFERS" as string, matchesEntry: 0, differsEntry: 0 };
      if (n >= 150) {
        try {
          const raw = mdEnsemble(state.ticks, state);
          md = {
            matchesProb: raw.matchesProb, differsProb: raw.differsProb,
            modelsForMatches: raw.modelsForMatches, modelsForDiffers: raw.modelsForDiffers,
            ensembleScore: raw.ensembleScore, dominant: raw.dominant,
            matchesEntry: raw.matchesEntry ?? 0, differsEntry: raw.suggestedEntry ?? 0,
          };
        } catch { /* not enough data */ }
      }

      // Barrier finders (read-only, no state changes)
      const overBarrier  = n >= 1000 ? findOptimalOverBarrier(freqs1k)  : null;
      const underBarrier = n >= 1000 ? findOptimalUnderBarrier(freqs1k) : null;

      // Profit simulations for all types
      const profitSims: Record<string, ReturnType<typeof simulateSignalProfitability> | null> = {
        OVER:    overBarrier  ? simulateSignalProfitability(state.ticks, "OVER",    { barrier: overBarrier.barrier })  : null,
        UNDER:   underBarrier ? simulateSignalProfitability(state.ticks, "UNDER",   { barrier: underBarrier.barrier }) : null,
        EVEN:    simulateSignalProfitability(state.ticks, "EVEN"),
        ODD:     simulateSignalProfitability(state.ticks, "ODD"),
        RISE:    simulateSignalProfitability(state.ticks, "RISE"),
        FALL:    simulateSignalProfitability(state.ticks, "FALL"),
        MATCHES: simulateSignalProfitability(state.ticks, "MATCHES", { entryDigit: md.matchesEntry }),
        DIFFERS: simulateSignalProfitability(state.ticks, "DIFFERS"),
      };

      // Window confluence per type
      const wins: Partial<Record<SignalType, number>> = {};
      if (n >= 50) {
        for (const t of ["OVER","UNDER","RISE","FALL","EVEN","ODD"] as const) {
          try { wins[t] = windowConfluence(state.ticks, t); } catch { wins[t] = 0; }
        }
      }

      // Streak values
      const downStreak = n >= 2 ? recentStreak(state.ticks, "DOWN") : 0;
      const upStreak   = n >= 2 ? recentStreak(state.ticks,   "UP") : 0;

      // Even/Odd checks
      const evenPct100 = [0,2,4,6,8].reduce((s,i) => s + freqs100[i], 0);
      const oddPct100  = [1,3,5,7,9].reduce((s,i) => s + freqs100[i], 0);
      const evenWinProb = evenPct100 / 100;
      const oddWinProb  = oddPct100  / 100;

      const strengthEven   = n >= 1000 ? checkEvenOddStrength(freqs1k, "EVEN")   : false;
      const strengthOdd    = n >= 1000 ? checkEvenOddStrength(freqs1k, "ODD")    : false;
      const recencyEven    = checkEvenOddRecency(state.ticks, "EVEN");
      const recencyOdd     = checkEvenOddRecency(state.ticks, "ODD");

      // Losing-digit guards
      const losingOkOver  = overBarrier  ? losingDigitsBelowThreshold(freqs1k, "OVER",  overBarrier.barrier)  : false;
      const losingOkUnder = underBarrier ? losingDigitsBelowThreshold(freqs1k, "UNDER", underBarrier.barrier) : false;

      // Primary dominant-positioning guards (rank-1 & rank-2 must be 2+ digits from barrier)
      const dominantOkOver  = overBarrier  ? checkDominantDigitPosition(freqs1k, "OVER",  overBarrier.barrier)  : false;
      const dominantOkUnder = underBarrier ? checkDominantDigitPosition(freqs1k, "UNDER", underBarrier.barrier) : false;

      // Least-appearing digit position guards (red bar must be 2+ digits inside winning side)
      const leastPosOkOver  = overBarrier  ? checkLeastAppearingPosition(freqs1k, "OVER",  overBarrier.barrier)  : false;
      const leastPosOkUnder = underBarrier ? checkLeastAppearingPosition(freqs1k, "UNDER", underBarrier.barrier) : false;

      // No tied frequencies guard — losing-side digits must be distinct per barrier
      const noTiesOkOver  = overBarrier  ? checkNoTiedFrequencies(freqs1k, "OVER",  overBarrier.barrier)  : false;
      const noTiesOkUnder = underBarrier ? checkNoTiedFrequencies(freqs1k, "UNDER", underBarrier.barrier) : false;

      // Cooldown helper
      const cdSecs = (type: SignalType): number => {
        const last = state.lastSignalTimes[type];
        if (!last) return 0;
        return Math.max(0, Math.round((300000 - (now - last)) / 1000));
      };

      // Build gate audit for every signal type
      const buildGate = (type: SignalType): SignalGateAudit => {
        const cdOk   = cdSecs(type) === 0;
        const pSim   = profitSims[type];
        const wCount = wins[type as keyof typeof wins] ?? 0;
        const blocked: string[] = [];

        let minTicks = 50, ensmOk = false, ensmScore = 0;
        let barFound: boolean | null = null, loseOk: boolean | null = null;
        let dominantPosOk: boolean | null = null;
        let leastPosOkGate: boolean | null = null;
        let noTiesOkGate: boolean | null = null;
        let strOk: boolean | null = null, recOk: boolean | null = null;
        let streakOk: boolean | null = null, streakN: number | null = null;
        let wRequired = 1;

        if (type === "OVER") {
          ensmOk = ensemble.overScore > 0.50; ensmScore = ensemble.overScore;
          barFound = overBarrier !== null; loseOk = losingOkOver;
          dominantPosOk = dominantOkOver;
          leastPosOkGate = leastPosOkOver;
          noTiesOkGate   = noTiesOkOver;
        } else if (type === "UNDER") {
          ensmOk = ensemble.underScore > 0.50; ensmScore = ensemble.underScore;
          barFound = underBarrier !== null; loseOk = losingOkUnder;
          dominantPosOk = dominantOkUnder;
          leastPosOkGate = leastPosOkUnder;
          noTiesOkGate   = noTiesOkUnder;
        } else if (type === "RISE") {
          ensmOk = ensemble.riseScore > 0.52; ensmScore = ensemble.riseScore;
          streakOk = downStreak >= 2; streakN = downStreak;
        } else if (type === "FALL") {
          ensmOk = ensemble.fallScore > 0.52; ensmScore = ensemble.fallScore;
          streakOk = upStreak >= 2; streakN = upStreak;
        } else if (type === "EVEN") {
          minTicks = 1000; wRequired = 2;
          ensmOk = evenWinProb >= 0.58; ensmScore = evenWinProb;
          strOk = strengthEven; recOk = recencyEven;
        } else if (type === "ODD") {
          minTicks = 1000; wRequired = 2;
          ensmOk = oddWinProb >= 0.58; ensmScore = oddWinProb;
          strOk = strengthOdd; recOk = recencyOdd;
        } else if (type === "MATCHES") {
          minTicks = 150;
          ensmOk = md.dominant === "MATCHES" && md.modelsForMatches >= 3 && md.matchesProb >= 0.22 && md.ensembleScore >= 60;
          ensmScore = md.ensembleScore;
        } else if (type === "DIFFERS") {
          minTicks = 150;
          ensmOk = md.dominant === "DIFFERS" && md.modelsForDiffers >= 2 && md.differsProb >= 0.82 && md.ensembleScore >= 60;
          ensmScore = md.ensembleScore;
        }

        const minOk   = n >= minTicks;
        const wOk     = wCount >= wRequired;
        const pSimOk  = pSim?.valid ?? false;

        if (!cdOk)      blocked.push(`Cooldown (${cdSecs(type)}s left)`);
        if (!minOk)     blocked.push(`Need ${minTicks} ticks (have ${n})`);
        if (!entropyOk) blocked.push("Entropy too high (random market)");
        if (anomaly)    blocked.push("Anomaly detected");
        if (drift && (type === "EVEN" || type === "ODD")) blocked.push("CUSUM drift detected");
        if (!ensmOk)    blocked.push(`Ensemble/model score too low (${(ensmScore * 100).toFixed(1)}%)`);
        if (streakOk === false) blocked.push(`Insufficient streak (${streakN})`);
        if (barFound === false) blocked.push("No valid barrier found (individual digits do not support entry)");
        if (dominantPosOk === false) blocked.push("PRIMARY CONDITION FAILED: rank-1 & rank-2 digits not ≥2 places from barrier");
        if (leastPosOkGate === false) blocked.push("Red bar (least-appearing digit) not ≥2 places inside winning side");
        if (noTiesOkGate === false)   blocked.push("Tied digit frequencies detected — market not stable enough");
        if (loseOk === false)   blocked.push("Hot losing-side digit detected (≥10.2%)");
        if (strOk === false)    blocked.push("1k-tick strength guard failed");
        if (recOk === false)    blocked.push("Entry trigger not met (last 2 ticks not both opposite side)");
        if (!wOk)       blocked.push(`Window confluence too low (${wCount}/${wRequired} windows)`);
        if (!pSimOk)    blocked.push(pSim ? `Profit sim failed (WR ${(pSim.winRate * 100).toFixed(1)}% < ${(pSim.threshold * 100).toFixed(0)}%)` : "Profit sim N/A");

        const overall = cdOk && minOk && (!["EVEN","ODD"].includes(type) || (entropyOk && !drift)) &&
          (!["OVER","UNDER","RISE","FALL"].includes(type) || (!anomaly && entropyOk)) &&
          (!["MATCHES","DIFFERS"].includes(type) || !anomaly) &&
          ensmOk && (streakOk !== false) && (barFound !== false) &&
          (dominantPosOk !== false) && (leastPosOkGate !== false) && (noTiesOkGate !== false) &&
          (loseOk !== false) && (strOk !== false) && (recOk !== false) && wOk && pSimOk;

        return {
          cooldownOk: cdOk, cooldownSecondsRemaining: cdSecs(type),
          minTicksOk: minOk, minTicksRequired: minTicks,
          ensembleOk: ensmOk, ensembleScore: parseFloat((ensmScore * 100).toFixed(1)),
          anomalyOk: !anomaly, entropyOk, driftOk: !drift,
          windowsCount: wCount, windowsRequired: wRequired, windowsOk: wOk,
          barrierFound: barFound, losingDigitsOk: loseOk,
          strengthOk: strOk, recencyOk: recOk,
          streakOk, streakCount: streakN,
          profitSimWinRate:   pSim ? parseFloat((pSim.winRate   * 100).toFixed(1)) : null,
          profitSimThreshold: pSim ? parseFloat((pSim.threshold * 100).toFixed(0)) : null,
          profitSimOk: pSimOk,
          overallPassing: overall && blocked.length === 0,
          blockedBy: blocked,
        };
      };

      const gateAudit = {
        OVER:    buildGate("OVER"),
        UNDER:   buildGate("UNDER"),
        RISE:    buildGate("RISE"),
        FALL:    buildGate("FALL"),
        EVEN:    buildGate("EVEN"),
        ODD:     buildGate("ODD"),
        MATCHES: buildGate("MATCHES"),
        DIFFERS: buildGate("DIFFERS"),
      };

      results.push({
        symbol,
        displayName: SYMBOL_DISPLAY_NAMES[symbol] ?? symbol,
        tickCount: n,
        lastDigit,
        lastPrice: lastTick.price,
        freqs30, freqs100, freqs1k,
        rsi, adx, entropy, anomaly, drift, entropyOk,
        regime, volRegime,
        ensemble: {
          overScore:    parseFloat((ensemble.overScore    * 100).toFixed(1)),
          underScore:   parseFloat((ensemble.underScore   * 100).toFixed(1)),
          riseScore:    parseFloat((ensemble.riseScore    * 100).toFixed(1)),
          fallScore:    parseFloat((ensemble.fallScore    * 100).toFixed(1)),
          evenScore:    parseFloat((ensemble.evenScore    * 100).toFixed(1)),
          oddScore:     parseFloat((ensemble.oddScore     * 100).toFixed(1)),
          matchesScore: parseFloat((ensemble.matchesScore * 100).toFixed(1)),
          differsScore: parseFloat((ensemble.differsScore * 100).toFixed(1)),
          agreement:    parseFloat((ensemble.agreement    * 100).toFixed(1)),
        },
        md: {
          matchesProb:      parseFloat((md.matchesProb * 100).toFixed(1)),
          differsProb:      parseFloat((md.differsProb * 100).toFixed(1)),
          modelsForMatches: md.modelsForMatches,
          modelsForDiffers: md.modelsForDiffers,
          ensembleScore:    parseFloat(md.ensembleScore.toFixed(1)),
          dominant:         md.dominant,
          matchesEntry:     md.matchesEntry,
          differsEntry:     md.differsEntry,
        },
        overBarrier:  overBarrier  ? { barrier: overBarrier.barrier,  winProb: parseFloat((overBarrier.winProb  * 100).toFixed(1)), winDigits: overBarrier.winDigits  } : null,
        underBarrier: underBarrier ? { barrier: underBarrier.barrier, winProb: parseFloat((underBarrier.winProb * 100).toFixed(1)), winDigits: underBarrier.winDigits } : null,
        profitSims,
        gateAudit,
        markovMatrix: state.markovMatrix.map(row => row.map(v => parseFloat(v.toFixed(3)))),
        lastSignalTimes: state.lastSignalTimes,
      });
    } catch {
      // Skip symbols that throw during snapshot computation
    }
  }

  return results.sort((a, b) => a.symbol.localeCompare(b.symbol));
}

/**
 * Returns current 1000-tick digit frequency array (0–9) for a symbol.
 * Returns null if insufficient tick history.
 */
export function getCurrentDigitFreqs(symbol: string): number[] | null {
  const state = symbolStates.get(symbol);
  if (!state || state.ticks.length < 50) return null;
  return digitFreqs(state.ticks, 1000);
}

/**
 * Returns true if ALL losing-side digits for an OVER/UNDER signal are still
 * below the 10.2% threshold — i.e. the signal conditions are still valid.
 */
export function isOverUnderConditionStillValid(
  symbol: string,
  signalType: "OVER" | "UNDER",
  barrier: number,
): boolean {
  const freqs = getCurrentDigitFreqs(symbol);
  if (!freqs) return true; // can't check yet — don't cancel prematurely
  const losing =
    signalType === "OVER"
      ? Array.from({ length: barrier + 1 }, (_, i) => i)
      : Array.from({ length: 10 - barrier }, (_, i) => barrier + i);
  return losing.every(d => freqs[d] < 10.2);
}

export function getAnalysisStats(): Record<string, { tickCount: number; matchesProb?: number; matchesEntry?: number; differsEntry?: number; ensembleScore?: number }> {
  const result: Record<string, { tickCount: number; matchesProb?: number; matchesEntry?: number; differsEntry?: number; ensembleScore?: number }> = {};
  for (const [sym, state] of symbolStates) {
    const n = state.ticks.length;
    if (n < 10) { result[sym] = { tickCount: n }; continue; }
    try {
      const md = mdEnsemble(state.ticks, state);
      result[sym] = {
        tickCount: n,
        matchesProb: parseFloat((md.matchesProb * 100).toFixed(1)),
        matchesEntry: md.matchesEntry,
        differsEntry: md.suggestedEntry,
        ensembleScore: parseFloat(md.ensembleScore.toFixed(1)),
      };
    } catch {
      result[sym] = { tickCount: n };
    }
  }
  return result;
}
