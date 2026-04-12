import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  base: '/FPV-Spot-Finder/',
  server: {
    proxy: {
      // ── Overpass-API Endpoints (Phase 4) ───────────────────────────────
      "/api/overpass-lz4": {
        target: "https://lz4.overpass-api.de",
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/overpass-lz4/, "/api/interpreter"),
      },
      "/api/overpass-z": {
        target: "https://z.overpass-api.de",
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/overpass-z/, "/api/interpreter"),
      },
      "/api/overpass-fr": {
        target: "https://overpass.openstreetmap.fr",
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/overpass-fr/, "/api/interpreter"),
      },
      "/api/overpass-pc": {
        target: "https://overpass.private.coffee",
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/overpass-pc/, "/api/interpreter"),
      },

      // ── OpenAIP Airspace API (Phase 7) ─────────────────────────────────
      // Browser → /api/openaip/airspaces?... → https://api.airspace.openaip.net/api/airspaces?...
      // Der x-openaip-api-key Header wird automatisch durchgereicht.
      "/api/openaip": {
        target: "https://api.core.openaip.net",
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/openaip/, "/api"),
      },
    },
  },
});
