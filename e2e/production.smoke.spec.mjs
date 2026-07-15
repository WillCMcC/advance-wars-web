import { expect, test } from "@playwright/test";

const ROM_SHA = "ef3cc89273f9df88020f07751ea6306b25c39df01893822fe431550eedf9b134";
const MGBA_CORE_PATH = /^\/emulator\/cores\/mgba(?:-thread)?(?:-legacy)?-wasm\.data$/;

test("exact production release boots through the private HTTPS ingress", async ({ page, request }) => {
  const expected = process.env.EXPECTED_COMMIT;
  expect(expected, "EXPECTED_COMMIT is required").toMatch(/^[0-9a-f]{40}$/);

  const health = await request.get("/healthz", { headers: { "cache-control": "no-cache" } });
  expect(health.ok()).toBe(true);
  expect(await health.text()).toContain("advance wars web ok");
  const version = await (await request.get("/version.json", { headers: { "cache-control": "no-cache" } })).json();
  expect(version).toMatchObject({ app: "advance-wars-web", commit: expected, rom_sha256: ROM_SHA });
  const manifest = await (await request.get("/game-manifest.json", { headers: { "cache-control": "no-cache" } })).json();
  expect(manifest).toMatchObject({
    core: "mgba",
    emulator_version: "4.2.3",
    rom: { bytes: 8_388_608, sha256: ROM_SHA }
  });

  const assets = [];
  page.on("response", (response) => {
    const url = new URL(response.url());
    if (response.ok() && (url.pathname.endsWith(".gba") || (url.pathname.includes("mgba") && url.pathname.endsWith(".data")))) {
      assets.push({ origin: url.origin, path: url.pathname });
    }
  });
  await page.goto(`/?e2e=1&release=${expected}`, { waitUntil: "domcontentloaded" });
  expect(await page.evaluate(() => window.isSecureContext)).toBe(true);
  await expect(page).toHaveTitle("Advance Wars 2 — Field Console");
  await expect(page.locator("main")).toHaveAttribute("data-release-marker", "advance-wars-2-black-hole-rising");
  await expect(page.locator("#status-text")).toHaveText("Ready to deploy");
  await page.locator(".ejs_start_button").click();
  await expect(page.locator("#status-text")).toHaveText("Campaign running", { timeout: 45_000 });
  expect(await page.evaluate(() => window.EJS_emulator?.getCore?.())).toBe("mgba");
  const origin = new URL(page.url()).origin;
  expect(assets).toEqual(expect.arrayContaining([
    { origin, path: "/roms/advance-wars-2.gba" },
    { origin, path: expect.stringMatching(MGBA_CORE_PATH) }
  ]));
  await expect.poll(
    async () => (await page.locator(".ejs_canvas").screenshot()).byteLength,
    { timeout: 15_000 }
  ).toBeGreaterThan(5_000);

  expect(await page.evaluate(async () => {
    await navigator.serviceWorker.register("/service-worker.js", { scope: "/" });
    return (await navigator.serviceWorker.ready).scope;
  })).toBe(`${origin}/`);
  await page.reload({ waitUntil: "domcontentloaded" });
  await expect.poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller))).toBe(true);
  await expect(page).toHaveTitle("Advance Wars 2 — Field Console");
});
