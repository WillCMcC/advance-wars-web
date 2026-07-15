import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { cp, copyFile, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dist = path.join(root, "dist");
const source = path.join(root, "src");
const config = JSON.parse(await readFile(path.join(root, "config/games.json"), "utf8"));

async function sha256(file) {
  const bytes = await readFile(file);
  return createHash("sha256").update(bytes).digest("hex");
}

async function copyRequired(from, to) {
  await mkdir(path.dirname(to), { recursive: true });
  await copyFile(from, to);
}

function resolveCommit() {
  try {
    const stamped = execFileSync("sh", ["-c", "test -s .deploy-version && cat .deploy-version"], {
      cwd: root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"]
    }).trim();
    if (/^[0-9a-f]{40}$/.test(stamped)) return stamped;
  } catch {
    // Local builds fall through to the checked-out commit.
  }
  return execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim();
}

function stagedPath(kind, file) {
  return path.join(root, ".release-games", kind, file);
}

async function requirePinnedFile(file, bytes, digest, label) {
  const info = await stat(file).catch(() => null);
  if (!info?.isFile()) throw new Error(`Missing owner-supplied ${label}: ${file}`);
  if (info.size !== bytes) throw new Error(`${label} size mismatch: expected ${bytes}, received ${info.size}`);
  const actual = await sha256(file);
  if (actual !== digest) throw new Error(`${label} digest mismatch: expected ${digest}, received ${actual}`);
  return actual;
}

const inputs = [];
for (const game of config.games) {
  const rom = process.env[game.romEnv]
    ? path.resolve(process.env[game.romEnv])
    : stagedPath("roms", game.romFile);
  const romDigest = await requirePinnedFile(rom, game.romBytes, game.romSha256, `${game.title} ROM`);
  let seed = null;
  if (game.seedFile) {
    seed = process.env[game.seedEnv]
      ? path.resolve(process.env[game.seedEnv])
      : stagedPath("seeds", game.seedFile);
    await requirePinnedFile(seed, game.saveBytes, game.seedSha256, `${game.title} save`);
  }
  inputs.push({ game, rom, romDigest, seed });
}

await rm(dist, { recursive: true, force: true });
for (const directory of ["assets", "roms", "seeds", "licenses"]) {
  await mkdir(path.join(dist, directory), { recursive: true });
}

for (const file of ["index.html", "app.css", "manifest.webmanifest", "service-worker.js"]) {
  const target = file === "app.css" ? path.join(dist, "assets", file) : path.join(dist, file);
  let contents = await readFile(path.join(source, file), "utf8");
  contents = contents.replaceAll("__BUILD_COMMIT__", resolveCommit());
  await writeFile(target, contents);
}
await cp(path.join(source, "icons"), path.join(dist, "icons"), { recursive: true });
for (const { game, rom, seed } of inputs) {
  await copyRequired(rom, path.join(dist, "roms", game.romFile));
  if (seed) await copyRequired(seed, path.join(dist, "seeds", game.seedFile));
}

const emulatorPackage = path.join(root, "node_modules/@emulatorjs/emulatorjs");
const emulatorData = path.join(emulatorPackage, "data");
await cp(emulatorData, path.join(dist, "emulator"), { recursive: true });

const runtimeParts = [
  "emulator.js",
  "nipplejs.js",
  "shaders.js",
  "storage.js",
  "gamepad.js",
  "GameManager.js",
  "socket.io.min.js",
  "compression.js"
];
const runtimeSource = await Promise.all(
  runtimeParts.map((file) => readFile(path.join(emulatorData, "src", file), "utf8"))
);
await writeFile(
  path.join(dist, "emulator", "emulator.bundle.js"),
  `/* EmulatorJS ${config.emulatorVersion}; unminified GPL-3.0 runtime. */\n${runtimeSource.join("\n;\n")}`
);

const emulatorCss = await readFile(path.join(emulatorData, "emulator.css"), "utf8");
const themedCss = await readFile(path.join(source, "emulator-overrides.css"), "utf8");
await writeFile(path.join(dist, "assets", "emulator-themed.css"), `${emulatorCss}\n${themedCss}`);

const corePackage = path.join(root, "node_modules/@emulatorjs/core-mgba");
for (const file of ["mgba-wasm.data", "mgba-legacy-wasm.data", "mgba-thread-wasm.data", "mgba-thread-legacy-wasm.data"]) {
  await copyRequired(path.join(corePackage, file), path.join(dist, "emulator", "cores", file));
}
await copyRequired(
  path.join(corePackage, "reports", "mgba.json"),
  path.join(dist, "emulator", "cores", "reports", "mgba.json")
);

for (const [sourceFile, targetFile] of [
  ["@fontsource/bebas-neue/files/bebas-neue-latin-400-normal.woff2", "bebas-neue-latin.woff2"],
  ["@fontsource/ibm-plex-mono/files/ibm-plex-mono-latin-400-normal.woff2", "ibm-plex-mono-regular.woff2"],
  ["@fontsource/ibm-plex-mono/files/ibm-plex-mono-latin-600-normal.woff2", "ibm-plex-mono-semibold.woff2"]
]) {
  await copyRequired(path.join(root, "node_modules", sourceFile), path.join(dist, "assets", "fonts", targetFile));
}

await build({
  entryPoints: [path.join(source, "app.js")],
  outfile: path.join(dist, "assets", "app.js"),
  bundle: true,
  format: "iife",
  platform: "browser",
  target: ["es2022"],
  legalComments: "inline",
  define: {
    __FIELD_KIT_GAMES__: JSON.stringify(config.games.map(({ romEnv, seedEnv, internalTitle, gameCode, revision, ...game }) => game)),
    __FIELD_KIT_EMULATOR_VERSION__: JSON.stringify(config.emulatorVersion)
  }
});

await copyRequired(path.join(emulatorPackage, "LICENSE"), path.join(dist, "licenses", "EmulatorJS-GPL-3.0.txt"));
await copyRequired(path.join(root, "node_modules/nipplejs/LICENSE"), path.join(dist, "licenses", "NippleJS-MIT.txt"));
await copyRequired(path.join(root, "node_modules/socket.io/LICENSE"), path.join(dist, "licenses", "Socket.IO-MIT.txt"));
await copyRequired(path.join(root, "node_modules/qrcode/license"), path.join(dist, "licenses", "QRCode-MIT.txt"));
await copyRequired(path.join(root, "LICENSE"), path.join(dist, "licenses", "Field-Kit-GPL-3.0.txt"));
await copyRequired(path.join(root, "NOTICE"), path.join(dist, "licenses", "Field-Kit-NOTICE.txt"));
await copyRequired(path.join(root, "licenses/MPL-2.0.txt"), path.join(dist, "licenses", "mGBA-MPL-2.0.txt"));
await copyRequired(
  path.join(root, "node_modules/@fontsource/bebas-neue/LICENSE"),
  path.join(dist, "licenses", "Bebas-Neue-OFL-1.1.txt")
);
await copyRequired(
  path.join(root, "node_modules/@fontsource/ibm-plex-mono/LICENSE"),
  path.join(dist, "licenses", "IBM-Plex-Mono-OFL-1.1.txt")
);
await copyRequired(path.join(root, "THIRD_PARTY_NOTICES.md"), path.join(dist, "licenses", "THIRD_PARTY_NOTICES.md"));

const commit = resolveCommit();
const publicGames = config.games.map((game) => ({
  id: game.id,
  title: game.title,
  system: game.system,
  core: game.core,
  emulator_version: config.emulatorVersion,
  rom: { file: game.romFile, bytes: game.romBytes, sha256: game.romSha256 },
  save: game.seedFile
    ? { bytes: game.saveBytes, seed_file: game.seedFile, seed_sha256: game.seedSha256 }
    : { bytes: game.saveBytes }
}));
await writeFile(path.join(dist, "game-manifest.json"), `${JSON.stringify({ games: publicGames }, null, 2)}\n`);
await writeFile(
  path.join(dist, "version.json"),
  `${JSON.stringify({
    app: "field-kit",
    commit,
    games: Object.fromEntries(config.games.map((game) => [game.id, game.romSha256]))
  })}\n`
);

console.log(`Built Field Kit at ${commit.slice(0, 12)} with ${inputs.length} verified owner-supplied games.`);
