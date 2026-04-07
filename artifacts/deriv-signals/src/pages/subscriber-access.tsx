import { useState, useEffect } from "react";
import { useLocation } from "wouter";
import { Key, AlertCircle, Loader2, Shield, Smartphone, CheckCircle } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { InstallPrompt } from "@/components/install-prompt";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

// ── Device fingerprint ───────────────────────────────────────────────────────

export function getDeviceId(): string {
  let id = localStorage.getItem("elite-device-id");
  if (!id) {
    const raw = [
      navigator.userAgent,
      `${screen.width}x${screen.height}`,
      Intl.DateTimeFormat().resolvedOptions().timeZone,
      navigator.language,
      navigator.hardwareConcurrency ?? 0,
    ].join("|");
    let h = 0;
    for (let i = 0; i < raw.length; i++) { h = Math.imul(31, h) + raw.charCodeAt(i) | 0; }
    id = `d-${Math.abs(h).toString(36)}-${Date.now().toString(36)}`;
    localStorage.setItem("elite-device-id", id);
  }
  return id;
}

/** Parse a human-readable device name from the user agent string */
export function getDeviceName(): string {
  const ua = navigator.userAgent;
  // iOS devices
  if (/iPhone/.test(ua)) return `iPhone`;
  if (/iPad/.test(ua)) return `iPad`;
  // Android — try to extract model name between semicolon and closing paren
  const android = ua.match(/Android[^;]*;\s*([^)]+)\)/);
  if (android) {
    const model = android[1].trim().replace(/Build\/.+/, "").trim();
    return model || "Android Device";
  }
  if (/Android/.test(ua)) return "Android Device";
  // Desktop
  if (/Windows NT 10/.test(ua)) return "Windows 10/11";
  if (/Windows NT/.test(ua)) return "Windows PC";
  if (/Macintosh/.test(ua)) return "Mac";
  if (/Linux/.test(ua)) return "Linux";
  return "Unknown Device";
}

// ── API helpers ──────────────────────────────────────────────────────────────

export async function verifyKeyApi(key: string, deviceId: string) {
  const res = await fetch(`${BASE}/api/access/verify`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ key, deviceId, deviceName: getDeviceName() }),
  });
  const data = await res.json();
  if (!res.ok) throw Object.assign(new Error(data.error || "Invalid key"), { keyReset: data.keyReset });
  return data as { sessionToken: string; name: string; tier: string; endDate: string; status: string };
}

async function checkSession(token: string) {
  const res = await fetch(`${BASE}/api/access/me`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error("Session invalid");
  return res.json() as Promise<{ valid: boolean; name: string; tier: string; endDate: string; status: string }>;
}

// ── Storage helpers ──────────────────────────────────────────────────────────

export function saveSession(data: { sessionToken: string; name: string; tier: string; endDate: string; status: string }, key: string) {
  localStorage.setItem("elite-session-token", data.sessionToken);
  localStorage.setItem("elite-access-key", key);
  localStorage.setItem("elite-subscriber-info", JSON.stringify({
    name: data.name, tier: data.tier, endDate: data.endDate, status: data.status,
  }));
}

export function clearSession() {
  localStorage.removeItem("elite-session-token");
  localStorage.removeItem("elite-access-key");
  localStorage.removeItem("elite-subscriber-info");
}

// ── Key formatter ────────────────────────────────────────────────────────────

function formatKey(raw: string): string {
  const stripped = raw.replace(/[^A-Z0-9]/gi, "").toUpperCase();
  const parts: string[] = [];
  let i = 0;
  if (stripped.startsWith("ELITE")) { parts.push("ELITE"); i = 5; }
  while (i < stripped.length && parts.length < 4) {
    parts.push(stripped.slice(i, i + 4));
    i += 4;
  }
  return parts.join("-");
}

// ── Component ────────────────────────────────────────────────────────────────

export function SubscriberAccess() {
  const [, navigate] = useLocation();
  const [raw, setRaw] = useState(() => {
    const params = new URLSearchParams(window.location.search);
    return params.get("key") || "";
  });
  const [autoChecking, setAutoChecking] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [keyReset, setKeyReset] = useState(false);

  const key = formatKey(raw);

  // ── Auto-login on mount ──────────────────────────────────────────────────
  useEffect(() => {
    async function tryAutoLogin() {
      const token = localStorage.getItem("elite-session-token");
      const storedKey = localStorage.getItem("elite-access-key");

      // 1. Try existing session token
      if (token) {
        try {
          const data = await checkSession(token);
          // Session still valid — update info and go straight to feed
          localStorage.setItem("elite-subscriber-info", JSON.stringify({
            name: data.name, tier: data.tier, endDate: data.endDate, status: data.status,
          }));
          navigate("/subscriber");
          return;
        } catch {
          // Session invalid — try re-verifying with stored key
        }
      }

      // 2. Try stored key (silent re-auth without showing the form)
      if (storedKey) {
        try {
          const deviceId = getDeviceId();
          const data = await verifyKeyApi(storedKey, deviceId);
          saveSession(data, storedKey);
          navigate("/subscriber");
          return;
        } catch (err: unknown) {
          // Key is expired or revoked — clear storage, show form
          clearSession();
          const e = err as { keyReset?: boolean; message?: string };
          if (e.keyReset) {
            setError("Your access key was reset (too many devices). Please contact your provider for a new key.");
            setKeyReset(true);
          }
        }
      }

      setAutoChecking(false);

      // 3. Pre-fill key from URL param and auto-submit
      const urlKey = new URLSearchParams(window.location.search).get("key");
      if (urlKey) {
        const formatted = formatKey(urlKey);
        if (formatted.length === 19) {
          setRaw(urlKey);
          handleSubmitKey(formatted);
        }
      }
    }

    tryAutoLogin();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleSubmitKey(k: string) {
    setLoading(true);
    setError("");
    setKeyReset(false);
    try {
      const deviceId = getDeviceId();
      const data = await verifyKeyApi(k, deviceId);
      saveSession(data, k);
      navigate("/subscriber");
    } catch (err: unknown) {
      const e = err as Error & { keyReset?: boolean };
      // Give a helpful message depending on what went wrong
      let msg = e.message || "Something went wrong";
      if (!e.keyReset) {
        if (msg.toLowerCase().includes("invalid") || msg.toLowerCase().includes("not found")) {
          // Check if the key looks truncated
          const stripped = k.replace(/-/g, "");
          if (stripped.length < 17) {
            msg = "Key looks incomplete — make sure you copied all the characters including the last ones.";
          } else {
            msg = "Key not found. Double-check it was copied correctly, or contact your provider for a new key.";
          }
        } else if (msg.toLowerCase().includes("fetch") || msg.toLowerCase().includes("network")) {
          msg = "Could not reach the server. Check your internet connection and try again.";
        }
      }
      setError(msg);
      setKeyReset(!!e.keyReset);
    } finally {
      setLoading(false);
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (key.length < 5) return;
    await handleSubmitKey(key);
  }

  // Show a spinner while auto-checking stored session
  if (autoChecking) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center"
        style={{ background: "hsl(228 48% 7%)" }}>
        <div className="flex flex-col items-center gap-4">
          <div className="w-16 h-16 rounded-2xl flex items-center justify-center"
            style={{ background: "linear-gradient(135deg,#0ea5e9,#a855f7,#FF4FA3)", boxShadow: "0 8px 24px rgba(14,165,233,0.30)" }}>
            <Shield className="w-8 h-8 text-white" />
          </div>
          <Loader2 className="w-6 h-6 animate-spin" style={{ color: "#38bdf8" }} />
          <p className="text-sm" style={{ color: "#6b84a8" }}>Checking your session…</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col items-center justify-center relative overflow-hidden"
      style={{ background: "hsl(228 48% 7%)" }}>

      {/* PWA install bottom sheet — shows automatically after 1.4s */}
      <InstallPrompt />

      {/* Background */}
      <div className="fixed inset-0 pointer-events-none">
        <div className="absolute top-[-15%] left-[-10%] w-[600px] h-[600px] rounded-full opacity-20"
          style={{ background: "radial-gradient(circle,#0ea5e9,transparent 65%)", filter: "blur(80px)" }} />
        <div className="absolute bottom-[-15%] right-[-10%] w-[600px] h-[600px] rounded-full opacity-15"
          style={{ background: "radial-gradient(circle,#FF4FA3,transparent 65%)", filter: "blur(80px)" }} />
        <div className="absolute inset-0 opacity-20"
          style={{
            backgroundImage: "linear-gradient(rgba(14,165,233,0.07) 1px,transparent 1px),linear-gradient(90deg,rgba(14,165,233,0.07) 1px,transparent 1px)",
            backgroundSize: "40px 40px",
          }} />
      </div>

      <motion.div initial={{ opacity: 0, y: 24 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5 }}
        className="relative z-10 w-full max-w-md px-6">
        <div className="rounded-3xl p-8"
          style={{
            background: "rgba(255,255,255,0.04)",
            backdropFilter: "blur(24px)",
            border: "1px solid rgba(14,165,233,0.18)",
            boxShadow: "0 24px 60px rgba(0,0,0,0.40), 0 0 0 1px rgba(255,255,255,0.03) inset",
          }}>

          {/* Logo */}
          <div className="flex flex-col items-center mb-8">
            <div className="w-16 h-16 rounded-2xl flex items-center justify-center mb-4"
              style={{ background: "linear-gradient(135deg,#0ea5e9,#a855f7,#FF4FA3)", boxShadow: "0 8px 24px rgba(14,165,233,0.30)" }}>
              <Shield className="w-8 h-8 text-white" />
            </div>
            <h1 className="text-2xl font-display font-black text-white">
              Elite <span style={{ color: "#FF4FA3" }}>Signals</span>
            </h1>
            <p className="text-sm mt-1" style={{ color: "#6b84a8" }}>Subscriber Access Portal</p>
          </div>

          {/* Form */}
          <form onSubmit={handleSubmit} className="space-y-5">
            <div className="space-y-2">
              <label className="text-xs font-semibold uppercase tracking-widest" style={{ color: "#6b84a8" }}>
                Your Access Key
              </label>
              <div className="relative">
                <Key className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4" style={{ color: "#38bdf8" }} />
                <input
                  type="text"
                  value={key}
                  onChange={(e) => setRaw(e.target.value)}
                  placeholder="ELITE-XXXX-XXXX-XXXX"
                  autoCorrect="off"
                  autoCapitalize="characters"
                  spellCheck={false}
                  maxLength={20}
                  className="w-full pl-10 pr-4 h-12 rounded-xl font-mono text-sm outline-none transition-all"
                  style={{ background: "rgba(255,255,255,0.06)", border: "1px solid rgba(14,165,233,0.25)", color: "#dce8f4", letterSpacing: "0.08em" }}
                  onFocus={(e) => { e.target.style.border = "1px solid rgba(14,165,233,0.55)"; e.target.style.boxShadow = "0 0 0 3px rgba(14,165,233,0.10)"; }}
                  onBlur={(e) => { e.target.style.border = "1px solid rgba(14,165,233,0.25)"; e.target.style.boxShadow = "none"; }}
                />
              </div>
              <p className="text-[11px]" style={{ color: "#4a607a" }}>
                Format: <span style={{ color: "#38bdf8", fontFamily: "monospace" }}>ELITE-XXXX-XXXX-XXXX</span>
              </p>
            </div>

            <AnimatePresence>
              {error && (
                <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
                  className="rounded-xl px-4 py-3 text-sm"
                  style={{ background: keyReset ? "rgba(234,179,8,0.08)" : "rgba(244,63,94,0.10)", border: `1px solid ${keyReset ? "rgba(234,179,8,0.30)" : "rgba(244,63,94,0.25)"}`, color: keyReset ? "#fbbf24" : "#f87171" }}>
                  <div className="flex items-start gap-2">
                    <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
                    <span>{error}</span>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            <button type="submit" disabled={loading || key.length < 5}
              className="w-full h-12 rounded-xl font-bold text-sm transition-all duration-200 flex items-center justify-center gap-2"
              style={{
                background: key.length >= 5 && !loading ? "linear-gradient(135deg,#0ea5e9,#a855f7,#FF4FA3)" : "rgba(255,255,255,0.06)",
                color: key.length >= 5 && !loading ? "#fff" : "#4a607a",
                cursor: key.length >= 5 && !loading ? "pointer" : "not-allowed",
                boxShadow: key.length >= 5 && !loading ? "0 4px 20px rgba(14,165,233,0.30)" : "none",
              }}>
              {loading ? <><Loader2 className="w-4 h-4 animate-spin" /> Verifying…</> : "Access Signals"}
            </button>
          </form>

          {/* Install hint */}
          <div className="mt-6 rounded-xl px-4 py-3 flex items-start gap-3"
            style={{ background: "rgba(14,165,233,0.05)", border: "1px solid rgba(14,165,233,0.12)" }}>
            <CheckCircle className="w-4 h-4 flex-shrink-0 mt-0.5" style={{ color: "#38bdf8" }} />
            <div className="text-[11px] space-y-0.5" style={{ color: "#4a8aad" }}>
              <p className="font-semibold" style={{ color: "#38bdf8" }}>Enter once, access forever</p>
              <p>Add this page to your home screen. Your key is remembered until your subscription expires — no need to re-enter.</p>
            </div>
          </div>

          <div className="flex items-center justify-center gap-2 mt-4 text-[11px]" style={{ color: "#4a607a" }}>
            <Smartphone className="w-3 h-3" />
            <span>Max 2 devices per subscription</span>
          </div>
        </div>
      </motion.div>
    </div>
  );
}
