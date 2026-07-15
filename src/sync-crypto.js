const encoder = new TextEncoder();

function concatBytes(...parts) {
  const length = parts.reduce((sum, part) => sum + part.byteLength, 0);
  const joined = new Uint8Array(length);
  let offset = 0;
  for (const part of parts) {
    joined.set(part, offset);
    offset += part.byteLength;
  }
  return joined;
}

export function encodeBase64Url(bytes) {
  let binary = "";
  for (let offset = 0; offset < bytes.byteLength; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  }
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/u, "");
}

export function decodeBase64Url(value) {
  if (typeof value !== "string" || !/^[A-Za-z0-9_-]+$/u.test(value)) throw new Error("Invalid sync capability");
  const padded = value.replaceAll("-", "+").replaceAll("_", "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
  const binary = atob(padded);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

async function digest(bytes) {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
}

export async function sha256Hex(bytes) {
  return [...await digest(bytes)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function createCapability() {
  return encodeBase64Url(crypto.getRandomValues(new Uint8Array(32)));
}

export async function deriveSyncIdentity(capability) {
  const secret = decodeBase64Url(capability);
  if (secret.byteLength !== 32 || capability.length !== 43) throw new Error("Invalid sync capability");
  const channel = await digest(concatBytes(encoder.encode("field-kit-channel-v1\0"), secret));
  const authorization = await digest(concatBytes(encoder.encode("field-kit-auth-v1\0"), secret));
  return {
    channel: encodeBase64Url(channel),
    authorization: encodeBase64Url(authorization)
  };
}

async function deriveEncryptionKey(capability, gameId) {
  const secret = decodeBase64Url(capability);
  const material = await crypto.subtle.importKey("raw", secret, "HKDF", false, ["deriveKey"]);
  return crypto.subtle.deriveKey({
    name: "HKDF",
    hash: "SHA-256",
    salt: encoder.encode("field-kit-save-sync-v1"),
    info: encoder.encode(`game:${gameId}`)
  }, material, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
}

export async function encryptSave(bytes, capability, gameId) {
  const save = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveEncryptionKey(capability, gameId);
  const data = new Uint8Array(await crypto.subtle.encrypt({
    name: "AES-GCM",
    iv,
    additionalData: encoder.encode(`field-kit-save-v1:${gameId}`),
    tagLength: 128
  }, key, save));
  return { version: 1, iv: encodeBase64Url(iv), data: encodeBase64Url(data) };
}

export async function decryptSave(payload, capability, gameId) {
  if (payload?.version !== 1 || typeof payload.iv !== "string" || typeof payload.data !== "string") {
    throw new Error("Unsupported encrypted save");
  }
  const iv = decodeBase64Url(payload.iv);
  const data = decodeBase64Url(payload.data);
  if (iv.byteLength !== 12) throw new Error("Invalid encrypted save");
  const key = await deriveEncryptionKey(capability, gameId);
  return new Uint8Array(await crypto.subtle.decrypt({
    name: "AES-GCM",
    iv,
    additionalData: encoder.encode(`field-kit-save-v1:${gameId}`),
    tagLength: 128
  }, key, data));
}
