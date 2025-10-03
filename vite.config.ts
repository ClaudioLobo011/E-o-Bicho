import react from "@vitejs/plugin-react";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { Plugin, PreviewServer, ViteDevServer } from "vite";
import { defineConfig } from "vite";

const adminEntry = resolve(__dirname, "admin.html");

function adminRewritePlugin(): Plugin {
  let outDir = "dist";

  return {
    name: "admin-rewrite-plugin",
    configResolved(config) {
      outDir = config.build.outDir;
    },
    configureServer(server: ViteDevServer) {
      server.middlewares.use(async (req, res, next) => {
        if (req.url && req.url.startsWith("/app")) {
          const adminHtml = readFileSync(adminEntry, "utf-8");
          const transformed = await server.transformIndexHtml(req.url, adminHtml);
          res.setHeader("Content-Type", "text/html");
          res.end(transformed);
          return;
        }
        next();
      });
    },
    configurePreviewServer(server: PreviewServer) {
      const previewEntry = resolve(outDir, "admin.html");
      server.middlewares.use((req, res, next) => {
        if (req.url && req.url.startsWith("/app")) {
          const adminHtml = existsSync(previewEntry)
            ? readFileSync(previewEntry, "utf-8")
            : readFileSync(adminEntry, "utf-8");
          res.setHeader("Content-Type", "text/html");
          res.end(adminHtml);
          return;
        }
        next();
      });
    }
  };
}

export default defineConfig({
  plugins: [react(), adminRewritePlugin()],
  server: {
    port: 5173,
    host: true
  },
  build: {
    rollupOptions: {
      input: {
        admin: adminEntry
      }
    }
  }
});
