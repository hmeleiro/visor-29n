import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import path from "node:path";
import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig(({ mode }) => {
  const environment = loadEnv(mode, process.cwd(), "");
  const apiTarget = `http://127.0.0.1:${environment.PORT || "3000"}`;
  const cacheKey = createHash("sha256")
    .update(process.cwd())
    .digest("hex")
    .slice(0, 12);

  return {
    root: "client",
    // OneDrive folders can deny recursive deletion even when the current user
    // owns them. Vite recreates this cache during development, so keep it in
    // the local temporary directory instead of node_modules/.vite.
    cacheDir: environment.VITE_CACHE_DIR
      || path.join(tmpdir(), "visor-escrutinio-29n-vite", cacheKey),
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

