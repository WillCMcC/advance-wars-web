import { toCanvas } from "qrcode";
import {
  createCapability,
  decryptSave,
  deriveSyncIdentity,
  encryptSave,
  sha256Hex
} from "./sync-crypto.js";

const games = __FIELD_KIT_GAMES__;
const emulatorVersion = __FIELD_KIT_EMULATOR_VERSION__;
const params = new URLSearchParams(location.search);
const requestedGame = params.get("game");
const activeGame = games.find((game) => game.id === requestedGame) || games[0];
const capabilityKey = "field-kit-sync-capability-v1";
const syncMetaPrefix = "field-kit-sync-meta-v1:";
const seedMarker = `/data/saves/.field-kit-seeded-${activeGame.id}`;

const statusText = document.querySelector("#status-text");
const statusChip = document.querySelector(".status-chip");
const housing = document.querySelector("#screen-housing");
const helpDialog = document.querySelector("#help-dialog");
const syncDialog = document.querySelector("#sync-dialog");
const installButton = document.querySelector("#install-button");
const fullscreenButton = document.querySelector("#fullscreen-button");
const syncButton = document.querySelector("#sync-button");
const syncNowButton = document.querySelector("#sync-now");
const createSyncButton = document.querySelector("#create-sync-link");
const forgetSyncButton = document.querySelector("#forget-sync");
const syncLink = document.querySelector("#sync-link");
const syncQr = document.querySelector("#sync-qr");
const qrPlaceholder = document.querySelector("#qr-placeholder");
const conflictPanel = document.querySelector("#sync-conflict");
let installPrompt = null;
let emulatorRunning = false;
let syncing = false;
let pendingSync = null;
let conflict = null;

function setStatus(label, state) {
  statusText.textContent = label;
  statusChip.dataset.state = state;
  document.documentElement.dataset.emulatorState = state;
}

function setSyncSummary(label, state = "local") {
  document.querySelector("#sync-summary").textContent = label;
  document.querySelector("#link-state").textContent = state === "paired" ? "LINK SEALED" : "LINK LOCAL";
  document.documentElement.dataset.syncState = state;
}

function currentCapability() {
  return localStorage.getItem(capabilityKey) || "";
}

function metaKey() {
  return `${syncMetaPrefix}${activeGame.id}`;
}

function readSyncMeta() {
  try {
    return JSON.parse(localStorage.getItem(metaKey()) || "null");
  } catch {
    return null;
  }
}

function writeSyncMeta(revision, digest) {
  localStorage.setItem(metaKey(), JSON.stringify({ revision, digest }));
}

function ingestPairingFragment() {
  const fragment = new URLSearchParams(location.hash.slice(1));
  const capability = fragment.get("sync");
  if (!capability) return;
  try {
    if (!/^[A-Za-z0-9_-]{43}$/u.test(capability)) throw new Error("invalid");
    localStorage.setItem(capabilityKey, capability);
    history.replaceState(null, "", `${location.pathname}${location.search}`);
    setSyncSummary("Paired · waiting", "paired");
  } catch {
    setStatus("Pairing link invalid", "error");
  }
}

function configureGamePage() {
  document.documentElement.dataset.game = activeGame.theme;
  document.documentElement.style.setProperty("--accent", activeGame.accent);
  document.documentElement.style.setProperty("--accent-soft", activeGame.accentSoft);
  document.querySelector('meta[name="theme-color"]').content = activeGame.accent;
  document.title = `${activeGame.shortTitle} — Field Kit`;
  document.querySelector("main").dataset.activeGame = activeGame.id;
  document.querySelector("#file-label").textContent = activeGame.fileLabel;
  document.querySelector("#identity-label").textContent = activeGame.identityLabel;
  document.querySelector("#intel-kicker").textContent = activeGame.fileLabel.replace("cartridge", "file");
  document.querySelector("#title-lead").textContent = activeGame.titleLead;
  document.querySelector("#title-tail").textContent = activeGame.titleTail;
  document.querySelector("#game-subtitle").textContent = activeGame.subtitle;
  document.querySelector("#game-briefing").textContent = activeGame.briefing;
  document.querySelector("#game").setAttribute("aria-label", `${activeGame.shortTitle} game display`);
  document.querySelector("#save-note").lastChild.textContent = activeGame.seedFile
    ? " Your attached Emerald Rogue save loads on this browser’s first launch. Pair once to carry later progress between devices."
    : " Saves stay in this browser until you pair another device. The emulator menu also exports manual backups.";
  document.querySelector("#cartridge-dock").replaceChildren(...games.map((game) => {
    const link = document.createElement("a");
    link.href = `/?game=${encodeURIComponent(game.id)}`;
    link.className = "cartridge-tab";
    link.dataset.active = String(game.id === activeGame.id);
    if (game.id === activeGame.id) link.setAttribute("aria-current", "page");
    link.innerHTML = `<span>${game.pickerCode}</span><small>${game.pickerKind}</small>`;
    return link;
  }));
}

function makeStartButtonAccessible() {
  const startButton = document.querySelector(".ejs_start_button");
  if (!startButton) return;
  startButton.parentElement?.prepend(startButton);
  startButton.setAttribute("role", "button");
  startButton.setAttribute("aria-label", `Launch ${activeGame.shortTitle}`);
  startButton.tabIndex = 0;
  startButton.addEventListener("keydown", (event) => {
    if (!["Enter", " "].includes(event.key) || event.repeat) return;
    event.preventDefault();
    event.stopPropagation();
    startButton.click();
  });
}

function ensureSavePath(manager) {
  const path = manager.getSaveFilePath();
  const pieces = path.split("/");
  let current = "";
  for (const piece of pieces.slice(0, -1)) {
    if (!piece) continue;
    current += `/${piece}`;
    if (!manager.FS.analyzePath(current).exists) manager.FS.mkdir(current);
  }
  return path;
}

async function persistFileSystem(manager) {
  await new Promise((resolve, reject) => manager.FS.syncfs(false, (error) => error ? reject(error) : resolve()));
}

async function replaceCartridgeSave(bytes, { markSeed = false } = {}) {
  if (bytes.byteLength !== activeGame.saveBytes) throw new Error(`Expected a ${activeGame.saveBytes}-byte save`);
  const manager = window.EJS_emulator.gameManager;
  const path = ensureSavePath(manager);
  if (manager.FS.analyzePath(path).exists) manager.FS.unlink(path);
  manager.FS.writeFile(path, bytes);
  if (markSeed) manager.FS.writeFile(seedMarker, new Uint8Array([1]));
  manager.loadSaveFiles();
  await persistFileSystem(manager);
}

function captureCartridgeSave() {
  const save = window.EJS_emulator?.gameManager?.getSaveFile();
  if (!(save instanceof Uint8Array) || save.byteLength !== activeGame.saveBytes) {
    throw new Error("Cartridge save is not ready yet");
  }
  return save;
}

async function loadAttachedSaveOnce() {
  if (!activeGame.seedFile || currentCapability()) return false;
  const manager = window.EJS_emulator.gameManager;
  if (manager.FS.analyzePath(seedMarker).exists) return false;
  setStatus("Loading attached save", "syncing");
  const response = await fetch(`/seeds/${encodeURIComponent(activeGame.seedFile)}`, { cache: "no-store" });
  if (!response.ok) throw new Error("Attached save is unavailable");
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (await sha256Hex(bytes) !== activeGame.seedSha256) throw new Error("Attached save failed verification");
  await replaceCartridgeSave(bytes, { markSeed: true });
  setStatus("Attached save loaded", "saved");
  return true;
}

async function apiRequest(identity, { method = "GET", revision, payload } = {}) {
  const endpoint = `/api/save-sync/${identity.channel}/${activeGame.id}`;
  const headers = { Authorization: `Bearer ${identity.authorization}` };
  if (payload) headers["Content-Type"] = "application/json";
  if (method === "PUT") headers[revision ? "If-Match" : "If-None-Match"] = revision ? `"r${revision}"` : "*";
  const response = await fetch(endpoint, {
    method,
    headers,
    body: payload ? JSON.stringify({ payload }) : undefined,
    cache: "no-store"
  });
  if (response.status === 404) return null;
  if (response.status === 412) {
    const error = new Error("Save revision changed");
    error.name = "SaveConflictError";
    throw error;
  }
  if (!response.ok) throw new Error(`Save sync failed (${response.status})`);
  return response.status === 204 ? null : response.json();
}

async function fetchRemote(capability) {
  const identity = await deriveSyncIdentity(capability);
  const remote = await apiRequest(identity);
  if (!remote) return { identity, remote: null };
  const bytes = await decryptSave(remote.payload, capability, activeGame.id);
  if (bytes.byteLength !== activeGame.saveBytes) throw new Error("Synced save has the wrong size");
  return { identity, remote: { ...remote, bytes, digest: await sha256Hex(bytes) } };
}

async function uploadSave(identity, capability, bytes, revision) {
  const payload = await encryptSave(bytes, capability, activeGame.id);
  return apiRequest(identity, { method: "PUT", revision, payload });
}

function showConflict(localBytes, remote, identity, capability) {
  conflict = { localBytes, remote, identity, capability };
  conflictPanel.hidden = false;
  setSyncSummary("Conflict · choose copy", "conflict");
  setStatus("Save sync needs a choice", "error");
  if (!syncDialog.open) syncDialog.showModal();
}

async function reconcileSave({ force = "auto", providedSave } = {}) {
  const capability = currentCapability();
  if (!capability || !emulatorRunning || syncing) return;
  syncing = true;
  syncNowButton.disabled = true;
  setSyncSummary("Syncing…", "paired");
  try {
    const localBytes = providedSave || captureCartridgeSave();
    const localDigest = await sha256Hex(localBytes);
    const meta = readSyncMeta();
    const { identity, remote } = await fetchRemote(capability);
    if (!remote) {
      const created = await uploadSave(identity, capability, localBytes, null);
      writeSyncMeta(created.revision, localDigest);
    } else if (force === "remote") {
      await replaceCartridgeSave(remote.bytes);
      writeSyncMeta(remote.revision, remote.digest);
    } else if (force === "local") {
      const updated = await uploadSave(identity, capability, localBytes, remote.revision);
      writeSyncMeta(updated.revision, localDigest);
    } else if (localDigest === remote.digest) {
      writeSyncMeta(remote.revision, remote.digest);
    } else if (!meta) {
      await replaceCartridgeSave(remote.bytes);
      writeSyncMeta(remote.revision, remote.digest);
    } else if (localDigest === meta.digest && remote.revision >= meta.revision) {
      await replaceCartridgeSave(remote.bytes);
      writeSyncMeta(remote.revision, remote.digest);
    } else if (remote.revision === meta.revision) {
      const updated = await uploadSave(identity, capability, localBytes, remote.revision);
      writeSyncMeta(updated.revision, localDigest);
    } else {
      showConflict(localBytes, remote, identity, capability);
      return;
    }
    conflict = null;
    conflictPanel.hidden = true;
    setSyncSummary("Encrypted · current", "paired");
    setStatus(activeGame.runningLabel, "running");
  } catch (error) {
    if (error.name === "SaveConflictError") {
      localStorage.removeItem(metaKey());
      setSyncSummary("Changed elsewhere · retry", "conflict");
    } else {
      setSyncSummary("Sync unavailable", "error");
    }
    setStatus(error.message || "Save sync failed", "error");
  } finally {
    syncing = false;
    syncNowButton.disabled = !emulatorRunning || !currentCapability();
  }
}

function scheduleSync(save) {
  if (!currentCapability() || syncing) return;
  clearTimeout(pendingSync);
  pendingSync = setTimeout(() => void reconcileSave({ providedSave: save }), 900);
}

async function renderPairingQr() {
  const capability = currentCapability();
  if (!capability) return;
  const url = new URL(location.origin);
  url.searchParams.set("game", activeGame.id);
  url.hash = new URLSearchParams({ sync: capability }).toString();
  syncLink.value = url.href;
  qrPlaceholder.hidden = true;
  syncQr.hidden = false;
  await toCanvas(syncQr, url.href, {
    errorCorrectionLevel: "M",
    margin: 3,
    width: 280,
    color: { dark: "#111a19ff", light: "#f1ead8ff" }
  });
  syncQr.style.removeProperty("width");
  syncQr.style.removeProperty("height");
  createSyncButton.textContent = "Refresh pairing QR";
  forgetSyncButton.hidden = false;
}

async function preparePairing() {
  if (!emulatorRunning) {
    setStatus(`Launch ${activeGame.shortTitle} first`, "error");
    return;
  }
  if (!currentCapability()) {
    localStorage.setItem(capabilityKey, createCapability());
    localStorage.removeItem(metaKey());
  }
  await reconcileSave();
  await renderPairingQr();
}

configureGamePage();
ingestPairingFragment();
if (currentCapability()) setSyncSummary("Paired · launch to sync", "paired");

window.EJS_player = "#game";
window.EJS_core = "gba";
window.EJS_controlScheme = "gba";
window.EJS_gameName = activeGame.id;
window.EJS_gameID = activeGame.gameId;
window.EJS_gameUrl = `/roms/${activeGame.romFile}`;
window.EJS_pathtodata = "/emulator/";
window.EJS_paths = {
  "emulator.min.js": "/emulator/emulator.bundle.js",
  "emulator.min.css": "/assets/emulator-themed.css"
};
window.EJS_color = activeGame.accent;
window.EJS_backgroundColor = "#111a19";
window.EJS_backgroundImage = "/icons/boot-map.svg";
window.EJS_backgroundBlur = false;
window.EJS_startButtonName = activeGame.startLabel;
window.EJS_alignStartButton = "center";
window.EJS_startOnLoaded = false;
window.EJS_fullscreenOnLoaded = false;
window.EJS_threads = false;
window.EJS_disableLocalStorage = false;
window.EJS_disableDatabases = false;
window.EJS_disableAutoLang = false;
window.EJS_language = "en-US";
window.EJS_volume = 0.7;
window.EJS_defaultOptions = { "save-state-location": "browser", "save-save-interval": 10 };
window.EJS_noAutoFocus = false;
window.EJS_forceLegacyCores = false;
window.EJS_VirtualGamepadSettings = [
  { type: "button", text: "B", id: "b", location: "right", left: 4, top: 74, bold: true, input_value: 0 },
  { type: "button", text: "A", id: "a", location: "right", left: 80, top: 32, bold: true, input_value: 8 },
  { type: "dpad", id: "dpad", location: "left", left: "50%", top: "50%", joystickInput: false, inputValues: [4, 5, 6, 7] },
  { type: "button", text: "Start", id: "start", location: "center", left: 64, top: 2, fontSize: 13, block: true, input_value: 3 },
  { type: "button", text: "Select", id: "select", location: "center", left: -8, top: 2, fontSize: 13, block: true, input_value: 2 },
  { type: "button", text: "L", id: "l", location: "left", left: 56, top: -26, bold: true, block: true, input_value: 10 },
  { type: "button", text: "R", id: "r", location: "right", right: 56, top: -20, bold: true, block: true, input_value: 11 }
];

window.EJS_ready = () => {
  makeStartButtonAccessible();
  setStatus("Ready to launch", "ready");
};
window.EJS_onGameStart = async () => {
  emulatorRunning = true;
  syncNowButton.disabled = !currentCapability();
  housing.classList.add("is-running");
  setStatus(activeGame.runningLabel, "running");
  window.EJS_emulator.on("saveSaveFiles", (save) => {
    if (save instanceof Uint8Array && save.byteLength === activeGame.saveBytes) scheduleSync(save);
  });
  try {
    const seeded = await loadAttachedSaveOnce();
    if (!seeded && currentCapability()) await reconcileSave();
  } catch (error) {
    setStatus(error.message || "Save setup failed", "error");
  }
};

const loader = document.createElement("script");
loader.src = "/emulator/loader.js";
loader.addEventListener("error", () => setStatus("Emulator failed to load", "error"));
document.head.appendChild(loader);

document.querySelector("#help-button").addEventListener("click", () => helpDialog.showModal());
syncButton.addEventListener("click", () => {
  syncDialog.showModal();
  if (currentCapability()) void renderPairingQr();
});
createSyncButton.addEventListener("click", () => void preparePairing());
syncNowButton.addEventListener("click", () => void reconcileSave());
document.querySelector("#copy-sync-link").addEventListener("click", async (event) => {
  if (!syncLink.value) return;
  try {
    await navigator.clipboard.writeText(syncLink.value);
    event.currentTarget.textContent = "Copied";
  } catch {
    syncLink.select();
  }
});
forgetSyncButton.addEventListener("click", () => {
  localStorage.removeItem(capabilityKey);
  for (const game of games) localStorage.removeItem(`${syncMetaPrefix}${game.id}`);
  syncLink.value = "";
  syncQr.width = 0;
  syncQr.height = 0;
  syncQr.hidden = true;
  qrPlaceholder.hidden = false;
  qrPlaceholder.textContent = "Pairing removed from this browser.";
  forgetSyncButton.hidden = true;
  createSyncButton.textContent = "Make pairing QR";
  syncNowButton.disabled = true;
  setSyncSummary("This device", "local");
});
document.querySelector("#keep-device-save").addEventListener("click", async () => {
  if (!conflict) return;
  await reconcileSave({ force: "local", providedSave: conflict.localBytes });
});
document.querySelector("#use-remote-save").addEventListener("click", async () => {
  if (!conflict) return;
  await replaceCartridgeSave(conflict.remote.bytes);
  writeSyncMeta(conflict.remote.revision, conflict.remote.digest);
  conflict = null;
  conflictPanel.hidden = true;
  setSyncSummary("Encrypted · current", "paired");
  setStatus(activeGame.runningLabel, "running");
});
syncDialog.addEventListener("close", () => {
  syncLink.value = "";
  syncQr.width = 0;
  syncQr.height = 0;
  syncQr.hidden = true;
  qrPlaceholder.hidden = false;
});

if (typeof housing.requestFullscreen !== "function" || typeof document.exitFullscreen !== "function") {
  fullscreenButton.hidden = true;
} else {
  fullscreenButton.addEventListener("click", async () => {
    try {
      if (document.fullscreenElement) {
        await document.exitFullscreen();
        return;
      }
      await housing.requestFullscreen({ navigationUI: "hide" });
      try {
        await screen.orientation?.lock?.("landscape");
      } catch {
        // Orientation lock is optional.
      }
    } catch {
      setStatus("Full screen unavailable", "error");
    }
  });
}

window.addEventListener("beforeinstallprompt", (event) => {
  event.preventDefault();
  installPrompt = event;
  installButton.hidden = false;
  document.documentElement.dataset.installAvailable = "true";
});
installButton.addEventListener("click", async () => {
  if (!installPrompt) return;
  installPrompt.prompt();
  await installPrompt.userChoice;
  installPrompt = null;
  installButton.hidden = true;
  delete document.documentElement.dataset.installAvailable;
});
window.addEventListener("appinstalled", () => {
  installButton.hidden = true;
  delete document.documentElement.dataset.installAvailable;
  setStatus("Installed for quick launch", "saved");
});

window.addEventListener("focus", () => {
  if (emulatorRunning && currentCapability()) void reconcileSave();
});
window.addEventListener("keydown", (event) => {
  const interactive = event.target instanceof Element && event.target.closest("button, [role=button], a, input, select, textarea, [contenteditable]");
  if (!interactive && !helpDialog.open && !syncDialog.open && document.documentElement.dataset.emulatorState === "running" &&
    ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(event.key)) {
    event.preventDefault();
  }
}, { passive: false });

if ("serviceWorker" in navigator && window.isSecureContext && !params.has("e2e")) {
  navigator.serviceWorker.register("/service-worker.js").catch(() => {
    // The kit remains fully playable when installation support is unavailable.
  });
}
