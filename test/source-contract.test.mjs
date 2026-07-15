import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import test from "node:test";

const game = JSON.parse(await readFile(new URL("../config/game.json", import.meta.url), "utf8"));
const app = await readFile(new URL("../src/app.js", import.meta.url), "utf8");
const emulatorOverrides = await readFile(new URL("../src/emulator-overrides.css", import.meta.url), "utf8");
const html = await readFile(new URL("../src/index.html", import.meta.url), "utf8");
const worker = await readFile(new URL("../src/service-worker.js", import.meta.url), "utf8");
const release = await readFile(new URL("../bin/release.sh", import.meta.url), "utf8");
const provision = await readFile(new URL("../bin/provision-and-deploy.sh", import.meta.url), "utf8");
const nginx = await readFile(new URL("../nginx.conf", import.meta.url), "utf8");
const dockerfile = await readFile(new URL("../Dockerfile", import.meta.url), "utf8");
const license = await readFile(new URL("../LICENSE", import.meta.url), "utf8");
const notices = await readFile(new URL("../THIRD_PARTY_NOTICES.md", import.meta.url), "utf8");

test("pins the supplied Advance Wars 2 cartridge identity", () => {
  assert.equal(game.id, "advance-wars-2-black-hole-rising");
  assert.equal(game.romBytes, 8 * 1024 * 1024);
  assert.match(game.romSha256, /^[0-9a-f]{64}$/);
});

test("configures a same-origin GBA runtime with persistent saves", () => {
  assert.match(app, /EJS_core = "gba"/);
  assert.match(app, /EJS_gameUrl = "\/roms\/advance-wars-2\.gba"/);
  assert.match(app, /EJS_disableLocalStorage = false/);
  assert.match(app, /EJS_defaultOptions = \{ "save-state-location": "browser" \}/);
  assert.doesNotMatch(app, /EJS_onSaveSave|EJS_onLoadSave/);
  assert.doesNotMatch(app, /cdn\.emulatorjs\.org/);
});

test("keeps cartridge images outside version control", () => {
  const trackedRoms = execFileSync("git", ["ls-files", "--", "*.gba"], {
    cwd: new URL("..", import.meta.url),
    encoding: "utf8"
  });
  assert.equal(trackedRoms, "");
});

test("publishes accessible controls and a durable release marker", () => {
  assert.match(html, /data-release-marker="advance-wars-2-black-hole-rising"/);
  assert.match(html, /aria-label="Game status"/);
  assert.match(html, /<dialog id="help-dialog"/);
  assert.match(app, /startButton\.parentElement\?\.prepend\(startButton\)/);
  assert.match(app, /startButton\.setAttribute\("role", "button"\)/);
  assert.match(app, /startButton\.tabIndex = 0/);
  assert.match(app, /\["Enter", " "\]\.includes\(event\.key\)/);
  assert.match(emulatorOverrides, /#game \.ejs_start_button \{[\s\S]*?position: absolute;[\s\S]*?z-index: 2;/);
  assert.match(emulatorOverrides, /\.ejs_start_button:focus-visible/);
  assert.match(worker, /advance-wars-shell-/);
  assert.match(worker, /event\.request\.method === "HEAD"/);
  assert.match(worker, /emulator\/compression\/extract7z\.js/);
});

test("allows production deployment only from reviewed release entry points", () => {
  assert.match(release, /TODOBOY_DEPLOY_TASK must identify the merge-gated release task/);
  assert.match(release, /ADVANCE_WARS_PROJECTS_RELEASE/);
  assert.match(release, /release requires the deploy train or the explicit Projects-pane release entry point/);
  assert.match(release, /git check-ignore -q \.release-rom\//);
  assert.doesNotMatch(release, /TODOBOY_DEPLOY_COMMIT:-\$head_commit/);
  assert.match(release, /version\.json.*deploy_commit/s);
  assert.match(release, /npm run test:e2e:live/);
});

test("keeps the cartridge behind the private Tailnet ingress", () => {
  assert.match(provision, /notExposeAsWebApp: true/);
  assert.match(provision, /ports: \[\]/);
  assert.doesNotMatch(provision, /ports:\s*\[\s*\{/);
  assert.match(provision, /docker info --format '\{\{\.Swarm\.NodeID\}\}'/);
  assert.match(provision, /nodeId: \$node_id/);
  assert.doesNotMatch(provision, /nodeId: null/);
  assert.match(provision, /captain-overlay-network/);
  assert.match(provision, /Spec\.EndpointSpec\.Ports \/\/ \[\]/);
  assert.match(provision, /Endpoint\.Ports \/\/ \[\]/);
  assert.match(provision, /127\.0\.0\.1:\$\{backend_port\}:8080/);
  assert.match(provision, /resolver 127\.0\.0\.11 valid=5s ipv6=off/);
  assert.match(provision, /server srv-captain--advance-wars:80 resolve/);
  assert.match(provision, /rw,noexec,nosuid,nodev,size=16m/);
  assert.match(provision, /client_body_temp_path \/tmp\/client_temp/);
  assert.match(provision, /proxy_temp_path \/tmp\/proxy_temp/);
  assert.match(provision, /HostConfig\.Privileged == false/);
  assert.match(provision, /HostConfig\.CapAdd \/\/ \[\]/);
  assert.match(provision, /SecurityOpt \/\/ \[\]\) == \["no-new-privileges"\]/);
  assert.match(provision, /nginx:1\.30\.3-alpine@sha256:[0-9a-f]{64}/);
  assert.match(provision, /refusing to replace unexpected container/);
  assert.match(provision, /tailscale serve --bg --yes/);
  assert.match(provision, /AllowFunnel/);
  assert.doesNotMatch(provision, /cloudflared|addcustomdomain/);
  assert.match(release, /mew\.tail79fee7\.ts\.net:10443/);
  assert.match(release, /app health marker is exposed through the public wildcard ingress/);
  assert.match(release, /app shell is exposed through the public wildcard ingress/);
  assert.match(release, /cartridge is exposed through the public wildcard ingress/);
  assert.match(release, /http:\/\/mew\.tail79fee7\.ts\.net:8092\/healthz/);
  assert.match(release, /private backend is reachable outside mew loopback/);
});

test("pins the container supply chain and avoids immutable caching for mutable assets", () => {
  assert.match(dockerfile, /^FROM node:22-alpine@sha256:[0-9a-f]{64}/m);
  assert.match(
    dockerfile,
    /^FROM nginx:1\.30\.3-alpine@sha256:0d3b80406a13a767339fbe2f41406d6c7da727ab89cf8fae399e81f780f814d1$/m,
  );
  assert.doesNotMatch(nginx, /assets[\s\S]{0,160}immutable/);
  assert.match(nginx, /Strict-Transport-Security/);
  assert.match(license, /GNU GENERAL PUBLIC LICENSE\s+Version 3, 29 June 2007/);
  assert.ok(license.length > 30_000);
  assert.match(notices, /NippleJS 0\.10\.2/);
  assert.match(notices, /Socket\.IO client 4\.8\.1/);
});
