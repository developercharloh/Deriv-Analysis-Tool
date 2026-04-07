import { Switch, Route, Router as WouterRouter } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/not-found";
import { FontSizeProvider } from "@/hooks/use-font-size";
import { SplashScreen } from "@/components/splash-screen";
import { useState, useEffect } from "react";
import { RefreshCw, X } from "lucide-react";

import { Dashboard } from "@/pages/dashboard";
import { LiveFeed } from "@/pages/live-feed";
import { History } from "@/pages/history";
import { Settings } from "@/pages/settings";
import { Subscribers } from "@/pages/subscribers";
import { BotSettings } from "@/pages/bot-settings";
import { AnalysisPanel } from "@/pages/analysis-panel";
import { SubscriberAccess } from "@/pages/subscriber-access";
import { SubscriberView } from "@/pages/subscriber-view";

const queryClient = new QueryClient();

function Router() {
  return (
    <Switch>
      <Route path="/access" component={SubscriberAccess} />
      <Route path="/subscriber" component={SubscriberView} />
      <Route path="/" component={Dashboard} />
      <Route path="/feed" component={LiveFeed} />
      <Route path="/history" component={History} />
      <Route path="/subscribers" component={Subscribers} />
      <Route path="/settings" component={Settings} />
      <Route path="/bot-settings" component={BotSettings} />
      <Route path="/analysis" component={AnalysisPanel} />
      <Route component={NotFound} />
    </Switch>
  );
}

const SUBSCRIBER_PATHS = ["/access", "/subscriber"];

function isSubscriberPath() {
  const base = import.meta.env.BASE_URL.replace(/\/$/, "");
  const path = window.location.pathname.replace(base, "") || "/";
  return SUBSCRIBER_PATHS.some((p) => path === p || path.startsWith(p + "?") || path.startsWith(p + "/"));
}

// ── PWA update banner ────────────────────────────────────────────────────────

function UpdateBanner() {
  const [showUpdate, setShowUpdate] = useState(false);
  const [reg, setReg] = useState<ServiceWorkerRegistration | null>(null);

  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;

    navigator.serviceWorker.getRegistration().then((registration) => {
      if (!registration) return;
      setReg(registration);

      // Already a waiting worker when we loaded
      if (registration.waiting) {
        setShowUpdate(true);
      }

      // New worker installed while the page is open
      registration.addEventListener("updatefound", () => {
        const newWorker = registration.installing;
        if (!newWorker) return;
        newWorker.addEventListener("statechange", () => {
          if (newWorker.state === "installed" && navigator.serviceWorker.controller) {
            setShowUpdate(true);
          }
        });
      });
    });

    // Reload when the controller changes (after skipWaiting)
    navigator.serviceWorker.addEventListener("controllerchange", () => {
      window.location.reload();
    });
  }, []);

  function applyUpdate() {
    if (reg?.waiting) {
      reg.waiting.postMessage({ type: "SKIP_WAITING" });
    } else {
      window.location.reload();
    }
  }

  if (!showUpdate) return null;

  return (
    <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-[9999] px-4 w-full max-w-sm">
      <div className="rounded-2xl px-4 py-3 flex items-center gap-3 shadow-2xl"
        style={{
          background: "linear-gradient(135deg,rgba(14,165,233,0.15),rgba(255,79,163,0.10))",
          border: "1px solid rgba(14,165,233,0.30)",
          backdropFilter: "blur(16px)",
        }}>
        <div className="w-8 h-8 rounded-xl flex items-center justify-center flex-shrink-0"
          style={{ background: "linear-gradient(135deg,#0ea5e9,#FF4FA3)" }}>
          <RefreshCw className="w-4 h-4 text-white" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-xs font-semibold text-white">New version available</p>
          <p className="text-[10px]" style={{ color: "#6b84a8" }}>Tap update to get the latest signals</p>
        </div>
        <button onClick={applyUpdate}
          className="px-3 py-1.5 rounded-lg text-[11px] font-bold whitespace-nowrap"
          style={{ background: "linear-gradient(135deg,#0ea5e9,#FF4FA3)", color: "#fff" }}>
          Update
        </button>
        <button onClick={() => setShowUpdate(false)} className="p-1 rounded-lg"
          style={{ color: "#4a607a" }}>
          <X className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
}

// ── App ──────────────────────────────────────────────────────────────────────

function App() {
  const skipSplash = isSubscriberPath();
  const [splashDone, setSplashDone] = useState(
    () => skipSplash || sessionStorage.getItem("elite-splash-done") === "1"
  );

  const handleSplashDone = () => {
    sessionStorage.setItem("elite-splash-done", "1");
    setSplashDone(true);
  };

  return (
    <FontSizeProvider>
      <QueryClientProvider client={queryClient}>
        <TooltipProvider>
          {!splashDone && <SplashScreen onDone={handleSplashDone} />}
          <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
            <Router />
          </WouterRouter>
          <Toaster />
          <UpdateBanner />
        </TooltipProvider>
      </QueryClientProvider>
    </FontSizeProvider>
  );
}

export default App;
