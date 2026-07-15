import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import test from "node:test";

const config = JSON.parse(await readFile(new URL("../config/games.json", import.meta.url), "utf8"));
const app = await readFile(new URL("../src/app.js", import.meta.url), "utf8");
const crypto = await readFile(new URL("../src/sync-crypto.js", import.meta.url), "utf8");
const emulatorOverrides = await readFile(new URL("../src/emulator-overrides.css", import.meta.url), "utf8");
const html = await readFile(new URL("../src/index.html", import.meta.url), "utf8");
const worker = await readFile(new URL("../src/service-worker.js", import.meta.url), "utf8");
const server = await readFile(new URL("../server/app.mjs", import.meta.url), "utf8");
const release = await readFile(new URL("../bin/release.sh", import.meta.url), "utf8");
const provision = await readFile(new URL("../bin/provision-and-deploy.sh", import.meta.url), "utf8");
const dockerfile = await readFile(new URL("../Dockerfile", import.meta.url), "utf8");
const license = await readFile(new URL("../LICENSE", import.meta.url), "utf8");
const notices = await readFile(new URL("../THIRD_PARTY_NOTICES.md", import.meta.url), "utf8");

test("pins both owner-supplied cartridge identities and the attached Emerald save", () => {
  assert.deepEqual(config.games.map((game) => game.id), [
    "advance-wars-2-black-hole-rising",
    "pokemon-emerald-rogue-v2-1a"
  ]);
  assert.equal(config.games[0].romBytes, 8 * 1024 * 1024);
  assert.equal(config.games[1].romBytes, 32 * 1024 * 1024);
  assert.equal(config.games[1].saveBytes, 128 * 1024);
  for (const game of config.games) assert.match(game.romSha256, /^[0-9a-f]{64}$/u);
  assert.match(config.games[1].seedSha256, /^[0-9a-f]{64}$/u);
});

test("ships distinct high-resolution model artwork for both cartridges", async () => {
  assert.deepEqual(config.games.map((game) => game.bootImage), [
    "/art/advance-command-map.webp",
    "/art/emerald-expedition-map.webp"
  ]);
  for (const game of config.games) {
    const artwork = await readFile(new URL(`../src${game.bootImage}`, import.meta.url));
    assert.ok(artwork.byteLength > 100_000);
    assert.equal(artwork.subarray(0, 4).toString("ascii"), "RIFF");
    assert.equal(artwork.subarray(8, 12).toString("ascii"), "WEBP");
  }
  assert.match(app, /window\.EJS_backgroundImage = activeGame\.bootImage/u);
});

test("configures a switchable same-origin GBA runtime with persistent saves", () => {
  assert.match(app, /window\.EJS_core = "gba"/u);
  assert.match(app, /window\.EJS_gameUrl = `\/roms\/\$\{activeGame\.romFile\}`/u);
  assert.match(app, /window\.EJS_disableLocalStorage = false/u);
  assert.match(app, /"save-state-location": "browser"/u);
  assert.match(app, /"save-save-interval": 10/u);
  assert.doesNotMatch(app, /cdn\.emulatorjs\.org/u);
});

test("keeps game and save inputs outside version control", () => {
  const tracked = execFileSync("git", ["ls-files", "--", "*.gba", "*.srm"], {
    cwd: new URL("..", import.meta.url),
    encoding: "utf8"
  });
  assert.equal(tracked, "");
});

test("publishes the Field Kit library, accessible controls, and durable release marker", () => {
  assert.match(html, /data-release-marker="field-kit-model-art-v1"/u);
  assert.match(html, /id="cartridge-dock"/u);
  assert.match(html, /id="sync-dialog"/u);
  assert.match(html, /aria-label="Field Kit save pairing QR code"/u);
  assert.match(app, /startButton\.parentElement\?\.prepend\(startButton\)/u);
  assert.match(app, /startButton\.setAttribute\("role", "button"\)/u);
  assert.match(app, /startButton\.tabIndex = 0/u);
  assert.match(emulatorOverrides, /#game \.ejs_start_button \{[\s\S]*?position: absolute;[\s\S]*?z-index: 2;/u);
  assert.match(worker, /field-kit-shell-/u);
  assert.match(worker, /url\.pathname\.startsWith\("\/api\/"\)/u);
  assert.match(worker, /advance-command-map\.webp/u);
  assert.match(worker, /emerald-expedition-map\.webp/u);
  assert.match(worker, /pokemon-emerald-rogue-v2\.1a\.gba/u);
});

test("uses fragment-only QR capabilities and client-side authenticated encryption", () => {
  assert.match(app, /url\.hash = new URLSearchParams\(\{ sync: capability \}\)/u);
  assert.match(app, /history\.replaceState\(null, "",/u);
  assert.match(app, /encryptSave\(bytes, capability, activeGame\.id\)/u);
  assert.match(crypto, /name: "AES-GCM"/u);
  assert.match(crypto, /name: "HKDF"/u);
  assert.match(crypto, /additionalData: encoder\.encode\(`field-kit-save-v1:/u);
  assert.doesNotMatch(server, /decrypt|subtle|sync capability/u);
  assert.match(server, /Cache-Control": "no-store"/u);
  assert.match(server, /same-origin request required/u);
  assert.match(server, /If-None-Match is required/u);
  assert.match(server, /revision changed/u);
});

test("allows production deployment only from reviewed release entry points", () => {
  execFileSync("bash", ["-n", "bin/release.sh", "bin/provision-and-deploy.sh"], {
    cwd: new URL("..", import.meta.url)
  });
  assert.match(release, /TODOBOY_DEPLOY_TASK must identify the merge-gated release task/u);
  assert.match(release, /ADVANCE_WARS_PROJECTS_RELEASE/u);
  assert.match(release, /release requires the deploy train or the explicit Projects-pane release entry point/u);
  assert.match(release, /git check-ignore -q \.release-games\//u);
  assert.doesNotMatch(release, /TODOBOY_DEPLOY_COMMIT:-\$head_commit/u);
  assert.match(release, /version\.json.*deploy_commit/su);
  assert.match(release, /npm run test:e2e:live/u);
});

test("keeps Field Kit behind private Tailnet ingress with persistent encrypted-save storage", () => {
  assert.match(provision, /notExposeAsWebApp: true/u);
  assert.match(provision, /hasPersistentData: true/u);
  assert.match(provision, /hostPath:"\/opt\/field-kit-data",containerPath:"\/data"/u);
  assert.match(provision, /ports: \[\]/u);
  assert.match(provision, /nodeId: \$node_id/u);
  assert.match(provision, /captain-overlay-network/u);
  assert.match(provision, /127\.0\.0\.1:\$\{backend_port\}:8080/u);
  assert.match(provision, /server srv-captain--advance-wars:8080 resolve/u);
  assert.match(provision, /tailscale serve --bg --yes/u);
  assert.match(provision, /AllowFunnel/u);
  assert.doesNotMatch(provision, /cloudflared|addcustomdomain/u);
  assert.match(release, /mew\.tail79fee7\.ts\.net:10443/u);
  assert.match(release, /private backend is reachable outside mew loopback/u);
});

test("pins the runtime supply chain and secure server behavior", () => {
  const nodeLines = dockerfile.match(/^FROM node:22-alpine@sha256:[0-9a-f]{64}.*$/gmu);
  assert.equal(nodeLines?.length, 2);
  assert.match(dockerfile, /^USER node$/mu);
  assert.match(dockerfile, /^VOLUME \["\/data"\]$/mu);
  assert.match(server, /Strict-Transport-Security/u);
  assert.match(server, /Content-Security-Policy/u);
  assert.match(server, /Accept-Ranges/u);
  assert.match(license, /GNU GENERAL PUBLIC LICENSE\s+Version 3, 29 June 2007/u);
  assert.ok(license.length > 30_000);
  assert.match(notices, /NippleJS 0\.10\.2/u);
  assert.match(notices, /Socket\.IO client 4\.8\.1/u);
});
