import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dist = path.join(root, "dist");
const config = JSON.parse(await readFile(path.join(root, "config/games.json"), "utf8"));
const required = [
  "index.html",
  "assets/app.css",
  "assets/app.js",
  "assets/emulator-themed.css",
  "art/advance-command-map.webp",
  "art/emerald-expedition-map.webp",
  "emulator/loader.js",
  "emulator/emulator.bundle.js",
  "emulator/cores/mgba-wasm.data",
  "emulator/cores/mgba-legacy-wasm.data",
  "emulator/cores/mgba-thread-wasm.data",
  "emulator/cores/mgba-thread-legacy-wasm.data",
  "roms/advance-wars-2.gba",
  "roms/pokemon-emerald-rogue-v2.1a.gba",
  "seeds/pokemon-emerald-rogue-v2.1a.srm",
  "game-manifest.json",
  "manifest.webmanifest",
  "icons/icon-192.png",
  "icons/icon-512.png",
  "service-worker.js",
  "version.json",
  "licenses/Field-Kit-GPL-3.0.txt",
  "licenses/Field-Kit-NOTICE.txt",
  "licenses/NippleJS-MIT.txt",
  "licenses/Socket.IO-MIT.txt",
  "licenses/QRCode-MIT.txt",
  "licenses/mGBA-MPL-2.0.txt",
  "licenses/Bebas-Neue-OFL-1.1.txt",
  "licenses/IBM-Plex-Mono-OFL-1.1.txt"
];

for (const file of required) {
  const info = await stat(path.join(dist, file));
  assert(info.isFile() && info.size > 0, `${file} must be a non-empty build artifact`);
}

for (const file of ["licenses/NippleJS-MIT.txt", "licenses/Socket.IO-MIT.txt", "licenses/QRCode-MIT.txt"]) {
  assert.match(await readFile(path.join(dist, file), "utf8"), /Permission is hereby granted/u);
}

for (const game of config.games) {
  const rom = await readFile(path.join(dist, "roms", game.romFile));
  assert.equal(rom.byteLength, game.romBytes);
  assert.equal(createHash("sha256").update(rom).digest("hex"), game.romSha256);
  if (game.seedFile) {
    const seed = await readFile(path.join(dist, "seeds", game.seedFile));
    assert.equal(seed.byteLength, game.saveBytes);
    assert.equal(createHash("sha256").update(seed).digest("hex"), game.seedSha256);
  }
}

const html = await readFile(path.join(dist, "index.html"), "utf8");
assert.match(html, /data-release-marker="field-kit-model-art-v1"/u);
assert.match(html, /<title>Field Kit<\/title>/u);

const app = await readFile(path.join(dist, "assets/app.js"), "utf8");
for (const game of config.games) assert.match(app, new RegExp(game.id, "u"));
assert.match(app, /AES-GCM/u);
assert.match(app, /field-kit-channel-v1/u);

const manifest = JSON.parse(await readFile(path.join(dist, "game-manifest.json"), "utf8"));
assert.equal(manifest.games.length, 2);
for (const game of config.games) {
  const built = manifest.games.find((candidate) => candidate.id === game.id);
  assert.equal(built.rom.sha256, game.romSha256);
  assert.equal(built.rom.bytes, game.romBytes);
}

const version = JSON.parse(await readFile(path.join(dist, "version.json"), "utf8"));
assert.equal(version.app, "field-kit");
assert.match(version.commit, /^[0-9a-f]{40}$/u);
assert.deepEqual(Object.keys(version.games).sort(), config.games.map((game) => game.id).sort());

console.log("Production Field Kit build contract verified.");
