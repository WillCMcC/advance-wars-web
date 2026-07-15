import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dist = path.join(root, "dist");
const game = JSON.parse(await readFile(path.join(root, "config/game.json"), "utf8"));
const required = [
  "index.html",
  "assets/app.css",
  "assets/app.js",
  "assets/emulator-themed.css",
  "emulator/loader.js",
  "emulator/emulator.bundle.js",
  "emulator/cores/mgba-wasm.data",
  "roms/advance-wars-2.gba",
  "game-manifest.json",
  "manifest.webmanifest",
  "service-worker.js",
  "version.json",
  "licenses/Advance-Wars-Web-GPL-3.0.txt",
  "licenses/Advance-Wars-Web-NOTICE.txt",
  "licenses/NippleJS-MIT.txt",
  "licenses/Socket.IO-MIT.txt",
  "licenses/mGBA-MPL-2.0.txt",
  "licenses/Bebas-Neue-OFL-1.1.txt",
  "licenses/IBM-Plex-Mono-OFL-1.1.txt"
];

for (const file of required) {
  const info = await stat(path.join(dist, file));
  assert(info.isFile() && info.size > 0, `${file} must be a non-empty build artifact`);
}

for (const file of ["licenses/NippleJS-MIT.txt", "licenses/Socket.IO-MIT.txt"]) {
  assert.match(await readFile(path.join(dist, file), "utf8"), /Permission is hereby granted/);
}

const rom = await readFile(path.join(dist, "roms", game.romFile));
assert.equal(rom.byteLength, game.romBytes);
assert.equal(createHash("sha256").update(rom).digest("hex"), game.romSha256);

const html = await readFile(path.join(dist, "index.html"), "utf8");
assert.match(html, /data-release-marker="advance-wars-2-black-hole-rising"/);
assert.match(html, /<title>Advance Wars 2 — Field Console<\/title>/);

const app = await readFile(path.join(dist, "assets/app.js"), "utf8");
assert.match(app, /advance-wars-2-black-hole-rising/);
assert.match(app, /EJS_core = "gba"/);

const manifest = JSON.parse(await readFile(path.join(dist, "game-manifest.json"), "utf8"));
assert.equal(manifest.rom.sha256, game.romSha256);
assert.equal(manifest.rom.bytes, game.romBytes);

const version = JSON.parse(await readFile(path.join(dist, "version.json"), "utf8"));
assert.match(version.commit, /^[0-9a-f]{40}$/);
assert.equal(version.rom_sha256, game.romSha256);

console.log("Production build contract verified.");
