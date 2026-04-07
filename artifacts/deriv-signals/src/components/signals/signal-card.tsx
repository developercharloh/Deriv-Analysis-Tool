import { useState, useEffect } from "react";
import { format } from "date-fns";
import {
  ArrowDownRight, ArrowUpRight, Equal, RefreshCw, TrendingUp, TrendingDown,
  Target, Activity, Hash, MapPin, Clock, Brain, CheckCircle2, Lightbulb,
} from "lucide-react";
import { type Signal } from "@workspace/api-client-react";
import { cn, formatPrice, getSignalColorInfo } from "@/lib/utils";
import { motion } from "framer-motion";

const VALIDITY_SECONDS = 600;

function useCountdown(createdAt: string) {
  const getRemaining = () => {
    const elapsed = Math.floor((Date.now() - new Date(createdAt).getTime()) / 1000);
    return Math.max(0, VALIDITY_SECONDS - elapsed);
  };
  const [remaining, setRemaining] = useState(getRemaining);
  useEffect(() => {
    if (remaining === 0) return;
    const id = setInterval(() => { const r = getRemaining(); setRemaining(r); if (r === 0) clearInterval(id); }, 1000);
    return () => clearInterval(id);
  }, [createdAt]);
  const pct = (remaining / VALIDITY_SECONDS) * 100;
  const mm = String(Math.floor(remaining / 60)).padStart(2, "0");
  const ss = String(remaining % 60).padStart(2, "0");
  const expired = remaining === 0;
  const barColor = pct > 50 ? "from-sky-400 to-cyan-400" : pct > 25 ? "from-amber-400 to-yellow-300" : "from-pink-500 to-rose-400";
  const textColor = pct > 50 ? "text-sky-600" : pct > 25 ? "text-amber-600" : "text-pink-600";
  return { remaining, pct, label: `${mm}:${ss}`, expired, barColor, textColor };
}

function getIcon(signalType: string) {
  switch (signalType) {
    case "OVER":    return TrendingUp;
    case "UNDER":   return TrendingDown;
    case "RISE":    return ArrowUpRight;
    case "FALL":    return ArrowDownRight;
    case "EVEN":
    case "ODD":     return Equal;
    case "MATCHES":
    case "DIFFERS": return RefreshCw;
    default:        return Activity;
  }
}

function getTradeLabel(signal: Signal): string {
  const t = signal.signalType;
  if ((t === "OVER" || t === "UNDER") && signal.predictionDigit != null) return `${t} ${signal.predictionDigit}`;
  return t;
}

function isRising(signalType: string) {
  return signalType === "RISE" || signalType === "OVER";
}

/* ── AI Confidence Ring ─────────────────────────────────────────── */
function AIConfidenceRing({ confidence, hex }: { confidence: string; hex: string }) {
  const pct = confidence === "HIGH" ? 0.92 : confidence === "MEDIUM" ? 0.65 : 0.38;
  const label = confidence === "HIGH" ? "92%" : confidence === "MEDIUM" ? "65%" : "38%";
  const size = 52, stroke = 4, r = (size - stroke) / 2;
  const circ = 2 * Math.PI * r;
  return (
    <div className="flex flex-col items-center gap-0.5 flex-shrink-0">
      <div className="relative" style={{ width: size, height: size }}>
        <svg width={size} height={size} className="-rotate-90">
          <circle cx={size/2} cy={size/2} r={r} fill="none" stroke="rgba(0,0,0,0.06)" strokeWidth={stroke} />
          <circle cx={size/2} cy={size/2} r={r} fill="none" stroke={hex} strokeWidth={stroke}
            strokeDasharray={circ} strokeDashoffset={circ * (1 - pct)} strokeLinecap="round"
            style={{ transition: "stroke-dashoffset 1s ease" }} />
        </svg>
        <div className="absolute inset-0 flex items-center justify-center">
          <span className="font-mono font-black text-[11px]" style={{ color: hex }}>{label}</span>
        </div>
      </div>
      <span className="text-[8px] text-slate-400 uppercase tracking-wide font-semibold">AI Conf.</span>
    </div>
  );
}

/* ── Countdown Bar ──────────────────────────────────────────────── */
function CountdownBar({ createdAt }: { createdAt: string }) {
  const { pct, label, expired, barColor, textColor } = useCountdown(createdAt);
  return (
    <div className="space-y-1.5">
      <div className="h-1.5 w-full rounded-full overflow-hidden" style={{ background: "rgba(0,0,0,0.06)" }}>
        <div className={cn("h-full rounded-full bg-gradient-to-r transition-all duration-1000", barColor)} style={{ width: `${pct}%` }} />
      </div>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1 text-[10px] text-slate-400">
          <Clock className="w-3 h-3" />
          <span className="uppercase tracking-wide">Validity</span>
        </div>
        {expired
          ? <span className="text-[11px] font-bold text-pink-500 tracking-widest animate-pulse">EXPIRED</span>
          : <span className={cn("font-mono text-[12px] font-bold tabular-nums", textColor)}>{label}</span>
        }
      </div>
    </div>
  );
}

/* ── Market family detector ─────────────────────────────────────── */
type MarketFamily = "volatility" | "jump" | "boom" | "crash" | "forex";

function getMarketFamily(symbol: string): MarketFamily {
  const s = symbol.toUpperCase();
  if (s.startsWith("BOOM")) return "boom";
  if (s.startsWith("CRASH")) return "crash";
  if (/^JD\d/.test(s) || /JUMP/i.test(s)) return "jump";
  if (/^(R_\d|1HZ\d|VOL)/.test(s)) return "volatility";
  return "forex";
}

const FAMILY_LABELS: Record<MarketFamily, string> = {
  volatility: "Volatility Index",
  jump: "Jump Index",
  boom: "Boom Index",
  crash: "Crash Index",
  forex: "Forex / Metal",
};

/* ── Entry section ──────────────────────────────────────────────── */
function EntrySection({ signal }: { signal: Signal }) {
  if (signal.entryDigit == null) return null;
  const t = signal.signalType;
  const family = getMarketFamily(signal.symbol);

  const notes: Partial<Record<typeof t, string>> = {
    MATCHES: "Last digit expected to repeat",
    DIFFERS: "Last digit expected to change",
    EVEN: "Last digit predicted even",
    ODD: "Last digit predicted odd",
    OVER: `Last digit predicted above ${signal.predictionDigit ?? "—"}`,
    UNDER: `Last digit predicted below ${signal.predictionDigit ?? "—"}`,
  };

  const familyHint: Partial<Record<MarketFamily, string>> = {
    jump: "Confirm after spike settles",
    boom: "Enter before next boom spike",
    crash: "Enter before next crash spike",
    forex: "Confirm during active session",
  };

  const note = notes[t as keyof typeof notes] ?? "";
  const hint = familyHint[family] ?? "";

  return (
    <div className="rounded-xl p-3 border border-sky-200 bg-sky-50">
      <div className="text-[10px] text-sky-600 flex items-center gap-1 mb-1 uppercase tracking-wide">
        <MapPin className="w-3 h-3" /> Entry Point
      </div>
      <div className="flex items-center gap-1.5">
        <span className="font-mono text-2xl font-bold text-sky-600 leading-none">{signal.entryDigit}</span>
        <span className="text-lg leading-none">🟦</span>
      </div>
      {note && <div className="text-[10px] text-sky-500 mt-1">{note}</div>}
      {hint && <div className="text-[10px] text-sky-400/80 mt-0.5 italic">{hint}</div>}
    </div>
  );
}

/* ── Entry Guide ────────────────────────────────────────────────── */
function EntryGuide({ signal }: { signal: Signal }) {
  const { signalType, symbol } = signal;
  const family = getMarketFamily(symbol);

  // Build entry instruction based on signal type + market family
  let entryColor = "#34d399";
  let entryBg = "rgba(5,150,105,0.08)";
  let entryBorder = "rgba(5,150,105,0.25)";
  let entryTitle = "Entry Guide";
  let entryText: React.ReactNode = null;

  if (signalType === "RISE" || signalType === "FALL") {
    const isRise = signalType === "RISE";
    const opposite = isRise ? "FALL" : "RISE";
    entryColor = isRise ? "#34d399" : "#f87171";
    entryBg = isRise ? "rgba(5,150,105,0.08)" : "rgba(239,68,68,0.08)";
    entryBorder = isRise ? "rgba(5,150,105,0.25)" : "rgba(239,68,68,0.25)";

    if (family === "volatility") {
      entryText = <>Watch for <strong>2 consecutive {opposite}</strong> ticks on the chart, then activate your <strong>{signalType}</strong> bot. Volatility markets respond quickly to this pattern.</>;
    } else if (family === "jump") {
      entryText = <>Jump indices spike suddenly. Wait for the spike to settle with <strong>3–4 calm ticks</strong>, then activate your <strong>{signalType}</strong> bot when price stabilises.</>;
    } else if (family === "boom") {
      entryText = isRise
        ? <>Boom markets spike upward periodically. Position your <strong>RISE</strong> bot just before the next spike. Watch for 2 rising ticks then enter.</>
        : <>After a boom spike, price drops briefly. Wait for the spike to peak, then activate your <strong>FALL</strong> bot on the retracement.</>;
    } else if (family === "crash") {
      entryText = signalType === "FALL"
        ? <>Crash markets spike downward. Position your <strong>FALL</strong> bot just before the next crash spike — enter after 2 consecutive falling ticks.</>
        : <>After a crash spike, price recovers briefly. Wait for the spike bottom, then activate your <strong>RISE</strong> bot on the bounce.</>;
    } else {
      // Forex / Metal
      entryText = <>Wait for a clear <strong>2–3 bar pullback</strong> in the {opposite.toLowerCase()} direction, then activate your <strong>{signalType}</strong> bot. Best results during active trading sessions.</>;
    }
  } else if (signalType === "OVER" || signalType === "UNDER") {
    const isOver = signalType === "OVER";
    entryColor = isOver ? "#38bdf8" : "#a78bfa";
    entryBg = isOver ? "rgba(14,165,233,0.08)" : "rgba(139,92,246,0.08)";
    entryBorder = isOver ? "rgba(14,165,233,0.25)" : "rgba(139,92,246,0.25)";
    entryTitle = "Entry Guide";

    const digit = signal.predictionDigit ?? "—";
    if (family === "jump") {
      entryText = <>Confirm the last <strong>2 digits are {isOver ? "above" : "below"} {digit}</strong>. On Jump markets, let any spike fully complete before activating your <strong>{signalType} {digit}</strong> bot.</>;
    } else if (family === "boom" || family === "crash") {
      entryText = <>During {family} spikes, last digits shift rapidly. Confirm <strong>2 stable ticks</strong> with last digit {isOver ? "above" : "below"} {digit} after the spike settles, then activate your bot.</>;
    } else if (family === "forex") {
      entryText = <>Verify the last digit is <strong>{isOver ? "above" : "below"} {digit}</strong> across 2 consecutive ticks. Forex digit patterns are most consistent during high-volume sessions.</>;
    } else {
      entryText = <>Confirm the last <strong>2 ticks both have last digit {isOver ? "above" : "below"} {digit}</strong>, then activate your <strong>{signalType} {digit}</strong> bot.</>;
    }
  } else if (signalType === "EVEN" || signalType === "ODD") {
    entryColor = "#f59e0b";
    entryBg = "rgba(245,158,11,0.08)";
    entryBorder = "rgba(245,158,11,0.25)";
    entryText = <>Verify that the last <strong>2–3 ticks</strong> ended in an <strong>{signalType.toLowerCase()}</strong> digit. When the pattern holds steady, activate your <strong>{signalType}</strong> bot. {family === "jump" ? "Skip ticks during spike moments." : family === "forex" ? "Most reliable during active market hours." : ""}</>;
  } else if (signalType === "MATCHES" || signalType === "DIFFERS") {
    const isMatch = signalType === "MATCHES";
    entryColor = "#c084fc";
    entryBg = "rgba(192,132,252,0.08)";
    entryBorder = "rgba(192,132,252,0.25)";
    const digit = signal.predictionDigit ?? signal.entryDigit ?? "—";
    entryText = isMatch
      ? <>Look for <strong>2 consecutive ticks</strong> where the last digit is <strong>{digit}</strong>. Once the pattern repeats, activate your <strong>MATCHES</strong> bot. {family === "jump" ? "Avoid entries during spike periods." : ""}</>
      : <>Confirm the last digit has <strong>changed away from {digit}</strong> for 2 consecutive ticks, then activate your <strong>DIFFERS</strong> bot. {family === "jump" ? "Wait for calm ticks after any spike." : ""}</>;
  }

  if (!entryText) return null;

  return (
    <div className="space-y-2">
      {/* Entry instruction */}
      <div className="rounded-xl px-3 py-2.5 flex items-start gap-2.5"
        style={{ background: entryBg, border: `1px solid ${entryBorder}` }}>
        <CheckCircle2 className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" style={{ color: entryColor }} />
        <div className="space-y-0.5">
          <div className="flex items-center gap-2">
            <p className="text-[10px] font-bold uppercase tracking-wider" style={{ color: entryColor }}>
              {entryTitle}
            </p>
            <span className="text-[9px] px-1.5 py-0.5 rounded-full font-semibold"
              style={{ background: `${entryColor}18`, color: entryColor, border: `1px solid ${entryColor}30` }}>
              {FAMILY_LABELS[family]}
            </span>
          </div>
          <p className="text-[11px] leading-snug" style={{ color: `${entryColor}cc` }}>
            {entryText}
          </p>
        </div>
      </div>

      {/* Gentle 3–7 run tip — always shown, calm tone */}
      <div className="rounded-xl px-3 py-2 flex items-start gap-2"
        style={{ background: "rgba(14,165,233,0.05)", border: "1px solid rgba(14,165,233,0.14)" }}>
        <Lightbulb className="w-3 h-3 flex-shrink-0 mt-0.5" style={{ color: "#38bdf8" }} />
        <p className="text-[10px] leading-snug" style={{ color: "#5b8fa8" }}>
          <strong style={{ color: "#38bdf8" }}>Tip for best results:</strong> Run <strong style={{ color: "#7dd3fc" }}>3–7 trades</strong>, then step back briefly and recheck the entry conditions before continuing. This keeps your trades aligned with the current market rhythm.
        </p>
      </div>
    </div>
  );
}

/* ── Signal Card ────────────────────────────────────────────────── */
export function SignalCard({ signal, animate = false }: { signal: Signal; animate?: boolean }) {
  const ci = getSignalColorInfo(signal.signalType);
  const Icon = getIcon(signal.signalType);
  const tradeLabel = getTradeLabel(signal);
  const hasEntry = signal.entryDigit != null;
  const rising = isRising(signal.signalType);

  const content = (
    <div
      className={cn(
        "rounded-2xl overflow-hidden relative group transition-all duration-300 cursor-default",
        "hover:-translate-y-1 hover:shadow-xl",
        animate ? ci.glow : ""
      )}
      style={{
        background: "rgba(255,255,255,0.045)",
        backdropFilter: "blur(20px)",
        border: `1px solid ${ci.hex}40`,
        boxShadow: `0 4px 28px ${ci.hex}20, 0 1px 0 rgba(255,255,255,0.06) inset`,
      }}
    >
      {/* Gradient tint overlay */}
      <div className={cn("absolute inset-0 opacity-30 group-hover:opacity-50 transition-opacity duration-300 pointer-events-none bg-gradient-to-br", ci.gradient)} />

      {/* Top colored stripe */}
      <div className="h-1 w-full" style={{ background: `linear-gradient(90deg, ${ci.hex}, ${ci.hex}80)` }} />

      <div className="p-4 relative z-10 space-y-3">

        {/* ── Header ── */}
        <div className="flex items-start justify-between gap-2">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-1.5 mb-0.5 flex-wrap">
              <span className="font-mono text-[11px] text-slate-400 font-semibold">{signal.symbol}</span>
              <span className={cn(
                "text-[9px] font-bold uppercase px-1.5 py-0.5 rounded-full tracking-wide",
                signal.confidence === "HIGH"   ? "bg-emerald-100 text-emerald-700 border border-emerald-200" :
                signal.confidence === "MEDIUM" ? "bg-amber-100 text-amber-700 border border-amber-200" :
                "bg-slate-100 text-slate-500 border border-slate-200"
              )}>
                {signal.confidence}
              </span>
            </div>
            <h3 className="font-display font-bold text-sm text-slate-800 leading-tight truncate">{signal.market}</h3>
          </div>
          <AIConfidenceRing confidence={signal.confidence} hex={ci.hex} />
        </div>

        {/* ── BIG Direction ── */}
        <div className={cn("rounded-xl px-4 py-3 border flex items-center justify-between", ci.bg, ci.border)}
          style={{ boxShadow: `inset 0 1px 0 rgba(255,255,255,0.70), 0 2px 8px ${ci.hex}10` }}>
          <div>
            <div className="text-[9px] text-slate-400 uppercase tracking-widest mb-1 font-semibold">Trade Type</div>
            <div className={cn("font-mono text-2xl font-black tracking-wide leading-none", ci.gradClass)}>
              {tradeLabel}
            </div>
          </div>
          <div className={cn("flex items-center justify-center w-10 h-10 rounded-xl", ci.bg, ci.border)}>
            <div className={rising ? "animate-arrow-up" : "animate-arrow-down"}>
              <Icon className={cn("w-5 h-5", ci.color)} />
            </div>
          </div>
        </div>

        {/* ── Entry + Last Digit ── */}
        <div className={cn("grid gap-2.5", hasEntry ? "grid-cols-2" : "grid-cols-1")}>
          <EntrySection signal={signal} />
          <div className="rounded-xl p-3 border border-slate-200 bg-slate-50">
            <div className="text-[10px] text-slate-400 flex items-center gap-1 mb-1 uppercase tracking-wide">
              <Hash className="w-3 h-3" /> Last Digit
            </div>
            <div className={cn("font-mono text-2xl font-bold leading-none", ci.color)}>{signal.digit}</div>
          </div>
        </div>

        {/* ── Entry Price ── */}
        <div className="rounded-xl p-2.5 border border-slate-200 flex items-center justify-between" style={{ background: "rgba(255,255,255,0.04)" }}>
          <div className="flex items-center gap-1 text-[10px] text-slate-400 uppercase tracking-wide">
            <Target className="w-3 h-3" /> Entry Price
          </div>
          <span className="font-mono text-sm font-bold text-slate-700">{formatPrice(signal.price, 4)}</span>
        </div>

        {/* ── Countdown ── */}
        <CountdownBar createdAt={signal.createdAt} />

        {/* ── Entry Guide ── */}
        <EntryGuide signal={signal} />

      </div>

      {/* ── Footer ── */}
      <div className="px-4 py-2.5 border-t flex items-center justify-between" style={{ borderColor: `${ci.hex}20`, background: `${ci.hex}06` }}>
        <div className="flex items-center gap-1.5">
          <span className="relative flex h-2 w-2">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full opacity-50" style={{ backgroundColor: ci.hex }} />
            <span className="relative inline-flex rounded-full h-2 w-2" style={{ backgroundColor: ci.hex }} />
          </span>
          <span className={cn("font-bold tracking-widest text-[11px] uppercase", ci.color)}>{tradeLabel}</span>
        </div>
        <div className="flex items-center gap-1.5">
          <Brain className="w-3 h-3 text-slate-300" />
          <span className="text-[10px] text-slate-400 font-mono">{format(new Date(signal.createdAt), "HH:mm:ss")}</span>
        </div>
      </div>
    </div>
  );

  if (animate) {
    return (
      <motion.div
        initial={{ opacity: 0, y: -20, scale: 0.92 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ type: "spring", stiffness: 380, damping: 22 }}
      >
        {content}
      </motion.div>
    );
  }
  return content;
}
