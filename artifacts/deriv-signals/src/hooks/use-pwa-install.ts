// Module-level storage for the deferred install prompt (Android Chrome)
// Must be captured before any user gesture blocks it

interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

let _deferredPrompt: BeforeInstallPromptEvent | null = null;
let _installed = false;

if (typeof window !== "undefined") {
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    _deferredPrompt = e as BeforeInstallPromptEvent;
  });

  window.addEventListener("appinstalled", () => {
    _installed = true;
    _deferredPrompt = null;
  });
}

export function getDeferredPrompt() {
  return _deferredPrompt;
}

export function clearDeferredPrompt() {
  _deferredPrompt = null;
}

export function isAppInstalled() {
  return (
    _installed ||
    window.matchMedia("(display-mode: standalone)").matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

export function isIOS() {
  return /iPad|iPhone|iPod/.test(navigator.userAgent) && !("MSStream" in window);
}

export function isAndroid() {
  return /Android/.test(navigator.userAgent);
}
