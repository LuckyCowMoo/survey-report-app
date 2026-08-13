import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { registerSW } from "virtual:pwa-register";
import App from "./App";
import { applyTheme, loadTheme } from "./lib/theme";
import "./styles.css";

applyTheme(loadTheme(), { animate: false });

/** Local / LAN preview — never install a SW (stale precache → blank gray screen). */
function isLocalHost(hostname: string): boolean {
  if (hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]") {
    return true;
  }
  if (hostname.endsWith(".local")) return true;
  return /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[0-1])\.)/.test(hostname);
}

if (isLocalHost(location.hostname)) {
  void navigator.serviceWorker?.getRegistrations().then((regs) => {
    for (const reg of regs) void reg.unregister();
  });
  void caches?.keys().then((keys) => {
    for (const key of keys) void caches.delete(key);
  });
} else if (import.meta.env.PROD) {
  registerSW({ immediate: true });
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>
);
