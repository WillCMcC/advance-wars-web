const CACHE = "advance-wars-shell-__BUILD_COMMIT__";
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
  "/icons/boot-map.svg",
  "/icons/command-star.svg",
  "/manifest.webmanifest",
  "/game-manifest.json"
];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key.startsWith("advance-wars-shell-") && key !== CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;

  if (event.request.method === "HEAD" && url.pathname === "/roms/advance-wars-2.gba") {
    event.respondWith(
      caches.open(CACHE).then(async (cache) => {
        const cached = await cache.match("/roms/advance-wars-2.gba");
        const headers = new Headers(cached?.headers);
        headers.set("Content-Length", "8388608");
        headers.set("Content-Type", "application/octet-stream");
        headers.set("Accept-Ranges", "bytes");
        return new Response(null, { status: 200, headers });
      })
    );
    return;
  }

  if (event.request.method !== "GET") return;

  if (url.pathname === "/roms/advance-wars-2.gba") {
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

  event.respondWith(
    caches.match(event.request).then((cached) => cached || fetch(event.request).then((response) => {
      if (response.ok && ["script", "style", "font", "image"].includes(event.request.destination)) {
        caches.open(CACHE).then((cache) => cache.put(event.request, response.clone()));
      }
      return response;
    }))
  );
});
