import { useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";

// ── Tip data ──────────────────────────────────────────────────────────────────
const TIPS = [
  {
    icon: "🎯",
    headline: "Discipline is your edge",
    body: "Run 3–7 trades per session, step back, recheck the entry, then continue. The traders who last are the ones who stay consistent.",
  },
  {
    icon: "⚡",
    headline: "You're always ahead",
    body: "Elite Signals processes thousands of ticks per second across 13 live markets — so you can focus on executing, not calculating.",
  },
  {
    icon: "📊",
    headline: "More markets, more moments",
    body: "With Volatility, Jump, Boom, Crash, Forex and more, fresh opportunities appear every 20 minutes. Stay ready.",
  },
  {
    icon: "🧠",
    headline: "AI does the reading — you take the trade",
    body: "Our engine watches pattern shifts in real time and surfaces the highest-probability setups. Your job is simply to act on them.",
  },
  {
    icon: "💎",
    headline: "Patience pays more than speed",
    body: "The best entry is a confirmed one. Each signal card shows you exactly what to watch for before activating your bot.",
  },
  {
    icon: "🔄",
    headline: "Check in, stay aligned",
    body: "Markets shift every 20 minutes. A quick glance when you return keeps you trading with the current rhythm, not against it.",
  },
  {
    icon: "🚀",
    headline: "Your signals never sleep",
    body: "Even when you step away, signals are being generated across all markets 24/7. Every return is a fresh opportunity.",
  },
  {
    icon: "🏆",
    headline: "Consistent small wins compound fast",
    body: "You don't need every trade to be perfect. Follow the entry guides, stick to 3–7 runs, and let compounding do the rest.",
  },
];

// ── Particles (subtle dot floaters) ──────────────────────────────────────────
const PARTICLES = Array.from({ length: 18 }, (_, i) => ({
  id: i,
  x: (i * 5.7 + Math.sin(i * 2.1) * 9) % 100,
  size: 3 + (i % 4) * 2,
  delay: (i * 0.31) % 5,
  dur: 5 + (i % 5) * 1.2,
  color: i % 3 === 0 ? "#38bdf8" : i % 3 === 1 ? "#FF4FA3" : "#a855f7",
}));

function FloatingParticles() {
  return (
    <div className="absolute inset-0 overflow-hidden pointer-events-none select-none">
      {PARTICLES.map((p) => (
        <motion.div
          key={p.id}
          className="absolute rounded-full opacity-30"
          style={{ left: `${p.x}%`, bottom: -20, width: p.size, height: p.size, backgroundColor: p.color }}
          animate={{ y: [0, -900] }}
          transition={{ duration: p.dur, repeat: Infinity, ease: "linear", delay: p.delay }}
        />
      ))}
    </div>
  );
}

// ── Candlestick chart (same as admin, dark-themed) ────────────────────────────
const CANDLES = [
  { h: 32, body: 20, bull: true  }, { h: 48, body: 30, bull: false },
  { h: 24, body: 16, bull: true  }, { h: 56, body: 36, bull: true  },
  { h: 40, body: 26, bull: false }, { h: 64, body: 42, bull: true  },
  { h: 50, body: 34, bull: true  }, { h: 36, body: 22, bull: false },
  { h: 68, body: 44, bull: true  }, { h: 52, body: 34, bull: false },
  { h: 44, body: 28, bull: true  }, { h: 30, body: 18, bull: false },
];

function CandleChart() {
  const [revealed, setRevealed] = useState(0);
  useEffect(() => {
    const iv = setInterval(() => setRevealed((p) => Math.min(p + 1, CANDLES.length)), 180);
    return () => clearInterval(iv);
  }, []);
  return (
    <div className="flex items-end gap-1.5 h-14 px-1 w-full">
      {CANDLES.map((c, i) => (
        <motion.div
          key={i}
          className="flex flex-col items-center flex-1"
          style={{ transformOrigin: "bottom" }}
          initial={{ scaleY: 0, opacity: 0 }}
          animate={i < revealed ? { scaleY: 1, opacity: 0.9 } : {}}
          transition={{ duration: 0.22, ease: "backOut" }}
        >
          <div className="w-px rounded-full" style={{ height: (c.h - c.body) / 2, backgroundColor: c.bull ? "#38bdf8" : "#FF4FA3" }} />
          <div className="w-full rounded-sm" style={{ height: c.body, backgroundColor: c.bull ? "rgba(56,189,248,0.25)" : "rgba(255,79,163,0.25)", border: `1px solid ${c.bull ? "#38bdf8" : "#FF4FA3"}` }} />
          <div className="w-px rounded-full" style={{ height: c.h / 5, backgroundColor: c.bull ? "#38bdf8" : "#FF4FA3" }} />
        </motion.div>
      ))}
    </div>
  );
}

// ── Ticker tape ───────────────────────────────────────────────────────────────
const TICKERS = [
  { sym: "EURUSD", val: "1.0842", up: true  }, { sym: "GBPUSD", val: "1.2654", up: false },
  { sym: "XAUUSD", val: "2341.5", up: true  }, { sym: "VOL100", val: "1234.0", up: false },
  { sym: "JUMP50", val: "5671.2", up: true  }, { sym: "VOL75",  val: "892.44", up: true  },
  { sym: "JUMP25", val: "3102.9", up: false }, { sym: "JD100",  val: "9823.1", up: false },
  { sym: "USDJPY", val: "149.82", up: true  }, { sym: "VOL25",  val: "451.22", up: true  },
];
const TAPE = [...TICKERS, ...TICKERS, ...TICKERS];

function TickerTape({ pos }: { pos: "top" | "bottom" }) {
  return (
    <div
      className={`absolute ${pos === "top" ? "top-0" : "bottom-0"} left-0 right-0 h-8 flex items-center overflow-hidden`}
      style={{
        background: "rgba(8,12,32,0.70)",
        backdropFilter: "blur(8px)",
        borderBottom: pos === "top" ? "1px solid rgba(56,189,248,0.12)" : undefined,
        borderTop:    pos === "bottom" ? "1px solid rgba(56,189,248,0.12)" : undefined,
      }}
    >
      <div className="ticker-track flex items-center whitespace-nowrap">
        {TAPE.map((t, i) => (
          <span key={i} className="flex items-center gap-1.5 px-4 border-r border-white/10">
            <span className="text-[10px] font-mono font-bold" style={{ color: "#4a607a" }}>{t.sym}</span>
            <span className={`text-[10px] font-mono font-bold ${t.up ? "text-sky-400" : "text-pink-400"}`}>
              {t.up ? "▲" : "▼"} {t.val}
            </span>
          </span>
        ))}
      </div>
    </div>
  );
}

// ── Tip carousel ──────────────────────────────────────────────────────────────
function TipCarousel() {
  const [idx, setIdx] = useState(0);
  useEffect(() => {
    const iv = setInterval(() => setIdx((p) => (p + 1) % TIPS.length), 2800);
    return () => clearInterval(iv);
  }, []);
  const tip = TIPS[idx];
  return (
    <div className="w-full relative" style={{ minHeight: 88 }}>
      <AnimatePresence mode="wait">
        <motion.div
          key={idx}
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -10 }}
          transition={{ duration: 0.45, ease: "easeInOut" }}
          className="w-full rounded-2xl px-4 py-3.5"
          style={{
            background: "rgba(56,189,248,0.05)",
            border: "1px solid rgba(56,189,248,0.14)",
          }}
        >
          <div className="flex items-start gap-3">
            <span className="text-2xl leading-none flex-shrink-0 mt-0.5">{tip.icon}</span>
            <div>
              <p className="text-[11px] font-bold mb-1" style={{ color: "#38bdf8" }}>{tip.headline}</p>
              <p className="text-[11px] leading-snug" style={{ color: "#6b84a8" }}>{tip.body}</p>
            </div>
          </div>
        </motion.div>
      </AnimatePresence>

      {/* Dot indicators */}
      <div className="flex items-center justify-center gap-1.5 mt-2.5">
        {TIPS.map((_, i) => (
          <div
            key={i}
            className="rounded-full transition-all duration-300"
            style={{
              width: i === idx ? 14 : 5,
              height: 5,
              background: i === idx ? "#38bdf8" : "rgba(56,189,248,0.20)",
            }}
          />
        ))}
      </div>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────
const MIN_SHOW_MS = 2600;

export function SubscriberSplash({ ready, onDone }: { ready: boolean; onDone: () => void }) {
  const [visible, setVisible] = useState(true);
  const readyTime = useRef<number | null>(null);
  const minMet = useRef(false);

  // Track when minimum display time is met
  useEffect(() => {
    const t = setTimeout(() => {
      minMet.current = true;
      // If already ready, fade out now
      if (readyTime.current !== null) dismiss();
    }, MIN_SHOW_MS);
    return () => clearTimeout(t);
  }, []);

  // When auth check finishes
  useEffect(() => {
    if (!ready) return;
    readyTime.current = Date.now();
    if (minMet.current) dismiss();
  }, [ready]);

  function dismiss() {
    setVisible(false);
    setTimeout(onDone, 550);
  }

  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          className="fixed inset-0 z-[999] flex flex-col items-center justify-center overflow-hidden"
          style={{ background: "hsl(228 48% 7%)" }}
          initial={{ opacity: 1 }}
          exit={{ opacity: 0, scale: 1.02 }}
          transition={{ duration: 0.55, ease: "easeInOut" }}
        >
          {/* Ambient glows */}
          <div className="absolute top-[-10%] left-[-5%] w-[500px] h-[500px] rounded-full pointer-events-none"
            style={{ background: "radial-gradient(circle,rgba(14,165,233,0.18),transparent 65%)", filter: "blur(80px)" }} />
          <div className="absolute bottom-[-10%] right-[-5%] w-[500px] h-[500px] rounded-full pointer-events-none"
            style={{ background: "radial-gradient(circle,rgba(255,79,163,0.13),transparent 65%)", filter: "blur(80px)" }} />

          <FloatingParticles />
          <TickerTape pos="top" />

          {/* Center card */}
          <motion.div
            className="relative z-10 flex flex-col items-center gap-4 px-6 py-7 rounded-3xl mx-4"
            style={{
              background: "rgba(255,255,255,0.04)",
              backdropFilter: "blur(28px)",
              border: "1px solid rgba(56,189,248,0.14)",
              boxShadow: "0 8px 60px rgba(14,165,233,0.12), 0 1px 0 rgba(255,255,255,0.06) inset",
              maxWidth: 380,
              width: "100%",
            }}
            initial={{ opacity: 0, scale: 0.88, y: 28 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            transition={{ delay: 0.12, duration: 0.65, ease: [0.34, 1.56, 0.64, 1] }}
          >
            {/* Logo */}
            <motion.div
              className="rounded-2xl overflow-hidden"
              initial={{ scale: 0.65, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={{ delay: 0.28, duration: 0.55, ease: "backOut" }}
            >
              <img src="/logo.png" alt="Elite Signals" className="w-16 h-16 object-contain" />
            </motion.div>

            {/* Brand name */}
            <motion.div
              className="flex flex-col items-center gap-1"
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.45, duration: 0.5 }}
            >
              <h1
                className="text-3xl font-display font-black tracking-wide"
                style={{
                  background: "linear-gradient(135deg,#38bdf8,#a855f7,#FF4FA3)",
                  WebkitBackgroundClip: "text",
                  WebkitTextFillColor: "transparent",
                  backgroundClip: "text",
                }}
              >
                ELITE SIGNALS
              </h1>
              <div className="flex items-center gap-1.5 px-3 py-1 rounded-full"
                style={{ background: "rgba(56,189,248,0.08)", border: "1px solid rgba(56,189,248,0.18)" }}>
                <span className="w-1.5 h-1.5 rounded-full bg-sky-400 animate-pulse" />
                <span className="text-[10px] font-bold tracking-widest uppercase"
                  style={{ background: "linear-gradient(90deg,#38bdf8,#FF4FA3)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent" }}>
                  AI Powered · Live
                </span>
              </div>
            </motion.div>

            {/* Candle chart */}
            <motion.div
              className="w-full"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.55, duration: 0.5 }}
            >
              <CandleChart />
            </motion.div>

            {/* Tip carousel */}
            <motion.div
              className="w-full"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.7, duration: 0.5 }}
            >
              <TipCarousel />
            </motion.div>

            {/* Progress bar */}
            <motion.div
              className="w-full"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.4, duration: 0.4 }}
            >
              <div className="h-1 w-full rounded-full overflow-hidden" style={{ background: "rgba(56,189,248,0.10)" }}>
                <motion.div
                  className="h-full rounded-full"
                  style={{ background: "linear-gradient(90deg,#38bdf8,#a855f7,#FF4FA3)" }}
                  initial={{ width: "0%" }}
                  animate={{ width: "100%" }}
                  transition={{ delay: 0.4, duration: MIN_SHOW_MS / 1000 - 0.4, ease: "linear" }}
                />
              </div>
              <motion.p
                className="text-center mt-2 text-[9px] tracking-[0.32em] uppercase"
                style={{ color: "#2d3f58" }}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: 1.0, duration: 0.5 }}
              >
                Connecting to live markets…
              </motion.p>
            </motion.div>
          </motion.div>

          <TickerTape pos="bottom" />
        </motion.div>
      )}
    </AnimatePresence>
  );
}
