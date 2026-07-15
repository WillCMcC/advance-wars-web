import { createHash, timingSafeEqual } from "node:crypto";
import { createReadStream } from "node:fs";
import {
  chmod,
  mkdir,
  open,
  readFile,
  readdir,
  rename,
  rmdir,
  stat,
  unlink,
  writeFile
} from "node:fs/promises";
import { createServer } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

const MAX_BODY_BYTES = 220 * 1024;
const MAX_CIPHERTEXT_CHARS = 200 * 1024;
const MAX_CHANNELS = 64;
const ALLOWED_GAMES = new Set([
  "advance-wars-2-black-hole-rising",
  "pokemon-emerald-rogue-v2-1a"
]);
const types = new Map([
  [".css", "text/css; charset=utf-8"],
  [".data", "application/octet-stream"],
  [".gba", "application/octet-stream"],
  [".html", "text/html; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".md", "text/markdown; charset=utf-8"],
  [".png", "image/png"],
  [".srm", "application/octet-stream"],
  [".svg", "image/svg+xml"],
  [".wasm", "application/wasm"],
  [".webp", "image/webp"],
  [".webmanifest", "application/manifest+json"],
  [".woff2", "font/woff2"]
]);
const locks = new Map();

function securityHeaders(response) {
  response.setHeader("Cross-Origin-Opener-Policy", "same-origin");
  response.setHeader("Cross-Origin-Embedder-Policy", "require-corp");
  response.setHeader("Cross-Origin-Resource-Policy", "same-origin");
  response.setHeader("X-Content-Type-Options", "nosniff");
  response.setHeader("Referrer-Policy", "no-referrer");
  response.setHeader("X-Frame-Options", "DENY");
  response.setHeader("X-Robots-Tag", "noindex, noarchive");
  response.setHeader("Permissions-Policy", "camera=(), geolocation=(), microphone=(), payment=()");
  response.setHeader("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  response.setHeader(
    "Content-Security-Policy",
    "default-src 'self'; connect-src 'self' blob:; script-src 'self' blob: 'wasm-unsafe-eval' 'unsafe-eval'; worker-src 'self' blob:; img-src 'self' data: blob:; media-src 'self' blob:; style-src 'self' 'unsafe-inline'; font-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'"
  );
}

function sendJson(response, status, body, headers = {}) {
  const data = Buffer.from(`${JSON.stringify(body)}\n`);
  response.writeHead(status, {
    "Cache-Control": "no-store",
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": data.byteLength,
    ...headers
  });
  response.end(data);
}

function sendText(response, status, body, headers = {}) {
  const data = Buffer.from(body);
  response.writeHead(status, {
    "Content-Type": "text/plain; charset=utf-8",
    "Content-Length": data.byteLength,
    ...headers
  });
  response.end(data);
}

function expectedOrigin(request) {
  const forwardedProto = String(request.headers["x-forwarded-proto"] || "").split(",")[0].trim();
  const proto = forwardedProto || "http";
  const forwardedHost = String(request.headers["x-forwarded-host"] || "").split(",")[0].trim();
  return `${proto}://${forwardedHost || request.headers.host}`;
}

function sameOriginMutation(request) {
  return typeof request.headers.origin === "string" && request.headers.origin === expectedOrigin(request);
}

function bearer(request) {
  const match = /^Bearer ([A-Za-z0-9_-]{43})$/u.exec(request.headers.authorization || "");
  return match?.[1] || null;
}

function hashAuthorization(value) {
  return createHash("sha256").update(value).digest("hex");
}

function authorizationMatches(record, value) {
  const supplied = Buffer.from(hashAuthorization(value), "hex");
  const expected = Buffer.from(record.authHash, "hex");
  return supplied.byteLength === expected.byteLength && timingSafeEqual(supplied, expected);
}

function validPayload(payload) {
  return payload?.version === 1 &&
    typeof payload.iv === "string" && /^[A-Za-z0-9_-]{16}$/u.test(payload.iv) &&
    typeof payload.data === "string" && payload.data.length >= 24 &&
    payload.data.length <= MAX_CIPHERTEXT_CHARS && /^[A-Za-z0-9_-]+$/u.test(payload.data);
}

async function readJson(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.byteLength;
    if (size > MAX_BODY_BYTES) throw Object.assign(new Error("request too large"), { status: 413 });
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw Object.assign(new Error("invalid JSON"), { status: 400 });
  }
}

async function withLock(key, work) {
  const previous = locks.get(key) || Promise.resolve();
  const current = previous.catch(() => {}).then(work);
  locks.set(key, current);
  try {
    return await current;
  } finally {
    if (locks.get(key) === current) locks.delete(key);
  }
}

async function readRecord(file) {
  try {
    const record = JSON.parse(await readFile(file, "utf8"));
    if (record?.version !== 1 || !/^[0-9a-f]{64}$/u.test(record.authHash) ||
      !Number.isSafeInteger(record.revision) || record.revision < 1 || !validPayload(record.payload)) {
      throw new Error("save record is corrupt");
    }
    return record;
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}

async function atomicRecordWrite(file, record) {
  await mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
  await chmod(path.dirname(file), 0o700);
  const temporary = `${file}.tmp-${process.pid}-${Date.now()}`;
  const handle = await open(temporary, "wx", 0o600);
  try {
    await handle.writeFile(`${JSON.stringify(record)}\n`, "utf8");
    await handle.sync();
  } finally {
    await handle.close();
  }
  await rename(temporary, file);
  await chmod(file, 0o600);
}

async function channelCount(syncDirectory) {
  const entries = await readdir(syncDirectory, { withFileTypes: true }).catch((error) => {
    if (error.code === "ENOENT") return [];
    throw error;
  });
  return entries.filter((entry) => entry.isDirectory()).length;
}

function parseSyncPath(pathname) {
  const match = /^\/api\/save-sync\/([A-Za-z0-9_-]{43})\/([a-z0-9-]{1,80})$/u.exec(pathname);
  if (!match || !ALLOWED_GAMES.has(match[2])) return null;
  return { channel: match[1], game: match[2] };
}

async function healthProbe(dataDirectory) {
  const probe = path.join(dataDirectory, `.health-${process.pid}-${Date.now()}`);
  await writeFile(probe, "ok", { mode: 0o600, flag: "wx" });
  await unlink(probe);
}

async function handleApi(request, response, url, dataDirectory) {
  response.setHeader("Cache-Control", "no-store");
  if (url.pathname === "/api/healthz" && request.method === "GET") {
    await healthProbe(dataDirectory);
    sendJson(response, 200, { ok: true, storage: "writable" });
    return true;
  }

  const target = parseSyncPath(url.pathname);
  if (!target) return false;
  if (!["GET", "PUT", "DELETE"].includes(request.method)) {
    response.setHeader("Allow", "GET, PUT, DELETE");
    sendJson(response, 405, { error: "method not allowed" });
    return true;
  }
  const authorization = bearer(request);
  if (!authorization) {
    sendJson(response, 404, { error: "not found" });
    return true;
  }
  if (request.method !== "GET" && !sameOriginMutation(request)) {
    sendJson(response, 403, { error: "same-origin request required" });
    return true;
  }

  const syncDirectory = path.join(dataDirectory, "save-sync");
  const file = path.join(syncDirectory, target.channel, `${target.game}.json`);
  await withLock(`${target.channel}/${target.game}`, async () => {
    const record = await readRecord(file);
    if (request.method === "GET") {
      if (!record || !authorizationMatches(record, authorization)) {
        sendJson(response, 404, { error: "not found" });
        return;
      }
      sendJson(response, 200, { revision: record.revision, payload: record.payload }, { ETag: `"r${record.revision}"` });
      return;
    }
    if (request.method === "DELETE") {
      if (!record || !authorizationMatches(record, authorization)) {
        sendJson(response, 404, { error: "not found" });
        return;
      }
      if (request.headers["if-match"] !== `"r${record.revision}"`) {
        sendJson(response, 412, { error: "revision changed", revision: record.revision }, { ETag: `"r${record.revision}"` });
        return;
      }
      await unlink(file);
      await rmdir(path.dirname(file)).catch((error) => {
        if (!["ENOTEMPTY", "ENOENT"].includes(error.code)) throw error;
      });
      response.writeHead(204, { "Cache-Control": "no-store" });
      response.end();
      return;
    }

    const body = await readJson(request);
    if (!validPayload(body?.payload)) {
      sendJson(response, 400, { error: "invalid encrypted save" });
      return;
    }
    if (!record) {
      if (request.headers["if-none-match"] !== "*") {
        sendJson(response, 428, { error: "If-None-Match is required" });
        return;
      }
      const existingChannel = await stat(path.dirname(file)).catch((error) => {
        if (error.code === "ENOENT") return null;
        throw error;
      });
      if (!existingChannel?.isDirectory() && await channelCount(syncDirectory) >= MAX_CHANNELS) {
        sendJson(response, 507, { error: "save channel limit reached" });
        return;
      }
      const created = {
        version: 1,
        authHash: hashAuthorization(authorization),
        revision: 1,
        updatedAt: new Date().toISOString(),
        payload: body.payload
      };
      await atomicRecordWrite(file, created);
      sendJson(response, 201, { revision: 1 }, { ETag: '"r1"' });
      return;
    }
    if (!authorizationMatches(record, authorization)) {
      sendJson(response, 404, { error: "not found" });
      return;
    }
    if (request.headers["if-match"] !== `"r${record.revision}"`) {
      sendJson(response, 412, { error: "revision changed", revision: record.revision }, { ETag: `"r${record.revision}"` });
      return;
    }
    const updated = {
      ...record,
      revision: record.revision + 1,
      updatedAt: new Date().toISOString(),
      payload: body.payload
    };
    await atomicRecordWrite(file, updated);
    sendJson(response, 200, { revision: updated.revision }, { ETag: `"r${updated.revision}"` });
  });
  return true;
}

function cacheHeader(pathname) {
  if (["/index.html", "/service-worker.js", "/manifest.webmanifest", "/version.json", "/game-manifest.json"].includes(pathname)) {
    return "no-cache";
  }
  if (pathname.startsWith("/roms/")) return "private, max-age=0, must-revalidate";
  if (pathname.startsWith("/seeds/")) return "no-store";
  if (pathname.startsWith("/emulator/") || pathname.startsWith("/icons/")) return "public, max-age=2592000";
  if (pathname.startsWith("/assets/")) return "public, max-age=0, must-revalidate";
  return "public, max-age=86400";
}

async function sendStatic(request, response, distDirectory, url) {
  const requested = decodeURIComponent(url.pathname);
  const candidate = requested === "/" ? "/index.html" : requested;
  let file = path.resolve(distDirectory, `.${candidate}`);
  if (!file.startsWith(`${distDirectory}${path.sep}`)) {
    sendText(response, 400, "bad path\n");
    return;
  }
  let info = await stat(file).catch(() => null);
  if (!info?.isFile()) {
    if (path.extname(candidate)) {
      sendText(response, 404, "not found\n");
      return;
    }
    file = path.join(distDirectory, "index.html");
    info = await stat(file).catch(() => null);
  }
  if (!info?.isFile()) {
    sendText(response, 404, "not found\n");
    return;
  }

  const headers = {
    "Accept-Ranges": "bytes",
    "Cache-Control": cacheHeader(candidate),
    "Content-Type": types.get(path.extname(file)) || "application/octet-stream"
  };
  const range = request.headers.range;
  if (range) {
    const match = /^bytes=(\d+)-(\d*)$/u.exec(range);
    const start = match ? Number(match[1]) : Number.NaN;
    const end = match && match[2] ? Number(match[2]) : info.size - 1;
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start > end || end >= info.size) {
      response.writeHead(416, { ...headers, "Content-Range": `bytes */${info.size}` });
      response.end();
      return;
    }
    response.writeHead(206, {
      ...headers,
      "Content-Length": end - start + 1,
      "Content-Range": `bytes ${start}-${end}/${info.size}`
    });
    if (request.method === "HEAD") response.end();
    else createReadStream(file, { start, end }).pipe(response);
    return;
  }
  response.writeHead(200, { ...headers, "Content-Length": info.size });
  if (request.method === "HEAD") response.end();
  else createReadStream(file).pipe(response);
}

export function createFieldKitServer(options = {}) {
  const distDirectory = path.resolve(options.distDir ?? fileURLToPath(new URL("../dist", import.meta.url)));
  const dataDirectory = path.resolve(options.dataDir ?? process.env.FIELD_KIT_DATA_DIR ?? "/data");
  const ready = mkdir(path.join(dataDirectory, "save-sync"), { recursive: true, mode: 0o700 })
    .then(() => chmod(dataDirectory, 0o700))
    .then(() => chmod(path.join(dataDirectory, "save-sync"), 0o700))
    .then(() => healthProbe(dataDirectory));

  const server = createServer(async (request, response) => {
    securityHeaders(response);
    try {
      await ready;
      const url = new URL(request.url || "/", `http://${request.headers.host || "localhost"}`);
      if (request.headers["x-forwarded-proto"] === "http") {
        response.writeHead(308, { Location: `https://${request.headers.host}${request.url}` });
        response.end();
        return;
      }
      if (url.pathname === "/healthz") {
        sendText(response, 200, "field kit ok\n", { "Cache-Control": "no-store" });
        return;
      }
      if (url.pathname.startsWith("/api/")) {
        if (!await handleApi(request, response, url, dataDirectory)) sendJson(response, 404, { error: "not found" });
        return;
      }
      if (!["GET", "HEAD"].includes(request.method)) {
        response.setHeader("Allow", "GET, HEAD");
        sendText(response, 405, "method not allowed\n");
        return;
      }
      await sendStatic(request, response, distDirectory, url);
    } catch (error) {
      if (!response.headersSent) sendJson(response, error.status || 500, { error: error.status ? error.message : "internal error" });
      else response.destroy();
    }
  });
  server.ready = ready;
  return server;
}
