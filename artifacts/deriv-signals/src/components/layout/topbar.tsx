import { Bell, Search, Menu } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useLocation } from "wouter";
import { useFontSize } from "@/hooks/use-font-size";
import { cn } from "@/lib/utils";
import { useState } from "react";

const PAGE_TITLES: Record<string, { title: string; sub: string; badge?: string }> = {
  "/":             { title: "Overview Dashboard",  sub: "Welcome back to your automated trading center.", badge: "LIVE"   },
  "/feed":         { title: "Live Signals Feed",   sub: "Real-time signals as they fire.",                badge: "STREAM" },
  "/history":      { title: "Signal History",      sub: "Past signals and performance."                                   },
  "/subscribers":  { title: "Subscribers",         sub: "Manage your paid subscribers."                                   },
  "/settings":     { title: "Bot Configuration",   sub: "Telegram, WhatsApp & delivery settings."                         },
  "/bot-settings": { title: "Bot Settings",        sub: "Signal types, markets & thresholds."                             },
  "/analysis":     { title: "Analysis Panel",      sub: "Market state & signal gate inspection.",         badge: "AI"     },
};

const SIZES = [
  { key: "small",  label: "S" },
  { key: "medium", label: "M" },
  { key: "large",  label: "L" },
] as const;

const TICKER_ITEMS = [
  { sym: "EURUSD",  val: "1.0842",  up: true  }, { sym: "GBPUSD",  val: "1.2654",  up: false },
  { sym: "USDJPY",  val: "149.82",  up: true  }, { sym: "XAUUSD",  val: "2341.5",  up: true  },
  { sym: "1HZ100V", val: "1234.0",  up: false }, { sym: "JD50",    val: "5671.2",  up: true  },
  { sym: "1HZ75V",  val: "892.44",  up: true  }, { sym: "JD25",    val: "3102.9",  up: false },
  { sym: "1HZ25V",  val: "451.22",  up: true  }, { sym: "JD100",   val: "9823.1",  up: false },
  { sym: "1HZ10V",  val: "102.55",  up: true  }, { sym: "JD10",    val: "1024.8",  up: true  },
];
const TICKER_2X = [...TICKER_ITEMS, ...TICKER_ITEMS];

interface TopbarProps {
  onMenuClick?: () => void;
}

export function Topbar({ onMenuClick }: TopbarProps) {
  const [location] = useLocation();
  const { fontSize, setFontSize } = useFontSize();
  const [searchFocused, setSearchFocused] = useState(false);
  const [hasNotif, setHasNotif] = useState(true);
  const page = PAGE_TITLES[location] ?? { title: "Dashboard", sub: "Elite Signals" };

  return (
    <header className="sticky top-0 z-40 flex flex-col"
      style={{ background: "rgba(8,12,32,0.90)", backdropFilter: "blur(20px)", borderBottom: "1px solid rgba(79,195,247,0.12)", boxShadow: "0 2px 24px rgba(14,165,233,0.10)" }}>

      {/* ── Ticker strip ── */}
      <div className="h-7 border-b border-sky-100 overflow-hidden flex items-center"
        style={{ background: "rgba(14,165,233,0.06)" }}>
        <div className="ticker-track flex items-center whitespace-nowrap">
          {TICKER_2X.map((t, i) => (
            <span key={i} className="flex items-center gap-1.5 px-4 border-r border-sky-100">
              <span className="text-[9px] font-mono font-bold text-slate-500 tracking-wide">{t.sym}</span>
              <span className={cn("text-[9px] font-mono font-bold", t.up ? "text-sky-600" : "text-pink-600")}>
                {t.up ? "▲" : "▼"} {t.val}
              </span>
            </span>
          ))}
        </div>
      </div>

      {/* ── Main bar ── */}
      <div className="h-16 flex items-center justify-between px-4 md:px-8">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" className="md:hidden text-slate-600 hover:bg-sky-50" onClick={onMenuClick}>
            <Menu className="w-5 h-5" />
          </Button>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-lg font-display font-bold text-slate-800">{page.title}</h1>
              {page.badge && (
                <span className="px-2 py-0.5 rounded-full text-[9px] font-bold tracking-widest uppercase"
                  style={{ background: "linear-gradient(90deg,rgba(14,165,233,0.12),rgba(255,79,163,0.12))", border: "1px solid rgba(14,165,233,0.25)", color: "#0ea5e9" }}>
                  {page.badge}
                </span>
              )}
            </div>
            <p className="text-xs text-slate-400 hidden sm:block">{page.sub}</p>
          </div>
        </div>

        <div className="flex items-center gap-2.5">
          {/* Font size toggle */}
          <div className="flex items-center gap-[2px] rounded-full p-1"
            style={{ background: "rgba(14,165,233,0.07)", border: "1px solid rgba(14,165,233,0.18)" }}>
            {SIZES.map(({ key, label }) => (
              <button key={key} onClick={() => setFontSize(key)}
                className={cn(
                  "w-7 h-7 rounded-full flex items-center justify-center font-bold text-[11px] transition-all duration-200",
                  fontSize === key
                    ? "text-white shadow-sm"
                    : "text-slate-400 hover:text-slate-600"
                )}
                style={fontSize === key ? { background: "linear-gradient(135deg,#0ea5e9,#FF4FA3)" } : undefined}>
                {label}
              </button>
            ))}
          </div>

          {/* Search */}
          <div className="relative hidden md:block">
            <Search className="w-3.5 h-3.5 absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
            <input type="text" placeholder="Search markets…"
              onFocus={() => setSearchFocused(true)} onBlur={() => setSearchFocused(false)}
              className="h-9 rounded-full pl-9 pr-4 text-xs w-48 placeholder:text-slate-400 outline-none transition-all duration-200 text-slate-700"
              style={{
                background: searchFocused ? "rgba(255,255,255,0.08)" : "rgba(255,255,255,0.05)",
                border: `1px solid ${searchFocused ? "rgba(14,165,233,0.50)" : "rgba(14,165,233,0.18)"}`,
                boxShadow: searchFocused ? "0 0 0 3px rgba(14,165,233,0.10)" : "none",
              }} />
          </div>

          {/* Bell */}
          <button onClick={() => setHasNotif(false)}
            className="w-9 h-9 rounded-full flex items-center justify-center relative transition-all duration-200"
            style={{ background: "rgba(255,255,255,0.06)", border: hasNotif ? "1px solid rgba(255,79,163,0.35)" : "1px solid rgba(14,165,233,0.20)" }}>
            <Bell className="w-4 h-4 text-slate-500" />
            {hasNotif && (
              <span className="absolute top-1.5 right-1.5 w-2 h-2 rounded-full"
                style={{ background: "linear-gradient(135deg,#FF4FA3,#f43f5e)", boxShadow: "0 0 6px rgba(255,79,163,0.70)" }} />
            )}
          </button>

          {/* Avatar */}
          <div className="w-9 h-9 rounded-full p-[2px] cursor-pointer"
            style={{ background: "linear-gradient(135deg,#0ea5e9,#a855f7,#FF4FA3)" }}>
            <div className="w-full h-full rounded-full flex items-center justify-center" style={{ background: "#0a0f28" }}>
              <span className="text-[11px] font-bold font-display text-slate-700">OP</span>
            </div>
          </div>
        </div>
      </div>
    </header>
  );
}
