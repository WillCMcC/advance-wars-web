import assert from "node:assert/strict";
import test from "node:test";

const {
  createCapability,
  decryptSave,
  deriveSyncIdentity,
  encryptSave,
  sha256Hex
} = await import("../src/sync-crypto.js");

test("derives stable opaque channel and authorization identities", async () => {
  const capability = createCapability();
  assert.match(capability, /^[A-Za-z0-9_-]{43}$/u);
  const first = await deriveSyncIdentity(capability);
  const second = await deriveSyncIdentity(capability);
  assert.deepEqual(first, second);
  assert.notEqual(first.channel, first.authorization);
  assert.match(first.channel, /^[A-Za-z0-9_-]{43}$/u);
});

test("round-trips an Emerald-sized save and rejects another capability", async () => {
  const capability = createCapability();
  const save = new Uint8Array(128 * 1024);
  save[0] = 0x42;
  save[12_345] = 0xa5;
  save[save.length - 1] = 0xee;
  const encrypted = await encryptSave(save, capability, "pokemon-emerald-rogue-v2-1a");
  assert.equal(encrypted.version, 1);
  assert.ok(encrypted.data.length > save.byteLength);
  assert.deepEqual(
    await decryptSave(encrypted, capability, "pokemon-emerald-rogue-v2-1a"),
    save
  );
  await assert.rejects(
    decryptSave(encrypted, createCapability(), "pokemon-emerald-rogue-v2-1a"),
    /operation|decrypt|cipher|data/iu
  );
  assert.equal(await sha256Hex(save), "a5a3f6236f2d93536a94d6f52c6d5704c5b078aca27d382600c72249eb06e008");
});

test("binds ciphertext to its game identity", async () => {
  const capability = createCapability();
  const encrypted = await encryptSave(new Uint8Array([1, 2, 3]), capability, "advance-wars-2-black-hole-rising");
  await assert.rejects(
    decryptSave(encrypted, capability, "pokemon-emerald-rogue-v2-1a"),
    /operation|decrypt|cipher|data/iu
  );
});
