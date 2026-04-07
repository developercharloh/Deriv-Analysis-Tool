import { useEffect, useRef, useState, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { cn } from "@/lib/utils";
import { Radio, TrendingUp, TrendingDown, Minus } from "lucide-react";

/* ─────────────────────────────────────────────────────────────────
   Constants
───────────────────────────────────────────────────────────────── */
const DERIV_WS = "wss://ws.binaryws.com/websockets/v3?app_id=1";
const TICK_HISTORY_COUNT = 1000;

const MARKETS = [
  { symbol: "1HZ10V",  label: "Vol 10 (1s)"  },
  { symbol: "1HZ25V",  label: "Vol 25 (1s)"  },
  { symbol: "1HZ50V",  label: "Vol 50 (1s)"  },
  { symbol: "1HZ75V",  label: "Vol 75 (1s)"  },
  { symbol: "1HZ100V", label: "Vol 100 (1s)" },
  { symbol: "JD10",    label: "Jump 10"       },
  { symbol: "JD25",    label: "Jump 25"       },
  { symbol: "JD50",    label: "Jump 50"       },
  { symbol: "JD75",    label: "Jump 75"       },
  { symbol: "JD100",   label: "Jump 100"      },
];

/* ─────────────────────────────────────────────────────────────────
   Helpers
───────────────────────────────────────────────────────────────── */
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

function digitColor(pct: number, min: number, max: number): string {
  const range = max - min || 1;
  const norm = (pct - min) / range; // 0 = cold, 1 = hot
  if (norm >= 0.8) return "#ef4444"; // hot red
  if (norm >= 0.6) return "#f97316"; // orange
  if (norm >= 0.4) return "#eab308"; // yellow
  if (norm >= 0.2) return "#0ea5e9"; // sky
  return "#6366f1";                  // cold indigo
}

function digitBg(pct: number, min: number, max: number): string {
  const color = digitColor(pct, min, max);
  return `${color}22`;
}

/* ─────────────────────────────────────────────────────────────────
   Hook: useDerivDigits
───────────────────────────────────────────────────────────────── */
interface TickState {
  digits: number[];          // rolling last 1000
  distribution: number[];    // [0..9] percentages
  livePrice: number | null;
  liveDigit: number | null;
  pipSize: number;
  prevPrice: number | null;
  status: "connecting" | "live" | "error";
  recentDigits: number[];    // last 24 for ticker strip
}

function useDerivDigits(symbol: string): TickState {
  const [state, setState] = useState<TickState>({
    digits: [], distribution: Array(10).fill(0),
    livePrice: null, liveDigit: null, pipSize: 2,
    prevPrice: null, status: "connecting", recentDigits: [],
  });

  const wsRef = useRef<WebSocket | null>(null);
  const symbolRef = useRef(symbol);
  symbolRef.current = symbol;

  const digitsRef = useRef<number[]>([]);
  const pipRef = useRef(2);

  const connect = useCallback(() => {
    if (wsRef.current) {
      wsRef.current.onopen = null;
      wsRef.current.onmessage = null;
      wsRef.current.onerror = null;
      wsRef.current.onclose = null;
      wsRef.current.close();
    }

    digitsRef.current = [];
    setState(s => ({ ...s, digits: [], distribution: Array(10).fill(0), livePrice: null, liveDigit: null, prevPrice: null, status: "connecting", recentDigits: [] }));

    const ws = new WebSocket(DERIV_WS);
    wsRef.current = ws;

    ws.onopen = () => {
      // request tick history first
      ws.send(JSON.stringify({
        ticks_history: symbolRef.current,
        count: TICK_HISTORY_COUNT,
        end: "latest",
        style: "ticks",
        subscribe: 1,
      }));
    };

    ws.onmessage = (ev) => {
      const msg = JSON.parse(ev.data);

      if (msg.error) {
        setState(s => ({ ...s, status: "error" }));
        return;
      }

      // Historical ticks bulk
      if (msg.msg_type === "history") {
        const prices: number[] = msg.history?.prices ?? [];
        const pip = msg.pip_size ?? 2;
        pipRef.current = pip;
        const newDigits = prices.map(p => getLastDigit(p, pip));
        digitsRef.current = newDigits.slice(-TICK_HISTORY_COUNT);
        const dist = buildDistribution(digitsRef.current);
        const lastP = prices[prices.length - 1] ?? null;
        const lastD = lastP !== null ? getLastDigit(lastP, pip) : null;
        setState(s => ({
          ...s,
          digits: digitsRef.current,
          distribution: dist,
          livePrice: lastP,
          liveDigit: lastD,
          pipSize: pip,
          prevPrice: null,
          status: "live",
          recentDigits: newDigits.slice(-24),
        }));
      }

      // Live tick
      if (msg.msg_type === "tick" && msg.tick) {
        const tick = msg.tick;
        const pip = tick.pip_size ?? pipRef.current;
        pipRef.current = pip;
        const price = tick.quote;
        const digit = getLastDigit(price, pip);
        digitsRef.current = [...digitsRef.current.slice(-(TICK_HISTORY_COUNT - 1)), digit];
        const dist = buildDistribution(digitsRef.current);
        setState(s => ({
          ...s,
          digits: digitsRef.current,
          distribution: dist,
          prevPrice: s.livePrice,
          livePrice: price,
          liveDigit: digit,
          pipSize: pip,
          status: "live",
          recentDigits: [...s.recentDigits.slice(-23), digit],
        }));
      }
    };

    ws.onerror = () => setState(s => ({ ...s, status: "error" }));
    ws.onclose = () => {
      // auto-reconnect after 3s if symbol unchanged
      setTimeout(() => {
        if (symbolRef.current === symbol) connect();
      }, 3000);
    };
  }, [symbol]);

  useEffect(() => {
    connect();
    return () => {
      if (wsRef.current) {
        wsRef.current.onopen = null;
        wsRef.current.onmessage = null;
        wsRef.current.onerror = null;
        wsRef.current.onclose = null;
        wsRef.current.close();
      }
    };
  }, [connect]);

  return state;
}

/* ─────────────────────────────────────────────────────────────────
   DigitCircle
───────────────────────────────────────────────────────────────── */
function DigitCircle({ digit, pct, isActive, min, max }: {
  digit: number; pct: number; isActive: boolean; min: number; max: number;
}) {
  const color = digitColor(pct, min, max);
  const bg = digitBg(pct, min, max);

  return (
    <div className="flex flex-col items-center gap-1.5 flex-1">
      {/* Circle */}
      <motion.div
        animate={isActive ? { scale: [1, 1.22, 1], boxShadow: [`0 0 0px ${color}00`, `0 0 18px ${color}99`, `0 0 0px ${color}00`] } : {}}
        transition={{ duration: 0.5 }}
        className="relative flex items-center justify-center rounded-full font-mono font-black text-sm select-none"
        style={{
          width: 42, height: 42,
          background: isActive ? color : bg,
          border: `2px solid ${isActive ? color : color + "55"}`,
          color: isActive ? "#fff" : color,
          boxShadow: isActive ? `0 0 14px ${color}80` : "none",
          transition: "background 0.3s, color 0.3s, border-color 0.3s",
        }}
      >
        {digit}
        {isActive && (
          <motion.div
            className="absolute inset-0 rounded-full"
            animate={{ opacity: [0.6, 0] }}
            transition={{ duration: 0.8, ease: "easeOut" }}
            style={{ background: color }}
          />
        )}
      </motion.div>

      {/* Bar */}
      <div className="w-full rounded-full overflow-hidden" style={{ height: 4, background: `${color}22` }}>
        <motion.div
          className="h-full rounded-full"
          style={{ background: color }}
          initial={{ width: 0 }}
          animate={{ width: `${Math.min(100, pct * 6.5)}%` }}
          transition={{ duration: 0.6, ease: "easeOut" }}
        />
      </div>

      {/* Pct */}
      <span className="font-mono text-[10px] font-bold tabular-nums" style={{ color }}>
        {pct.toFixed(1)}%
      </span>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────
   LivePrice
───────────────────────────────────────────────────────────────── */
function LivePrice({ price, prevPrice, liveDigit, pipSize, status }: {
  price: number | null; prevPrice: number | null; liveDigit: number | null;
  pipSize: number; status: string;
}) {
  const dir = price !== null && prevPrice !== null
    ? price > prevPrice ? "up" : price < prevPrice ? "down" : "flat"
    : "flat";

  const priceStr = price !== null ? price.toFixed(pipSize) : "——";
  const lastDigitStr = liveDigit !== null ? String(liveDigit) : "—";
  const prefix = price !== null ? priceStr.slice(0, -1) : "——";

  const arrowColor = dir === "up" ? "#10b981" : dir === "down" ? "#ef4444" : "#94a3b8";

  return (
    <div className="flex flex-col items-center gap-1">
      {/* Live indicator */}
      <div className="flex items-center gap-1.5">
        {status === "live"
          ? <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
          : status === "connecting"
          ? <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" />
          : <span className="w-1.5 h-1.5 rounded-full bg-red-500" />
        }
        <span className="text-[10px] font-semibold uppercase tracking-widest text-slate-400">
          {status === "live" ? "Live" : status === "connecting" ? "Connecting…" : "Error"}
        </span>
        {dir !== "flat" && (
          dir === "up"
            ? <TrendingUp className="w-3 h-3" style={{ color: arrowColor }} />
            : <TrendingDown className="w-3 h-3" style={{ color: arrowColor }} />
        )}
      </div>

      {/* Price */}
      <div className="flex items-baseline gap-0.5 font-mono font-black">
        <span className="text-xl text-slate-700">{prefix}</span>
        <AnimatePresence mode="popLayout">
          <motion.span
            key={lastDigitStr}
            initial={{ y: -14, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 14, opacity: 0 }}
            transition={{ duration: 0.25 }}
            className="text-2xl"
            style={{ color: "#0ea5e9", textShadow: "0 0 12px rgba(14,165,233,0.6)" }}
          >
            {lastDigitStr}
          </motion.span>
        </AnimatePresence>
      </div>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────
   TickerStrip  (last 24 digits as small squares)
───────────────────────────────────────────────────────────────── */
const DIGIT_COLORS = ["#6366f1","#8b5cf6","#0ea5e9","#10b981","#eab308","#f97316","#ef4444","#ec4899","#14b8a6","#a3e635"];

function TickerStrip({ recentDigits }: { recentDigits: number[] }) {
  return (
    <div className="flex gap-1 items-center flex-wrap">
      {recentDigits.map((d, i) => {
        const isLatest = i === recentDigits.length - 1;
        return (
          <motion.div
            key={i}
            initial={isLatest ? { scale: 0.5, opacity: 0 } : false}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ duration: 0.2 }}
            className="rounded-md font-mono text-[10px] font-bold flex items-center justify-center select-none"
            style={{
              width: 20, height: 20,
              background: isLatest ? DIGIT_COLORS[d] : `${DIGIT_COLORS[d]}30`,
              color: isLatest ? "#fff" : DIGIT_COLORS[d],
              border: `1px solid ${DIGIT_COLORS[d]}55`,
              boxShadow: isLatest ? `0 0 8px ${DIGIT_COLORS[d]}80` : "none",
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
   Single Market Panel
───────────────────────────────────────────────────────────────── */
function MarketDigitPanel({ symbol }: { symbol: string }) {
  const state = useDerivDigits(symbol);
  const { distribution, livePrice, liveDigit, pipSize, prevPrice, status, recentDigits } = state;

  const validPcts = distribution.filter(p => p > 0);
  const minPct = validPcts.length ? Math.min(...validPcts) : 0;
  const maxPct = validPcts.length ? Math.max(...validPcts) : 10;
  const tickCount = state.digits.length;

  return (
    <div className="space-y-4">
      {/* Price + tick count */}
      <div className="flex items-center justify-between">
        <LivePrice
          price={livePrice}
          prevPrice={prevPrice}
          liveDigit={liveDigit}
          pipSize={pipSize}
          status={status}
        />
        <div className="text-right">
          <div className="text-xs font-semibold text-slate-500">Ticks loaded</div>
          <div className="font-mono text-lg font-black text-slate-700">
            {tickCount.toLocaleString()}<span className="text-slate-400 text-xs font-normal"> / {TICK_HISTORY_COUNT.toLocaleString()}</span>
          </div>
        </div>
      </div>

      {/* Digit Circles */}
      <div className="flex gap-1.5 items-end">
        {Array.from({ length: 10 }, (_, d) => (
          <DigitCircle
            key={d}
            digit={d}
            pct={distribution[d] ?? 0}
            isActive={liveDigit === d}
            min={minPct}
            max={maxPct}
          />
        ))}
      </div>

      {/* Color legend */}
      <div className="flex items-center gap-2 text-[9px] text-slate-400 font-semibold uppercase tracking-wide">
        <div className="flex items-center gap-1">
          <span className="w-2 h-2 rounded-full bg-indigo-500" /> Cold (rare)
        </div>
        <div className="flex items-center gap-1">
          <span className="w-2 h-2 rounded-full bg-sky-500" /> Normal
        </div>
        <div className="flex items-center gap-1">
          <span className="w-2 h-2 rounded-full bg-orange-500" /> Hot (frequent)
        </div>
        <div className="flex items-center gap-1">
          <span className="w-2 h-2 rounded-full bg-red-500" /> Very Hot
        </div>
      </div>

      {/* Recent ticks strip */}
      <div>
        <p className="text-[10px] text-slate-400 font-semibold uppercase tracking-wide mb-1.5">Last digits ticker</p>
        <TickerStrip recentDigits={recentDigits} />
      </div>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────
   Main: DerivMarketPulse  (exported, replaces MarketStatusGrid)
───────────────────────────────────────────────────────────────── */
export function DerivMarketPulse() {
  const [activeIdx, setActiveIdx] = useState(0);
  const activeMarket = MARKETS[activeIdx];

  return (
    <div>
      {/* Header */}
      <div className="flex items-center gap-3 mb-4">
        <div className="w-8 h-8 rounded-xl flex items-center justify-center"
          style={{ background: "linear-gradient(135deg,rgba(14,165,233,0.12),rgba(255,79,163,0.12))", border: "1px solid rgba(14,165,233,0.20)" }}>
          <Radio className="w-4 h-4 text-sky-500 animate-pulse" />
        </div>
        <div>
          <h2 className="text-xl font-display font-bold text-slate-800">Market Pulse</h2>
          <p className="text-[11px] text-slate-400">Digit distribution · last {TICK_HISTORY_COUNT.toLocaleString()} ticks · live from Deriv</p>
        </div>
        <div className="ml-auto flex items-center gap-1.5 text-[10px] font-semibold text-emerald-600 px-2.5 py-1 rounded-full"
          style={{ background: "rgba(16,185,129,0.08)", border: "1px solid rgba(16,185,129,0.20)" }}>
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
          Real-time WebSocket
        </div>
      </div>

      {/* Market Tabs */}
      <div className="flex flex-wrap gap-1.5 mb-4">
        {MARKETS.map((m, i) => (
          <button
            key={m.symbol}
            onClick={() => setActiveIdx(i)}
            className={cn(
              "px-3 py-1.5 rounded-xl text-[11px] font-bold font-mono transition-all duration-200",
              activeIdx === i
                ? "text-white shadow-lg"
                : "text-slate-500 hover:text-slate-700"
            )}
            style={{
              background: activeIdx === i
                ? "linear-gradient(135deg,#0ea5e9,#6366f1)"
                : "rgba(14,165,233,0.06)",
              border: activeIdx === i
                ? "1px solid rgba(14,165,233,0.40)"
                : "1px solid rgba(14,165,233,0.14)",
              boxShadow: activeIdx === i ? "0 2px 12px rgba(14,165,233,0.30)" : "none",
            }}
          >
            {m.label}
          </button>
        ))}
      </div>

      {/* Panel Card */}
      <div className="rounded-2xl p-5"
        style={{ background: "rgba(255,255,255,0.05)", backdropFilter: "blur(16px)", border: "1px solid rgba(14,165,233,0.18)", boxShadow: "0 4px 24px rgba(14,165,233,0.10)" }}>
        <div className="flex items-center gap-2 mb-4">
          <span className="font-mono text-sm font-black text-slate-600">{activeMarket.symbol}</span>
          <span className="text-slate-300">·</span>
          <span className="text-sm text-slate-500 font-semibold">{activeMarket.label}</span>
        </div>
        <AnimatePresence mode="wait">
          <motion.div
            key={activeMarket.symbol}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.25 }}
          >
            <MarketDigitPanel symbol={activeMarket.symbol} />
          </motion.div>
        </AnimatePresence>
      </div>
    </div>
  );
}
