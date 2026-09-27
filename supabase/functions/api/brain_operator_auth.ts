const encoder = new TextEncoder();

export function brainOperatorIsConfigured() {
  return (Deno.env.get("BRAIN_OPERATOR_PASSWORD") || "").length >= 16
    && encoder.encode(Deno.env.get("BRAIN_OPERATOR_SESSION_SECRET") || "").length >= 32;
}

export function brainOperatorAllowedOrigin(request: Request) {
  const origin = request.headers.get("origin");
  if (!origin) return false;
  const configuredOrigins = (Deno.env.get("BRAIN_OPERATOR_ALLOWED_ORIGINS") || "")
    .split(",").map((value) => value.trim()).filter(Boolean);
  const allowed = new Set([
    "https://vendeo-e755e.web.app",
    "https://vendeo-e755e.firebaseapp.com",
    "http://localhost:3000",
    "http://127.0.0.1:3000",
    ...configuredOrigins,
  ]);
  return allowed.has(origin);
}

function bytesToBase64Url(bytes: Uint8Array) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function base64UrlToBytes(value: string) {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(normalized + "=".repeat((4 - normalized.length % 4) % 4));
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

async function hmac(secret: string, value: string) {
  const key = await crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return new Uint8Array(await crypto.subtle.sign("HMAC", key, encoder.encode(value)));
}

function constantTimeEqual(left: Uint8Array, right: Uint8Array) {
  let difference = left.length ^ right.length;
  const length = Math.max(left.length, right.length);
  for (let i = 0; i < length; i++) difference |= (left[i] || 0) ^ (right[i] || 0);
  return difference === 0;
}

export async function createBrainOperatorToken(now = Date.now()) {
  const expiresAt = Math.floor(now / 1000) + 8 * 60 * 60;
  const nonce = bytesToBase64Url(crypto.getRandomValues(new Uint8Array(24)));
  const message = `${expiresAt}.${nonce}`;
  const signature = bytesToBase64Url(await hmac(Deno.env.get("BRAIN_OPERATOR_SESSION_SECRET") || "", message));
  return `${message}.${signature}`;
}

export async function verifyBrainOperatorToken(token: string | null | undefined, now = Date.now()) {
  if (!token || !brainOperatorIsConfigured()) return false;
  const [expiresAtText, nonce, signature, extra] = token.split(".");
  if (!expiresAtText || !nonce || !signature || extra !== undefined) return false;
  const expiresAt = Number(expiresAtText);
  const currentSeconds = Math.floor(now / 1000);
  if (!Number.isSafeInteger(expiresAt) || expiresAt <= currentSeconds || expiresAt > currentSeconds + 8 * 60 * 60) return false;
  try {
    const expected = await hmac(Deno.env.get("BRAIN_OPERATOR_SESSION_SECRET") || "", `${expiresAtText}.${nonce}`);
    return constantTimeEqual(base64UrlToBytes(signature), expected);
  } catch {
    return false;
  }
}

export async function brainOperatorPasswordMatches(candidate: string) {
  const expected = Deno.env.get("BRAIN_OPERATOR_PASSWORD") || "";
  if (!brainOperatorIsConfigured() || candidate.length !== expected.length) return false;
  return constantTimeEqual(encoder.encode(candidate), encoder.encode(expected));
}

export async function hashBrainOperatorAddress(request: Request) {
  const secret = Deno.env.get("BRAIN_OPERATOR_SESSION_SECRET") || "";
  const address = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim()
    || request.headers.get("x-real-ip")?.trim()
    || "unknown-client";
  const digest = await hmac(secret, address);
  return [...digest].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function isBrainOperatorRequest(request: Request) {
  if (!brainOperatorAllowedOrigin(request)) return false;
  const header = request.headers.get("authorization") || "";
  if (!header.startsWith("Bearer ")) return false;
  return verifyBrainOperatorToken(header.slice(7));
}
