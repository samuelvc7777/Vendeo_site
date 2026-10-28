import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.8";

const allowedOrigin = "https://vendeo-e755e.web.app";
const cors = {
  "Access-Control-Allow-Origin": allowedOrigin,
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-match-session",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Cache-Control": "no-store",
  "Content-Type": "application/json",
};
const json = (value: unknown, status = 200) =>
  new Response(JSON.stringify(value), { status, headers: cors });
const sha256 = async (secret: string) => {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(secret));
  return Array.from(new Uint8Array(digest), x => x.toString(16).padStart(2, "0")).join("");
};
const safeString = (value: unknown) => typeof value === "string" ? value : "";
const isValidId = (value: string) => value.length > 0 && value.length <= 200;
const photoUrl = (p: Record<string, unknown>): string => {
  if (typeof p.url === "string") return p.url;
  const list = Array.isArray(p.processedFiles) ? p.processedFiles : [];
  const chosen = [...list].sort((a: any, b: any) => Number(b?.width || 0) - Number(a?.width || 0))[0];
  return safeString(chosen?.url);
};
const normalize = (value: any) => {
  const person = value?.person || value?.user || {};
  const personId = safeString(person?._id || person?.id);
  const matchId = safeString(value?.id || value?._id);
  if (!isValidId(personId) || !isValidId(matchId)) return null;
  const photos = (Array.isArray(person.photos) ? person.photos : [])
    .map((p: any, i: number) => ({ id: safeString(p?.id) || personId + "-" + i, url: photoUrl(p) }))
    .filter((p: any) => p.url);
  let age: number | null = null;
  const birth = Date.parse(safeString(person.birth_date || person.birthDate));
  if (Number.isFinite(birth)) {
    const now = new Date();
    const born = new Date(birth);
    age = now.getUTCFullYear() - born.getUTCFullYear()
      - (now.getUTCMonth() < born.getUTCMonth() ||
        now.getUTCMonth() === born.getUTCMonth() && now.getUTCDate() < born.getUTCDate() ? 1 : 0);
    if (age < 18 || age > 119) age = null;
  }
  const countCandidate = value?.message_count ?? value?.messageCount ?? null;
  const messageCount = countCandidate == null || !Number.isFinite(Number(countCandidate))
    ? null : Math.max(0, Number(countCandidate));
  return {
    id: matchId,
    person: {
      id: personId, name: safeString(person.name) || "Match",
      bio: safeString(person.bio), birthDate: safeString(person.birth_date) || null,
      age, photos, interests: [],
    },
    messages: [],
    messageCount,
    unreadCount: Number(value?.unread_count || 0),
    isNewMatch: Boolean(value?.is_new_match),
    lastActivityAt: value?.last_activity_date || value?.created_date || null,
  };
};

Deno.serve(async req => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);
  if (req.headers.get("origin") !== allowedOrigin) return json({ error: "origin_not_allowed" }, 403);

  const session = req.headers.get("x-match-session") || "";
  if (!session || session.length > 200) return json({ error: "match_session_required" }, 401);
  const url = Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) return json({ error: "service_unavailable" }, 503);
  const db = createClient(url, key, { auth: { persistSession: false } });
  const { data: config, error: dbError } = await db.from("match_tinder_config")
    .select("auth_token, session_hash").eq("id", "default").maybeSingle();
  if (dbError) return json({ error: "session_lookup_unavailable" }, 503);
  if (!config?.session_hash || await sha256(session) !== config.session_hash) {
    return json({ error: "match_session_invalid" }, 401);
  }
  if (!config.auth_token) return json({ error: "tinder_not_connected" }, 409);

  try {
    const authHash = await sha256(String(config.auth_token));
    const uuid = (offset: number) => {
      const hex = (authHash + authHash).slice(offset, offset + 32);
      return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
    };
    const result = new Map<string, ReturnType<typeof normalize>>();
    const seenPages = new Set<string>();
    let nextPage = "";
    // Respeita o limite de paginação; sem swipes, mensagens ou outras mutações.
    for (let page = 0; page < 4; page++) {
      const endpoint = new URL("https://api.gotinder.com/v2/matches");
      endpoint.searchParams.set("locale", "pt");
      endpoint.searchParams.set("count", "60");
      endpoint.searchParams.set("message", "0");
      endpoint.searchParams.set("is_tinder_u", "false");
      if (nextPage) endpoint.searchParams.set("page_token", nextPage);
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 13000);
      let response: Response;
      try {
        response = await fetch(endpoint, {
          method: "GET", signal: controller.signal,
          headers: {
            Accept: "application/json",
            "accept-language": "pt-BR,pt;q=0.9,en;q=0.8",
            platform: "web",
            "app-version": "1073604",
            "tinder-version": "7.36.4",
            "x-supported-image-formats": "webp,jpeg",
            "x-auth-token": String(config.auth_token),
            "persistent-device-id": uuid(0),
            "app-session-id": uuid(16),
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/154.0.0.0 Safari/537.36",
            Origin: "https://tinder.com",
            Referer: "https://tinder.com/",
          },
        });
      } finally {
        clearTimeout(timeout);
      }
      if (!response.ok) {
        return json({ error: response.status === 401 ? "tinder_token_expired" : "tinder_matches_unavailable" },
          response.status === 401 ? 401 : 502);
      }
      const data = await response.json();
      const raw = data?.data?.matches || data?.matches || data?.data?.data?.matches || [];
      for (const item of Array.isArray(raw) ? raw : []) {
        const normalized = normalize(item);
        if (normalized) result.set(normalized.id, normalized);
      }
      const candidate = safeString(data?.data?.next_page_token || data?.next_page_token || data?.data?.data?.next_page_token);
      if (!candidate || seenPages.has(candidate) || !Array.isArray(raw) || raw.length === 0) break;
      seenPages.add(candidate);
      nextPage = candidate;
    }
    return json({ matches: [...result.values()], count: result.size });
  } catch {
    return json({ error: "tinder_matches_unavailable" }, 503);
  }
});