const TINDER_API_BASE = "https://api.gotinder.com";
const REQUEST_TIMEOUT_MS = 12000;
const APP_VERSION = "1073604";
const TINDER_VERSION = "7.36.4";
const WEB_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/154.0.0.0 Safari/537.36";

type TinderAction = "like" | "pass" | "superlike";

interface TinderIdentity {
  deviceId: string;
  appSessionId: string;
  sessionStartedAt: number;
}

interface TinderRouteParams {
  request: Request;
  path: string;
  supabase: any;
  corsHeaders: Record<string, string>;
  originAllowed: boolean;
}

const channelCache = new Map<string, any>();

function json(value: unknown, status: number, corsHeaders: Record<string, string>): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
    },
  });
}

async function sha256Hex(value: string): Promise<string> {
  const encoded = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", encoded);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function randomSessionSecret(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  const payload = Array.from(bytes)
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
  return `mt_${crypto.randomUUID().replaceAll("-", "")}_${payload}`;
}

function ensureIdentity(config?: any): TinderIdentity {
  const startedAtRaw =
    config?.app_session_started_at ||
    config?.connected_at ||
    new Date().toISOString();
  const startedAt = new Date(startedAtRaw).getTime();
  return {
    deviceId: String(
      config?.device_id ||
      config?.persistent_device_id ||
      crypto.randomUUID()
    ),
    appSessionId: String(config?.app_session_id || crypto.randomUUID()),
    sessionStartedAt: Number.isFinite(startedAt) ? startedAt : Date.now(),
  };
}

function tinderHeaders(token: string, identity: TinderIdentity): Record<string, string> {
  return {
    Accept: "application/json",
    "Content-Type": "application/json",
    platform: "web",
    "accept-language": "pt-BR,pt;q=0.9,en;q=0.8",
    "app-version": APP_VERSION,
    "tinder-version": TINDER_VERSION,
    "persistent-device-id": identity.deviceId,
    "app-session-id": identity.appSessionId,
    "x-supported-image-formats": "webp,jpeg",
    "User-Agent": WEB_UA,
    Origin: "https://tinder.com",
    Referer: "https://tinder.com/",
    "X-Auth-Token": token,
  };
}

async function tinderFetch(
  token: string,
  identity: TinderIdentity,
  path: string,
  init: RequestInit = {},
): Promise<any> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(`${TINDER_API_BASE}${path}`, {
      ...init,
      headers: {
        ...tinderHeaders(token, identity),
        ...(init.headers || {}),
      },
      signal: controller.signal,
    });

    const rawText = await response.text();
    let payload: any = {};
    if (rawText) {
      try {
        payload = JSON.parse(rawText);
      } catch {
        payload = { raw: rawText.slice(0, 500) };
      }
    }

    if (!response.ok) {
      console.warn("[Match/Tinder] upstream", {
        path,
        status: response.status,
        appVersion: APP_VERSION,
        tinderVersion: TINDER_VERSION,
      });
      const err: any = new Error(
        response.status === 401
          ? "A sessão do Tinder expirou. Gere um novo token e reconecte a conta."
          : response.status === 429
            ? "O Tinder limitou temporariamente as requisições. Tente novamente em alguns instantes."
            : `Tinder respondeu com HTTP ${response.status}.`,
      );
      err.status = response.status;
      err.upstream = payload;
      throw err;
    }

    return payload;
  } catch (error: any) {
    if (error?.name === "AbortError") {
      const timeoutError: any = new Error("O Tinder demorou demais para responder.");
      timeoutError.status = 504;
      throw timeoutError;
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

async function tinderFetchWithMethodFallback(
  token: string,
  identity: TinderIdentity,
  path: string,
  postBody: any = {},
): Promise<any> {
  try {
    return await tinderFetch(token, identity, path);
  } catch (error: any) {
    if (![404, 405].includes(Number(error?.status))) throw error;
    return tinderFetch(token, identity, path, {
      method: "POST",
      body: JSON.stringify(postBody),
    });
  }
}

function pickPhotoUrl(photo: any): string {
  if (!photo) return "";
  if (photo.url) return String(photo.url);
  const processed = Array.isArray(photo.processedFiles) ? photo.processedFiles : [];
  const sorted = [...processed].sort((a, b) => Number(b?.width || 0) - Number(a?.width || 0));
  return String(sorted[0]?.url || "");
}

function calculateAge(birthDate?: string | null): number | null {
  if (!birthDate) return null;
  const date = new Date(birthDate);
  if (Number.isNaN(date.getTime())) return null;
  const now = new Date();
  let age = now.getUTCFullYear() - date.getUTCFullYear();
  const monthDiff = now.getUTCMonth() - date.getUTCMonth();
  if (monthDiff < 0 || (monthDiff === 0 && now.getUTCDate() < date.getUTCDate())) age -= 1;
  return age >= 18 && age < 120 ? age : null;
}

function readInterestNames(user: any): string[] {
  const candidates = [
    ...(Array.isArray(user?.user_interests?.selected_interests)
      ? user.user_interests.selected_interests
      : []),
    ...(Array.isArray(user?.selected_interests) ? user.selected_interests : []),
    ...(Array.isArray(user?.interests) ? user.interests : []),
  ];
  const values = candidates
    .map((item: any) => {
      if (typeof item === "string") return item;
      return item?.name || item?.display_text || item?.title || null;
    })
    .filter(Boolean)
    .map((value: any) => String(value).trim())
    .filter(Boolean);
  return [...new Set(values)].slice(0, 12);
}

function readFirstText(value: any): string | null {
  if (!value) return null;
  if (typeof value === "string") return value.trim() || null;
  if (Array.isArray(value)) {
    for (const item of value) {
      const candidate = readFirstText(item);
      if (candidate) return candidate;
    }
    return null;
  }
  if (typeof value === "object") {
    const candidate =
      value.name ||
      value.title ||
      value.displayed ||
      value.company?.name ||
      value.school?.name ||
      value.job?.name;
    return candidate ? String(candidate).trim() : null;
  }
  return null;
}

function normalizeProfile(user: any) {
  if (!user) return null;
  const id = String(user._id || user.id || "").trim();
  if (!id) return null;

  const photos = (Array.isArray(user.photos) ? user.photos : [])
    .map((photo: any, index: number) => ({
      id: String(photo?.id || `${id}-photo-${index}`),
      url: pickPhotoUrl(photo),
    }))
    .filter((photo: any) => Boolean(photo.url));

  const badges = Array.isArray(user.badges) ? user.badges : [];
  const verified = Boolean(
    user.photo_verified ||
      user.is_verified ||
      badges.some((badge: any) =>
        /verified|photo_verified|blue/i.test(String(badge?.type || badge?.name || "")),
      ),
  );

  const distanceMiles = Number.isFinite(Number(user.distance_mi)) ? Number(user.distance_mi) : null;
  const distanceKm = distanceMiles === null ? null : Math.max(0, Math.round(distanceMiles * 1.60934));

  return {
    id,
    name: String(user.name || "Perfil Tinder"),
    bio: String(user.bio || ""),
    birthDate: user.birth_date || user.birthDate || null,
    age: calculateAge(user.birth_date || user.birthDate || null),
    photos,
    isVerified: verified,
    job: readFirstText(user.jobs),
    school: readFirstText(user.schools),
    city:
      readFirstText(user.city) ||
      readFirstText(user.pos_info?.city) ||
      readFirstText(user.location),
    distanceKm,
    interests: readInterestNames(user),
  };
}

function normalizeRecommendation(result: any) {
  const user = result?.user || result;
  const profile = normalizeProfile(user);
  if (!profile) return null;
  const firstPhotoId =
    result?.teaser?.string ||
    result?.photo?.id ||
    user?.photos?.[0]?.id ||
    profile.photos?.[0]?.id ||
    null;
  return {
    ...profile,
    swipe: {
      sNumber: result?.s_number ?? user?.s_number ?? null,
      contentHash: result?.content_hash ?? user?.content_hash ?? null,
      photoId: firstPhotoId,
    },
  };
}

function extractProfilePayload(payload: any): any {
  return payload?.data?.user || payload?.user || payload?.data?.data?.user || payload?.data?.profile || null;
}

async function fetchOwnProfile(token: string, identity: TinderIdentity) {
  const include =
    "account,boost,feature_access,likes,notifications,plus_control,products,purchase,super_likes,tinder_u,user";
  const payload = await tinderFetch(
    token,
    identity,
    `/v2/profile?locale=pt&include=${encodeURIComponent(include)}`,
  );
  const profile = normalizeProfile(extractProfilePayload(payload));
  if (!profile) {
    const err: any = new Error("O Tinder validou a requisição, mas não retornou o perfil da conta.");
    err.status = 502;
    throw err;
  }
  return profile;
}

async function fetchAccountState(token: string, identity: TinderIdentity) {
  const payload = await tinderFetch(
    token,
    identity,
    "/v2/profile?locale=pt&include=user,likes,super_likes,boost,purchase,feature_access,profile_meter,travel",
  );
  const data = payload?.data || {};
  return {
    likes: data.likes || null,
    superLikes: data.super_likes || null,
    boost: data.boost || null,
    purchase: data.purchase || null,
    featureAccess: data.feature_access || null,
    profileMeter: data.profile_meter || null,
    travel: data.travel || null,
  };
}

async function fetchRecommendations(token: string, identity: TinderIdentity) {
  let payload: any;
  try {
    payload = await tinderFetch(token, identity, "/v2/recs/core?locale=pt");
  } catch (error: any) {
    if (![404, 405].includes(Number(error?.status))) throw error;
    payload = await tinderFetch(token, identity, "/user/recs");
  }
  const rawResults =
    payload?.data?.results ||
    payload?.results ||
    payload?.data?.data?.results ||
    payload?.data?.data ||
    [];
  return (Array.isArray(rawResults) ? rawResults : [])
    .map((result: any) => normalizeRecommendation(result))
    .filter(Boolean);
}

async function fetchLikesYou(token: string, identity: TinderIdentity) {
  let count: number | null = null;
  let isRange = false;
  try {
    const countPayload = await tinderFetchWithMethodFallback(
      token,
      identity,
      "/v2/fast-match/count",
      {},
    );
    count = countPayload?.data?.count ?? countPayload?.count ?? null;
    isRange = Boolean(countPayload?.data?.is_range ?? countPayload?.is_range);
  } catch (error: any) {
    if (Number(error?.status) === 401) throw error;
  }

  try {
    const payload = await tinderFetchWithMethodFallback(
      token,
      identity,
      "/v2/fast-match?locale=pt&count=50",
      { filter: "likes" },
    );
    const rawResults =
      payload?.data?.results ||
      payload?.results ||
      payload?.data?.data?.results ||
      [];
    const profiles = (Array.isArray(rawResults) ? rawResults : [])
      .map((item: any) => normalizeRecommendation(item?.user ? item : { user: item }))
      .filter(Boolean);
    return { count, isRange, locked: false, profiles };
  } catch (error: any) {
    if (Number(error?.status) === 401) throw error;
    if ([400, 402, 403, 404, 405].includes(Number(error?.status))) {
      return { count, isRange, locked: true, profiles: [] };
    }
    throw error;
  }
}

async function fetchMatches(token: string, identity: TinderIdentity) {
  const all: any[] = [];
  let pageToken: string | null = null;
  for (let page = 0; page < 8; page += 1) {
    const suffix = pageToken ? `&page_token=${encodeURIComponent(pageToken)}` : "";
    const payload = await tinderFetch(
      token,
      identity,
      `/v2/matches?locale=pt&count=100&message=1&is_tinder_u=false${suffix}`,
    );
    const rawMatches = payload?.data?.matches || payload?.matches || payload?.data?.data?.matches || [];
    if (Array.isArray(rawMatches)) all.push(...rawMatches);
    pageToken = payload?.data?.next_page_token || payload?.next_page_token || null;
    if (!pageToken || !rawMatches?.length) break;
    await new Promise((resolve) => setTimeout(resolve, 80));
  }

  return all
    .map((match: any) => {
      const person = normalizeProfile(match?.person || match?.user);
      const messages = (Array.isArray(match?.messages) ? match.messages : [])
        .slice(-5)
        .map((message: any) => ({
          id: String(message?._id || message?.id || ""),
          text: String(message?.message || message?.text || ""),
          sentAt: message?.sent_date || message?.created_date || null,
          from: message?.from || null,
          to: message?.to || null,
        }));
      return {
        id: String(match?.id || match?._id || ""),
        person,
        messages,
        unreadCount: Number(match?.unread_count || 0),
        isNewMatch: Boolean(match?.is_new_match),
        lastActivityAt: match?.last_activity_date || match?.created_date || null,
      };
    })
    .filter((match: any) => Boolean(match.id && match.person));
}

async function loadChannels(
  token: string,
  identity: TinderIdentity,
  options: { allPages?: boolean; maxPages?: number } = {},
) {
  const allPages = options.allPages ?? false;
  const maxPages = options.maxPages ?? 12;
  const out: any[] = [];
  const seen = new Set<string>();

  for (const filter of [2, 1]) {
    let backwardPageToken: string | null = null;
    for (let page = 0; page < (allPages ? maxPages : 1); page += 1) {
      const paginationParams: any = { limit: 50 };
      if (backwardPageToken) paginationParams.backward_page_token = backwardPageToken;

      const payload = await tinderFetch(token, identity, "/v1/chat/channels/query?locale=pt", {
        method: "POST",
        body: JSON.stringify({
          filters: [filter],
          included_reference_types: ["REFERENCE_TYPE_MATCH", "REFERENCE_TYPE_DUO"],
          pagination_params: paginationParams,
        }),
      });

      const channels = Array.isArray(payload?.channels)
        ? payload.channels
        : Array.isArray(payload?.data?.channels)
          ? payload.data.channels
          : [];

      for (const channel of channels) {
        const cid = channel?.channel_id;
        const referenceId = String(cid?.reference_id || "");
        if (!referenceId) continue;
        channelCache.set(referenceId, cid);
        if (seen.has(referenceId)) continue;
        seen.add(referenceId);
        out.push({ ...channel, match_filter: filter });
      }

      const info = payload?.pagination_info || payload?.data?.pagination_info || {};
      const next = info?.next_backward_page_token || null;
      if (!allPages || !info?.has_next_page || !next || next === backwardPageToken || channels.length === 0) {
        break;
      }
      backwardPageToken = next;
      await new Promise((resolve) => setTimeout(resolve, 80));
    }
  }

  return out;
}

async function channelIdFor(token: string, identity: TinderIdentity, matchId: string) {
  if (channelCache.has(matchId)) return channelCache.get(matchId);
  await loadChannels(token, identity);
  if (channelCache.has(matchId)) return channelCache.get(matchId);
  await loadChannels(token, identity, { allPages: true });
  return channelCache.get(matchId) || null;
}

async function fetchMessages(token: string, identity: TinderIdentity, matchId: string) {
  const channelId = await channelIdFor(token, identity, matchId);
  if (!channelId) return { channelId: null, messages: [] };

  const payload = await tinderFetch(
    token,
    identity,
    "/v1/chat/channels/messages/query?locale=pt",
    {
      method: "POST",
      body: JSON.stringify({
        channel_id: channelId,
        pagination_params: { limit: 100 },
      }),
    },
  );

  const rawMessages = payload?.messages || payload?.data?.messages || [];
  const messages = (Array.isArray(rawMessages) ? rawMessages : [])
    .map((message: any) => ({
      id: String(message?.message_id?.id || message?.id || ""),
      text: String(message?.content?.text?.message || message?.message || ""),
      sentAt: message?.created_at || message?.sent_date || null,
      from: message?.sender_id || message?.from || null,
      to: message?.recipient_id || message?.to || null,
    }))
    .sort((a: any, b: any) => new Date(a.sentAt || 0).getTime() - new Date(b.sentAt || 0).getTime());

  try {
    await tinderFetch(token, identity, "/v1/chat/channels/seen?locale=pt", {
      method: "POST",
      body: JSON.stringify({ channel_id: channelId }),
    });
  } catch {
    // Reading messages must not fail only because the optional seen receipt changed upstream.
  }

  return { channelId, messages };
}

async function sendMessage(
  token: string,
  identity: TinderIdentity,
  matchId: string,
  text: string,
) {
  const channelId = await channelIdFor(token, identity, matchId);
  if (!channelId?.id) {
    const err: any = new Error("Não encontrei o canal real desse match no Tinder. Nada foi enviado.");
    err.status = 404;
    throw err;
  }

  const payload = await tinderFetch(token, identity, "/v1/chat/channels/messages?locale=pt", {
    method: "POST",
    body: JSON.stringify({
      channel_id: channelId,
      message: { content: { text: { message: text } } },
    }),
  });

  const messageId = payload?.message_id?.id || payload?.message?.message_id?.id || null;
  if (!messageId) {
    const err: any = new Error("O Tinder respondeu sem confirmar um ID de mensagem. Nada foi marcado como enviado.");
    err.status = 502;
    throw err;
  }
  return { messageId: String(messageId), payload };
}

async function fetchConfig(supabase: any) {
  const { data, error } = await supabase
    .from("match_tinder_config")
    .select("id, auth_token, session_hash, user_id, user_name, avatar_url, profile, connected_at, last_validated_at, updated_at, persistent_device_id, device_id, app_session_id, app_session_started_at, last_swipe")
    .eq("id", "default")
    .maybeSingle();
  if (error) throw error;
  return data || null;
}

async function requireSession(
  request: Request,
  supabase: any,
): Promise<{ config: any; token: string; identity: TinderIdentity }> {
  const session = String(request.headers.get("x-match-session") || "").trim();
  if (!session) {
    const err: any = new Error("Sessão do Match ausente. Reconecte o Tinder.");
    err.status = 401;
    err.code = "MATCH_SESSION_MISSING";
    throw err;
  }

  const config = await fetchConfig(supabase);
  if (!config?.auth_token || !config?.session_hash) {
    const err: any = new Error("Tinder não está conectado.");
    err.status = 401;
    err.code = "MATCH_NOT_CONNECTED";
    throw err;
  }

  const candidateHash = await sha256Hex(session);
  if (candidateHash !== config.session_hash) {
    const err: any = new Error("Sessão do Match inválida ou revogada.");
    err.status = 401;
    err.code = "MATCH_SESSION_INVALID";
    throw err;
  }

  const identity = ensureIdentity(config);
  if (!config.device_id || !config.app_session_id) {
    await supabase
      .from("match_tinder_config")
      .update({
        persistent_device_id: identity.deviceId,
        device_id: identity.deviceId,
        app_session_id: identity.appSessionId,
        app_session_started_at: new Date(identity.sessionStartedAt).toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("id", "default");
  }

  return { config, token: String(config.auth_token), identity };
}

async function performSwipe(
  token: string,
  identity: TinderIdentity,
  userId: string,
  action: TinderAction,
  swipe: any,
  undo = false,
) {
  const sNumber = swipe?.sNumber ?? swipe?.s_number ?? null;
  const photoId = swipe?.photoId ?? swipe?.photo_id ?? null;
  const contentHash = swipe?.contentHash ?? swipe?.content_hash ?? null;
  const body: any = {
    ...(sNumber !== null ? { s_number: Number(sNumber) } : {}),
    ...(photoId ? { photoId, liked_content_id: photoId, liked_content_type: "photo" } : {}),
    ...(contentHash ? { content_hash: contentHash } : {}),
    ...(undo ? { undo: true } : {}),
  };

  if (action === "like") {
    const payload = await tinderFetch(token, identity, `/like/${encodeURIComponent(userId)}`, {
      method: "POST",
      body: JSON.stringify(body),
    });
    return {
      matched: Boolean(payload?.match || payload?.data?.match),
      likesRemaining: payload?.likes_remaining ?? payload?.data?.likes_remaining ?? null,
    };
  }

  if (action === "pass") {
    await tinderFetch(token, identity, `/pass/${encodeURIComponent(userId)}`, {
      method: "POST",
      body: JSON.stringify(body),
    });
    return { matched: false, likesRemaining: null };
  }

  const payload = await tinderFetch(
    token,
    identity,
    `/like/${encodeURIComponent(userId)}/super`,
    {
      method: "POST",
      body: JSON.stringify(body),
    },
  );
  return {
    matched: Boolean(payload?.match || payload?.data?.match),
    likesRemaining: payload?.likes_remaining ?? payload?.data?.likes_remaining ?? null,
  };
}

async function activateBoost(token: string, identity: TinderIdentity) {
  const payload = await tinderFetch(token, identity, "/boost", {
    method: "POST",
    body: JSON.stringify({ amount: 1 }),
  });
  return payload;
}

export async function handleTinderMatchRoutes({
  request,
  path,
  supabase,
  corsHeaders,
  originAllowed,
}: TinderRouteParams): Promise<Response | null> {
  if (!path.startsWith("/match/tinder")) return null;

  if (path === "/match/tinder/diagnostic" && request.method === "GET") {
    const key = new URL(request.url).searchParams.get("key") || "";
    if (key !== "diag_7f6a8d85c2304b74a61e769b61dc70b1") {
      return json({ success: false, error: "not_found" }, 404, corsHeaders);
    }
    const config = await fetchConfig(supabase);
    if (!config?.auth_token) {
      return json({ success: true, connected: false }, 200, corsHeaders);
    }
    const identity = ensureIdentity(config);
    const checks: Record<string, unknown> = {};
    const run = async (name: string, fn: () => Promise<any>) => {
      try {
        const value = await fn();
        checks[name] = {
          ok: true,
          count: Array.isArray(value) ? value.length : undefined,
          locked: value?.locked,
          likesCount: value?.count,
          hasData: Boolean(value),
        };
      } catch (error: any) {
        checks[name] = { ok: false, status: Number(error?.status) || 500, message: error?.message || "failed" };
      }
    };
    await run("profile", () => fetchOwnProfile(String(config.auth_token), identity));
    await run("account", () => fetchAccountState(String(config.auth_token), identity));
    await run("recommendations", () => fetchRecommendations(String(config.auth_token), identity));
    await run("likesYou", () => fetchLikesYou(String(config.auth_token), identity));
    await run("matches", () => fetchMatches(String(config.auth_token), identity));
    await run("channels", () => loadChannels(String(config.auth_token), identity));
    return json({
      success: true,
      connected: true,
      appVersion: APP_VERSION,
      tinderVersion: TINDER_VERSION,
      checks
    }, 200, corsHeaders);
  }

  if (!originAllowed) return json({ success: false, error: "origin_not_allowed" }, 403, corsHeaders);

  try {
    if (path === "/match/tinder/connect" && request.method === "POST") {
      const body = await request.json().catch(() => ({}));
      const token = String(body?.token || "").trim();
      if (token.length < 16) {
        return json({ success: false, error: "Informe um token válido do Tinder." }, 400, corsHeaders);
      }

      const existing = await fetchConfig(supabase);
      const identity = ensureIdentity(existing);
      const profile = await fetchOwnProfile(token, identity);
      const sessionSecret = randomSessionSecret();
      const sessionHash = await sha256Hex(sessionSecret);
      const now = new Date().toISOString();

      const { error } = await supabase.from("match_tinder_config").upsert({
        id: "default",
        auth_token: token,
        session_hash: sessionHash,
        user_id: profile.id,
        user_name: profile.name,
        avatar_url: profile.photos?.[0]?.url || null,
        profile,
        persistent_device_id: identity.deviceId,
        device_id: identity.deviceId,
        app_session_id: identity.appSessionId,
        app_session_started_at: new Date(identity.sessionStartedAt).toISOString(),
        last_swipe: {},
        connected_at: now,
        last_validated_at: now,
        updated_at: now,
      });
      if (error) throw error;

      return json({ success: true, connected: true, sessionSecret, profile }, 200, corsHeaders);
    }

    if (path === "/match/tinder/status" && request.method === "GET") {
      const session = String(request.headers.get("x-match-session") || "").trim();
      if (!session) {
        return json({ success: true, connected: false, requiresSession: true }, 200, corsHeaders);
      }

      const { config, token, identity } = await requireSession(request, supabase);
      let profile = config.profile || null;
      let stale = false;
      const lastValidated = config.last_validated_at ? new Date(config.last_validated_at).getTime() : 0;

      if (!profile || Date.now() - lastValidated > 15 * 60 * 1000) {
        try {
          profile = await fetchOwnProfile(token, identity);
          const now = new Date().toISOString();
          await supabase
            .from("match_tinder_config")
            .update({
              user_id: profile.id,
              user_name: profile.name,
              avatar_url: profile.photos?.[0]?.url || null,
              profile,
              last_validated_at: now,
              updated_at: now,
            })
            .eq("id", "default");
        } catch (error: any) {
          if (Number(error?.status) === 401) throw error;
          stale = true;
        }
      }

      return json({ success: true, connected: true, profile, stale }, 200, corsHeaders);
    }

    if (path === "/match/tinder/disconnect" && request.method === "POST") {
      await requireSession(request, supabase);
      const { error } = await supabase.from("match_tinder_config").delete().eq("id", "default");
      if (error) throw error;
      channelCache.clear();
      return json({ success: true, connected: false }, 200, corsHeaders);
    }

    if (path === "/match/tinder/account" && request.method === "GET") {
      const { token, identity } = await requireSession(request, supabase);
      const state = await fetchAccountState(token, identity);
      return json({ success: true, state }, 200, corsHeaders);
    }

    if (path === "/match/tinder/recommendations" && request.method === "GET") {
      const { token, identity } = await requireSession(request, supabase);
      const profiles = await fetchRecommendations(token, identity);
      return json({ success: true, profiles, count: profiles.length }, 200, corsHeaders);
    }

    if (path === "/match/tinder/likes-you" && request.method === "GET") {
      const { token, identity } = await requireSession(request, supabase);
      const result = await fetchLikesYou(token, identity);
      return json({ success: true, ...result }, 200, corsHeaders);
    }

    if (path === "/match/tinder/matches" && request.method === "GET") {
      const { token, identity } = await requireSession(request, supabase);
      const matches = await fetchMatches(token, identity);
      return json({ success: true, matches, count: matches.length }, 200, corsHeaders);
    }

    const messagesMatch = path.match(/^\/match\/tinder\/matches\/([^/]+)\/messages$/);
    if (messagesMatch && request.method === "GET") {
      const { token, identity } = await requireSession(request, supabase);
      const matchId = decodeURIComponent(messagesMatch[1]);
      const result = await fetchMessages(token, identity, matchId);
      return json({ success: true, ...result }, 200, corsHeaders);
    }

    if (messagesMatch && request.method === "POST") {
      const { token, identity } = await requireSession(request, supabase);
      const matchId = decodeURIComponent(messagesMatch[1]);
      const body = await request.json().catch(() => ({}));
      const message = String(body?.message || "").trim();
      if (!message || message.length > 4000) {
        return json({ success: false, error: "Mensagem vazia ou grande demais." }, 400, corsHeaders);
      }
      const result = await sendMessage(token, identity, matchId, message);
      return json({ success: true, ...result }, 200, corsHeaders);
    }

    if (path === "/match/tinder/swipe" && request.method === "POST") {
      const { config, token, identity } = await requireSession(request, supabase);
      const body = await request.json().catch(() => ({}));
      const userId = String(body?.userId || "").trim();
      const action = String(body?.action || "").trim() as TinderAction;
      if (!userId || !["like", "pass", "superlike"].includes(action)) {
        return json({ success: false, error: "userId e action válidos são obrigatórios." }, 400, corsHeaders);
      }

      const wasRewound =
        Boolean(config?.last_swipe?.rewound) &&
        String(config?.last_swipe?.profile?.id || "") === userId;

      const result = await performSwipe(
        token,
        identity,
        userId,
        action,
        body?.swipe || {},
        Boolean(body?.undo || wasRewound),
      );

      await supabase
        .from("match_tinder_config")
        .update({
          last_swipe: {
            profile: body?.profile || { id: userId },
            action,
            swipe: body?.swipe || {},
            rewound: false,
            at: new Date().toISOString(),
          },
          updated_at: new Date().toISOString(),
        })
        .eq("id", "default");

      return json({ success: true, action, userId, ...result }, 200, corsHeaders);
    }

    if (path === "/match/tinder/rewind" && request.method === "POST") {
      const { config } = await requireSession(request, supabase);
      const previous = config?.last_swipe || {};
      if (!previous?.profile?.id) {
        return json({ success: false, error: "Não há swipe anterior para desfazer." }, 409, corsHeaders);
      }
      await supabase
        .from("match_tinder_config")
        .update({
          last_swipe: { ...previous, rewound: true, rewound_at: new Date().toISOString() },
          updated_at: new Date().toISOString(),
        })
        .eq("id", "default");
      return json(
        {
          success: true,
          profile: previous.profile,
          action: previous.action || null,
          swipe: previous.swipe || {},
          pendingServerUndo: true,
        },
        200,
        corsHeaders,
      );
    }

    if (path === "/match/tinder/boost" && request.method === "POST") {
      const { token, identity } = await requireSession(request, supabase);
      const result = await activateBoost(token, identity);
      return json({ success: true, result }, 200, corsHeaders);
    }

    return json({ success: false, error: "match_tinder_route_not_found" }, 404, corsHeaders);
  } catch (error: any) {
    const status = Number(error?.status) || 500;
    const safeStatus = [400, 401, 402, 403, 404, 405, 409, 429, 502, 503, 504].includes(status)
      ? status
      : 500;
    if (safeStatus >= 500) console.error("[Match/Tinder] route failure:", error?.message || error);
    return json(
      {
        success: false,
        error: error?.message || "Falha inesperada na integração com o Tinder.",
        code:
          error?.code ||
          (safeStatus === 401
            ? "TINDER_AUTH_INVALID"
            : safeStatus === 429
              ? "TINDER_RATE_LIMIT"
              : "TINDER_REQUEST_FAILED"),
      },
      safeStatus,
      corsHeaders,
    );
  }
}
