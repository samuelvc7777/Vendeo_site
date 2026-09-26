import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

export const BRAIN_OPERATOR_COOKIE = "vendeo_brain_operator";
export const BRAIN_OPERATOR_SESSION_SECONDS = 8 * 60 * 60;

function getOperatorPassword() {
  return process.env.BRAIN_OPERATOR_PASSWORD || "";
}

function getSessionSecret() {
  return process.env.BRAIN_OPERATOR_SESSION_SECRET || "";
}

export function isBrainOperatorAuthConfigured() {
  return getOperatorPassword().length >= 16 && Buffer.byteLength(getSessionSecret()) >= 32;
}

function safeEqual(left: string, right: string) {
  const leftBytes = Buffer.from(left);
  const rightBytes = Buffer.from(right);
  return leftBytes.length === rightBytes.length && timingSafeEqual(leftBytes, rightBytes);
}

export function verifyBrainOperatorPassword(candidate: string) {
  const expected = getOperatorPassword();
  return isBrainOperatorAuthConfigured() && safeEqual(candidate, expected);
}

function signSession(expiresAt: number, nonce: string) {
  return createHmac("sha256", getSessionSecret()).update(`${expiresAt}.${nonce}`).digest("base64url");
}

export function createBrainOperatorSession(now = Date.now()) {
  const expiresAt = Math.floor(now / 1000) + BRAIN_OPERATOR_SESSION_SECONDS;
  const nonce = randomBytes(24).toString("base64url");
  return `${expiresAt}.${nonce}.${signSession(expiresAt, nonce)}`;
}

export function verifyBrainOperatorSession(token: string | null | undefined, now = Date.now()) {
  if (!token || !isBrainOperatorAuthConfigured()) return false;
  const [expiresAtText, nonce, signature, extra] = token.split(".");
  if (!expiresAtText || !nonce || !signature || extra !== undefined) return false;
  const expiresAt = Number(expiresAtText);
  const currentSeconds = Math.floor(now / 1000);
  if (!Number.isSafeInteger(expiresAt) || expiresAt <= currentSeconds || expiresAt > currentSeconds + BRAIN_OPERATOR_SESSION_SECONDS) {
    return false;
  }
  return safeEqual(signature, signSession(expiresAt, nonce));
}

export function isSameOriginRequest(request: Request) {
  const origin = request.headers.get("origin");
  if (!origin) return false;
  try {
    return new URL(origin).origin === new URL(request.url).origin;
  } catch {
    return false;
  }
}

export function brainOperatorCookieOptions() {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict" as const,
    path: "/api/operator",
    maxAge: BRAIN_OPERATOR_SESSION_SECONDS,
  };
}
