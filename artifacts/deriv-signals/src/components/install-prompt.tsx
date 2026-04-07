import { useState, useEffect } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Share, Plus } from "lucide-react";
import {
  getDeferredPrompt,
  clearDeferredPrompt,
  isAppInstalled,
  isIOS,
} from "@/hooks/use-pwa-install";

const SESSION_KEY = "elite-install-dismissed";
const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

export function InstallPrompt() {
  const [visible, setVisible] = useState(false);
  const [platform, setPlatform] = useState<"android" | "ios">("android");
  const [installing, setInstalling] = useState(false);
  const [done, setDone] = useState(false);

  useEffect(() => {
    if (isAppInstalled()) return;
    if (sessionStorage.getItem(SESSION_KEY)) return;

    const ios = isIOS();
    setPlatform(ios ? "ios" : "android");

    // Show immediately — no delay
    setVisible(true);
  }, []);

  function dismiss() {
    sessionStorage.setItem(SESSION_KEY, "1");
    setVisible(false);
  }

  async function handleInstall() {
    const prompt = getDeferredPrompt();
    if (prompt) {
      setInstalling(true);
      try {
        await prompt.prompt();
        const { outcome } = await prompt.userChoice;
        clearDeferredPrompt();
        if (outcome === "accepted") {
          setDone(true);
          setTimeout(() => {
            sessionStorage.setItem(SESSION_KEY, "1");
            setVisible(false);
          }, 1200);
          return;
        }
      } finally {
        setInstalling(false);
      }
    }
    // Fallback: just dismiss
    dismiss();
  }

  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          key="install-screen"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0, scale: 0.97 }}
          transition={{ duration: 0.18 }}
          className="fixed inset-0 z-[9999] flex flex-col items-center justify-between overflow-hidden"
          style={{ background: "hsl(228 48% 7%)" }}
        >
          {/* Background glow */}
          <div className="absolute inset-0 pointer-events-none">
            <div className="absolute top-[-10%] left-[-10%] w-[500px] h-[500px] rounded-full opacity-25"
              style={{ background: "radial-gradient(circle,#0ea5e9,transparent 65%)", filter: "blur(80px)" }} />
            <div className="absolute bottom-[-10%] right-[-10%] w-[500px] h-[500px] rounded-full opacity-20"
              style={{ background: "radial-gradient(circle,#FF4FA3,transparent 65%)", filter: "blur(80px)" }} />
            <div className="absolute inset-0 opacity-10"
              style={{
                backgroundImage: "linear-gradient(rgba(14,165,233,0.08) 1px,transparent 1px),linear-gradient(90deg,rgba(14,165,233,0.08) 1px,transparent 1px)",
                backgroundSize: "40px 40px",
              }} />
          </div>

          {/* Top spacer */}
          <div className="flex-1" />

          {/* Center content */}
          <div className="relative z-10 flex flex-col items-center px-8 w-full max-w-sm">

            {done ? (
              /* Success state */
              <motion.div
                initial={{ scale: 0.8, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                className="flex flex-col items-center gap-4 text-center"
              >
                <div className="w-24 h-24 rounded-3xl flex items-center justify-center"
                  style={{ background: "linear-gradient(135deg,#34d399,#0ea5e9)", boxShadow: "0 12px 40px rgba(52,211,153,0.40)" }}>
                  <span className="text-5xl">✅</span>
                </div>
                <p className="text-xl font-black text-white">App Installed!</p>
                <p className="text-sm" style={{ color: "#6b84a8" }}>Open Elite Signals from your home screen and enter your access key.</p>
              </motion.div>
            ) : (
              <>
                {/* App icon */}
                <motion.div
                  initial={{ scale: 0.8, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  transition={{ delay: 0.05 }}
                >
                  <img
                    src={`${BASE}/icon-512.png`}
                    alt="Elite Signals"
                    className="w-28 h-28 rounded-[28px] mb-6"
                    style={{ boxShadow: "0 16px 48px rgba(14,165,233,0.40)" }}
                  />
                </motion.div>

                <motion.div
                  initial={{ opacity: 0, y: 12 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.08 }}
                  className="text-center mb-8"
                >
                  <h1 className="text-3xl font-black text-white mb-1">
                    Elite <span style={{ color: "#FF4FA3" }}>Signals</span>
                  </h1>
                  <p className="text-sm" style={{ color: "#6b84a8" }}>
                    Install the app to access your live trading signals
                  </p>
                </motion.div>

                {/* Features row */}
                <motion.div
                  initial={{ opacity: 0, y: 12 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.12 }}
                  className="flex items-center justify-center gap-4 mb-8"
                >
                  {[
                    { emoji: "⚡", label: "Instant access" },
                    { emoji: "🔔", label: "Live signals" },
                    { emoji: "🔒", label: "Secure" },
                  ].map((f) => (
                    <div key={f.label} className="flex flex-col items-center gap-1">
                      <span className="text-xl">{f.emoji}</span>
                      <span className="text-[10px] font-semibold" style={{ color: "#4a607a" }}>{f.label}</span>
                    </div>
                  ))}
                </motion.div>

                {/* Android — native install button */}
                {platform === "android" && (
                  <motion.div
                    initial={{ opacity: 0, y: 12 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.15 }}
                    className="w-full space-y-3"
                  >
                    <button
                      onClick={handleInstall}
                      disabled={installing}
                      className="w-full py-4 rounded-2xl font-black text-base flex items-center justify-center gap-3 transition-all active:scale-95"
                      style={{
                        background: "linear-gradient(135deg,#0ea5e9,#a855f7,#FF4FA3)",
                        color: "#fff",
                        boxShadow: "0 8px 32px rgba(14,165,233,0.45)",
                        opacity: installing ? 0.8 : 1,
                      }}
                    >
                      <span className="text-xl">📲</span>
                      {installing ? "Opening install…" : "Add to Home Screen"}
                    </button>
                    <button
                      onClick={dismiss}
                      className="w-full py-3 rounded-2xl text-sm font-medium"
                      style={{ color: "#3d5470" }}
                    >
                      Skip — enter key on website
                    </button>
                  </motion.div>
                )}

                {/* iOS — step-by-step */}
                {platform === "ios" && (
                  <motion.div
                    initial={{ opacity: 0, y: 12 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.15 }}
                    className="w-full space-y-3"
                  >
                    <p className="text-xs text-center mb-2" style={{ color: "#6b84a8" }}>
                      Follow these steps to install:
                    </p>
                    {[
                      {
                        icon: <Share className="w-4 h-4" />,
                        color: "#38bdf8",
                        bg: "rgba(14,165,233,0.12)",
                        text: <>Tap the <strong className="text-white">Share</strong> button <span style={{ color: "#38bdf8" }}>⬆</span> at the bottom of Safari</>,
                      },
                      {
                        icon: <Plus className="w-4 h-4" />,
                        color: "#a855f7",
                        bg: "rgba(168,85,247,0.12)",
                        text: <>Tap <strong className="text-white">"Add to Home Screen"</strong></>,
                      },
                      {
                        icon: <span className="text-sm font-bold">✓</span>,
                        color: "#34d399",
                        bg: "rgba(52,211,153,0.12)",
                        text: <>Tap <strong className="text-white">Add</strong> — then open the app from your home screen!</>,
                      },
                    ].map((step, i) => (
                      <div key={i} className="flex items-center gap-3 rounded-2xl px-4 py-3"
                        style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.07)" }}>
                        <div className="w-8 h-8 rounded-xl flex items-center justify-center flex-shrink-0"
                          style={{ background: step.bg, color: step.color }}>
                          {step.icon}
                        </div>
                        <p className="text-xs leading-relaxed" style={{ color: "#94a3b8" }}>{step.text}</p>
                      </div>
                    ))}
                    <button
                      onClick={dismiss}
                      className="w-full py-3 rounded-2xl text-sm font-medium mt-1"
                      style={{ color: "#3d5470" }}
                    >
                      Skip — enter key on website
                    </button>
                  </motion.div>
                )}
              </>
            )}
          </div>

          {/* Bottom spacer */}
          <div className="flex-1" />

          {/* Bottom note */}
          {!done && (
            <p className="relative z-10 text-[10px] pb-6" style={{ color: "#2d3f58" }}>
              Free · No app store required · Works on Android &amp; iOS
            </p>
          )}
        </motion.div>
      )}
    </AnimatePresence>
  );
}
