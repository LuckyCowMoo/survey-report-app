import type { IncomingMessage, ServerResponse } from "node:http";
import type { Plugin } from "vite";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

const EPC_UPSTREAM =
  "https://api.get-energy-performance-data.communities.gov.uk";

async function proxyEpcApi(
  req: IncomingMessage,
  res: ServerResponse
): Promise<boolean> {
  const raw = req.url ?? "";
  const pathOnly = raw.split("?")[0] ?? "";
  if (!pathOnly.startsWith("/api/epc")) return false;

  const rest = pathOnly.slice("/api/epc".length) || "/";
  const qs = raw.includes("?") ? raw.slice(raw.indexOf("?")) : "";
  const target = `${EPC_UPSTREAM}/api${rest}${qs}`;
  const rawAuth = req.headers.authorization;
  const auth = Array.isArray(rawAuth) ? rawAuth[0] : rawAuth;

  try {
    const upstream = await fetch(target, {
      method: req.method || "GET",
      headers: {
        Accept:
          typeof req.headers.accept === "string"
            ? req.headers.accept
            : "application/json",
        ...(auth ? { Authorization: auth } : {})
      }
    });
    const buf = Buffer.from(await upstream.arrayBuffer());
    res.statusCode = upstream.status;
    const contentType = upstream.headers.get("content-type");
    if (contentType) res.setHeader("Content-Type", contentType);
    res.end(buf);
  } catch {
    res.statusCode = 502;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ error: "EPC proxy failed" }));
  }
  return true;
}

function epcProxyPlugin(): Plugin {
  const attach = (
    server: { middlewares: { use: (fn: (req: IncomingMessage, res: ServerResponse, next: () => void) => void) => void } }
  ) => {
    server.middlewares.use((req, res, next) => {
      void proxyEpcApi(req, res).then((handled) => {
        if (!handled) next();
      });
    });
  };
  return {
    name: "epc-proxy",
    configureServer: attach,
    configurePreviewServer: attach
  };
}

export default defineConfig(({ command }) => ({
  // GitHub Pages serves project sites from /<repo-name>/; the deploy workflow
  // sets BASE_PATH accordingly. Cloudflare Pages and local dev use "/".
  base: process.env.BASE_PATH || "/",
  server: {
    host: true,
    // LAN phones hit this as http://192.168.x.x:5173 — allow any Host header in dev.
    allowedHosts: true,
    cors: true
  },
  preview: {
    host: true,
    allowedHosts: true
  },
  plugins: [
    epcProxyPlugin(),
    react(),
    VitePWA({
      // Dev: do not inject a SW. A stale PWA cache on the phone is a blank screen.
      injectRegister: command === "build" ? "auto" : null,
      registerType: "autoUpdate",
      devOptions: { enabled: false },
      includeAssets: ["icons/apple-touch-icon.png", "favicon.svg"],
      manifest: {
        name: "Damp Survey Report Generator",
        short_name: "Survey Reports",
        description:
          "Turns a shorthand damp-survey document into a finished report",
        theme_color: "#12405e",
        background_color: "#f4f6f8",
        display: "standalone",
        orientation: "portrait",
        icons: [
          {
            src: "icons/icon-192.png",
            sizes: "192x192",
            type: "image/png"
          },
          {
            src: "icons/icon-512.png",
            sizes: "512x512",
            type: "image/png"
          },
          {
            src: "icons/icon-512.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "maskable"
          }
        ]
      },
      workbox: {
        // The app bundle includes the content library; cache everything so it
        // works offline after the first visit.
        globPatterns: ["**/*.{js,css,html,svg,png,woff2}"],
        maximumFileSizeToCacheInBytes: 8 * 1024 * 1024,
        navigateFallbackDenylist: [/^\/api\//],
        runtimeCaching: [
          {
            urlPattern: /\/api\/epc\//,
            handler: "NetworkOnly"
          }
        ]
      }
    })
  ],
  build: {
    chunkSizeWarningLimit: 1500
  }
}));
