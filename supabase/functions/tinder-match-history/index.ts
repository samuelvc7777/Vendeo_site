import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.8";

const origin = "https://vendeo-e755e.web.app";
const cors = {
  "Access-Control-Allow-Origin": origin,
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-match-session",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json",
  "Cache-Control": "no-store",
};
const json = (value: unknown, status = 200) =>
  new Response(JSON.stringify(value), { status, headers: cors });
const validId = (id: unknown): id is string =>
  typeof id === "string" && id.length > 0 && id.length <= 200
  && /^[a-zA-Z0-9_:\-.]+$/.test(id);
const sha256 = async (value: string) => {
  const data = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(data), b => b.toString(16).padStart(2, "0")).join("");
};

Deno.serve(async request => {
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
  if (request.method !== "POST") return json({ error: "method_not_allowed" }, 405);
  if (request.headers.get("origin") !== origin) return json({ error: "origin_not_allowed" }, 403);
  const session = request.headers.get("x-match-session") || "";
  if (!session || session.length > 200) return json({ error: "match_session_required" }, 401);
  const url = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !serviceKey) return json({ error: "service_unavailable" }, 503);
  const db = createClient(url, serviceKey, { auth: { persistSession: false } });
  try {
    const { data: config, error: configError } = await db.from("match_tinder_config")
      .select("user_id, session_hash").eq("id", "default").maybeSingle();
    if (configError) return json({ error: "session_verification_failed" }, 503);
    const expected = String(config?.session_hash || "");
    if (!expected || await sha256(session) !== expected || !validId(config?.user_id)) {
      return json({ error: "match_session_invalid" }, 401);
    }
    const body = await request.json().catch(() => ({}));
    const accountUserId = String(config.user_id);
    if (body?.action === "check") {
      if (!validId(body?.profileId)) return json({ error: "invalid_profile_id" }, 400);
      const { data, error } = await db.from("tinder_match_history")
        .select("first_seen_at").eq("account_user_id", accountUserId)
        .eq("profile_id", body.profileId).maybeSingle();
      if (error) return json({ error: "history_lookup_failed" }, 503);
      return json({ previouslyMatched: Boolean(data), firstSeenAt: data?.first_seen_at || null });
    }
    if (body?.action === "observe") {
      const ids = body?.profileIds;
      if (!Array.isArray(ids) || ids.length > 100 || ids.some(id => !validId(id))) {
        return json({ error: "invalid_profile_ids" }, 400);
      }
      const unique = [...new Set(ids as string[])];
      if (!unique.length) return json({ recorded: 0 });
      const source = body?.source === "new_match" ? "new_match" : "current_match";
      const { error } = await db.from("tinder_match_history").upsert(
        unique.map(profileId => ({
          account_user_id: accountUserId, profile_id: profileId, source,
        })),
        { onConflict: "account_user_id,profile_id", ignoreDuplicates: true },
      );
      if (error) return json({ error: "history_save_failed" }, 503);
      return json({ recorded: unique.length });
    }
    return json({ error: "invalid_action" }, 400);
  } catch {
    return json({ error: "history_unavailable" }, 503);
  }
});
