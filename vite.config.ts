import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  return {
    plugins: [react(), tailwindcss()],
    base: env.VITE_BASE || "/",
    server: {
      proxy: {
        "/api": "http://127.0.0.1:7710",
      },
    },
    build: {
      chunkSizeWarningLimit: 1000,
    },
  };
});
