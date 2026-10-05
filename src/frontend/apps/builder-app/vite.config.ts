import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import path from "path";
import { env as nodeEnv } from "process";
import { readdirSync, readFileSync } from "fs";
import { createRequire } from "module";
import { defineConfig, loadEnv, type Plugin } from "vite";

/** pdf.js's standard fonts (for PDFs that use a font without embedding it), served at /pdfjs/standard_fonts/. */
function pdfjsStandardFonts(): Plugin {
  const dir = path.join(path.dirname(createRequire(import.meta.url).resolve("pdfjs-dist/package.json")), "standard_fonts");
  const prefix = "/pdfjs/standard_fonts/";
  return {
    name: "pdfjs-standard-fonts",
    configureServer(server) {
      server.middlewares.use(prefix, (req, res, next) => {
        const file = path.basename(decodeURIComponent((req.url ?? "").split("?")[0]));
        if (!readdirSync(dir).includes(file)) return next();
        res.setHeader("Content-Type", "application/octet-stream");
        res.end(readFileSync(path.join(dir, file)));
      });
    },
    generateBundle() {
      for (const file of readdirSync(dir)) this.emitFile({ type: "asset", fileName: `${prefix.slice(1)}${file}`, source: readFileSync(path.join(dir, file)) });
    },
  };
}

export default defineConfig(({ mode }) => {
  const viteEnv = loadEnv(mode, process.cwd(), "");

  const apiHttps = viteEnv.VITE_API_HTTPS || nodeEnv.services__backend__https__0 || "N/A";
  const apiHttp = viteEnv.VITE_API_HTTP || nodeEnv.services__backend__http__0 || "N/A";
  // `??` so an explicitly empty VITE_API_BASE means "same origin" (used by the Docker build behind a reverse proxy)
  const apiBase = viteEnv.VITE_API_BASE ?? (nodeEnv.services__backend__https__0 || nodeEnv.services__backend__http__0 || "N/A");

  console.log("===== RESOLVED ENVIRONMENT =====");
  console.log("NODE_ENV =", nodeEnv.NODE_ENV);
  console.log("HOST =", nodeEnv.HOST);
  console.log("PORT =", nodeEnv.PORT);
  console.log("API HTTPS =", apiHttps);
  console.log("API HTTP =", apiHttp);
  console.log("API BASE =", apiBase);
  console.log("================================");

  return {
    plugins: [react(), tailwindcss(), pdfjsStandardFonts()],
    resolve: {
      tsconfigPaths: true,
      alias: {
        "@components": path.resolve(__dirname, "../../packages/ui/src/components/ui"),
        "@components/ui": path.resolve(__dirname, "../../packages/ui/src/components/ui"),
        "@starlights/ui": path.resolve(__dirname, "../../packages/ui/src"),
      },
    },
    server: {
      port: parseInt(nodeEnv.PORT || "55052"),
      open: true,
    },
    define: {
      "import.meta.env.VITE_API_HTTPS": JSON.stringify(apiHttps),
      "import.meta.env.VITE_API_HTTP": JSON.stringify(apiHttp),
      "import.meta.env.VITE_API_BASE": JSON.stringify(apiBase),
    },
  };
});
