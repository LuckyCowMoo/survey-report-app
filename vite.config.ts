import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

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
        maximumFileSizeToCacheInBytes: 8 * 1024 * 1024
      }
    })
  ],
  build: {
    chunkSizeWarningLimit: 1500
  }
}));
