import { readFile } from "node:fs/promises";
import { devices, expect, test } from "@playwright/test";

const MGBA_CORE_PATH = /^\/emulator\/cores\/mgba(?:-thread)?(?:-legacy)?-wasm\.data$/u;
const games = [
  {
    id: "advance-wars-2-black-hole-rising",
    title: "Advance Wars 2 — Field Kit",
    shortTitle: "Advance Wars 2",
    rom: "/roms/advance-wars-2.gba",
    bytes: 8_388_608,
    saveBytes: 65_536
  },
  {
    id: "pokemon-emerald-rogue-v2-1a",
    title: "Emerald Rogue — Field Kit",
    shortTitle: "Emerald Rogue",
    rom: "/roms/pokemon-emerald-rogue-v2.1a.gba",
    bytes: 33_554_432,
    saveBytes: 131_072
  }
];

function gameUrl(game, suffix = "") {
  return `/?game=${game.id}&e2e=1${suffix}`;
}

async function boot(page, game = games[0], { menu = false, url = gameUrl(game) } = {}) {
  await page.goto(url);
  await expect(page.locator("#status-text")).toHaveText("Ready to launch");
  await page.locator(".ejs_start_button").click();
  await expect.poll(() => page.evaluate(() => Boolean(window.EJS_emulator?.started)), { timeout: 45_000 }).toBe(true);
  if (menu) await page.evaluate(() => window.EJS_emulator.menu.open(true));
}

async function saveDigest(page) {
  return page.evaluate(async () => {
    const manager = window.EJS_emulator.gameManager;
    manager.saveSaveFiles();
    const bytes = manager.getSaveFile(false);
    const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
    return [...digest].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  });
}

test("renders the private two-cartridge Field Kit with no external runtime requests", async ({ page }) => {
  const successfulExternalResponses = [];
  page.on("response", (response) => {
    if (new URL(response.url()).origin !== "http://127.0.0.1:4173" && response.ok()) {
      successfulExternalResponses.push(response.url());
    }
  });

  await page.goto(gameUrl(games[0]));
  await expect(page).toHaveTitle(games[0].title);
  await expect(page.locator("main")).toHaveAttribute("data-release-marker", "field-kit-save-sync-v1");
  await expect(page.locator("main")).toHaveAttribute("data-active-game", games[0].id);
  await expect(page.getByRole("navigation", { name: "Choose a game" }).getByRole("link")).toHaveCount(2);
  await expect(page.getByRole("link", { name: /ER Roguelike/u })).toHaveAttribute("href", `/?game=${games[1].id}`);
  await expect(page.locator("#status-text")).toHaveText("Ready to launch");
  await expect(page.locator(".ejs_start_button")).toHaveText(/DEPLOY/u);
  await expect(page.locator("#game")).toBeVisible();
  await expect(page.locator(".status-chip")).toHaveAttribute("role", "status");

  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
  expect(successfulExternalResponses).toEqual([]);
});

test("launches from the semantic start control with the keyboard", async ({ page }) => {
  await page.goto(gameUrl(games[1]));
  await expect(page.locator("#status-text")).toHaveText("Ready to launch");
  const startButton = page.getByRole("button", { name: "Launch Emerald Rogue" });
  await expect(startButton).toHaveAttribute("tabindex", "0");
  for (let step = 0; step < 14 && !(await startButton.evaluate((element) => element === document.activeElement)); step += 1) {
    await page.keyboard.press("Tab");
  }
  await expect(startButton).toBeFocused();
  await expect(startButton).toHaveCSS("outline-style", "solid");
  await page.keyboard.press("Enter");
  await expect.poll(() => page.evaluate(() => Boolean(window.EJS_emulator?.started)), { timeout: 45_000 }).toBe(true);
});

for (const game of games) {
  test(`boots ${game.shortTitle} from the pinned same-origin cartridge`, async ({ page }) => {
    const loadedAssets = [];
    page.on("response", (response) => {
      const url = new URL(response.url());
      if (response.ok() && (url.pathname.endsWith(".gba") || url.pathname.endsWith(".data"))) {
        loadedAssets.push({ origin: url.origin, path: url.pathname });
      }
    });
    await boot(page, game);
    await expect(page.locator(".ejs_canvas")).toBeVisible();
    await expect.poll(async () => (await page.locator(".ejs_canvas").screenshot()).byteLength).toBeGreaterThan(5_000);
    const origin = new URL(page.url()).origin;
    expect(loadedAssets).toEqual(expect.arrayContaining([
      { origin, path: game.rom },
      { origin, path: expect.stringMatching(MGBA_CORE_PATH) }
    ]));
    expect(await page.evaluate(() => window.EJS_emulator?.getCore?.())).toBe("mgba");
  });
}

test("loads the attached Emerald Rogue save exactly once on a new browser", async ({ page }) => {
  await boot(page, games[1]);
  await expect(page.locator("#status-text")).toHaveText("Attached save loaded");
  expect(await saveDigest(page)).toBe("d0efbea53b433335125d3e006e32a1702462eed661d1fe7fdd36679a1993865a");
  expect(await page.evaluate(() => {
    const manager = window.EJS_emulator.gameManager;
    return manager.FS.analyzePath("/data/saves/.field-kit-seeded-pokemon-emerald-rogue-v2-1a").exists;
  })).toBe(true);
  await page.reload();
  await expect(page.locator("#status-text")).toHaveText("Ready to launch");
  await page.locator(".ejs_start_button").click();
  await expect.poll(() => page.evaluate(() => Boolean(window.EJS_emulator?.started)), { timeout: 45_000 }).toBe(true);
  expect(await saveDigest(page)).toBe("d0efbea53b433335125d3e006e32a1702462eed661d1fe7fdd36679a1993865a");
});

test("pairs by local QR and carries an encrypted save from computer to phone and back", async ({ page, browser }, testInfo) => {
  await boot(page, games[1]);
  await expect(page.locator("#status-text")).toHaveText("Attached save loaded");
  await page.getByRole("button", { name: "Sync devices" }).click();
  await page.getByRole("button", { name: "Make pairing QR" }).click();
  await expect(page.locator("#sync-link")).toHaveValue(/^http:\/\/127\.0\.0\.1:4173\/\?game=pokemon-emerald-rogue-v2-1a#sync=[A-Za-z0-9_-]{43}$/u);
  await expect(page.locator("#sync-qr")).toBeVisible();
  const pairingLink = await page.locator("#sync-link").inputValue();
  expect(pairingLink).toMatch(/^http:\/\/127\.0\.0\.1:4173\/\?game=pokemon-emerald-rogue-v2-1a#sync=[A-Za-z0-9_-]{43}$/u);
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem("field-kit-sync-meta-v1:pokemon-emerald-rogue-v2-1a"))?.revision ?? 0)).toBe(1);
  await page.locator("#sync-dialog").getByRole("button", { name: "Close save sync" }).click();

  const phoneContext = await browser.newContext({
    ...devices["iPhone 13"],
    baseURL: testInfo.project.use.baseURL,
    serviceWorkers: "block"
  });
  const phone = await phoneContext.newPage();
  await phone.goto(pairingLink);
  expect(phone.url()).not.toContain("#sync=");
  await expect(phone.locator("#sync-summary")).toHaveText("Paired · launch to sync");
  await phone.locator(".ejs_start_button").click();
  await expect.poll(() => phone.evaluate(() => JSON.parse(localStorage.getItem("field-kit-sync-meta-v1:pokemon-emerald-rogue-v2-1a"))?.revision ?? 0), { timeout: 45_000 }).toBe(1);
  expect(await saveDigest(phone)).toBe("d0efbea53b433335125d3e006e32a1702462eed661d1fe7fdd36679a1993865a");

  await phone.evaluate(async () => {
    const manager = window.EJS_emulator.gameManager;
    manager.saveSaveFiles();
    const bytes = manager.getSaveFile(false);
    bytes[216] ^= 0xff;
    const path = manager.getSaveFilePath();
    manager.FS.unlink(path);
    manager.FS.writeFile(path, bytes);
    manager.loadSaveFiles();
    await new Promise((resolve, reject) => manager.FS.syncfs(false, (error) => error ? reject(error) : resolve()));
  });
  const changedDigest = await saveDigest(phone);
  expect(changedDigest).not.toBe("d0efbea53b433335125d3e006e32a1702462eed661d1fe7fdd36679a1993865a");
  await phone.getByRole("button", { name: "Sync devices" }).click();
  await phone.getByRole("button", { name: "Sync now" }).click();
  await expect.poll(() => phone.evaluate(() => JSON.parse(localStorage.getItem("field-kit-sync-meta-v1:pokemon-emerald-rogue-v2-1a"))?.revision ?? 0)).toBe(2);

  await page.getByRole("button", { name: "Sync devices" }).click();
  await page.getByRole("button", { name: "Sync now" }).click();
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem("field-kit-sync-meta-v1:pokemon-emerald-rogue-v2-1a"))?.revision ?? 0)).toBe(2);
  expect(await saveDigest(page)).toBe(changedDigest);
  await phoneContext.close();
});

test("keeps both shoulder controls inside the real iPhone landscape hit area", async ({ browser }, testInfo) => {
  const context = await browser.newContext({
    ...devices["iPhone 13 landscape"],
    baseURL: testInfo.project.use.baseURL,
    serviceWorkers: "block"
  });
  const page = await context.newPage();
  await boot(page, games[0]);
  await page.evaluate(() => {
    const manager = window.EJS_emulator.gameManager;
    const original = manager.simulateInput.bind(manager);
    window.__shoulderInputs = [];
    manager.simulateInput = (player, index, value) => {
      if (index === 10 || index === 11) window.__shoulderInputs.push(`${index}:${value}`);
      return original(player, index, value);
    };
  });

  for (const [selector, index] of [[".b_l", 10], [".b_r", 11]]) {
    const geometry = await page.locator(selector).evaluate((element) => {
      const rect = element.getBoundingClientRect();
      const game = element.closest(".ejs_parent").getBoundingClientRect();
      const center = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
      return {
        width: rect.width,
        height: rect.height,
        inside: rect.left >= game.left && rect.top >= game.top && rect.right <= game.right && rect.bottom <= game.bottom,
        ownsCenter: center === element || element.contains(center)
      };
    });
    expect(geometry.width).toBeGreaterThanOrEqual(44);
    expect(geometry.height).toBeGreaterThanOrEqual(44);
    expect(geometry.inside).toBe(true);
    expect(geometry.ownsCenter).toBe(true);
    await page.locator(selector).tap();
    await expect.poll(() => page.evaluate((buttonIndex) => [
      window.__shoulderInputs.includes(`${buttonIndex}:1`),
      window.__shoulderInputs.includes(`${buttonIndex}:0`)
    ], index)).toEqual([true, true]);
  }
  expect(await page.evaluate(() => ({
    horizontal: document.documentElement.scrollWidth - innerWidth,
    vertical: document.documentElement.scrollHeight - innerHeight
  }))).toEqual({ horizontal: 0, vertical: 0 });
  await context.close();
});

test("native cartridge-save export and import remain available", async ({ page }) => {
  await boot(page, games[0], { menu: true });
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("button", { name: "Export Save File", exact: true }).click()
  ]);
  expect(download.suggestedFilename()).toBe("advance-wars-2.srm");
  const exported = await readFile(await download.path());
  expect(exported.byteLength).toBe(games[0].saveBytes);

  const imported = Buffer.alloc(games[0].saveBytes);
  imported[0] = 0x42;
  imported[123] = 0xa5;
  imported[imported.length - 1] = 0xee;
  await page.evaluate(() => window.EJS_emulator.menu.open(true));
  const [chooser] = await Promise.all([
    page.waitForEvent("filechooser"),
    page.getByRole("button", { name: "Import Save File", exact: true }).click()
  ]);
  await chooser.setFiles({ name: "regression.srm", mimeType: "application/octet-stream", buffer: imported });
  await expect.poll(() => page.evaluate(() => {
    const manager = window.EJS_emulator.gameManager;
    const bytes = manager.FS.readFile(manager.getSaveFilePath());
    return [bytes.byteLength, bytes[0], bytes[123], bytes[bytes.length - 1]];
  })).toEqual([games[0].saveBytes, 0x42, 0xa5, 0xee]);
});

test("a previously booted cartridge reloads and boots fully offline", async ({ page, context }) => {
  await page.goto(`/?game=${games[0].id}`);
  await page.evaluate(async () => {
    await navigator.serviceWorker.register("/service-worker.js", { scope: "/" });
    await navigator.serviceWorker.ready;
  });
  await page.reload();
  await expect.poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller))).toBe(true);
  await expect(page.locator("#status-text")).toHaveText("Ready to launch");
  await page.locator(".ejs_start_button").click();
  await expect.poll(() => page.evaluate(() => Boolean(window.EJS_emulator?.started)), { timeout: 45_000 }).toBe(true);
  await expect.poll(() => page.evaluate(async () =>
    (await window.EJS_emulator.storage.rom.get("advance-wars-2.gba"))?.data?.byteLength ?? 0
  )).toBe(games[0].bytes);
  await page.evaluate(() => window.EJS_emulator.storage.rom.remove("advance-wars-2.gba"));

  const romResponses = [];
  page.on("response", (response) => {
    if (new URL(response.url()).pathname !== games[0].rom) return;
    void response.allHeaders().then((headers) => romResponses.push({
      method: response.request().method(),
      status: response.status(),
      fromWorker: response.fromServiceWorker(),
      length: headers["content-length"]
    }));
  });
  await context.setOffline(true);
  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(page.locator("#status-text")).toHaveText("Ready to launch");
  await page.locator(".ejs_start_button").click();
  await expect.poll(() => page.evaluate(() => Boolean(window.EJS_emulator?.started)), { timeout: 45_000 }).toBe(true);
  await expect.poll(() => romResponses.some((response) =>
    response.method === "HEAD" && response.status === 200 && response.fromWorker && response.length === String(games[0].bytes)
  )).toBe(true);
  await expect.poll(() => romResponses.some((response) =>
    response.method === "GET" && response.status === 200 && response.fromWorker && response.length === String(games[0].bytes)
  )).toBe(true);
  await expect.poll(async () => (await page.locator(".ejs_canvas").screenshot()).byteLength).toBeGreaterThan(5_000);
});
