import { useEffect, useRef, useState, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { cn } from "@/lib/utils";
import { Radio, TrendingUp, TrendingDown, ChevronDown } from "lucide-react";

/* ─────────────────────────────────────────────────────────────────
   Constants
───────────────────────────────────────────────────────────────── */
const DERIV_WS = "wss://ws.binaryws.com/websockets/v3?app_id=1";
const TICK_HISTORY_COUNT = 1000;

const VOLATILITY_MARKETS = [
  { symbol: "1HZ10V",  label: "Volatility 10 (1s)",  short: "Vol 10 (1s)"  },
  { symbol: "1HZ25V",  label: "Volatility 25 (1s)",  short: "Vol 25 (1s)"  },
  { symbol: "1HZ50V",  label: "Volatility 50 (1s)",  short: "Vol 50 (1s)"  },
  { symbol: "1HZ75V",  label: "Volatility 75 (1s)",  short: "Vol 75 (1s)"  },
  { symbol: "1HZ100V", label: "Volatility 100 (1s)", short: "Vol 100 (1s)" },
  { symbol: "JD10",    label: "Jump 10 Index",        short: "Jump 10"      },
  { symbol: "JD25",    label: "Jump 25 Index",        short: "Jump 25"      },
  { symbol: "JD50",    label: "Jump 50 Index",        short: "Jump 50"      },
  { symbol: "JD75",    label: "Jump 75 Index",        short: "Jump 75"      },
  { symbol: "JD100",   label: "Jump 100 Index",       short: "Jump 100"     },
];

const SIGNAL_TYPES = [
  { id: "even-odd",        label: "Even / Odd",        color: "#7c3aed" },
  { id: "matches-differs", label: "Matches / Differs",  color: "#0ea5e9" },
  { id: "over-under",      label: "Over / Under",       color: "#059669" },
] as const;
type SignalTypeId = typeof SIGNAL_TYPES[number]["id"];

/* digit group helpers */
function isEven(d: number)  { return d % 2 === 0; }
function isOver(d: number)  { return d >= 5; }

function getDigitTag(d: number, signalType: SignalTypeId): { label: string; color: string } | null {
  switch (signalType) {
    case "even-odd":
      return isEven(d)
        ? { label: "E", color: "#7c3aed" }
        : { label: "O", color: "#ec4899" };
    case "over-under":
      return isOver(d)
        ? { label: "OV", color: "#059669" }
        : { label: "UN", color: "#f59e0b" };
    case "matches-differs":
      return null; // no tag for M/D — all digits equal
  }
}

/* ─────────────────────────────────────────────────────────────────
   Heat-map coloring
───────────────────────────────────────────────────────────────── */
function digitColor(pct: number, min: number, max: number): string {
  const range = max - min || 1;
  const norm = (pct - min) / range;
  if (norm >= 0.8) return "#ef4444";
  if (norm >= 0.6) return "#f97316";
  if (norm >= 0.4) return "#eab308";
  if (norm >= 0.2) return "#0ea5e9";
  return "#6366f1";
}

/* ─────────────────────────────────────────────────────────────────
   Hook: useDerivDigits
───────────────────────────────────────────────────────────────── */
interface TickState {
  digits: number[];
  distribution: number[];
  livePrice: number | null;
  liveDigit: number | null;
  pipSize: number;
  prevPrice: number | null;
  status: "connecting" | "live" | "error";
  recentDigits: number[];
}

function getLastDigit(price: number, pipSize: number): number {
  const factor = Math.pow(10, pipSize);
  return Math.abs(Math.round(price * factor)) % 10;
}

function buildDistribution(digits: number[]): number[] {
  const counts = Array(10).fill(0);
  for (const d of digits) counts[d]++;
  const total = digits.length || 1;
  return counts.map((c) => Math.round((c / total) * 1000) / 10);
}

function useDerivDigits(symbol: string): TickState {
  const [state, setState] = useState<TickState>({
    digits: [], distribution: Array(10).fill(0),
    livePrice: null, liveDigit: null, pipSize: 2,
    prevPrice: null, status: "connecting", recentDigits: [],
  });

  const wsRef    = useRef<WebSocket | null>(null);
  const symRef   = useRef(symbol);
  symRef.current = symbol;
  const digRef   = useRef<number[]>([]);
  const pipRef   = useRef(2);

  const connect = useCallback(() => {
    if (wsRef.current) {
      wsRef.current.onopen = wsRef.current.onmessage =
        wsRef.current.onerror = wsRef.current.onclose = null;
      wsRef.current.close();
    }
    digRef.current = [];
    setState(s => ({
      ...s, digits: [], distribution: Array(10).fill(0),
      livePrice: null, liveDigit: null, prevPrice: null,
      status: "connecting", recentDigits: [],
    }));

    const ws = new WebSocket(DERIV_WS);
    wsRef.current = ws;

    ws.onopen = () => ws.send(JSON.stringify({
      ticks_history: symRef.current, count: TICK_HISTORY_COUNT,
      end: "latest", style: "ticks", subscribe: 1,
    }));

    ws.onmessage = (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.error) { setState(s => ({ ...s, status: "error" })); return; }

      if (msg.msg_type === "history") {
        const prices: number[] = msg.history?.prices ?? [];
        const pip = msg.pip_size ?? 2;
        pipRef.current = pip;
        const newDigs = prices.map(p => getLastDigit(p, pip));
        digRef.current = newDigs.slice(-TICK_HISTORY_COUNT);
        const lastP = prices[prices.length - 1] ?? null;
        setState(s => ({
          ...s, digits: digRef.current,
          distribution: buildDistribution(digRef.current),
          livePrice: lastP, prevPrice: null, pipSize: pip, status: "live",
          liveDigit: lastP !== null ? getLastDigit(lastP, pip) : null,
          recentDigits: newDigs.slice(-32),
        }));
      }

      if (msg.msg_type === "tick" && msg.tick) {
        const { quote, pip_size } = msg.tick;
        const pip = pip_size ?? pipRef.current;
        pipRef.current = pip;
        const digit = getLastDigit(quote, pip);
        digRef.current = [...digRef.current.slice(-(TICK_HISTORY_COUNT - 1)), digit];
        setState(s => ({
          ...s, digits: digRef.current,
          distribution: buildDistribution(digRef.current),
          prevPrice: s.livePrice, livePrice: quote, liveDigit: digit,
          pipSize: pip, status: "live",
          recentDigits: [...s.recentDigits.slice(-31), digit],
        }));
      }
    };

    ws.onerror = () => setState(s => ({ ...s, status: "error" }));
    ws.onclose = () => setTimeout(() => {
      if (symRef.current === symbol) connect();
    }, 3000);
  }, [symbol]);

  useEffect(() => {
    connect();
    return () => {
      if (wsRef.current) {
        wsRef.current.onopen = wsRef.current.onmessage =
          wsRef.current.onerror = wsRef.current.onclose = null;
        wsRef.current.close();
      }
    };
  }, [connect]);

  return state;
}

/* ─────────────────────────────────────────────────────────────────
   StyledSelect  (reusable dropdown)
───────────────────────────────────────────────────────────────── */
function StyledSelect({ value, onChange, options, accentColor = "#0ea5e9" }: {
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
  accentColor?: string;
}) {
  return (
    <div className="relative">
      <select
        value={value}
        onChange={e => onChange(e.target.value)}
        className="appearance-none pl-3 pr-8 py-2 rounded-xl text-xs font-bold font-mono cursor-pointer outline-none transition-all"
        style={{
          background: `${accentColor}10`,
          border: `1.5px solid ${accentColor}35`,
          color: accentColor,
          boxShadow: `0 2px 8px ${accentColor}15`,
        }}
      >
        {options.map(o => (
          <option key={o.value} value={o.value} style={{ background: "#1e293b", color: "#e2e8f0" }}>
            {o.label}
          </option>
        ))}
      </select>
      <ChevronDown
        className="absolute right-2 top-1/2 -translate-y-1/2 pointer-events-none"
        style={{ width: 12, height: 12, color: accentColor }}
      />
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────
   DigitCircle
───────────────────────────────────────────────────────────────── */
function DigitCircle({ digit, pct, isActive, min, max, signalType }: {
  digit: number; pct: number; isActive: boolean;
  min: number; max: number; signalType: SignalTypeId;
}) {
  const heatColor = digitColor(pct, min, max);
  const tag = getDigitTag(digit, signalType);

  return (
    <div className="flex flex-col items-center gap-1.5 flex-1 min-w-0">
      {/* Signal tag badge */}
      {tag ? (
        <span
          className="text-[8px] font-black uppercase tracking-widest px-1.5 py-0.5 rounded-md"
          style={{ background: `${tag.color}18`, color: tag.color, border: `1px solid ${tag.color}35` }}
        >
          {tag.label}
        </span>
      ) : (
        <span className="text-[8px] text-transparent select-none">M</span>
      )}

      {/* Circle */}
      <motion.div
        animate={isActive
          ? { scale: [1, 1.20, 1], boxShadow: [`0 0 0px ${heatColor}00`, `0 0 20px ${heatColor}bb`, `0 0 0px ${heatColor}00`] }
          : {}}
        transition={{ duration: 0.5 }}
        className="relative flex items-center justify-center rounded-full font-mono font-black text-sm select-none"
        style={{
          width: 44, height: 44,
          background: isActive ? heatColor : `${heatColor}20`,
          border: `2px solid ${isActive ? heatColor : heatColor + "55"}`,
          color: isActive ? "#fff" : heatColor,
          boxShadow: isActive ? `0 0 16px ${heatColor}90` : "none",
          transition: "background 0.3s, color 0.3s, border-color 0.3s",
        }}
      >
        {digit}
        {isActive && (
          <motion.div
            className="absolute inset-0 rounded-full"
            animate={{ opacity: [0.55, 0] }}
            transition={{ duration: 0.9, ease: "easeOut" }}
            style={{ background: heatColor }}
          />
        )}
      </motion.div>

      {/* Bar */}
      <div className="w-full rounded-full overflow-hidden" style={{ height: 4, background: `${heatColor}20` }}>
        <motion.div
          className="h-full rounded-full"
          style={{ background: heatColor }}
          animate={{ width: `${Math.min(100, pct * 6.5)}%` }}
          transition={{ duration: 0.6, ease: "easeOut" }}
        />
      </div>

      {/* Percentage */}
      <span className="font-mono text-[10px] font-bold tabular-nums" style={{ color: heatColor }}>
        {pct.toFixed(1)}%
      </span>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────
   DigitRow  (upper 0-4 or lower 5-9)
───────────────────────────────────────────────────────────────── */
function DigitRow({ digits, distribution, liveDigit, min, max, signalType, rowLabel, rowColor }: {
  digits: number[]; distribution: number[]; liveDigit: number | null;
  min: number; max: number; signalType: SignalTypeId;
  rowLabel: string; rowColor: string;
}) {
  const rowTotal = digits.reduce((acc, d) => acc + (distribution[d] ?? 0), 0);

  return (
    <div className="rounded-xl p-3" style={{ background: `${rowColor}06`, border: `1px solid ${rowColor}20` }}>
      {/* Row header */}
      <div className="flex items-center justify-between mb-3">
        <span className="text-[10px] font-black uppercase tracking-widest" style={{ color: rowColor }}>
          {rowLabel}
        </span>
        <span className="font-mono text-[11px] font-bold" style={{ color: rowColor }}>
          {rowTotal.toFixed(1)}% share
        </span>
      </div>
      {/* Digit circles */}
      <div className="flex gap-2">
        {digits.map(d => (
          <DigitCircle
            key={d} digit={d}
            pct={distribution[d] ?? 0}
            isActive={liveDigit === d}
            min={min} max={max}
            signalType={signalType}
          />
        ))}
      </div>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────
   LivePrice
───────────────────────────────────────────────────────────────── */
const DIGIT_COLORS_10 = [
  "#6366f1","#8b5cf6","#0ea5e9","#10b981","#eab308",
  "#f97316","#ef4444","#ec4899","#14b8a6","#84cc16",
];

function LivePrice({ price, prevPrice, liveDigit, pipSize, status }: {
  price: number | null; prevPrice: number | null; liveDigit: number | null;
  pipSize: number; status: string;
}) {
  const dir = price !== null && prevPrice !== null
    ? price > prevPrice ? "up" : price < prevPrice ? "down" : "flat" : "flat";
  const priceStr    = price !== null ? price.toFixed(pipSize) : "——.——";
  const prefix      = price !== null ? priceStr.slice(0, -1) : "——.——";
  const lastDigitStr = liveDigit !== null ? String(liveDigit) : "—";
  const arrowColor  = dir === "up" ? "#10b981" : dir === "down" ? "#ef4444" : "#94a3b8";
  const digitColor2 = liveDigit !== null ? DIGIT_COLORS_10[liveDigit] : "#0ea5e9";

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-1.5">
        {status === "live"
          ? <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
          : status === "connecting"
          ? <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" />
          : <span className="w-1.5 h-1.5 rounded-full bg-red-500" />}
        <span className="text-[10px] font-semibold uppercase tracking-widest text-slate-400">
          {status === "live" ? "Live" : status === "connecting" ? "Connecting…" : "Error"}
        </span>
        {dir !== "flat" && (dir === "up"
          ? <TrendingUp  className="w-3 h-3" style={{ color: arrowColor }} />
          : <TrendingDown className="w-3 h-3" style={{ color: arrowColor }} />
        )}
      </div>
      <div className="flex items-baseline gap-0 font-mono font-black leading-none">
        <span className="text-2xl text-slate-700">{prefix}</span>
        <AnimatePresence mode="popLayout">
          <motion.span
            key={lastDigitStr}
            initial={{ y: -16, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 16, opacity: 0 }}
            transition={{ duration: 0.22 }}
            className="text-3xl"
            style={{ color: digitColor2, textShadow: `0 0 14px ${digitColor2}80` }}
          >
            {lastDigitStr}
          </motion.span>
        </AnimatePresence>
      </div>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────
   TickerStrip
───────────────────────────────────────────────────────────────── */
function TickerStrip({ recentDigits }: { recentDigits: number[] }) {
  return (
    <div className="flex gap-1 flex-wrap">
      {recentDigits.map((d, i) => {
        const isLatest = i === recentDigits.length - 1;
        const c = DIGIT_COLORS_10[d];
        return (
          <motion.div
            key={i}
            initial={isLatest ? { scale: 0.4, opacity: 0 } : false}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ duration: 0.18 }}
            className="rounded-md font-mono text-[10px] font-bold flex items-center justify-center select-none"
            style={{
              width: 20, height: 20,
              background: isLatest ? c : `${c}28`,
              color: isLatest ? "#fff" : c,
              border: `1px solid ${c}50`,
              boxShadow: isLatest ? `0 0 8px ${c}90` : "none",
            }}
          >
            {d}
          </motion.div>
        );
      })}
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────
   Row config per signal type
───────────────────────────────────────────────────────────────── */
function getRowConfig(signalType: SignalTypeId): {
  upperLabel: string; upperColor: string;
  lowerLabel: string; lowerColor: string;
} {
  switch (signalType) {
    case "even-odd":
      return {
        upperLabel: "Digits 0 – 4  ·  Even: 0, 2, 4  |  Odd: 1, 3",
        upperColor: "#7c3aed",
        lowerLabel: "Digits 5 – 9  ·  Odd: 5, 7, 9  |  Even: 6, 8",
        lowerColor: "#ec4899",
      };
    case "over-under":
      return {
        upperLabel: "UNDER  ·  Digits 0 – 4",
        upperColor: "#f59e0b",
        lowerLabel: "OVER   ·  Digits 5 – 9",
        lowerColor: "#059669",
      };
    case "matches-differs":
      return {
        upperLabel: "Digits 0 – 4  ·  Matches / Differs",
        upperColor: "#0ea5e9",
        lowerLabel: "Digits 5 – 9  ·  Matches / Differs",
        lowerColor: "#6366f1",
      };
  }
}

/* ─────────────────────────────────────────────────────────────────
   MarketDigitPanel  (inner)
───────────────────────────────────────────────────────────────── */
function MarketDigitPanel({ symbol, signalType }: { symbol: string; signalType: SignalTypeId }) {
  const state = useDerivDigits(symbol);
  const { distribution, livePrice, liveDigit, pipSize, prevPrice, status, recentDigits, digits } = state;

  const validPcts = distribution.filter(p => p > 0);
  const minPct = validPcts.length ? Math.min(...validPcts) : 0;
  const maxPct = validPcts.length ? Math.max(...validPcts) : 10;
  const tickCount = digits.length;

  const { upperLabel, upperColor, lowerLabel, lowerColor } = getRowConfig(signalType);

  return (
    <div className="space-y-4">
      {/* Live price + tick count */}
      <div className="flex items-start justify-between gap-4">
        <LivePrice
          price={livePrice} prevPrice={prevPrice}
          liveDigit={liveDigit} pipSize={pipSize} status={status}
        />
        <div className="text-right">
          <div className="text-[10px] font-semibold text-slate-400 uppercase tracking-wide">Ticks loaded</div>
          <div className="font-mono text-xl font-black text-slate-700">
            {tickCount.toLocaleString()}
            <span className="text-slate-400 text-xs font-normal"> / {TICK_HISTORY_COUNT.toLocaleString()}</span>
          </div>
        </div>
      </div>

      {/* Upper row: digits 0–4 */}
      <DigitRow
        digits={[0, 1, 2, 3, 4]}
        distribution={distribution}
        liveDigit={liveDigit}
        min={minPct} max={maxPct}
        signalType={signalType}
        rowLabel={upperLabel}
        rowColor={upperColor}
      />

      {/* Lower row: digits 5–9 */}
      <DigitRow
        digits={[5, 6, 7, 8, 9]}
        distribution={distribution}
        liveDigit={liveDigit}
        min={minPct} max={maxPct}
        signalType={signalType}
        rowLabel={lowerLabel}
        rowColor={lowerColor}
      />

      {/* Heat legend */}
      <div className="flex items-center gap-3 flex-wrap text-[9px] font-semibold uppercase tracking-wide text-slate-400">
        {[
          { c: "#6366f1", l: "Cold (rare)" },
          { c: "#0ea5e9", l: "Normal" },
          { c: "#eab308", l: "Warm" },
          { c: "#f97316", l: "Hot" },
          { c: "#ef4444", l: "Very Hot" },
        ].map(({ c, l }) => (
          <div key={l} className="flex items-center gap-1">
            <span className="w-2 h-2 rounded-full" style={{ background: c }} />{l}
          </div>
        ))}
      </div>

      {/* Recent digits ticker */}
      <div>
        <p className="text-[10px] text-slate-400 font-semibold uppercase tracking-wide mb-1.5">Last digits ticker</p>
        <TickerStrip recentDigits={recentDigits} />
      </div>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────
   Main Export: DerivMarketPulse
───────────────────────────────────────────────────────────────── */
export function DerivMarketPulse() {
  const [symbolIdx, setSymbolIdx]     = useState(0);
  const [signalType, setSignalType]   = useState<SignalTypeId>("even-odd");

  const activeMarket  = VOLATILITY_MARKETS[symbolIdx];
  const activeSignal  = SIGNAL_TYPES.find(s => s.id === signalType)!;

  const marketOptions  = VOLATILITY_MARKETS.map((m, i) => ({ value: String(i), label: m.label }));
  const signalOptions  = SIGNAL_TYPES.map(s => ({ value: s.id, label: s.label }));

  return (
    <div>
      {/* ── Header ── */}
      <div className="flex items-center gap-3 mb-4 flex-wrap">
        <div className="w-8 h-8 rounded-xl flex items-center justify-center"
          style={{ background: "linear-gradient(135deg,rgba(14,165,233,0.12),rgba(255,79,163,0.12))", border: "1px solid rgba(14,165,233,0.20)" }}>
          <Radio className="w-4 h-4 text-sky-500 animate-pulse" />
        </div>
        <div>
          <h2 className="text-xl font-display font-bold text-slate-800">Market Pulse</h2>
          <p className="text-[11px] text-slate-400">
            Digit distribution · last {TICK_HISTORY_COUNT.toLocaleString()} ticks · live from Deriv
          </p>
        </div>
        <div className="ml-auto flex items-center gap-1.5 text-[10px] font-semibold text-emerald-600 px-2.5 py-1 rounded-full"
          style={{ background: "rgba(16,185,129,0.08)", border: "1px solid rgba(16,185,129,0.20)" }}>
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
          Real-time WebSocket
        </div>
      </div>

      {/* ── Dropdowns ── */}
      <div className="flex flex-wrap gap-3 mb-4">
        {/* Volatility / Market */}
        <div className="flex flex-col gap-1">
          <span className="text-[9px] font-bold uppercase tracking-widest text-slate-400 pl-1">Index</span>
          <StyledSelect
            value={String(symbolIdx)}
            onChange={v => setSymbolIdx(Number(v))}
            options={marketOptions}
            accentColor="#0ea5e9"
          />
        </div>

        {/* Signal Type */}
        <div className="flex flex-col gap-1">
          <span className="text-[9px] font-bold uppercase tracking-widest text-slate-400 pl-1">Signal Type</span>
          <StyledSelect
            value={signalType}
            onChange={v => setSignalType(v as SignalTypeId)}
            options={signalOptions}
            accentColor={activeSignal.color}
          />
        </div>

        {/* Active context pill */}
        <div className="flex items-end pb-0.5">
          <div
            className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-[11px] font-bold"
            style={{
              background: `${activeSignal.color}12`,
              border: `1.5px solid ${activeSignal.color}30`,
              color: activeSignal.color,
            }}
          >
            <span className="font-mono font-black">{activeMarket.short}</span>
            <span className="opacity-40">·</span>
            <span>{activeSignal.label}</span>
          </div>
        </div>
      </div>

      {/* ── Panel Card ── */}
      <div className="rounded-2xl p-5"
        style={{ background: "rgba(255,255,255,0.05)", backdropFilter: "blur(16px)", border: "1px solid rgba(14,165,233,0.18)", boxShadow: "0 4px 24px rgba(14,165,233,0.10)" }}>
        <AnimatePresence mode="wait">
          <motion.div
            key={`${activeMarket.symbol}-${signalType}`}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.22 }}
          >
            <MarketDigitPanel symbol={activeMarket.symbol} signalType={signalType} />
          </motion.div>
        </AnimatePresence>
      </div>
    </div>
  );
}
