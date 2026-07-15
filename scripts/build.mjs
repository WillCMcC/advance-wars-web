import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { cp, copyFile, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dist = path.join(root, "dist");
const source = path.join(root, "src");
const game = JSON.parse(await readFile(path.join(root, "config/game.json"), "utf8"));

const requiredRom = process.env.ADVANCE_WARS_ROM
  ? path.resolve(process.env.ADVANCE_WARS_ROM)
  : path.join(root, ".release-rom", game.romFile);

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

const romStat = await stat(requiredRom).catch(() => null);
if (!romStat?.isFile()) {
  throw new Error(`Missing owner-supplied ROM. Set ADVANCE_WARS_ROM or stage ${path.relative(root, requiredRom)}.`);
}
if (romStat.size !== game.romBytes) {
  throw new Error(`ROM size mismatch: expected ${game.romBytes}, received ${romStat.size}`);
}
const romDigest = await sha256(requiredRom);
if (romDigest !== game.romSha256) {
  throw new Error(`ROM digest mismatch: expected ${game.romSha256}, received ${romDigest}`);
}

await rm(dist, { recursive: true, force: true });
await mkdir(path.join(dist, "assets"), { recursive: true });
await mkdir(path.join(dist, "roms"), { recursive: true });
await mkdir(path.join(dist, "licenses"), { recursive: true });

for (const file of ["index.html", "app.css", "app.js", "manifest.webmanifest", "service-worker.js"]) {
  const target = file === "app.css" || file === "app.js" ? path.join(dist, "assets", file) : path.join(dist, file);
  let contents = await readFile(path.join(source, file), "utf8");
  contents = contents.replaceAll("__BUILD_COMMIT__", resolveCommit());
  await writeFile(target, contents);
}
await cp(path.join(source, "icons"), path.join(dist, "icons"), { recursive: true });
await copyRequired(requiredRom, path.join(dist, "roms", game.romFile));

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
  `/* EmulatorJS ${game.emulatorVersion}; unminified GPL-3.0 runtime. */\n${runtimeSource.join("\n;\n")}`
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

await copyRequired(path.join(emulatorPackage, "LICENSE"), path.join(dist, "licenses", "EmulatorJS-GPL-3.0.txt"));
await copyRequired(path.join(root, "node_modules/nipplejs/LICENSE"), path.join(dist, "licenses", "NippleJS-MIT.txt"));
await copyRequired(path.join(root, "node_modules/socket.io/LICENSE"), path.join(dist, "licenses", "Socket.IO-MIT.txt"));
await copyRequired(path.join(root, "LICENSE"), path.join(dist, "licenses", "Advance-Wars-Web-GPL-3.0.txt"));
await copyRequired(path.join(root, "NOTICE"), path.join(dist, "licenses", "Advance-Wars-Web-NOTICE.txt"));
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
await writeFile(
  path.join(dist, "game-manifest.json"),
  `${JSON.stringify({
    id: game.id,
    title: game.title,
    system: game.system,
    core: game.core,
    emulator_version: game.emulatorVersion,
    rom: { file: game.romFile, bytes: game.romBytes, sha256: game.romSha256 }
  }, null, 2)}\n`
);
await writeFile(
  path.join(dist, "version.json"),
  `${JSON.stringify({ app: "advance-wars-web", commit, rom_sha256: game.romSha256 })}\n`
);

console.log(`Built ${game.title} at ${commit.slice(0, 12)} with verified ROM ${romDigest.slice(0, 12)}…`);
