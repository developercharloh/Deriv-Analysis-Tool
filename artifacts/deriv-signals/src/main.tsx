import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";

createRoot(document.getElementById("root")!).render(<App />);

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    const base = import.meta.env.BASE_URL;
    const swUrl = `${base}sw.js`;
    navigator.serviceWorker
      .register(swUrl, { scope: base })
      .then((reg) => {
        console.log("[Elite Signals] SW registered, scope:", reg.scope);
        reg.update();
      })
      .catch((err) => {
        console.error("[Elite Signals] SW registration failed:", err);
      });
  });
}
