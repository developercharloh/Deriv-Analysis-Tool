import { useEffect, useState, useRef, useCallback } from "react";
import { useLocation } from "wouter";
import { useLiveSignals } from "@/hooks/use-live-signals";
import { useGetSignals } from "@workspace/api-client-react";
import { SignalCard } from "@/components/signals/signal-card";
import { AnimatePresence, motion } from "framer-motion";
import { Shield, LogOut, Wifi, WifiOff, Star, Calendar, AlertTriangle } from "lucide-react";
import { format, formatDistanceToNow } from "date-fns";
import { cn } from "@/lib/utils";
import { getDeviceId, verifyKeyApi, saveSession, clearSession } from "./subscriber-access";
import { SubscriberSplash } from "@/components/subscriber-splash";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

interface SubInfo {
  name: string;
  tier: string;
  endDate: string;
  status: string;
}

const TIER_LABELS: Record<string, string> = {
  weekly: "Weekly",
  monthly: "Monthly",
  "6months": "6 Months",
  yearly: "Yearly",
};

function daysRemaining(endDate: string) {
  return Math.max(0, Math.ceil((new Date(endDate).getTime() - Date.now()) / 86400000));
}

async function heartbeat(token: string) {
  const res = await fetch(`${BASE}/api/access/me`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || "Session invalid");
  }
  return res.json() as Promise<SubInfo & { valid: boolean }>;
}

async function doLogout(token: string) {
  await fetch(`${BASE}/api/access/logout`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
  }).catch(() => {});
}

/** Try to silently re-authenticate using the stored access key.
 *  Returns the new session token on success, throws on failure. */
async function silentReAuth(): Promise<string> {
  const storedKey = localStorage.getItem("elite-access-key");
  if (!storedKey) throw new Error("No stored key");
  const deviceId = getDeviceId();
  const data = await verifyKeyApi(storedKey, deviceId);
  saveSession(data, storedKey);
  return data.sessionToken;
}

function SubscriberHeader({
  info,
  onLogout,
  connected,
}: {
  info: SubInfo;
  onLogout: () => void;
  connected: boolean;
}) {
  const days = daysRemaining(info.endDate);
  const isExpiring = days <= 3;
  return (
    <div className="sticky top-0 z-40 flex items-center justify-between px-6 h-16"
      style={{ background: "rgba(8,12,32,0.92)", backdropFilter: "blur(20px)", borderBottom: "1px solid rgba(79,195,247,0.12)" }}>
      <div className="flex items-center gap-3">
        <div className="w-8 h-8 rounded-xl flex items-center justify-center"
          style={{ background: "linear-gradient(135deg,#0ea5e9,#a855f7,#FF4FA3)" }}>
          <Shield className="w-4 h-4 text-white" />
        </div>
        <div>
          <span className="font-display font-black text-white text-sm">Elite </span>
          <span className="font-display font-black text-sm" style={{ color: "#FF4FA3" }}>Signals</span>
        </div>
        <div className="hidden sm:flex items-center gap-1.5 ml-2 text-[10px] font-semibold px-2 py-0.5 rounded-full"
          style={{ background: connected ? "rgba(5,150,105,0.12)" : "rgba(148,163,184,0.08)", border: `1px solid ${connected ? "rgba(5,150,105,0.30)" : "rgba(148,163,184,0.15)"}`, color: connected ? "#34d399" : "#64748b" }}>
          {connected ? <><span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />LIVE</> : <><WifiOff className="w-2.5 h-2.5" />OFFLINE</>}
        </div>
      </div>
      <div className="flex items-center gap-3">
        <div className="hidden sm:flex flex-col items-end">
          <span className="text-sm font-semibold text-white">{info.name}</span>
          <div className="flex items-center gap-2 text-[11px]">
            <span className="px-1.5 py-0.5 rounded font-bold"
              style={{ background: "rgba(255,79,163,0.15)", color: "#FF4FA3" }}>
              {TIER_LABELS[info.tier] ?? info.tier}
            </span>
            <span className={cn("font-mono", isExpiring ? "text-amber-400" : "text-muted-foreground")}>
              {days === 0 ? "Expires today" : `${days}d left`}
            </span>
          </div>
        </div>
        <button onClick={onLogout}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all"
          style={{ background: "rgba(244,63,94,0.10)", border: "1px solid rgba(244,63,94,0.20)", color: "#f87171" }}>
          <LogOut className="w-3 h-3" />
          <span className="hidden sm:inline">Sign out</span>
        </button>
      </div>
    </div>
  );
}

function KickedBanner({ reason }: { reason: string }) {
  return (
    <motion.div initial={{ opacity: 0, y: -12 }} animate={{ opacity: 1, y: 0 }}
      className="mx-6 mt-4 flex items-start gap-3 rounded-2xl px-5 py-4"
      style={{ background: "rgba(234,179,8,0.08)", border: "1px solid rgba(234,179,8,0.25)" }}>
      <AlertTriangle className="w-4 h-4 text-amber-400 flex-shrink-0 mt-0.5" />
      <div>
        <p className="text-sm font-semibold text-amber-300">Session Ended</p>
        <p className="text-xs text-amber-400/80 mt-0.5">{reason}</p>
      </div>
    </motion.div>
  );
}

export function SubscriberView() {
  const [, navigate] = useLocation();
  const [info, setInfo] = useState<SubInfo | null>(null);
  const [checking, setChecking] = useState(true);
  const [splashDone, setSplashDone] = useState(false);
  const [kicked, setKicked] = useState("");
  const tokenRef = useRef<string>("");

  const handleLogout = useCallback(async () => {
    if (tokenRef.current) await doLogout(tokenRef.current);
    clearSession();
    navigate("/access");
  }, [navigate]);

  // Initial auth check
  useEffect(() => {
    const token = localStorage.getItem("elite-session-token");
    const raw = localStorage.getItem("elite-subscriber-info");

    if (!token) { navigate("/access"); return; }
    tokenRef.current = token;

    // Optimistically show stored info while we verify
    if (raw) {
      try { setInfo(JSON.parse(raw) as SubInfo); } catch { /* ignored */ }
    }

    // Verify session — if invalid, try silent re-auth with stored key
    heartbeat(token)
      .then((data) => setInfo({ name: data.name, tier: data.tier, endDate: data.endDate, status: data.status }))
      .catch(async () => {
        try {
          const newToken = await silentReAuth();
          tokenRef.current = newToken;
          const raw2 = localStorage.getItem("elite-subscriber-info");
          if (raw2) setInfo(JSON.parse(raw2) as SubInfo);
        } catch {
          clearSession();
          navigate("/access");
        }
      })
      .finally(() => setChecking(false));
  }, [navigate]);

  // Heartbeat every 30s — if session expires, try silent re-auth before kicking
  useEffect(() => {
    if (!tokenRef.current) return;
    const interval = setInterval(async () => {
      try {
        const data = await heartbeat(tokenRef.current);
        setInfo({ name: data.name, tier: data.tier, endDate: data.endDate, status: data.status });
      } catch {
        // Session failed — try silent re-auth
        try {
          const newToken = await silentReAuth();
          tokenRef.current = newToken;
        } catch (err: unknown) {
          // Re-auth failed (revoked / expired) — kick the user
          const msg = err instanceof Error ? err.message : "Session ended";
          setKicked(msg);
          clearInterval(interval);
          clearSession();
          setTimeout(() => navigate("/access"), 4000);
        }
      }
    }, 30_000);
    return () => clearInterval(interval);
  }, [navigate]);

  const { data: initialSignals, isLoading } = useGetSignals({ limit: 50 });
  const { signals, connected } = useLiveSignals(initialSignals || []);

  if (!splashDone) {
    return (
      <SubscriberSplash
        ready={!checking}
        onDone={() => setSplashDone(true)}
      />
    );
  }
  if (!info) return null;

  const days = daysRemaining(info.endDate);

  return (
    <div className="min-h-screen flex flex-col" style={{ background: "hsl(228 48% 7%)" }}>
      <div className="fixed inset-0 pointer-events-none z-0">
        <div className="absolute top-[-10%] left-[-5%] w-[600px] h-[600px] rounded-full opacity-20"
          style={{ background: "radial-gradient(circle,#0ea5e9,transparent 65%)", filter: "blur(80px)" }} />
        <div className="absolute bottom-[-10%] right-[-5%] w-[600px] h-[600px] rounded-full opacity-15"
          style={{ background: "radial-gradient(circle,#FF4FA3,transparent 65%)", filter: "blur(80px)" }} />
      </div>

      <div className="relative z-10 flex flex-col flex-1">
        <SubscriberHeader info={info} onLogout={handleLogout} connected={connected} />

        {kicked && <KickedBanner reason={kicked} />}

        <div className="flex-1 px-6 py-6 max-w-7xl mx-auto w-full">
          <div className="flex flex-wrap items-center gap-4 mb-6">
            <div>
              <h1 className="text-2xl font-display font-black text-white">Live Signal Feed</h1>
              <p className="text-sm" style={{ color: "#6b84a8" }}>Real-time signals across 13 markets</p>
            </div>
            <div className="ml-auto flex items-center gap-3 flex-wrap">
              <div className="flex items-center gap-2 text-sm px-3 py-1.5 rounded-xl"
                style={{ background: "rgba(255,79,163,0.08)", border: "1px solid rgba(255,79,163,0.20)", color: "#FF4FA3" }}>
                <Star className="w-3.5 h-3.5" />
                {TIER_LABELS[info.tier] ?? info.tier}
              </div>
              <div className="flex items-center gap-2 text-sm px-3 py-1.5 rounded-xl"
                style={{ background: "rgba(14,165,233,0.08)", border: "1px solid rgba(14,165,233,0.20)", color: "#38bdf8" }}>
                <Calendar className="w-3.5 h-3.5" />
                {days === 0 ? "Expires today" : `${days} days left`}
              </div>
            </div>
          </div>

          {isLoading ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
              {[...Array(8)].map((_, i) => (
                <div key={i} className="h-64 rounded-2xl animate-pulse"
                  style={{ background: "rgba(14,165,233,0.06)", border: "1px solid rgba(14,165,233,0.10)" }} />
              ))}
            </div>
          ) : signals.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-64 rounded-2xl border-2 border-dashed"
              style={{ borderColor: "rgba(14,165,233,0.20)", background: "rgba(14,165,233,0.03)" }}>
              <Wifi className="w-10 h-10 mb-3" style={{ color: "rgba(56,189,248,0.40)" }} />
              <p className="text-sm font-semibold" style={{ color: "#6b84a8" }}>Monitoring markets — signals appear here</p>
              <p className="text-xs mt-1" style={{ color: "#4a607a" }}>New signals fire every 20 minutes</p>
            </div>
          ) : (
            <AnimatePresence mode="popLayout">
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                {signals.map((signal, i) => (
                  <motion.div key={signal.id} layout initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, scale: 0.95 }} transition={{ delay: i * 0.03 }}>
                    <SignalCard signal={signal} animate={i === 0} />
                  </motion.div>
                ))}
              </div>
            </AnimatePresence>
          )}
        </div>

        <footer className="text-center py-4 text-[11px]" style={{ color: "#2d3f58", borderTop: "1px solid rgba(14,165,233,0.08)" }}>
          Elite Signals · Expires {format(new Date(info.endDate), "MMM d, yyyy")} ({formatDistanceToNow(new Date(info.endDate), { addSuffix: true })})
        </footer>
      </div>
    </div>
  );
}
