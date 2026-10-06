import { getApiUrl } from "@/infrastructure/http/network";

const SESSION_STORAGE_KEY = "vendeo_match_tinder_session_v1";

export interface TinderPhoto {
  id: string;
  url: string;
}

export interface TinderSwipeMetadata {
  sNumber?: number | string | null;
  contentHash?: string | null;
  photoId?: string | null;
}

export interface TinderPublicProfile {
  id: string;
  name: string;
  bio: string;
  birthDate?: string | null;
  age?: number | null;
  photos: TinderPhoto[];
  isVerified?: boolean;
  job?: string | null;
  school?: string | null;
  city?: string | null;
  distanceKm?: number | null;
  interests: string[];
  swipe?: TinderSwipeMetadata;
}

export interface TinderMatchMessage {
  id: string;
  text: string;
  sentAt?: string | null;
  from?: string | null;
  to?: string | null;
  isMine?: boolean;
}

export interface TinderMatchItem {
  id: string;
  person: TinderPublicProfile;
  messages: TinderMatchMessage[];
  unreadCount: number;
  isNewMatch: boolean;
  lastActivityAt?: string | null;
}

export interface TinderLikesYouResult {
  count: number | null;
  isRange: boolean;
  locked: boolean;
  profiles: TinderPublicProfile[];
}

export interface TinderAccountState {
  likes: any;
  superLikes: any;
  boost: any;
  purchase: any;
  featureAccess: any;
  profileMeter: any;
  travel: any;
}

export type TinderSwipeAction = "like" | "pass" | "superlike";

function readSession(): string {
  if (typeof window === "undefined") return "";
  return window.localStorage.getItem(SESSION_STORAGE_KEY) || "";
}

function saveSession(sessionSecret: string): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(SESSION_STORAGE_KEY, sessionSecret);
}

export function clearTinderSession(): void {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(SESSION_STORAGE_KEY);
}

async function request<T>(
  path: string,
  init: RequestInit = {},
  options: { requireSession?: boolean } = {},
): Promise<T> {
  const headers = new Headers(init.headers || {});
  if (!headers.has("Content-Type") && init.body) {
    headers.set("Content-Type", "application/json");
  }

  // Anexa chave anon do Supabase para garantir autorização no Gateway e Edge Function
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "";
  if (anonKey) {
    if (!headers.has("apikey")) headers.set("apikey", anonKey);
    if (!headers.has("Authorization")) headers.set("Authorization", `Bearer ${anonKey}`);
  }

  const session = readSession();
  if (session) headers.set("X-Match-Session", session);

  const response = await fetch(getApiUrl(path), {
    ...init,
    headers,
    cache: "no-store",
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload?.success === false) {
    if (payload?.code === "MATCH_SESSION_INVALID" || payload?.code === "MATCH_SESSION_REQUIRED") {
      clearTinderSession();
    }
    const error = new Error(
      payload?.error || ("Falha na integração Tinder (HTTP " + response.status + ")."),
    ) as Error & { code?: string; status?: number };
    error.code = payload?.code;
    error.status = response.status;
    throw error;
  }
  return payload as T;
}

export async function connectTinder(token: string): Promise<TinderPublicProfile> {
  const payload = await request<{
    success: true;
    connected: true;
    sessionSecret: string;
    profile: TinderPublicProfile;
  }>("/api/match/tinder/connect", {
    method: "POST",
    body: JSON.stringify({ token }),
  });

  saveSession(payload.sessionSecret);
  return payload.profile;
}

export async function getTinderStatus(): Promise<{
  connected: boolean;
  requiresSession?: boolean;
  serverHasConnection?: boolean;
  tokenExpired?: boolean;
  error?: string;
  sessionSecret?: string;
  profile?: TinderPublicProfile | null;
  stale?: boolean;
}> {
  const result = await request<{
    connected: boolean;
    requiresSession?: boolean;
    serverHasConnection?: boolean;
    tokenExpired?: boolean;
    error?: string;
    sessionSecret?: string;
    profile?: TinderPublicProfile | null;
    stale?: boolean;
  }>("/api/match/tinder/status");

  if (result.sessionSecret) {
    saveSession(result.sessionSecret);
  }
  if (!result.connected && result.tokenExpired) {
    clearTinderSession();
  }

  return result;
}

export async function disconnectTinder(): Promise<void> {
  await request(
    "/api/match/tinder/disconnect",
    { method: "POST" },
    { requireSession: true },
  );
  clearTinderSession();
}

export async function getTinderRecommendations(): Promise<TinderPublicProfile[]> {
  const payload = await request<{ profiles: TinderPublicProfile[] }>(
    "/api/match/tinder/recommendations",
    {},
    { requireSession: true },
  );
  return payload.profiles || [];
}

export async function getTinderLikesYou(): Promise<TinderLikesYouResult> {
  return request<TinderLikesYouResult>(
    "/api/match/tinder/likes",
    {},
    { requireSession: true },
  );
}

export async function getTinderAccountState(): Promise<TinderAccountState> {
  const payload = await request<{ account: TinderAccountState }>(
    "/api/match/tinder/account",
    {},
    { requireSession: true },
  );
  return payload.account;
}

export async function getTinderMatches(): Promise<TinderMatchItem[]> {
  const payload = await request<{ matches: TinderMatchItem[] }>(
    "/api/match/tinder/matches",
    {},
    { requireSession: true },
  );
  return payload.matches || [];
}

export async function getTinderMessages(matchId: string): Promise<TinderMatchMessage[]> {
  const payload = await request<{ messages: TinderMatchMessage[] }>(
    "/api/match/tinder/messages/" + encodeURIComponent(matchId),
    {},
    { requireSession: true },
  );
  return payload.messages || [];
}

export async function sendTinderMessage(
  matchId: string,
  message: string,
): Promise<TinderMatchMessage> {
  const payload = await request<{ message: TinderMatchMessage }>(
    "/api/match/tinder/messages/" + encodeURIComponent(matchId),
    {
      method: "POST",
      body: JSON.stringify({ message }),
    },
    { requireSession: true },
  );
  return payload.message;
}

export async function swipeTinder(
  profile: TinderPublicProfile,
  action: TinderSwipeAction,
  undo = false,
): Promise<{ matched: boolean; likesRemaining?: number | null }> {
  return request(
    "/api/match/tinder/swipe",
    {
      method: "POST",
      body: JSON.stringify({
        userId: profile.id,
        action,
        sNumber: profile.swipe?.sNumber ?? null,
        contentHash: profile.swipe?.contentHash ?? null,
        photoId: profile.swipe?.photoId ?? profile.photos?.[0]?.id ?? null,
        undo,
      }),
    },
    { requireSession: true },
  );
}

export async function rewindTinder(): Promise<{
  profile: TinderPublicProfile;
  action?: TinderSwipeAction | null;
  pendingServerUndo?: boolean;
}> {
  return request(
    "/api/match/tinder/rewind",
    { method: "POST" },
    { requireSession: true },
  );
}

export async function activateTinderBoost(): Promise<any> {
  return request(
    "/api/match/tinder/boost",
    { method: "POST" },
    { requireSession: true },
  );
}
