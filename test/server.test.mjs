import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { createFieldKitServer } from "../server/app.mjs";

async function fixture(t) {
  const root = await mkdtemp(path.join(tmpdir(), "field-kit-server-"));
  const dist = path.join(root, "dist");
  const data = path.join(root, "data");
  await mkdir(path.join(dist, "roms"), { recursive: true });
  await mkdir(path.join(dist, "art"), { recursive: true });
  await writeFile(path.join(dist, "index.html"), "<main data-release-marker=\"field-kit-model-art-v1\">Field Kit</main>");
  await writeFile(path.join(dist, "roms", "sample.gba"), Buffer.from("0123456789"));
  await writeFile(path.join(dist, "art", "sample.webp"), Buffer.from("RIFF0000WEBP"));
  const server = createFieldKitServer({ distDir: dist, dataDir: data });
  await server.ready;
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  t.after(async () => {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    await rm(root, { recursive: true, force: true });
  });
  return { origin, data };
}

test("serves the private shell, health probes, and byte ranges", async (t) => {
  const { origin } = await fixture(t);
  const page = await fetch(origin);
  assert.equal(page.status, 200);
  assert.match(await page.text(), /field-kit-model-art-v1/u);
  assert.equal(page.headers.get("cross-origin-opener-policy"), "same-origin");
  const artwork = await fetch(`${origin}/art/sample.webp`);
  assert.equal(artwork.status, 200);
  assert.equal(artwork.headers.get("content-type"), "image/webp");
  const health = await fetch(`${origin}/api/healthz`);
  assert.deepEqual(await health.json(), { ok: true, storage: "writable" });
  const range = await fetch(`${origin}/roms/sample.gba`, { headers: { Range: "bytes=2-5" } });
  assert.equal(range.status, 206);
  assert.equal(range.headers.get("content-range"), "bytes 2-5/10");
  assert.equal(await range.text(), "2345");
});

test("stores only bounded opaque saves with authorization and revision guards", async (t) => {
  const { origin, data } = await fixture(t);
  const channel = "a".repeat(43);
  const authorization = "b".repeat(43);
  const wrongAuthorization = "z".repeat(43);
  const endpoint = `${origin}/api/save-sync/${channel}/pokemon-emerald-rogue-v2-1a`;
  const payload = { version: 1, iv: "c".repeat(16), data: "d".repeat(48) };
  const baseHeaders = { Authorization: `Bearer ${authorization}`, Origin: origin, "Content-Type": "application/json" };

  const missingGuard = await fetch(endpoint, { method: "PUT", headers: baseHeaders, body: JSON.stringify({ payload }) });
  assert.equal(missingGuard.status, 428);
  const created = await fetch(endpoint, {
    method: "PUT",
    headers: { ...baseHeaders, "If-None-Match": "*" },
    body: JSON.stringify({ payload })
  });
  assert.equal(created.status, 201);
  assert.deepEqual(await created.json(), { revision: 1 });

  const storedPath = path.join(data, "save-sync", channel, "pokemon-emerald-rogue-v2-1a.json");
  const stored = JSON.parse(await readFile(storedPath, "utf8"));
  assert.equal(stored.payload.data, payload.data);
  assert.equal(stored.authorization, undefined);
  assert.notEqual(stored.authHash, authorization);
  assert.equal((await stat(storedPath)).mode & 0o777, 0o600);

  assert.equal((await fetch(endpoint, { headers: { Authorization: `Bearer ${wrongAuthorization}` } })).status, 404);
  const read = await fetch(endpoint, { headers: { Authorization: `Bearer ${authorization}` } });
  assert.equal(read.status, 200);
  assert.deepEqual(await read.json(), { revision: 1, payload });
  assert.equal(read.headers.get("etag"), '"r1"');

  const stale = await fetch(endpoint, {
    method: "PUT",
    headers: { ...baseHeaders, "If-Match": '"r0"' },
    body: JSON.stringify({ payload })
  });
  assert.equal(stale.status, 412);
  const updated = await fetch(endpoint, {
    method: "PUT",
    headers: { ...baseHeaders, "If-Match": '"r1"' },
    body: JSON.stringify({ payload: { ...payload, data: "e".repeat(48) } })
  });
  assert.equal(updated.status, 200);
  assert.deepEqual(await updated.json(), { revision: 2 });
  const deleted = await fetch(endpoint, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${authorization}`, Origin: origin, "If-Match": '"r2"' }
  });
  assert.equal(deleted.status, 204);
  assert.equal((await fetch(endpoint, { headers: { Authorization: `Bearer ${authorization}` } })).status, 404);
});

test("rejects cross-origin mutation and redirects forwarded plain HTTP", async (t) => {
  const { origin } = await fixture(t);
  const endpoint = `${origin}/api/save-sync/${"a".repeat(43)}/advance-wars-2-black-hole-rising`;
  const rejected = await fetch(endpoint, {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${"b".repeat(43)}`,
      Origin: "https://example.test",
      "If-None-Match": "*",
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ payload: { version: 1, iv: "c".repeat(16), data: "d".repeat(48) } })
  });
  assert.equal(rejected.status, 403);
  const redirect = await fetch(origin, { headers: { "X-Forwarded-Proto": "http" }, redirect: "manual" });
  assert.equal(redirect.status, 308);
  assert.match(redirect.headers.get("location"), /^https:\/\//u);
});
