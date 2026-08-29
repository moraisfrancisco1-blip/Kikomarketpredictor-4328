import app from "./api";

const port = Number(process.env.PORT ?? 3000);
const distDir = `${import.meta.dir}/../dist`;
const indexPath = `${distDir}/index.html`;

const server = Bun.serve({
  port,
  async fetch(request) {
    const url = new URL(request.url);

    if (url.pathname.startsWith("/api")) {
      return app.fetch(request);
    }

    const filePath = getStaticFilePath(url.pathname);
    const file = Bun.file(filePath);

    if (await file.exists()) {
      const ext = filePath.split(".").pop()?.toLowerCase() ?? "";
      const mime: Record<string, string> = {
        js:      "application/javascript; charset=utf-8",
        mjs:     "application/javascript; charset=utf-8",
        css:     "text/css; charset=utf-8",
        html:    "text/html; charset=utf-8",
        json:    "application/json; charset=utf-8",
        webmanifest: "application/manifest+json; charset=utf-8",
        svg:     "image/svg+xml",
        png:     "image/png",
        jpg:     "image/jpeg",
        jpeg:    "image/jpeg",
        ico:     "image/x-icon",
        woff:    "font/woff",
        woff2:   "font/woff2",
        ttf:     "font/ttf",
        txt:     "text/plain; charset=utf-8",
      };
      const contentType = mime[ext] ?? "application/octet-stream";
      const headers: Record<string, string> = { "Content-Type": contentType };
      // Cache assets (hashed filenames) for 1 year; everything else no-cache
      if (url.pathname.startsWith("/assets/")) {
        headers["Cache-Control"] = "public, max-age=31536000, immutable";
      } else {
        headers["Cache-Control"] = "no-cache";
      }
      return new Response(file, { headers });
    }

    const index = Bun.file(indexPath);
    if (await index.exists()) {
      return new Response(index, {
        headers: { "Content-Type": "text/html; charset=utf-8" },
      });
    }

    return new Response("Build output not found. Run `bun run build` first.", {
      status: 500,
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  },
});

console.log(`Web server listening on http://localhost:${server.port}`);

function getStaticFilePath(pathname: string) {
  const cleanPath = decodeURIComponent(pathname)
    .replace(/^\/+/, "")
    .replaceAll("..", "");

  return cleanPath ? `${distDir}/${cleanPath}` : indexPath;
}
