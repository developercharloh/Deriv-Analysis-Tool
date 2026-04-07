import { useState, useEffect, useCallback } from "react";
import { AppLayout } from "@/components/layout/app-layout";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  CheckCircle2, XCircle, Clock, AlertTriangle, TrendingUp, TrendingDown,
  BarChart2, Cpu, Activity, RefreshCw, ChevronDown, ChevronRight, Zap, Shield
} from "lucide-react";
import { cn } from "@/lib/utils";

// ─── Types ────────────────────────────────────────────────────────────────────

interface SignalGateAudit {
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
  barrierFound: boolean | null;
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

interface MarketSnapshot {
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
  gateAudit: Record<string, SignalGateAudit>;
  markovMatrix: number[][];
  lastSignalTimes: Record<string, number>;
}

// ─── Signal type styles ───────────────────────────────────────────────────────

const SIGNAL_COLORS: Record<string, string> = {
  OVER:    "bg-emerald-500/20 text-emerald-300 border-emerald-500/30",
  UNDER:   "bg-red-500/20    text-red-300    border-red-500/30",
  RISE:    "bg-blue-500/20   text-blue-300   border-blue-500/30",
  FALL:    "bg-orange-500/20 text-orange-300 border-orange-500/30",
  EVEN:    "bg-purple-500/20 text-purple-300 border-purple-500/30",
  ODD:     "bg-pink-500/20   text-pink-300   border-pink-500/30",
  MATCHES: "bg-yellow-500/20 text-yellow-300 border-yellow-500/30",
  DIFFERS: "bg-cyan-500/20   text-cyan-300   border-cyan-500/30",
};

const ALL_SIGNAL_TYPES = ["OVER","UNDER","RISE","FALL","EVEN","ODD","MATCHES","DIFFERS"];

// ─── Sub-components ───────────────────────────────────────────────────────────

function GateIcon({ ok }: { ok: boolean }) {
  return ok
    ? <CheckCircle2 className="w-4 h-4 text-emerald-400 flex-shrink-0" />
    : <XCircle      className="w-4 h-4 text-red-400    flex-shrink-0" />;
}

function ScoreBar({ value, max = 100, color = "bg-primary" }: { value: number; max?: number; color?: string }) {
  const pct = Math.min(100, Math.max(0, (value / max) * 100));
  return (
    <div className="w-full h-1.5 bg-white/10 rounded-full overflow-hidden">
      <div className={cn("h-full rounded-full transition-all", color)} style={{ width: `${pct}%` }} />
    </div>
  );
}

function DigitFreqChart({ freqs, label }: { freqs: number[]; label: string }) {
  const max = Math.max(...freqs, 1);
  return (
    <div>
      <p className="text-xs text-muted-foreground mb-2 font-medium">{label}</p>
      <div className="flex items-end gap-1 h-16">
        {freqs.map((f, i) => {
          const pct = (f / max) * 100;
          const isHigh = f > 12;
          const isLow  = f < 7;
          return (
            <div key={i} className="flex-1 flex flex-col items-center gap-0.5">
              <div
                className={cn(
                  "w-full rounded-t transition-all",
                  isHigh ? "bg-emerald-500" : isLow ? "bg-red-500/60" : "bg-primary/60"
                )}
                style={{ height: `${pct}%` }}
              />
              <span className="text-[9px] text-muted-foreground">{i}</span>
            </div>
          );
        })}
      </div>
      <div className="flex justify-between mt-1">
        {freqs.map((f, i) => (
          <span key={i} className="text-[8px] text-muted-foreground w-full text-center">{f.toFixed(0)}%</span>
        ))}
      </div>
    </div>
  );
}

function MarkovHeatmap({ matrix }: { matrix: number[][] }) {
  if (!matrix || matrix.length < 10) return null;
  return (
    <div className="overflow-x-auto">
      <table className="text-[9px] border-collapse w-full">
        <thead>
          <tr>
            <th className="p-0.5 text-muted-foreground">→</th>
            {Array.from({ length: 10 }, (_, i) => (
              <th key={i} className="p-0.5 text-muted-foreground text-center">{i}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {matrix.map((row, from) => (
            <tr key={from}>
              <td className="p-0.5 text-muted-foreground font-medium pr-1">{from}</td>
              {row.map((v, to) => {
                const intensity = Math.min(1, v / 0.25);
                const bg = `rgba(99,102,241,${(intensity * 0.8).toFixed(2)})`;
                return (
                  <td
                    key={to}
                    className="p-0.5 text-center rounded"
                    style={{ background: bg, color: intensity > 0.5 ? "white" : "rgba(255,255,255,0.5)" }}
                  >
                    {(v * 100).toFixed(0)}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
      <p className="text-[9px] text-muted-foreground mt-1">Row = current digit → Col = probability of next digit (%)</p>
    </div>
  );
}

function SignalGateRow({ type, audit }: { type: string; audit: SignalGateAudit }) {
  const [expanded, setExpanded] = useState(false);
  const passing = audit.overallPassing;

  return (
    <div className={cn(
      "rounded-lg border p-2.5 transition-all",
      passing ? "border-emerald-500/20 bg-emerald-500/5" : "border-red-500/20 bg-red-500/5"
    )}>
      <button
        className="w-full flex items-center justify-between gap-2"
        onClick={() => setExpanded(e => !e)}
      >
        <div className="flex items-center gap-2">
          <span className={cn("text-[10px] font-bold px-1.5 py-0.5 rounded border", SIGNAL_COLORS[type])}>{type}</span>
          {passing
            ? <span className="text-xs text-emerald-400 font-medium flex items-center gap-1"><CheckCircle2 className="w-3 h-3" /> READY</span>
            : <span className="text-xs text-red-400 font-medium flex items-center gap-1"><XCircle className="w-3 h-3" /> BLOCKED</span>
          }
          {audit.blockedBy.length > 0 && (
            <span className="text-[9px] text-muted-foreground truncate max-w-[200px]">{audit.blockedBy[0]}</span>
          )}
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          <span className="text-[9px] text-muted-foreground">{audit.windowsCount}/{audit.windowsRequired} win</span>
          {audit.profitSimWinRate !== null && (
            <span className={cn("text-[9px]", audit.profitSimOk ? "text-emerald-400" : "text-red-400")}>
              WR {audit.profitSimWinRate}%
            </span>
          )}
          {expanded ? <ChevronDown className="w-3 h-3 text-muted-foreground" /> : <ChevronRight className="w-3 h-3 text-muted-foreground" />}
        </div>
      </button>

      {expanded && (
        <div className="mt-2.5 pt-2 border-t border-white/5 grid grid-cols-2 gap-1.5">
          {[
            ["Cooldown",       audit.cooldownOk,       audit.cooldownOk ? "Clear" : `${audit.cooldownSecondsRemaining}s left`],
            ["Min ticks",      audit.minTicksOk,       `${audit.minTicksRequired} needed`],
            ["Entropy OK",     audit.entropyOk,        null],
            ["No anomaly",     audit.anomalyOk,        null],
            ["No drift",       audit.driftOk,          null],
            ["Ensemble/Score", audit.ensembleOk,       `${audit.ensembleScore}%`],
            ["Windows",        audit.windowsOk,        `${audit.windowsCount}/${audit.windowsRequired}`],
            ...(audit.barrierFound !== null ? [["Barrier found", audit.barrierFound, null] as [string, boolean, string|null]] : []),
            ...(audit.losingDigitsOk !== null ? [["Losing digits <10%", audit.losingDigitsOk, null] as [string, boolean, string|null]] : []),
            ...(audit.strengthOk !== null ? [["1k strength guard", audit.strengthOk, null] as [string, boolean, string|null]] : []),
            ...(audit.recencyOk !== null ? [["Recency guard", audit.recencyOk, null] as [string, boolean, string|null]] : []),
            ...(audit.streakOk !== null ? [["Streak", audit.streakOk, `${audit.streakCount} ticks`] as [string, boolean, string|null]] : []),
            ["Profit sim", audit.profitSimOk, audit.profitSimWinRate !== null ? `${audit.profitSimWinRate}% ≥ ${audit.profitSimThreshold}%` : "N/A"],
          ].map(([label, ok, detail]) => (
            <div key={label as string} className="flex items-center gap-1.5">
              <GateIcon ok={ok as boolean} />
              <span className="text-[10px] text-muted-foreground">{label as string}</span>
              {detail && <span className="text-[10px] text-white/60 ml-auto">{detail as string}</span>}
            </div>
          ))}

          {audit.blockedBy.length > 0 && (
            <div className="col-span-2 mt-1 pt-1 border-t border-white/5">
              <p className="text-[9px] text-red-400 font-medium mb-0.5">Blocked by:</p>
              {audit.blockedBy.map((b, i) => (
                <p key={i} className="text-[9px] text-red-300/80 flex items-start gap-1">
                  <span className="mt-0.5">•</span>{b}
                </p>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function MarketCard({ market }: { market: MarketSnapshot }) {
  const [freqWindow, setFreqWindow] = useState<"30" | "100" | "1k">("100");
  const [showMarkov, setShowMarkov] = useState(false);

  const freqData = freqWindow === "30" ? market.freqs30 : freqWindow === "100" ? market.freqs100 : market.freqs1k;
  const passCount = ALL_SIGNAL_TYPES.filter(t => market.gateAudit[t]?.overallPassing).length;

  const statusColor = passCount >= 2 ? "text-emerald-400" : passCount === 1 ? "text-yellow-400" : "text-muted-foreground";

  return (
    <div className="bg-card/60 border border-white/10 rounded-2xl overflow-hidden backdrop-blur-xl">
      {/* Header */}
      <div className="px-4 py-3 border-b border-white/5 flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="font-semibold text-sm text-white truncate">{market.displayName}</p>
          <p className="text-[10px] text-muted-foreground">{market.symbol}</p>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          <span className={cn("text-xs font-bold", statusColor)}>
            {passCount}/8 ready
          </span>
          <div className={cn(
            "text-[10px] px-2 py-0.5 rounded-full border",
            market.anomaly ? "bg-red-500/20 border-red-500/30 text-red-300" :
            market.drift   ? "bg-orange-500/20 border-orange-500/30 text-orange-300" :
                             "bg-emerald-500/20 border-emerald-500/30 text-emerald-300"
          )}>
            {market.anomaly ? "⚡ Anomaly" : market.drift ? "↗ Drift" : "✓ Clean"}
          </div>
          <div className="text-right">
            <p className="text-xs font-mono text-white">{market.lastPrice.toFixed(3)}</p>
            <p className="text-[10px] text-muted-foreground">{market.tickCount.toLocaleString()} ticks</p>
          </div>
        </div>
      </div>

      <Tabs defaultValue="overview" className="p-3">
        <TabsList className="w-full bg-white/5 h-8 mb-3">
          {[
            ["overview", "Overview"],
            ["digits",   "Digits"],
            ["models",   "Models"],
            ["gates",    "Signal Gates"],
            ["markov",   "Markov"],
          ].map(([v, l]) => (
            <TabsTrigger key={v} value={v} className="flex-1 text-[10px] h-6 data-[state=active]:bg-white/10">
              {l}
            </TabsTrigger>
          ))}
        </TabsList>

        {/* OVERVIEW TAB */}
        <TabsContent value="overview" className="mt-0 space-y-3">
          <div className="grid grid-cols-3 gap-2">
            {[
              { label: "RSI",     value: market.rsi,     color: market.rsi > 70 ? "text-red-400" : market.rsi < 30 ? "text-blue-400" : "text-white" },
              { label: "ADX",     value: market.adx,     color: market.adx > 25 ? "text-emerald-400" : "text-muted-foreground" },
              { label: "Entropy", value: market.entropy, color: market.entropyOk ? "text-emerald-400" : "text-red-400" },
            ].map(({ label, value, color }) => (
              <div key={label} className="bg-white/5 rounded-lg p-2 text-center">
                <p className={cn("text-lg font-bold font-mono", color)}>{value}</p>
                <p className="text-[10px] text-muted-foreground">{label}</p>
              </div>
            ))}
          </div>

          <div className="grid grid-cols-2 gap-2">
            {[
              { label: "Regime",  value: market.regime },
              { label: "Volatility", value: market.volRegime },
              { label: "Anomaly", value: market.anomaly ? "YES" : "NO", color: market.anomaly ? "text-red-400" : "text-emerald-400" },
              { label: "Drift",   value: market.drift   ? "YES" : "NO", color: market.drift   ? "text-red-400" : "text-emerald-400" },
            ].map(({ label, value, color }) => (
              <div key={label} className="bg-white/5 rounded-lg p-2">
                <p className="text-[9px] text-muted-foreground">{label}</p>
                <p className={cn("text-xs font-semibold", color ?? "text-white")}>{value}</p>
              </div>
            ))}
          </div>

          {/* Signal readiness summary */}
          <div className="bg-white/5 rounded-lg p-2.5">
            <p className="text-[10px] text-muted-foreground mb-2">Signal Readiness</p>
            <div className="grid grid-cols-4 gap-1">
              {ALL_SIGNAL_TYPES.map(t => {
                const gate = market.gateAudit[t];
                return (
                  <div key={t} className={cn(
                    "rounded p-1.5 text-center border text-[9px] font-bold",
                    gate?.overallPassing ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-300" : "border-red-500/20 bg-red-500/5 text-red-400/70"
                  )}>
                    {t}
                  </div>
                );
              })}
            </div>
          </div>

          {/* Barrier results */}
          <div className="space-y-1.5">
            {market.overBarrier && (
              <div className="bg-emerald-500/10 border border-emerald-500/20 rounded-lg p-2 text-xs">
                <span className="text-emerald-300 font-semibold">OVER {market.overBarrier.barrier}</span>
                <span className="text-muted-foreground mx-1">|</span>
                <span className="text-white/70">Win: [{market.overBarrier.winDigits.join(",")}]</span>
                <span className="text-muted-foreground mx-1">|</span>
                <span className="text-white/70">{market.overBarrier.winProb}%</span>
              </div>
            )}
            {market.underBarrier && (
              <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-2 text-xs">
                <span className="text-red-300 font-semibold">UNDER {market.underBarrier.barrier}</span>
                <span className="text-muted-foreground mx-1">|</span>
                <span className="text-white/70">Win: [{market.underBarrier.winDigits.join(",")}]</span>
                <span className="text-muted-foreground mx-1">|</span>
                <span className="text-white/70">{market.underBarrier.winProb}%</span>
              </div>
            )}
            {!market.overBarrier && !market.underBarrier && (
              <div className="bg-white/5 border border-white/10 rounded-lg p-2 text-xs text-muted-foreground text-center">
                No valid OVER/UNDER barrier — individual digits do not support entry
              </div>
            )}
          </div>
        </TabsContent>

        {/* DIGITS TAB */}
        <TabsContent value="digits" className="mt-0 space-y-3">
          <div className="flex gap-1 mb-1">
            {(["30","100","1k"] as const).map(w => (
              <button
                key={w}
                onClick={() => setFreqWindow(w)}
                className={cn(
                  "px-2.5 py-1 rounded text-[10px] font-medium transition-all",
                  freqWindow === w ? "bg-primary text-white" : "bg-white/5 text-muted-foreground hover:bg-white/10"
                )}
              >
                {w === "1k" ? "1000" : w} ticks
              </button>
            ))}
          </div>

          <DigitFreqChart freqs={freqData} label={`Last ${freqWindow === "1k" ? "1000" : freqWindow} ticks — digit 0–9 frequency`} />

          <div className="bg-white/5 rounded-lg p-2.5 space-y-1.5">
            <p className="text-[10px] text-muted-foreground mb-2">Individual digit breakdown</p>
            {freqData.map((f, i) => (
              <div key={i} className="flex items-center gap-2">
                <span className="text-[10px] font-mono w-3 text-muted-foreground">{i}</span>
                <ScoreBar
                  value={f}
                  max={25}
                  color={f >= 12 ? "bg-emerald-500" : f < 7 ? "bg-red-500" : "bg-primary/70"}
                />
                <span className={cn(
                  "text-[10px] font-mono w-10 text-right flex-shrink-0",
                  f >= 12 ? "text-emerald-400" : f < 7 ? "text-red-400" : "text-white/70"
                )}>{f.toFixed(1)}%</span>
                {f >= 12 && <span className="text-[8px] text-emerald-400">HOT</span>}
                {f < 7  && <span className="text-[8px] text-red-400">COLD</span>}
              </div>
            ))}
          </div>
        </TabsContent>

        {/* MODELS TAB */}
        <TabsContent value="models" className="mt-0 space-y-3">
          <div className="bg-white/5 rounded-lg p-2.5">
            <p className="text-[10px] text-muted-foreground mb-2.5">Ensemble Model Scores</p>
            <div className="space-y-2">
              {[
                { label: "OVER",    value: market.ensemble.overScore,    threshold: 50 },
                { label: "UNDER",   value: market.ensemble.underScore,   threshold: 50 },
                { label: "RISE",    value: market.ensemble.riseScore,    threshold: 52 },
                { label: "FALL",    value: market.ensemble.fallScore,    threshold: 52 },
                { label: "EVEN",    value: market.ensemble.evenScore,    threshold: 58 },
                { label: "ODD",     value: market.ensemble.oddScore,     threshold: 58 },
                { label: "MATCHES", value: market.ensemble.matchesScore, threshold: 50 },
                { label: "DIFFERS", value: market.ensemble.differsScore, threshold: 50 },
              ].map(({ label, value, threshold }) => (
                <div key={label} className="flex items-center gap-2">
                  <span className={cn("text-[9px] font-bold w-14 flex-shrink-0 px-1 py-0.5 rounded text-center border", SIGNAL_COLORS[label])}>
                    {label}
                  </span>
                  <ScoreBar
                    value={value}
                    max={100}
                    color={value >= threshold ? "bg-emerald-500" : "bg-red-500/60"}
                  />
                  <span className={cn("text-[10px] font-mono w-10 text-right flex-shrink-0", value >= threshold ? "text-emerald-400" : "text-red-400")}>
                    {value.toFixed(1)}%
                  </span>
                  <span className="text-[8px] text-muted-foreground flex-shrink-0">≥{threshold}</span>
                </div>
              ))}
            </div>
            <div className="mt-2.5 pt-2 border-t border-white/5">
              <div className="flex items-center justify-between text-[10px]">
                <span className="text-muted-foreground">Model agreement</span>
                <span className="text-white">{market.ensemble.agreement}%</span>
              </div>
            </div>
          </div>

          <div className="bg-white/5 rounded-lg p-2.5">
            <p className="text-[10px] text-muted-foreground mb-2.5">MATCHES / DIFFERS Model (8-model ensemble)</p>
            <div className="space-y-1.5">
              <div className="flex justify-between text-[10px]">
                <span className="text-muted-foreground">Dominant signal</span>
                <span className={cn("font-bold", SIGNAL_COLORS[market.md.dominant] || "text-white")}>{market.md.dominant}</span>
              </div>
              <div className="flex justify-between text-[10px]">
                <span className="text-muted-foreground">MATCHES prob</span>
                <span className={market.md.matchesProb >= 22 ? "text-yellow-400" : "text-muted-foreground"}>{market.md.matchesProb}%</span>
              </div>
              <div className="flex justify-between text-[10px]">
                <span className="text-muted-foreground">DIFFERS prob</span>
                <span className={market.md.differsProb >= 82 ? "text-cyan-400" : "text-muted-foreground"}>{market.md.differsProb}%</span>
              </div>
              <div className="flex justify-between text-[10px]">
                <span className="text-muted-foreground">Models for MATCHES</span>
                <span>{market.md.modelsForMatches}/8</span>
              </div>
              <div className="flex justify-between text-[10px]">
                <span className="text-muted-foreground">Models for DIFFERS</span>
                <span>{market.md.modelsForDiffers}/8</span>
              </div>
              <div className="flex justify-between text-[10px]">
                <span className="text-muted-foreground">Ensemble score</span>
                <span>{market.md.ensembleScore}</span>
              </div>
              <div className="flex justify-between text-[10px]">
                <span className="text-muted-foreground">Best MATCHES entry digit</span>
                <span className="font-mono font-bold text-yellow-300">{market.md.matchesEntry}</span>
              </div>
              <div className="flex justify-between text-[10px]">
                <span className="text-muted-foreground">Best DIFFERS avoid digit</span>
                <span className="font-mono font-bold text-cyan-300">{market.md.differsEntry}</span>
              </div>
            </div>
          </div>

          <div className="bg-white/5 rounded-lg p-2.5">
            <p className="text-[10px] text-muted-foreground mb-2.5">Profit Simulation (last 100 ticks)</p>
            <div className="space-y-1.5">
              {ALL_SIGNAL_TYPES.map(t => {
                const sim = market.profitSims[t];
                if (!sim) return (
                  <div key={t} className="flex items-center gap-2">
                    <span className={cn("text-[9px] font-bold w-14 flex-shrink-0 px-1 py-0.5 rounded text-center border", SIGNAL_COLORS[t])}>{t}</span>
                    <span className="text-[10px] text-muted-foreground">N/A — barrier required</span>
                  </div>
                );
                return (
                  <div key={t} className="flex items-center gap-2">
                    <span className={cn("text-[9px] font-bold w-14 flex-shrink-0 px-1 py-0.5 rounded text-center border", SIGNAL_COLORS[t])}>{t}</span>
                    <ScoreBar value={sim.winRate * 100} max={100} color={sim.valid ? "bg-emerald-500" : "bg-red-500/60"} />
                    <span className={cn("text-[10px] font-mono w-12 text-right flex-shrink-0", sim.valid ? "text-emerald-400" : "text-red-400")}>
                      {(sim.winRate * 100).toFixed(1)}%
                    </span>
                    {sim.valid
                      ? <CheckCircle2 className="w-3 h-3 text-emerald-400 flex-shrink-0" />
                      : <XCircle      className="w-3 h-3 text-red-400    flex-shrink-0" />
                    }
                  </div>
                );
              })}
            </div>
          </div>
        </TabsContent>

        {/* SIGNAL GATES TAB */}
        <TabsContent value="gates" className="mt-0 space-y-2">
          <p className="text-[10px] text-muted-foreground">
            Each signal goes through every gate below before it is sent or shown on the dashboard.
            Click a signal to expand the full gate breakdown.
          </p>
          {ALL_SIGNAL_TYPES.map(t => (
            <SignalGateRow key={t} type={t} audit={market.gateAudit[t]} />
          ))}
        </TabsContent>

        {/* MARKOV TAB */}
        <TabsContent value="markov" className="mt-0 space-y-3">
          <div className="bg-white/5 rounded-lg p-2.5">
            <p className="text-[10px] text-muted-foreground mb-2">
              Transition probability matrix — how likely each digit is to follow the current last digit.
              Brighter cells = stronger transition tendency.
            </p>
            <MarkovHeatmap matrix={market.markovMatrix} />
          </div>
          <div className="bg-white/5 rounded-lg p-2.5 space-y-1">
            <p className="text-[10px] text-muted-foreground mb-2">Last signal dispatch times</p>
            {ALL_SIGNAL_TYPES.map(t => {
              const ts = market.lastSignalTimes[t];
              const ago = ts ? Math.round((Date.now() - ts) / 60000) : null;
              return (
                <div key={t} className="flex items-center justify-between text-[10px]">
                  <span className={cn("font-bold px-1 py-0.5 rounded border text-[9px]", SIGNAL_COLORS[t])}>{t}</span>
                  <span className="text-muted-foreground">
                    {ago !== null ? `${ago} min ago` : "Never fired"}
                  </span>
                </div>
              );
            })}
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export function AnalysisPanel() {
  const [data, setData]     = useState<{ markets: MarketSnapshot[]; timestamp: number } | null>(null);
  const [loading, setLoading] = useState(true);
  const [lastFetch, setLastFetch] = useState<Date | null>(null);
  const [filter, setFilter] = useState("");

  const fetchData = useCallback(async () => {
    try {
      const res = await fetch("/api/analysis-inspect");
      if (res.ok) {
        const json = await res.json();
        setData(json);
        setLastFetch(new Date());
      }
    } catch { /* silent */ }
    finally { setLoading(false); }
  }, []);

  useEffect(() => {
    fetchData();
    const iv = setInterval(fetchData, 5000);
    return () => clearInterval(iv);
  }, [fetchData]);

  const markets = (data?.markets ?? []).filter(m =>
    !filter || m.symbol.toLowerCase().includes(filter.toLowerCase()) ||
    m.displayName.toLowerCase().includes(filter.toLowerCase())
  );

  const totalReady = (data?.markets ?? []).flatMap(m =>
    ALL_SIGNAL_TYPES.filter(t => m.gateAudit[t]?.overallPassing)
  ).length;

  return (
    <AppLayout>
      <div className="flex-1 overflow-y-auto p-6 space-y-6">
        {/* Page header */}
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-display font-bold text-white flex items-center gap-2">
              <Cpu className="w-6 h-6 text-primary" />
              Market Analysis Engine
            </h1>
            <p className="text-sm text-muted-foreground mt-1">
              Real-time view of how every market is being analysed and which signals are ready, pending, or filtered out
            </p>
          </div>
          <div className="text-right flex-shrink-0">
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <RefreshCw className="w-3 h-3 animate-spin" style={{ animationDuration: "3s" }} />
              Auto-refreshes every 5s
            </div>
            {lastFetch && <p className="text-[10px] text-muted-foreground mt-0.5">Last: {lastFetch.toLocaleTimeString()}</p>}
          </div>
        </div>

        {/* Stats row */}
        <div className="grid grid-cols-4 gap-3">
          {[
            { icon: Activity, label: "Markets online",   value: data?.markets.length ?? 0,             color: "text-emerald-400" },
            { icon: Zap,      label: "Signals ready",    value: totalReady,                              color: "text-yellow-400" },
            { icon: Shield,   label: "Anomaly markets",  value: (data?.markets ?? []).filter(m => m.anomaly).length, color: "text-red-400" },
            { icon: BarChart2,"label": "Drift markets",  value: (data?.markets ?? []).filter(m => m.drift).length,  color: "text-orange-400" },
          ].map(({ icon: Icon, label, value, color }) => (
            <div key={label} className="bg-card/60 border border-white/10 rounded-xl p-3 flex items-center gap-3">
              <Icon className={cn("w-5 h-5 flex-shrink-0", color)} />
              <div>
                <p className={cn("text-lg font-bold", color)}>{value}</p>
                <p className="text-[10px] text-muted-foreground">{label}</p>
              </div>
            </div>
          ))}
        </div>

        {/* Filter */}
        <div className="flex gap-3 items-center">
          <input
            className="bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white placeholder:text-muted-foreground flex-1 max-w-xs outline-none focus:border-primary/50"
            placeholder="Filter market…"
            value={filter}
            onChange={e => setFilter(e.target.value)}
          />
          {filter && (
            <button onClick={() => setFilter("")} className="text-xs text-muted-foreground hover:text-white transition-colors">
              Clear
            </button>
          )}
          <span className="text-xs text-muted-foreground">{markets.length} market{markets.length !== 1 ? "s" : ""}</span>
        </div>

        {/* Loading state */}
        {loading && (
          <div className="text-center py-16">
            <RefreshCw className="w-8 h-8 text-primary animate-spin mx-auto mb-3" />
            <p className="text-muted-foreground">Loading market analysis data…</p>
            <p className="text-xs text-muted-foreground mt-1">Waiting for at least 10 ticks per market</p>
          </div>
        )}

        {/* Market grid */}
        {!loading && markets.length === 0 && (
          <div className="text-center py-16 text-muted-foreground">
            <AlertTriangle className="w-8 h-8 mx-auto mb-3 text-yellow-400" />
            <p>{filter ? "No markets match the filter" : "No market data yet — waiting for ticks"}</p>
          </div>
        )}

        <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
          {markets.map(m => <MarketCard key={m.symbol} market={m} />)}
        </div>
      </div>
    </AppLayout>
  );
}
