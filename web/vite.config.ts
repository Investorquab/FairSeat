import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// In dev, proxy /api to the backend (default :8787). In production the site and API are
// served behind the same origin, so the relative /api path just works.
export default defineConfig({
  plugins: [react()],
  server: {
    host: true,
    proxy: {
      "/api": process.env.API_ORIGIN ?? "http://localhost:8787",
    },
  },
});
