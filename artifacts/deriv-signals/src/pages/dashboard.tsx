import { useGetSignals, useGetSettings } from "@workspace/api-client-react";
import { AppLayout } from "@/components/layout/app-layout";
import { Activity, TrendingUp, Zap, Target, Clock, Radio, Brain } from "lucide-react";
import { AreaChart, Area, ResponsiveContainer, Tooltip, XAxis } from "recharts";
import { SignalCard } from "@/components/signals/signal-card";
import { useLiveSignals } from "@/hooks/use-live-signals";
import { useState, useEffect, useCallback, useRef } from "react";
import { cn, getSignalColorInfo } from "@/lib/utils";
import { format, formatDistanceToNow } from "date-fns";
import { motion } from "framer-motion";

const mockChartData = Array.from({ length: 24 }).map((_, i) => ({
  time: `${i}h`,
  signals: Math.floor(Math.random() * 50) + 15,
  high:    Math.floor(Math.random() * 20) + 5,
}));

/* ── Animated Number ───────────────────────────────────────────── */
function AnimatedNumber({ value, className }: { value: number; className?: string }) {
  const [display, setDisplay] = useState(0);
  const prev = useRef(0);
  useEffect(() => {
    const start = prev.current, diff = value - start, dur = 900, startTime = performance.now();
    const tick = (now: number) => {
      const t = Math.min(1, (now - startTime) / dur);
      const ease = 1 - Math.pow(1 - t, 3);
      setDisplay(Math.round(start + diff * ease));
      if (t < 1) requestAnimationFrame(tick); else prev.current = value;
    };
    requestAnimationFrame(tick);
  }, [value]);
  return <span className={className}>{display.toLocaleString()}</span>;
}

/* ── Status types ──────────────────────────────────────────────── */
interface StatusData {
  nextSignalAt: number;
  intervalMinutes: number;
  markets: Array<{
    symbol: string;
    label: string;
    last: { signalType: string; createdAt: string; confidence: string } | null;
  }>;
}

function useStatus() {
  const [status, setStatus] = useState<StatusData | null>(null);
  const fetch_ = useCallback(async () => {
    try { const r = await fetch("/api/status"); if (r.ok) setStatus(await r.json()); } catch {}
  }, []);
  useEffect(() => { fetch_(); const iv = setInterval(fetch_, 30000); return () => clearInterval(iv); }, [fetch_]);
  return status;
}

function useCountdownToNext(nextSignalAt: number, intervalMinutes: number) {
  const getState = useCallback(() => {
    const now = Date.now(), remaining = Math.max(0, nextSignalAt - now);
    const total = intervalMinutes * 60 * 1000;
    const pct = nextSignalAt > 0 ? Math.min(1, remaining / total) : 0;
    const mm = String(Math.floor(remaining / 60000)).padStart(2, "0");
    const ss = String(Math.floor((remaining % 60000) / 1000)).padStart(2, "0");
    return { remaining, pct, label: `${mm}:${ss}` };
  }, [nextSignalAt, intervalMinutes]);
  const [state, setState] = useState(getState);
  useEffect(() => { const iv = setInterval(() => setState(getState()), 1000); return () => clearInterval(iv); }, [getState]);
  return state;
}

/* ── Hero Countdown ────────────────────────────────────────────── */
function HeroCountdown({ nextSignalAt, intervalMinutes }: { nextSignalAt: number; intervalMinutes: number }) {
  const { pct, label, remaining } = useCountdownToNext(nextSignalAt, intervalMinutes);
  const isUrgent = pct < 0.2 && remaining > 0;
  const isNow    = remaining === 0;

  const size = 160, stroke = 7, r = (size - stroke) / 2;
  const circ = 2 * Math.PI * r;
  const offset = circ * (1 - pct);
  const ringColor = isNow ? "#0ea5e9" : pct > 0.5 ? "#0ea5e9" : pct > 0.2 ? "#f59e0b" : "#FF4FA3";
  const timeColor = isNow ? "text-sky-600" : pct > 0.5 ? "text-sky-600" : pct > 0.2 ? "text-amber-600" : "text-pink-600";

  return (
    <div className="flex flex-col items-center gap-2">
      <div className="relative" style={{ width: size, height: size }}>
        {isUrgent && (
          <>
            <div className="absolute inset-0 rounded-full animate-ping opacity-10" style={{ border: `3px solid ${ringColor}` }} />
            <div className="absolute inset-2 rounded-full animate-ping opacity-8" style={{ border: `2px solid ${ringColor}`, animationDelay: "0.5s" }} />
          </>
        )}
        <svg width={size} height={size} className="-rotate-90">
          <circle cx={size/2} cy={size/2} r={r} fill="none" stroke="rgba(14,165,233,0.10)" strokeWidth={stroke} />
          <circle cx={size/2} cy={size/2} r={r} fill="none" stroke={ringColor} strokeWidth={stroke}
            strokeDasharray={circ} strokeDashoffset={offset} strokeLinecap="round"
            style={{ transition: "stroke-dashoffset 1s linear, stroke 0.5s", filter: `drop-shadow(0 0 6px ${ringColor}80)` }} />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className={cn("font-mono text-3xl font-black tabular-nums", timeColor)}>
            {isNow ? "NOW!" : label}
          </span>
          <span className="text-[9px] text-slate-400 uppercase tracking-widest mt-0.5 font-semibold">next signal</span>
        </div>
      </div>
      <div className="text-center">
        <p className="text-xs text-slate-400 font-medium">Every {intervalMinutes} min</p>
        {nextSignalAt > 0 && (
          <p className="text-[11px] font-mono text-slate-500 mt-0.5">at {format(new Date(nextSignalAt), "HH:mm")} UTC</p>
        )}
      </div>
    </div>
  );
}

/* ── Stat Card ─────────────────────────────────────────────────── */
function StatCard({ label, value, sub, icon: Icon, accentColor, accentGradient }: {
  label: string; value: string | number; sub: string;
  icon: React.ElementType; accentColor: string; accentGradient: string;
}) {
  return (
    <motion.div
      whileHover={{ y: -2, boxShadow: `0 8px 30px ${accentColor}20` }}
      transition={{ duration: 0.2 }}
      className="rounded-2xl p-5 relative overflow-hidden"
      style={{ background: "rgba(255,255,255,0.05)", backdropFilter: "blur(16px)", border: `1px solid ${accentColor}30`, boxShadow: `0 4px 24px ${accentColor}18` }}
    >
      <div className="absolute top-0 left-0 w-1 h-full rounded-l-2xl" style={{ background: accentGradient }} />
      <div className="pl-2">
        <div className="flex items-start justify-between mb-3">
          <p className="text-xs text-slate-400 font-semibold uppercase tracking-wide">{label}</p>
          <div className="w-9 h-9 rounded-xl flex items-center justify-center" style={{ background: `${accentColor}12`, border: `1px solid ${accentColor}20` }}>
            <Icon className="w-4 h-4" style={{ color: accentColor }} />
          </div>
        </div>
        <div className="text-3xl font-display font-black text-slate-800 leading-none mb-2">{value}</div>
        <p className="text-xs text-slate-400">{sub}</p>
      </div>
    </motion.div>
  );
}

/* ── Market Status Grid ────────────────────────────────────────── */
function MarketStatusGrid({ markets }: { markets: StatusData["markets"] }) {
  return (
    <div>
      <div className="flex items-center gap-3 mb-5">
        <div className="w-8 h-8 rounded-xl flex items-center justify-center" style={{ background: "linear-gradient(135deg,rgba(14,165,233,0.12),rgba(255,79,163,0.12))", border: "1px solid rgba(14,165,233,0.20)" }}>
          <Radio className="w-4 h-4 text-sky-500 animate-live-dot" />
        </div>
        <h2 className="text-xl font-display font-bold text-slate-800">Market Pulse</h2>
        <span className="text-xs text-slate-400 ml-1">Last signal per index</span>
        <div className="ml-auto flex items-center gap-1.5 text-[10px] font-semibold text-sky-600 px-2.5 py-1 rounded-full" style={{ background: "rgba(14,165,233,0.08)", border: "1px solid rgba(14,165,233,0.20)" }}>
          <span className="w-1.5 h-1.5 rounded-full bg-sky-500 animate-live-dot" />
          {markets.length} Active
        </div>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {markets.map((m) => {
          const ci = m.last ? getSignalColorInfo(m.last.signalType) : null;
          return (
            <motion.div key={m.symbol} whileHover={{ y: -2 }} transition={{ duration: 0.15 }}
              className={cn("rounded-2xl p-3.5 border transition-all duration-300 cursor-default", ci ? ci.border : "border-slate-200")}
              style={{ background: ci ? `${ci.hex}08` : "rgba(255,255,255,0.04)", backdropFilter: "blur(12px)", boxShadow: ci ? `0 2px 16px ${ci.hex}18` : "none" }}>
              <div className="flex items-center justify-between mb-2">
                <span className="font-mono text-[11px] text-slate-400 font-semibold">{m.symbol}</span>
                {m.last && ci && (
                  <span className={cn("text-[9px] font-bold uppercase px-1.5 py-0.5 rounded-full border", ci.bg, ci.border, ci.color)}>
                    {m.last.signalType}
                  </span>
                )}
              </div>
              <div className="font-display font-bold text-xs text-slate-700 truncate mb-2">
                {m.label.replace(" (1s)", "")}
              </div>
              {m.last
                ? <div className="text-[10px] text-slate-400">{formatDistanceToNow(new Date(m.last.createdAt), { addSuffix: true })}</div>
                : <div className="text-[10px] text-slate-300 italic">No signal yet</div>
              }
            </motion.div>
          );
        })}
      </div>
    </div>
  );
}

/* ── Chart ─────────────────────────────────────────────────────── */
function SignalActivityChart() {
  return (
    <div className="rounded-2xl p-5 relative overflow-hidden"
      style={{ background: "rgba(255,255,255,0.05)", backdropFilter: "blur(16px)", border: "1px solid rgba(14,165,233,0.18)", boxShadow: "0 4px 24px rgba(14,165,233,0.12)" }}>
      <div className="flex items-center justify-between mb-4">
        <div>
          <p className="text-xs text-slate-400 uppercase tracking-wide font-semibold mb-1">Signal Activity</p>
          <p className="text-sm font-bold text-slate-700">24-Hour Overview</p>
        </div>
        <div className="flex gap-4 text-[10px] text-slate-400">
          {[
            { label: "OVER/UNDER", color: "#059669" }, { label: "RISE/FALL", color: "#0ea5e9" },
            { label: "EVEN/ODD",   color: "#7c3aed" }, { label: "M/D",       color: "#0f766e" },
          ].map(({ label, color }) => (
            <div key={label} className="flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full" style={{ backgroundColor: color }} />
              <span>{label}</span>
            </div>
          ))}
        </div>
      </div>
      <div className="h-28">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={mockChartData} margin={{ top: 4, right: 0, left: 0, bottom: 0 }}>
            <defs>
              <linearGradient id="chartGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%"  stopColor="#0ea5e9" stopOpacity={0.22} />
                <stop offset="95%" stopColor="#0ea5e9" stopOpacity={0}    />
              </linearGradient>
            </defs>
            <XAxis dataKey="time" hide />
            <Tooltip
              contentStyle={{ backgroundColor: "rgba(8,12,32,0.95)", borderColor: "rgba(14,165,233,0.25)", borderRadius: "12px", fontSize: "11px", color: "#c4d4e8", boxShadow: "0 4px 24px rgba(14,165,233,0.20)" }}
              itemStyle={{ color: "#38bdf8" }}
            />
            <Area type="monotone" dataKey="signals" stroke="#0ea5e9" strokeWidth={2.5}
              fill="url(#chartGrad)" dot={false}
              style={{ filter: "drop-shadow(0 2px 6px rgba(14,165,233,0.30))" }} />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

/* ── Dashboard ─────────────────────────────────────────────────── */
export function Dashboard() {
  const { data: initialSignals, isLoading: signalsLoading } = useGetSignals({ limit: 6 });
  const { data: settings } = useGetSettings();
  const status = useStatus();
  const { signals } = useLiveSignals(initialSignals || []);
  const recentSignals = signals.slice(0, 3);
  const isRunning = settings?.isRunning ?? false;

  return (
    <AppLayout>
      <div className="space-y-6">

        {/* ── Hero Countdown (full-width prominent card) ── */}
        <div className="gradient-border-card p-6">
          <div className="flex flex-col md:flex-row gap-6 items-center">
            {/* Countdown */}
            <div className="flex flex-col items-center gap-3 md:pr-6 md:border-r" style={{ borderColor: "rgba(14,165,233,0.15)" }}>
              <div className="flex items-center gap-2 mb-1">
                <div className="w-7 h-7 rounded-lg flex items-center justify-center" style={{ background: "linear-gradient(135deg,rgba(14,165,233,0.12),rgba(255,79,163,0.12))", border: "1px solid rgba(14,165,233,0.22)" }}>
                  <Clock className="w-4 h-4 text-sky-500" />
                </div>
                <span className="text-sm font-bold text-slate-600 uppercase tracking-widest">Next Signal</span>
              </div>
              {status
                ? <HeroCountdown nextSignalAt={status.nextSignalAt} intervalMinutes={status.intervalMinutes} />
                : <div className="w-40 h-40 rounded-full flex items-center justify-center animate-pulse" style={{ border: "4px solid rgba(14,165,233,0.12)" }}>
                    <Clock className="w-10 h-10 text-slate-300" />
                  </div>
              }
            </div>

            {/* Stats 2×2 */}
            <div className="grid grid-cols-2 gap-3 flex-1 w-full">
              <StatCard label="Total Signals (24h)" value={1284} sub="+12.5% vs yesterday"
                icon={Activity} accentColor="#0ea5e9" accentGradient="linear-gradient(180deg,#0ea5e9,#38bdf8)" />

              <StatCard label="Active Markets" value={settings?.selectedMarkets?.length || 13} sub="Currently monitoring ticks"
                icon={Target} accentColor="#7c3aed" accentGradient="linear-gradient(180deg,#7c3aed,#a78bfa)" />

              <StatCard
                label="Bot Status"
                value={isRunning ? "Running" : "Stopped"}
                sub={settings?.enableTelegram ? "Telegram + WhatsApp active" : "Telegram alerts disabled"}
                icon={Zap}
                accentColor={isRunning ? "#059669" : "#94a3b8"}
                accentGradient={isRunning ? "linear-gradient(180deg,#059669,#10b981)" : "linear-gradient(180deg,#94a3b8,#cbd5e1)"}
              />

              <div className="rounded-2xl p-4 flex flex-col justify-center items-center gap-1 relative overflow-hidden"
                style={{ background: "linear-gradient(135deg,rgba(14,165,233,0.08),rgba(255,79,163,0.08))", border: "1px solid rgba(14,165,233,0.18)", boxShadow: "0 4px 16px rgba(14,165,233,0.06)" }}>
                <Brain className="w-5 h-5 mb-1" style={{ color: "#FF4FA3" }} />
                <span className="text-2xl font-display font-black text-slate-800">8</span>
                <span className="text-[10px] text-slate-400 font-semibold uppercase tracking-wide text-center">Signal Types</span>
                <div className="mt-1 text-[9px] font-bold tracking-widest px-2 py-0.5 rounded-full"
                  style={{ background: "linear-gradient(90deg,rgba(14,165,233,0.12),rgba(255,79,163,0.12))", border: "1px solid rgba(14,165,233,0.20)", color: "#0ea5e9" }}>
                  AI POWERED
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* ── Chart ── */}
        <SignalActivityChart />

        {/* ── Market Pulse ── */}
        {status?.markets && <MarketStatusGrid markets={status.markets} />}

        {/* ── Recent Signals ── */}
        <div>
          <div className="flex items-center justify-between mb-5">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-xl flex items-center justify-center" style={{ background: "linear-gradient(135deg,#0ea5e9,#FF4FA3)" }}>
                <Zap className="w-4 h-4 text-white" />
              </div>
              <div>
                <h2 className="text-xl font-display font-bold text-slate-800">Recent Signals</h2>
                <p className="text-xs text-slate-400">Live · updates automatically</p>
              </div>
            </div>
            <div className="flex items-center gap-1.5 text-[11px] font-semibold text-sky-600 px-3 py-1.5 rounded-full"
              style={{ background: "rgba(14,165,233,0.08)", border: "1px solid rgba(14,165,233,0.20)" }}>
              <span className="w-1.5 h-1.5 rounded-full bg-sky-500 animate-live-dot" />
              Real-time feed
            </div>
          </div>

          {signalsLoading ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
              {[1,2,3].map(i => <div key={i} className="h-64 rounded-2xl animate-pulse" style={{ background: "rgba(14,165,233,0.06)", border: "1px solid rgba(14,165,233,0.12)" }} />)}
            </div>
          ) : recentSignals.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-44 rounded-2xl border-2 border-dashed border-sky-200"
              style={{ background: "rgba(14,165,233,0.04)" }}>
              <Activity className="w-10 h-10 mb-3 text-sky-300" />
              <p className="text-sm font-semibold text-slate-500">Waiting for first signal…</p>
              <p className="text-xs text-slate-400 mt-1">Markets are being monitored</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
              {recentSignals.map((signal, index) => (
                <SignalCard key={signal.id} signal={signal} animate={index === 0} />
              ))}
            </div>
          )}
        </div>

      </div>
    </AppLayout>
  );
}
