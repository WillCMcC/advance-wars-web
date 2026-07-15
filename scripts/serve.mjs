import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "dist");
const port = Number(process.env.PORT || 4173);
const types = new Map([
  [".css", "text/css; charset=utf-8"],
  [".data", "application/octet-stream"],
  [".gba", "application/octet-stream"],
  [".html", "text/html; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".svg", "image/svg+xml"],
  [".wasm", "application/wasm"],
  [".webmanifest", "application/manifest+json"],
  [".woff2", "font/woff2"]
]);

const server = http.createServer(async (request, response) => {
  const url = new URL(request.url || "/", `http://${request.headers.host || "localhost"}`);
  const requested = decodeURIComponent(url.pathname);
  const candidate = requested === "/" ? "/index.html" : requested;
  let file = path.resolve(root, `.${candidate}`);
  if (!file.startsWith(`${root}${path.sep}`)) {
    response.writeHead(400).end("bad path");
    return;
  }
  let info = await stat(file).catch(() => null);
  if (!info?.isFile()) {
    if (path.extname(candidate)) {
      response.writeHead(404).end("not found");
      return;
    }
    file = path.join(root, "index.html");
    info = await stat(file).catch(() => null);
  }
  if (!info?.isFile()) {
    response.writeHead(404).end("not found");
    return;
  }
  response.setHeader("Content-Type", types.get(path.extname(file)) || "application/octet-stream");
  response.setHeader("Content-Length", info.size);
  response.setHeader("Cross-Origin-Opener-Policy", "same-origin");
  response.setHeader("Cross-Origin-Embedder-Policy", "require-corp");
  response.setHeader("Cross-Origin-Resource-Policy", "same-origin");
  response.setHeader("Content-Security-Policy", "default-src 'self'; connect-src 'self' blob:; script-src 'self' blob: 'wasm-unsafe-eval' 'unsafe-eval'; worker-src 'self' blob:; img-src 'self' data: blob:; media-src 'self' blob:; style-src 'self' 'unsafe-inline'; font-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'");
  response.writeHead(200);
  if (request.method === "HEAD") response.end();
  else createReadStream(file).pipe(response);
});

server.listen(port, "127.0.0.1", () => console.log(`Advance Wars preview listening at http://127.0.0.1:${port}`));
