import { Link, useLocation } from "wouter";
import { Activity, BarChart3, Settings, RadioReceiver, Users, Bot, Cpu } from "lucide-react";
import { cn } from "@/lib/utils";
import { motion, AnimatePresence } from "framer-motion";
import { useEffect, useRef, useState } from "react";

const navItems = [
  { icon: BarChart3,     label: "Dashboard",     path: "/" },
  { icon: RadioReceiver, label: "Live Feed",      path: "/feed" },
  { icon: Activity,      label: "History",        path: "/history" },
  { icon: Users,         label: "Subscribers",    path: "/subscribers" },
  { icon: Bot,           label: "Bot Settings",   path: "/bot-settings" },
  { icon: Cpu,           label: "Analysis Panel", path: "/analysis" },
  { icon: Settings,      label: "Settings",       path: "/settings" },
];

const CANDLES = [
  { h: 28, body: 18, bull: false }, { h: 42, body: 26, bull: true  },
  { h: 22, body: 14, bull: false }, { h: 52, body: 34, bull: true  },
  { h: 38, body: 24, bull: false }, { h: 60, body: 40, bull: true  },
  { h: 46, body: 30, bull: true  }, { h: 32, body: 20, bull: false },
  { h: 64, body: 42, bull: true  }, { h: 50, body: 32, bull: true  },
  { h: 36, body: 22, bull: false },
];
const TICKERS = [
  { sym: "EURUSD", val: "1.0842", up: true  }, { sym: "GBPUSD", val: "1.2654", up: false },
  { sym: "XAUUSD", val: "2341.5", up: true  }, { sym: "VOL100", val: "1234.0", up: false },
  { sym: "JUMP50", val: "5671.2", up: true  }, { sym: "VOL75",  val: "892.44", up: true  },
];

function ForexAnimation() {
  const [tickIdx, setTickIdx] = useState(0);
  const [candleReveal, setCandleReveal] = useState(0);
  const [lineProgress, setLineProgress] = useState(0);

  useEffect(() => {
    const ci = setInterval(() => setCandleReveal(p => { if (p >= CANDLES.length) { clearInterval(ci); return p; } return p + 1; }), 150);
    const li = setInterval(() => setLineProgress(p => { if (p >= 100) { clearInterval(li); return 100; } return p + 2; }), 50);
    const ti = setInterval(() => setTickIdx(i => (i + 1) % TICKERS.length), 1400);
    return () => { clearInterval(ci); clearInterval(li); clearInterval(ti); };
  }, []);

  const t = TICKERS[tickIdx];

  return (
    <div className="rounded-2xl overflow-hidden border border-sky-100 p-3"
      style={{ background: "rgba(255,255,255,0.04)", backdropFilter: "blur(12px)" }}>
      <div className="flex items-center justify-between mb-2">
        <AnimatePresence mode="wait">
          <motion.div key={tickIdx} initial={{ opacity: 0, y: 5 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -5 }} transition={{ duration: 0.3 }} className="flex items-center gap-2">
            <span className="text-[10px] font-bold tracking-wider text-slate-500">{t.sym}</span>
            <span className={cn("text-xs font-mono font-bold", t.up ? "text-sky-600" : "text-pink-600")}>{t.val}</span>
            <span className={cn("text-[10px]", t.up ? "text-sky-600" : "text-pink-600")}>{t.up ? "▲" : "▼"}</span>
          </motion.div>
        </AnimatePresence>
        <div className="flex gap-0.5 items-end">
          {[...Array(3)].map((_, i) => (
            <motion.div key={i} className="w-1 rounded-full" style={{ backgroundColor: "#0ea5e9" }}
              animate={{ height: [4, 12, 6, 16, 8][i % 5] }}
              transition={{ repeat: Infinity, duration: 0.6 + i * 0.2, repeatType: "reverse" }} />
          ))}
        </div>
      </div>

      <div className="relative h-16 flex items-end gap-[3px] px-1">
        <div className="absolute bottom-4 left-1 h-[2px] rounded-full transition-all duration-100"
          style={{ width: `${lineProgress}%`, transform: "rotate(-10deg)", transformOrigin: "left bottom", background: "linear-gradient(90deg,#0ea5e9,#a855f7)" }} />
        {CANDLES.map((c, i) => (
          <motion.div key={i} initial={{ scaleY: 0, opacity: 0 }}
            animate={i < candleReveal ? { scaleY: 1, opacity: 1 } : {}}
            transition={{ duration: 0.2, ease: "backOut" }}
            style={{ transformOrigin: "bottom" }} className="flex flex-col items-center justify-end flex-1">
            <div className="w-px rounded-full" style={{ height: (c.h - c.body) / 2, backgroundColor: c.bull ? "#0ea5e9" : "#FF4FA3" }} />
            <div className="w-full rounded-sm border" style={{ height: c.body, backgroundColor: c.bull ? "rgba(14,165,233,0.20)" : "rgba(255,79,163,0.20)", borderColor: c.bull ? "#0ea5e9" : "#FF4FA3" }} />
            <div className="w-px rounded-full" style={{ height: c.h / 5, backgroundColor: c.bull ? "#0ea5e9" : "#FF4FA3" }} />
          </motion.div>
        ))}
      </div>

      <div className="mt-2 flex items-center gap-1.5">
        <div className="w-1.5 h-1.5 rounded-full bg-sky-500 animate-live-dot" />
        <span className="text-[10px] text-slate-500 tracking-widest uppercase">Live Markets</span>
      </div>
    </div>
  );
}

function SidebarBottom() {
  const [showForex, setShowForex] = useState(true);
  useEffect(() => { const t = setTimeout(() => setShowForex(false), 8000); return () => clearTimeout(t); }, []);
  return (
    <div className="p-4 border-t border-sky-100">
      <AnimatePresence mode="wait">
        {showForex ? (
          <motion.div key="forex" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} transition={{ duration: 0.4 }}>
            <ForexAnimation />
          </motion.div>
        ) : (
          <motion.div key="status" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4 }}
            className="rounded-2xl p-4 border border-sky-100"
            style={{ background: "rgba(255,255,255,0.04)", backdropFilter: "blur(8px)" }}>
            <div className="flex items-center gap-3 mb-2">
              <div className="w-2 h-2 rounded-full bg-sky-500 animate-live-dot" />
              <span className="text-sm font-semibold text-slate-700">System Online</span>
            </div>
            <p className="text-xs text-slate-500">Listening for Deriv WebSocket ticks.</p>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

export function Sidebar() {
  const [location] = useLocation();
  return (
    <aside className="w-64 h-screen hidden md:flex flex-col flex-shrink-0 z-50 fixed left-0 top-0"
      style={{ background: "rgba(8,12,32,0.94)", backdropFilter: "blur(24px)", borderRight: "1px solid rgba(79,195,247,0.12)", boxShadow: "4px 0 32px rgba(14,165,233,0.10)" }}>

      {/* Logo */}
      <div className="h-20 flex items-center px-6 border-b border-sky-100"
        style={{ background: "linear-gradient(135deg,rgba(14,165,233,0.05) 0%,transparent 70%)" }}>
        <Link href="/" className="flex items-center gap-3 group">
          <img src="/logo.png" alt="Elite Signals" className="w-10 h-10 rounded-xl object-contain shadow-md shadow-sky-200/60 group-hover:shadow-sky-300/70 transition-all duration-300" />
          <span className="font-display font-bold text-lg tracking-wide text-slate-800">
            Elite<br />
            <span style={{ background: "linear-gradient(90deg,#0ea5e9,#FF4FA3)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent" }}>Signals</span>
          </span>
        </Link>
      </div>

      {/* AI Powered badge */}
      <div className="mx-4 mt-3 flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-full text-[10px] font-bold tracking-widest uppercase"
        style={{ background: "linear-gradient(90deg,rgba(14,165,233,0.10),rgba(255,79,163,0.10))", border: "1px solid rgba(14,165,233,0.20)" }}>
        <span className="w-1.5 h-1.5 rounded-full bg-sky-500 animate-live-dot" />
        <span style={{ background: "linear-gradient(90deg,#0ea5e9,#FF4FA3)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent" }}>AI Powered</span>
      </div>

      {/* Nav */}
      <nav className="flex-1 py-5 px-4 flex flex-col gap-1.5">
        <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-2 px-3">Menu</div>
        {navItems.map((item) => {
          const isActive = location === item.path;
          return (
            <Link key={item.path} href={item.path} className="relative outline-none">
              <div className={cn(
                "flex items-center gap-3 px-4 py-2.5 rounded-xl transition-all duration-200 relative z-10",
                isActive ? "text-slate-800" : "text-slate-500 hover:text-slate-700 hover:bg-sky-50/60"
              )}>
                <item.icon className={cn("w-4.5 h-4.5 flex-shrink-0", isActive ? "text-pink-500" : "text-slate-400")} />
                <span className={cn("font-semibold text-sm", isActive && "text-slate-800")}>{item.label}</span>
                {isActive && (
                  <span className="ml-auto w-1.5 h-1.5 rounded-full bg-pink-500 animate-live-dot" />
                )}
              </div>
              {isActive && (
                <motion.div layoutId="sidebar-active" className="absolute inset-0 nav-active-bg rounded-xl z-0"
                  initial={false} transition={{ type: "spring", stiffness: 320, damping: 28 }} />
              )}
              {isActive && (
                <div className="absolute left-0 top-1/2 -translate-y-1/2 w-1 h-6 rounded-r-full"
                  style={{ background: "linear-gradient(180deg,#0ea5e9,#FF4FA3)" }} />
              )}
            </Link>
          );
        })}
      </nav>

      <SidebarBottom />
    </aside>
  );
}
