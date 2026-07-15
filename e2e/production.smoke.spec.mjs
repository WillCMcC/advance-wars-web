import { expect, test } from "@playwright/test";

const games = [
  {
    id: "advance-wars-2-black-hole-rising",
    title: "Advance Wars 2 — Field Kit",
    rom: "/roms/advance-wars-2.gba",
    bytes: 8_388_608,
    sha: "ef3cc89273f9df88020f07751ea6306b25c39df01893822fe431550eedf9b134"
  },
  {
    id: "pokemon-emerald-rogue-v2-1a",
    title: "Emerald Rogue — Field Kit",
    rom: "/roms/pokemon-emerald-rogue-v2.1a.gba",
    bytes: 33_554_432,
    sha: "514d29951df8862a54381f454df0c81fa4383706f2ad1a8f5df626842e32cc34"
  }
];
const MGBA_CORE_PATH = /^\/emulator\/cores\/mgba(?:-thread)?(?:-legacy)?-wasm\.data$/u;

test("exact production release boots both cartridges through private HTTPS", async ({ page, request }) => {
  const expected = process.env.EXPECTED_COMMIT;
  expect(expected, "EXPECTED_COMMIT is required").toMatch(/^[0-9a-f]{40}$/u);

  const health = await request.get("/healthz", { headers: { "cache-control": "no-cache" } });
  expect(health.ok()).toBe(true);
  expect(await health.text()).toContain("field kit ok");
  const apiHealth = await (await request.get("/api/healthz", { headers: { "cache-control": "no-cache" } })).json();
  expect(apiHealth).toEqual({ ok: true, storage: "writable" });
  const version = await (await request.get("/version.json", { headers: { "cache-control": "no-cache" } })).json();
  expect(version).toMatchObject({ app: "field-kit", commit: expected });
  for (const game of games) expect(version.games[game.id]).toBe(game.sha);
  const manifest = await (await request.get("/game-manifest.json", { headers: { "cache-control": "no-cache" } })).json();
  expect(manifest.games).toHaveLength(2);
  for (const game of games) {
    expect(manifest.games.find((candidate) => candidate.id === game.id)).toMatchObject({
      core: "mgba",
      emulator_version: "4.2.3",
      rom: { bytes: game.bytes, sha256: game.sha }
    });
  }

  for (const game of games) {
    const assets = [];
    page.on("response", (response) => {
      const url = new URL(response.url());
      if (response.ok() && (url.pathname.endsWith(".gba") || (url.pathname.includes("mgba") && url.pathname.endsWith(".data")))) {
        assets.push({ origin: url.origin, path: url.pathname });
      }
    });
    await page.goto(`/?game=${game.id}&e2e=1&release=${expected}`, { waitUntil: "domcontentloaded" });
    expect(await page.evaluate(() => window.isSecureContext)).toBe(true);
    await expect(page).toHaveTitle(game.title);
    await expect(page.locator("main")).toHaveAttribute("data-release-marker", "field-kit-save-sync-v1");
    await expect(page.locator("main")).toHaveAttribute("data-active-game", game.id);
    await expect(page.locator("#status-text")).toHaveText("Ready to launch");
    await page.locator(".ejs_start_button").click();
    await expect.poll(() => page.evaluate(() => Boolean(window.EJS_emulator?.started)), { timeout: 45_000 }).toBe(true);
    expect(await page.evaluate(() => window.EJS_emulator?.getCore?.())).toBe("mgba");
    const origin = new URL(page.url()).origin;
    expect(assets).toEqual(expect.arrayContaining([
      { origin, path: game.rom },
      { origin, path: expect.stringMatching(MGBA_CORE_PATH) }
    ]));
    await expect.poll(async () => (await page.locator(".ejs_canvas").screenshot()).byteLength).toBeGreaterThan(5_000);
  }

  const origin = new URL(page.url()).origin;
  expect(await page.evaluate(async () => {
    await navigator.serviceWorker.register("/service-worker.js", { scope: "/" });
    return (await navigator.serviceWorker.ready).scope;
  })).toBe(`${origin}/`);
  await page.reload({ waitUntil: "domcontentloaded" });
  await expect.poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller))).toBe(true);
  await expect(page.locator("main")).toHaveAttribute("data-release-marker", "field-kit-save-sync-v1");
});
