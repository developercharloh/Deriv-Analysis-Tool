import { useState, useEffect, useRef } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  Smartphone, X, Copy, Check, Share2, ExternalLink,
  ChevronRight, Shield, Wifi, Download, Pencil, Save, RotateCcw,
} from "lucide-react";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");
const STORAGE_KEY = "elite-custom-share-url";

function getDefaultUrl() {
  return `${window.location.origin}${BASE}/access`;
}

function loadShareUrl(): string {
  return localStorage.getItem(STORAGE_KEY) || getDefaultUrl();
}

function CopyBtn({ text }: { text: string }) {
  const [ok, setOk] = useState(false);
  function copy() {
    navigator.clipboard.writeText(text).then(() => {
      setOk(true);
      setTimeout(() => setOk(false), 2000);
    });
  }
  return (
    <button
      onClick={copy}
      className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold transition-all flex-shrink-0"
      style={{
        background: ok ? "rgba(52,211,153,0.12)" : "rgba(14,165,233,0.10)",
        border: `1px solid ${ok ? "rgba(52,211,153,0.30)" : "rgba(14,165,233,0.22)"}`,
        color: ok ? "#34d399" : "#38bdf8",
      }}
    >
      {ok ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
      {ok ? "Copied!" : "Copy"}
    </button>
  );
}

const STEPS = [
  {
    icon: Share2,
    color: "#38bdf8",
    bg: "rgba(14,165,233,0.10)",
    border: "rgba(14,165,233,0.20)",
    title: "Share the link",
    desc: "Send the subscriber app link via WhatsApp to your subscribers.",
  },
  {
    icon: Shield,
    color: "#a855f7",
    bg: "rgba(168,85,247,0.10)",
    border: "rgba(168,85,247,0.20)",
    title: "Enter access key",
    desc: "They open the link and enter the ELITE key you gave them.",
  },
  {
    icon: Download,
    color: "#FF4FA3",
    bg: "rgba(255,79,163,0.10)",
    border: "rgba(255,79,163,0.20)",
    title: "Add to Home Screen",
    desc: 'Tap the browser menu → "Add to Home Screen" to install like an app.',
  },
  {
    icon: Wifi,
    color: "#34d399",
    bg: "rgba(52,211,153,0.10)",
    border: "rgba(52,211,153,0.20)",
    title: "Live signals forever",
    desc: "The app opens automatically — no key re-entry until subscription expires.",
  },
];

export function InstallTab() {
  const [open, setOpen] = useState(false);
  const [shareUrl, setShareUrl] = useState(getDefaultUrl);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [saved, setSaved] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setShareUrl(loadShareUrl());
  }, []);

  useEffect(() => {
    if (editing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [editing]);

  function startEdit() {
    setDraft(shareUrl);
    setEditing(true);
  }

  function saveEdit() {
    const trimmed = draft.trim();
    if (!trimmed) return;
    localStorage.setItem(STORAGE_KEY, trimmed);
    setShareUrl(trimmed);
    setEditing(false);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }

  function resetUrl() {
    const def = getDefaultUrl();
    localStorage.removeItem(STORAGE_KEY);
    setShareUrl(def);
    setDraft(def);
    setEditing(false);
  }

  const waUrl = `https://wa.me/?text=${encodeURIComponent(
    `🚀 Elite Signals — your trading signal app\n\nOpen this link to access your signals:\n${shareUrl}\n\nEnter your access key, then add to Home Screen for instant access!`
  )}`;

  const isCustom = shareUrl !== getDefaultUrl();

  return (
    <>
      {/* Floating vertical tab */}
      <motion.button
        onClick={() => setOpen(true)}
        whileHover={{ x: -4 }}
        className="fixed right-0 top-1/2 -translate-y-1/2 z-50 flex flex-col items-center gap-2 px-2 py-4 rounded-l-2xl cursor-pointer"
        style={{
          background: "linear-gradient(180deg,#0ea5e9,#a855f7,#FF4FA3)",
          boxShadow: "-4px 0 24px rgba(14,165,233,0.35)",
          writingMode: "vertical-rl",
        }}
        title="Share Subscriber App"
      >
        <Smartphone className="w-4 h-4 text-white flex-shrink-0" style={{ writingMode: "horizontal-tb" }} />
        <span
          className="text-[11px] font-black text-white tracking-widest uppercase"
          style={{ writingMode: "vertical-rl", textOrientation: "mixed", letterSpacing: "0.12em" }}
        >
          Install App
        </span>
        <ChevronRight className="w-3.5 h-3.5 text-white/70 flex-shrink-0" style={{ writingMode: "horizontal-tb" }} />
      </motion.button>

      {/* Backdrop */}
      <AnimatePresence>
        {open && (
          <motion.div
            key="backdrop"
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            onClick={() => setOpen(false)}
            className="fixed inset-0 z-50"
            style={{ background: "rgba(0,0,0,0.50)", backdropFilter: "blur(4px)" }}
          />
        )}
      </AnimatePresence>

      {/* Slide-out panel */}
      <AnimatePresence>
        {open && (
          <motion.div
            key="panel"
            initial={{ x: "100%" }} animate={{ x: 0 }} exit={{ x: "100%" }}
            transition={{ type: "spring", stiffness: 340, damping: 32 }}
            className="fixed right-0 top-0 bottom-0 z-50 w-full max-w-sm flex flex-col"
            style={{
              background: "hsl(228 48% 9%)",
              borderLeft: "1px solid rgba(14,165,233,0.18)",
              boxShadow: "-20px 0 60px rgba(0,0,0,0.50)",
            }}
          >
            {/* Header */}
            <div
              className="flex items-center justify-between px-5 py-4 flex-shrink-0"
              style={{ borderBottom: "1px solid rgba(14,165,233,0.12)" }}
            >
              <div className="flex items-center gap-3">
                <div
                  className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0"
                  style={{ background: "linear-gradient(135deg,#0ea5e9,#a855f7,#FF4FA3)" }}
                >
                  <Smartphone className="w-4 h-4 text-white" />
                </div>
                <div>
                  <p className="text-sm font-black text-white">Subscriber App</p>
                  <p className="text-[11px]" style={{ color: "#6b84a8" }}>Share with your subscribers</p>
                </div>
              </div>
              <button
                onClick={() => setOpen(false)}
                className="w-8 h-8 rounded-xl flex items-center justify-center transition-colors"
                style={{ background: "rgba(255,255,255,0.05)", color: "#6b84a8" }}
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Scrollable body */}
            <div className="flex-1 overflow-y-auto px-5 py-5 space-y-5">

              {/* Share link section */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <p className="text-[11px] font-semibold uppercase tracking-widest" style={{ color: "#6b84a8" }}>
                    Share Link
                  </p>
                  <div className="flex items-center gap-1.5">
                    {isCustom && !editing && (
                      <span
                        className="text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded-full"
                        style={{ background: "rgba(255,79,163,0.12)", color: "#FF4FA3", border: "1px solid rgba(255,79,163,0.25)" }}
                      >
                        Custom
                      </span>
                    )}
                    {saved && (
                      <span
                        className="text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded-full"
                        style={{ background: "rgba(52,211,153,0.12)", color: "#34d399", border: "1px solid rgba(52,211,153,0.25)" }}
                      >
                        Saved ✓
                      </span>
                    )}
                  </div>
                </div>

                <div
                  className="rounded-2xl p-4 space-y-3"
                  style={{ background: "rgba(14,165,233,0.06)", border: "1px solid rgba(14,165,233,0.15)" }}
                >
                  {editing ? (
                    /* Edit mode */
                    <div className="space-y-3">
                      <input
                        ref={inputRef}
                        value={draft}
                        onChange={(e) => setDraft(e.target.value)}
                        onKeyDown={(e) => { if (e.key === "Enter") saveEdit(); if (e.key === "Escape") setEditing(false); }}
                        placeholder="https://bit.ly/your-link"
                        className="w-full text-xs font-mono rounded-xl px-3 py-2.5 outline-none"
                        style={{
                          background: "rgba(255,255,255,0.06)",
                          border: "1px solid rgba(14,165,233,0.35)",
                          color: "#e2e8f0",
                          caretColor: "#38bdf8",
                        }}
                      />
                      <div className="flex items-center gap-2">
                        <button
                          onClick={saveEdit}
                          className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-bold transition-all flex-1 justify-center"
                          style={{
                            background: "linear-gradient(135deg,#0ea5e9,#a855f7)",
                            color: "#fff",
                          }}
                        >
                          <Save className="w-3.5 h-3.5" /> Save Link
                        </button>
                        <button
                          onClick={() => setEditing(false)}
                          className="px-3 py-2 rounded-xl text-xs font-semibold"
                          style={{ background: "rgba(255,255,255,0.05)", color: "#6b84a8", border: "1px solid rgba(255,255,255,0.08)" }}
                        >
                          Cancel
                        </button>
                        {isCustom && (
                          <button
                            onClick={resetUrl}
                            title="Reset to default URL"
                            className="w-8 h-8 flex items-center justify-center rounded-xl"
                            style={{ background: "rgba(255,79,163,0.08)", color: "#FF4FA3", border: "1px solid rgba(255,79,163,0.18)" }}
                          >
                            <RotateCcw className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>
                    </div>
                  ) : (
                    /* Display mode */
                    <>
                      <p className="text-xs font-mono break-all leading-relaxed" style={{ color: "#38bdf8" }}>
                        {shareUrl}
                      </p>
                      <div className="flex items-center gap-2 flex-wrap">
                        <CopyBtn text={shareUrl} />
                        <button
                          onClick={startEdit}
                          className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold transition-all"
                          style={{
                            background: "rgba(255,79,163,0.08)",
                            border: "1px solid rgba(255,79,163,0.20)",
                            color: "#FF4FA3",
                          }}
                        >
                          <Pencil className="w-3.5 h-3.5" /> Edit
                        </button>
                        <a
                          href={shareUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold transition-all"
                          style={{ background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.10)", color: "#94a3b8" }}
                        >
                          <ExternalLink className="w-3.5 h-3.5" /> Open
                        </a>
                      </div>
                    </>
                  )}
                </div>

                {!editing && (
                  <p className="text-[10px] leading-relaxed" style={{ color: "#3d5470" }}>
                    Tap <strong style={{ color: "#FF4FA3" }}>Edit</strong> to paste your bit.ly or custom short URL — it will be used for all copy &amp; share actions.
                  </p>
                )}
              </div>

              {/* WhatsApp share */}
              <a
                href={waUrl}
                target="_blank"
                rel="noreferrer"
                className="flex items-center gap-3 w-full px-4 py-3.5 rounded-2xl font-semibold text-sm transition-all"
                style={{
                  background: "linear-gradient(135deg,rgba(37,211,102,0.15),rgba(37,211,102,0.08))",
                  border: "1px solid rgba(37,211,102,0.30)",
                  color: "#4ade80",
                }}
              >
                <span className="text-xl flex-shrink-0">📲</span>
                <div className="text-left">
                  <p className="font-bold leading-none mb-0.5">Share via WhatsApp</p>
                  <p className="text-[11px] font-normal" style={{ color: "rgba(74,222,128,0.70)" }}>
                    Sends a pre-written message with your share link
                  </p>
                </div>
              </a>

              {/* Divider */}
              <div className="flex items-center gap-3">
                <div className="flex-1 h-px" style={{ background: "rgba(255,255,255,0.07)" }} />
                <span className="text-[10px] font-semibold uppercase tracking-widest" style={{ color: "#4a607a" }}>
                  How it works
                </span>
                <div className="flex-1 h-px" style={{ background: "rgba(255,255,255,0.07)" }} />
              </div>

              {/* Steps */}
              <div className="space-y-3">
                {STEPS.map((step, i) => {
                  const Icon = step.icon;
                  return (
                    <div
                      key={i}
                      className="flex items-start gap-3 rounded-2xl p-3.5"
                      style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.06)" }}
                    >
                      <div
                        className="flex-shrink-0 flex items-center justify-center w-8 h-8 rounded-xl"
                        style={{ background: step.bg, border: `1px solid ${step.border}` }}
                      >
                        <Icon className="w-4 h-4" style={{ color: step.color }} />
                      </div>
                      <div className="flex-1 min-w-0 pt-0.5">
                        <div className="flex items-center gap-2 mb-0.5">
                          <span
                            className="text-[9px] font-black rounded-full w-4 h-4 flex items-center justify-center flex-shrink-0"
                            style={{ background: step.bg, color: step.color }}
                          >
                            {i + 1}
                          </span>
                          <p className="text-xs font-bold text-white">{step.title}</p>
                        </div>
                        <p className="text-[11px] leading-relaxed" style={{ color: "#6b84a8" }}>{step.desc}</p>
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Tip */}
              <div
                className="rounded-2xl px-4 py-3 flex items-start gap-2.5"
                style={{ background: "rgba(255,79,163,0.06)", border: "1px solid rgba(255,79,163,0.15)" }}
              >
                <span className="text-base flex-shrink-0">💡</span>
                <p className="text-[11px] leading-relaxed" style={{ color: "#c084fc" }}>
                  Go to <strong className="text-pink-400">Subscribers</strong> → Copy Link to send each subscriber a link with their key already pre-filled — they tap it and go straight in.
                </p>
              </div>
            </div>

            {/* Footer */}
            <div
              className="px-5 py-4 flex-shrink-0 text-center"
              style={{ borderTop: "1px solid rgba(14,165,233,0.10)" }}
            >
              <p className="text-[10px]" style={{ color: "#2d3f58" }}>
                Elite Signals · Web App (PWA) · Works on Android & iOS
              </p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
