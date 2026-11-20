import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig(({ mode }) => {
  const environment = loadEnv(mode, process.cwd(), "");
  const apiTarget = `http://127.0.0.1:${environment.PORT || "3000"}`;

  return {
    root: "client",
    plugins: [react()],
    build: {
      outDir: "../dist/client",
      emptyOutDir: true,
      sourcemap: false,
    },
    server: {
      port: 5173,
      proxy: {
        "/api": apiTarget,
        "/healthz": apiTarget,
      },
    },
  };
});

