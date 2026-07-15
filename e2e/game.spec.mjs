import { readFile } from "node:fs/promises";
import { devices, expect, test } from "@playwright/test";

async function boot(page, { menu = false, url = "/?e2e=1" } = {}) {
  await page.goto(url);
  await expect(page.locator("#status-text")).toHaveText("Ready to deploy");
  await page.locator(".ejs_start_button").click();
  await expect(page.locator("#status-text")).toHaveText("Campaign running", { timeout: 45_000 });
  if (menu) await page.evaluate(() => window.EJS_emulator.menu.open(true));
}

test("renders the field console and readies the pinned local emulator", async ({ page }) => {
  const successfulExternalResponses = [];
  page.on("response", (response) => {
    if (new URL(response.url()).origin !== "http://127.0.0.1:4173" && response.ok()) {
      successfulExternalResponses.push(response.url());
    }
  });

  await page.goto("/?e2e=1");
  await expect(page).toHaveTitle("Advance Wars 2 — Field Console");
  await expect(page.locator("main")).toHaveAttribute("data-release-marker", "advance-wars-2-black-hole-rising");
  await expect(page.locator("#status-text")).toHaveText("Ready to deploy");
  await expect(page.locator(".ejs_start_button")).toHaveText(/DEPLOY/);
  await expect(page.locator("#game")).toBeVisible();
  await expect(page.locator(".status-chip")).toHaveAttribute("role", "status");

  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
  expect(successfulExternalResponses).toEqual([]);
});

for (const key of ["Enter", "Space"]) {
  test(`launches from the semantic start control with ${key}`, async ({ page }) => {
    await page.goto("/?e2e=1");
    await expect(page.locator("#status-text")).toHaveText("Ready to deploy");

    const startButton = page.getByRole("button", { name: "Deploy Advance Wars 2" });
    await expect(startButton).toHaveAttribute("tabindex", "0");
    for (let step = 0; step < 10 && !(await startButton.evaluate((element) => element === document.activeElement)); step += 1) {
      await page.keyboard.press("Tab");
    }
    await expect(startButton).toBeFocused();
    await expect(startButton).toHaveCSS("outline-style", "solid");

    await page.keyboard.press(key);
    await expect(page.locator("#status-text")).toHaveText("Campaign running", { timeout: 45_000 });
  });
}

test("boots the cartridge and exposes usable touch controls on a phone", async ({ browser }, testInfo) => {
  const context = await browser.newContext({
    ...devices["iPhone 13"],
    baseURL: testInfo.project.use.baseURL,
    serviceWorkers: "block"
  });
  const page = await context.newPage();
  const loadedAssets = new Set();
  page.on("response", (response) => {
    const pathname = new URL(response.url()).pathname;
    if (response.ok() && (pathname.endsWith(".gba") || pathname.endsWith(".data"))) loadedAssets.add(pathname);
  });

  await boot(page);
  await expect(page.locator(".ejs_canvas")).toBeVisible();
  for (const control of [".b_a", ".b_b", ".b_start", ".b_select", ".b_l", ".b_r"]) {
    await expect(page.locator(control)).toBeVisible();
  }

  await page.waitForTimeout(1_500);
  const renderedFrame = await page.locator(".ejs_canvas").screenshot();
  expect(renderedFrame.byteLength).toBeGreaterThan(5_000);
  expect(loadedAssets.has("/roms/advance-wars-2.gba")).toBe(true);
  expect([...loadedAssets].some((asset) => asset.includes("mgba") && asset.endsWith(".data"))).toBe(true);
  expect(await page.evaluate(() => window.EJS_emulator?.getCore?.())).toBe("mgba");
  await context.close();
});

test("keeps both shoulder controls inside the real iPhone landscape hit area", async ({ browser }, testInfo) => {
  const context = await browser.newContext({
    ...devices["iPhone 13 landscape"],
    baseURL: testInfo.project.use.baseURL,
    serviceWorkers: "block"
  });
  const page = await context.newPage();
  await boot(page);
  await page.evaluate(() => {
    const gameManager = window.EJS_emulator.gameManager;
    const original = gameManager.simulateInput.bind(gameManager);
    window.__shoulderInputs = [];
    gameManager.simulateInput = (player, index, value) => {
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

test("native cartridge-save export and import remain functional", async ({ page }) => {
  await boot(page, { menu: true });
  expect(await page.evaluate(() => ({
    save: window.EJS_emulator.functions.saveSave?.length ?? 0,
    load: window.EJS_emulator.functions.loadSave?.length ?? 0
  }))).toEqual({ save: 0, load: 0 });

  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("button", { name: "Export Save File", exact: true }).click()
  ]);
  expect(download.suggestedFilename()).toBe("advance-wars-2.srm");
  const exported = await readFile(await download.path());
  expect(exported.byteLength).toBe(65_536);

  const imported = Buffer.alloc(65_536);
  imported[0] = 0x42;
  imported[123] = 0xa5;
  imported[65_535] = 0xee;
  await page.evaluate(() => window.EJS_emulator.menu.open(true));
  const [chooser] = await Promise.all([
    page.waitForEvent("filechooser"),
    page.getByRole("button", { name: "Import Save File", exact: true }).click()
  ]);
  await chooser.setFiles({ name: "regression.srm", mimeType: "application/octet-stream", buffer: imported });
  await expect.poll(() => page.evaluate(() => {
    const gameManager = window.EJS_emulator.gameManager;
    const bytes = gameManager.FS.readFile(gameManager.getSaveFilePath());
    return [bytes.byteLength, bytes[0], bytes[123], bytes[bytes.length - 1]];
  })).toEqual([65_536, 0x42, 0xa5, 0xee]);
});

test("save states default to browser storage and round-trip after reload", async ({ page }) => {
  await boot(page, { menu: true });
  expect(await page.evaluate(() => window.EJS_emulator.getSettingValue("save-state-location"))).toBe("browser");
  const downloads = [];
  const choosers = [];
  page.on("download", (download) => downloads.push(download));
  page.on("filechooser", (chooser) => choosers.push(chooser));

  await page.getByRole("button", { name: "Save State", exact: true }).click();
  const key = "advance-wars-2-black-hole-rising.state";
  await expect.poll(() => page.evaluate(async (stateKey) =>
    (await window.EJS_emulator.storage.states.get(stateKey))?.byteLength ?? 0, key
  )).toBeGreaterThan(100_000);
  expect(downloads).toHaveLength(0);

  await page.reload();
  await expect(page.locator("#status-text")).toHaveText("Ready to deploy");
  await page.locator(".ejs_start_button").click();
  await expect(page.locator("#status-text")).toHaveText("Campaign running", { timeout: 45_000 });
  expect(await page.evaluate(() => window.EJS_emulator.getSettingValue("save-state-location"))).toBe("browser");
  const expectedSize = await page.evaluate(async (stateKey) =>
    (await window.EJS_emulator.storage.states.get(stateKey)).byteLength, key
  );
  await page.evaluate(() => {
    const gameManager = window.EJS_emulator.gameManager;
    const original = gameManager.loadState.bind(gameManager);
    window.__loadedStateBytes = 0;
    gameManager.loadState = (state) => {
      window.__loadedStateBytes = state.byteLength;
      return original(state);
    };
    window.EJS_emulator.menu.open(true);
  });
  await page.getByRole("button", { name: "Load State", exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.__loadedStateBytes)).toBe(expectedSize);
  expect(choosers).toHaveLength(0);
});

test("a previously booted cartridge reloads and boots fully offline", async ({ page, context }) => {
  await page.goto("/");
  await page.evaluate(async () => {
    await navigator.serviceWorker.register("/service-worker.js", { scope: "/" });
    await navigator.serviceWorker.ready;
  });
  await page.reload();
  await expect.poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller))).toBe(true);
  await expect(page.locator("#status-text")).toHaveText("Ready to deploy");
  await page.locator(".ejs_start_button").click();
  await expect(page.locator("#status-text")).toHaveText("Campaign running", { timeout: 45_000 });
  await expect.poll(() => page.evaluate(async () =>
    (await window.EJS_emulator.storage.rom.get("advance-wars-2.gba"))?.data?.byteLength ?? 0
  )).toBe(8_388_608);
  expect(await page.evaluate(async () => {
    for (const name of await caches.keys()) {
      if (!name.startsWith("advance-wars-shell-")) continue;
      const response = await (await caches.open(name)).match("/roms/advance-wars-2.gba");
      if (response) return (await response.arrayBuffer()).byteLength;
    }
    return 0;
  })).toBe(8_388_608);
  await page.evaluate(() => window.EJS_emulator.storage.rom.remove("advance-wars-2.gba"));

  const romResponses = [];
  page.on("response", (response) => {
    if (new URL(response.url()).pathname !== "/roms/advance-wars-2.gba") return;
    void response.allHeaders().then((headers) => romResponses.push({
      method: response.request().method(),
      status: response.status(),
      fromWorker: response.fromServiceWorker(),
      length: headers["content-length"]
    }));
  });
  await context.setOffline(true);
  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(page.locator("#status-text")).toHaveText("Ready to deploy");
  await page.locator(".ejs_start_button").click();
  await expect(page.locator("#status-text")).toHaveText("Campaign running", { timeout: 45_000 });
  await expect.poll(() => romResponses.some((response) =>
    response.method === "HEAD" && response.status === 200 && response.fromWorker && response.length === "8388608"
  )).toBe(true);
  await expect.poll(() => romResponses.some((response) =>
    response.method === "GET" && response.status === 200 && response.fromWorker && response.length === "8388608"
  )).toBe(true);
  await expect.poll(
    async () => (await page.locator(".ejs_canvas").screenshot()).byteLength,
    { timeout: 15_000 }
  ).toBeGreaterThan(5_000);
});
