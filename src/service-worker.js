const CACHE = "field-kit-shell-__BUILD_COMMIT__";
const ROMS = new Map([
  ["/roms/advance-wars-2.gba", "8388608"],
  ["/roms/pokemon-emerald-rogue-v2.1a.gba", "33554432"]
]);
const SHELL = [
  "/",
  "/assets/app.css",
  "/assets/app.js",
  "/assets/emulator-themed.css",
  "/emulator/loader.js",
  "/emulator/emulator.bundle.js",
  "/emulator/compression/extract7z.js",
  "/emulator/cores/reports/mgba.json",
  "/emulator/cores/mgba-wasm.data",
  "/assets/fonts/bebas-neue-latin.woff2",
  "/assets/fonts/ibm-plex-mono-regular.woff2",
  "/assets/fonts/ibm-plex-mono-semibold.woff2",
  "/art/advance-command-map.webp",
  "/art/emerald-expedition-map.webp",
  "/icons/command-star.svg",
  "/icons/icon-192.png",
  "/icons/icon-512.png",
  "/manifest.webmanifest",
  "/game-manifest.json"
];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key.startsWith("field-kit-shell-") && key !== CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin || url.pathname.startsWith("/api/")) return;

  if (event.request.method === "HEAD" && ROMS.has(url.pathname)) {
    event.respondWith(
      caches.open(CACHE).then(async (cache) => {
        const cached = await cache.match(url.pathname);
        const headers = new Headers(cached?.headers);
        headers.set("Content-Length", ROMS.get(url.pathname));
        headers.set("Content-Type", "application/octet-stream");
        headers.set("Accept-Ranges", "bytes");
        return new Response(null, { status: 200, headers });
      })
    );
    return;
  }

  if (event.request.method !== "GET") return;

  if (ROMS.has(url.pathname)) {
    event.respondWith(
      caches.open(CACHE).then(async (cache) => {
        const cached = await cache.match(event.request);
        if (cached) return cached;
        const response = await fetch(event.request);
        if (response.ok) await cache.put(event.request, response.clone());
        return response;
      })
    );
    return;
  }

  if (url.pathname.startsWith("/seeds/")) return;

  if (event.request.mode === "navigate") {
    event.respondWith(
      fetch(event.request).catch(() => caches.match("/"))
    );
    return;
  }

  event.respondWith(
    caches.match(event.request).then((cached) => cached || fetch(event.request).then((response) => {
      if (response.ok && ["script", "style", "font", "image"].includes(event.request.destination)) {
        caches.open(CACHE).then((cache) => cache.put(event.request, response.clone()));
      }
      return response;
    }))
  );
});
