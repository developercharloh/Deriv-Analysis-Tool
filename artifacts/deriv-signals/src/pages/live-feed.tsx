import { AppLayout } from "@/components/layout/app-layout";
import { useLiveSignals } from "@/hooks/use-live-signals";
import { useGetSignals } from "@workspace/api-client-react";
import { SignalCard } from "@/components/signals/signal-card";
import { RadioReceiver, Zap, Activity, Wifi, WifiOff } from "lucide-react";
import { AnimatePresence, motion } from "framer-motion";
import { useState, useEffect } from "react";

function useSignalFlash(signals: unknown[]) {
  const [prev, setPrev] = useState(signals.length);
  const [flash, setFlash] = useState(false);
  useEffect(() => {
    if (signals.length > prev) { setFlash(true); setTimeout(() => setFlash(false), 600); }
    setPrev(signals.length);
  }, [signals.length]);
  return { flash };
}

function TerminalWaiting() {
  const [cursor, setCursor] = useState(true);
  const [lines, setLines] = useState<string[]>([]);
  const bootLines = [
    "> Connecting to Deriv WebSocket…",
    "> Stream established. Monitoring 13 markets.",
    "> CUSUM threshold: h=6 active.",
    "> Awaiting tick data…",
    "> Analysing digit patterns…",
  ];
  useEffect(() => {
    const ci = setInterval(() => setCursor(c => !c), 530);
    let i = 0;
    const li = setInterval(() => { if (i < bootLines.length) { setLines(p => [...p, bootLines[i]]); i++; } else clearInterval(li); }, 600);
    return () => { clearInterval(ci); clearInterval(li); };
  }, []);
  return (
    <div className="col-span-full">
      <div className="rounded-2xl border overflow-hidden" style={{ borderColor: "rgba(14,165,233,0.20)", background: "rgba(255,255,255,0.70)", backdropFilter: "blur(16px)", boxShadow: "0 4px 24px rgba(14,165,233,0.08)" }}>
        <div className="flex items-center gap-2 px-4 py-3 border-b border-sky-100" style={{ background: "rgba(240,249,255,0.60)" }}>
          <div className="flex gap-1.5">
            <div className="w-3 h-3 rounded-full bg-pink-400/70" />
            <div className="w-3 h-3 rounded-full bg-amber-400/70" />
            <div className="w-3 h-3 rounded-full bg-sky-400/70" />
          </div>
          <span className="text-[10px] font-mono text-slate-400 mx-auto tracking-widest uppercase">elite-signals — signal-monitor</span>
        </div>
        <div className="p-6 font-mono min-h-48">
          <AnimatePresence>
            {lines.map((line, i) => (
              <motion.div key={i} initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }} transition={{ duration: 0.25 }} className="text-xs mb-1.5">
                <span className="text-sky-400">&gt;</span>
                <span className="text-slate-600 ml-2">{line.replace('> ', '')}</span>
              </motion.div>
            ))}
          </AnimatePresence>
          <div className="text-xs text-sky-500 mt-1 flex items-center gap-1">
            <span className="text-sky-400">&gt;</span>
            <span className="ml-2 text-slate-500">Scanning ticks</span>
            {cursor && <span className="inline-block w-2 h-3.5 ml-0.5 rounded-sm" style={{ backgroundColor: "#0ea5e9" }} />}
          </div>
        </div>
        <div className="px-6 pb-5 flex items-center gap-3">
          <RadioReceiver className="w-5 h-5 text-sky-500 animate-pulse" />
          <div className="flex-1 h-[2px] rounded-full overflow-hidden" style={{ background: "rgba(14,165,233,0.10)" }}>
            <motion.div className="h-full rounded-full" style={{ background: "linear-gradient(90deg,#0ea5e9,#FF4FA3)" }}
              animate={{ x: ["-100%", "100%"] }} transition={{ duration: 2, repeat: Infinity, ease: "easeInOut" }} />
          </div>
          <span className="text-[10px] font-mono text-slate-400">MONITORING</span>
        </div>
      </div>
    </div>
  );
}

export function LiveFeed() {
  const { data: initialSignals } = useGetSignals({ limit: 50 });
  const { signals, isConnected } = useLiveSignals(initialSignals || []);
  const { flash } = useSignalFlash(signals);

  return (
    <AppLayout>
      <div className="flex flex-col min-h-0">

        {/* ── Header ── */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-5 flex-shrink-0">
          <div className="min-w-0">
            <div className="flex items-center gap-3 mb-1">
              <h1 className="text-2xl sm:text-3xl font-display font-black text-slate-800">Live Stream</h1>
              <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-bold tracking-widest uppercase flex-shrink-0"
                style={{ background: "rgba(14,165,233,0.10)", border: "1px solid rgba(14,165,233,0.25)", color: "#0ea5e9" }}>
                <span className="w-1.5 h-1.5 rounded-full bg-sky-500 animate-live-dot" />
                LIVE
              </div>
            </div>
            <p className="text-sm text-slate-400">Real-time signals across 13 markets</p>
          </div>

          <motion.div animate={flash ? { scale: [1, 1.05, 1] } : {}} transition={{ duration: 0.3 }}
            className="flex items-center gap-2 px-3 py-2 rounded-xl self-start sm:self-auto flex-shrink-0"
            style={{
              background: isConnected ? "rgba(14,165,233,0.08)" : "rgba(239,68,68,0.06)",
              border: `1px solid ${isConnected ? "rgba(14,165,233,0.25)" : "rgba(239,68,68,0.20)"}`,
            }}>
            {isConnected ? <Wifi className="w-3.5 h-3.5 text-sky-500 flex-shrink-0" /> : <WifiOff className="w-3.5 h-3.5 text-red-400 flex-shrink-0" />}
            <div>
              <div className={`text-[10px] font-bold tracking-wide ${isConnected ? "text-sky-600" : "text-red-500"}`}>
                {isConnected ? "CONNECTED" : "DISCONNECTED"}
              </div>
              {isConnected && <div className="text-[9px] text-slate-400">{signals.length} captured</div>}
            </div>
          </motion.div>
        </div>

        {/* ── Disconnected alert ── */}
        {!isConnected && (
          <div className="mb-4 rounded-xl p-4 flex items-start gap-3 flex-shrink-0"
            style={{ background: "rgba(239,68,68,0.06)", border: "1px solid rgba(239,68,68,0.18)" }}>
            <WifiOff className="w-4 h-4 text-red-400 mt-0.5 flex-shrink-0" />
            <div>
              <p className="text-sm font-bold text-red-500">Connection Lost</p>
              <p className="text-xs text-slate-500 mt-0.5">Lost connection to the live stream. Attempting to reconnect…</p>
            </div>
          </div>
        )}

        {/* ── Stats strip ── */}
        {isConnected && signals.length > 0 && (
          <div className="grid grid-cols-3 gap-2 mb-4 flex-shrink-0">
            {[
              { label: "Captured",   value: signals.length,                                          color: "#0ea5e9", icon: <Activity className="w-3 h-3" /> },
              { label: "HIGH Conf.", value: signals.filter(s => s.confidence === "HIGH").length,     color: "#059669", icon: <Zap className="w-3 h-3" /> },
              { label: "Types",      value: new Set(signals.map(s => s.signalType)).size,            color: "#7c3aed", icon: <RadioReceiver className="w-3 h-3" /> },
            ].map(({ label, value, color, icon }) => (
              <div key={label} className="rounded-xl px-2.5 py-2 flex items-center gap-2"
                style={{ background: `${color}08`, border: `1px solid ${color}20`, backdropFilter: "blur(12px)" }}>
                <div className="w-6 h-6 rounded-md flex items-center justify-center flex-shrink-0"
                  style={{ background: `${color}14`, color }}>
                  {icon}
                </div>
                <div className="min-w-0">
                  <div className="text-base font-mono font-black leading-none" style={{ color }}>{value}</div>
                  <div className="text-[8px] text-slate-400 uppercase tracking-wide leading-tight mt-0.5 truncate font-semibold">{label}</div>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* ── Signal Grid ── */}
        <div className="flex-1 overflow-y-auto pr-1 -mr-1">
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4 pb-20">
            <AnimatePresence>
              {signals.length === 0 && isConnected
                ? <TerminalWaiting />
                : signals.map((signal) => <SignalCard key={signal.id} signal={signal} animate />)
              }
            </AnimatePresence>
          </div>
        </div>

      </div>
    </AppLayout>
  );
}
