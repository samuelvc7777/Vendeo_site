const TINDER_API_BASE = "https://api.gotinder.com";
const REQUEST_TIMEOUT_MS = 15000;
const TINDER_WEB_APP_VERSION = "1073604";
const TINDER_WEB_VERSION = "7.36.4";

const BASE_HEADERS: Record<string, string> = {
  Accept: "application/json",
  "Content-Type": "application/json",
  "accept-language": "pt-BR,pt;q=0.9,en;q=0.8",
  platform: "web",
  "app-version": TINDER_WEB_APP_VERSION,
  "tinder-version": TINDER_WEB_VERSION,
  "x-supported-image-formats": "webp,jpeg",
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/154.0.0.0 Safari/537.36",
  Origin: "https://tinder.com",
  Referer: "https://tinder.com/",
};

type TinderAction = "like" | "pass" | "superlike";

interface TinderRouteParams {
  request: Request;
  path: string;
  supabase: any;
  corsHeaders: Record<string, string>;
  originAllowed: boolean;
}

function json(
  value: unknown,
  status: number,
  corsHeaders: Record<string, string>,
): Response {
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

async function tinderFetch(
  token: string,
  path: string,
  init: RequestInit = {},
): Promise<any> {
  const tokenHash = await sha256Hex(token);
  const stableUuid = (offset: number) => {
    const hex = (tokenHash + tokenHash).slice(offset, offset + 32);
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
  };
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(`${TINDER_API_BASE}${path}`, {
      ...init,
      headers: {
        ...BASE_HEADERS,
        "persistent-device-id": stableUuid(0),
        "app-session-id": stableUuid(16),
        ...(init.headers || {}),
        "X-Auth-Token": token,
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
      const err: any = new Error(
        response.status === 401
          ? "Token do Tinder expirado ou inválido."
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
  if (monthDiff < 0 || (monthDiff === 0 && now.getUTCDate() < date.getUTCDate())) {
    age -= 1;
  }
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

function normalizeProfile(user: any, recMeta: any = {}) {
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

  const distanceMiles =
    Number.isFinite(Number(user.distance_mi)) ? Number(user.distance_mi) : null;
  const distanceKm =
    distanceMiles === null ? null : Math.max(0, Math.round(distanceMiles * 1.60934));

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
    swipe: {
      sNumber: Number.isFinite(Number(recMeta?.s_number ?? user?.s_number))
        ? Number(recMeta?.s_number ?? user?.s_number)
        : null,
      contentHash: recMeta?.content_hash || recMeta?.contentHash || user?.content_hash || null,
      photoId: recMeta?.photoId || recMeta?.photo_id || photos?.[0]?.id || null,
    },
  };
}

function extractProfilePayload(payload: any): any {
  return (
    payload?.data?.user ||
    payload?.user ||
    payload?.data?.data?.user ||
    payload?.data?.profile ||
    null
  );
}

async function fetchOwnProfile(token: string) {
  const include =
    "account,boost,feature_access,likes,notifications,plus_control,products,purchase,super_likes,tinder_u,user";
  const payload = await tinderFetch(
    token,
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

async function fetchRecommendations(token: string) {
  let payload: any;
  try {
    payload = await tinderFetch(token, "/user/recs");
  } catch {
    try {
      payload = await tinderFetch(token, "/recs/core");
    } catch {
      try {
        payload = await tinderFetch(token, "/v2/recs/core?locale=pt");
      } catch {
        payload = { results: [] };
      }
    }
  }

  const rawResults =
    payload?.data?.results ||
    payload?.results ||
    payload?.data?.data?.results ||
    payload?.data?.data ||
    [];

  const profiles = (Array.isArray(rawResults) ? rawResults : [])
    .map((result: any) => normalizeProfile(result?.user || result, result))
    .filter(Boolean);

  return profiles;
}

async function fetchMatches(token: string) {
  const payload = await tinderFetch(
    token,
    "/v2/matches?locale=pt&count=60&message=1&is_tinder_u=false",
  );
  const rawMatches =
    payload?.data?.matches ||
    payload?.matches ||
    payload?.data?.data?.matches ||
    [];

  return (Array.isArray(rawMatches) ? rawMatches : [])
    .map((match: any) => {
      const person = normalizeProfile(match?.person || match?.user);
      const messages = (Array.isArray(match?.messages) ? match.messages : [])
        .slice(-15)
        .map((message: any) => ({
          id: String(message?._id || message?.id || ""),
          text: String(message?.message || message?.text || ""),
          sentAt: message?.sent_date || message?.created_date || null,
          from: message?.from || null,
          to: message?.to || null,
          isMine: String(message?.from) === String(token ? "" : ""),
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

async function fetchLikesYou(token: string) {
  let count: number | null = null;
  let isRange = false;

  try {
    const countPayload = await tinderFetch(token, "/v2/fast-match/count?locale=pt");
    const rawCount = countPayload?.data?.count ?? countPayload?.count;
    count = Number.isFinite(Number(rawCount)) ? Number(rawCount) : null;
    isRange = Boolean(countPayload?.data?.is_range ?? countPayload?.is_range ?? false);
  } catch {
    // best-effort
  }

  try {
    const payload = await tinderFetch(token, "/v2/fast-match?locale=pt&count=50");
    const rawResults =
      payload?.data?.results ||
      payload?.results ||
      payload?.data?.data?.results ||
      [];
    const profiles = (Array.isArray(rawResults) ? rawResults : [])
      .map((entry: any) => normalizeProfile(entry?.user || entry, entry))
      .filter(Boolean);

    return {
      count: count ?? profiles.length,
      isRange,
      locked: false,
      profiles,
    };
  } catch (error: any) {
    if ([401, 402, 403, 404].includes(Number(error?.status))) {
      return { count: count ?? 0, isRange, locked: true, profiles: [] };
    }
    return { count: count ?? 0, isRange, locked: true, profiles: [] };
  }
}

async function fetchAccountState(token: string) {
  const include =
    "user,likes,super_likes,boost,purchase,feature_access,profile_meter,travel";
  const payload = await tinderFetch(
    token,
    "/v2/profile?locale=pt&include=" + encodeURIComponent(include),
  );
  const data = payload?.data || {};
  const boost = data?.boost || {};
  const superLikes = data?.super_likes || data?.superLikes || {};
  const likes = data?.likes || {};
  const purchase = data?.purchase || {};
  const featureAccess = data?.feature_access || {};

  return {
    boost: {
      remaining:
        boost?.remaining ??
        boost?.boost_remaining ??
        boost?.boosts_remaining ??
        null,
      duration: boost?.duration ?? null,
      resetsAt: boost?.resets_at ?? boost?.reset_at ?? null,
      expiresAt: boost?.expires_at ?? null,
      isBoosting: Boolean(boost?.is_boosting || false),
    },
    superLikes: {
      remaining:
        superLikes?.remaining ??
        superLikes?.super_likes_remaining ??
        null,
      resetsAt: superLikes?.resets_at ?? superLikes?.reset_at ?? null,
    },
    likes: {
      remaining: likes?.remaining ?? likes?.likes_remaining ?? null,
      rateLimitedUntil: likes?.rate_limited_until ?? likes?.resets_at ?? null,
    },
    purchase: {
      hasPlus: Boolean(purchase?.plus || purchase?.is_plus || false),
      hasGold: Boolean(purchase?.gold || purchase?.is_gold || false),
      hasPlatinum: Boolean(purchase?.platinum || purchase?.is_platinum || false),
    },
    featureAccess: {
      rewind: Boolean(featureAccess?.rewind?.enabled ?? featureAccess?.rewind ?? false),
      likesYou: Boolean(featureAccess?.likes_you?.enabled ?? featureAccess?.likes_you ?? false),
      passport: Boolean(featureAccess?.passport?.enabled ?? featureAccess?.passport ?? false),
    },
  };
}

async function queryChannels(token: string) {
  const output: any[] = [];
  const seen = new Set<string>();

  for (const filter of [2, 1]) {
    let backwardPageToken: string | null = null;
    for (let page = 0; page < 12; page += 1) {
      const paginationParams: Record<string, unknown> = { limit: 50 };
      if (backwardPageToken) {
        paginationParams.backward_page_token = backwardPageToken;
      }

      const payload = await tinderFetch(
        token,
        "/v1/chat/channels/query?locale=pt",
        {
          method: "POST",
          body: JSON.stringify({
            filters: [filter],
            included_reference_types: [
              "REFERENCE_TYPE_MATCH",
              "REFERENCE_TYPE_DUO",
            ],
            pagination_params: paginationParams,
          }),
        },
      );

      const channels = Array.isArray(payload?.channels)
        ? payload.channels
        : Array.isArray(payload?.data?.channels)
          ? payload.data.channels
          : [];

      for (const channel of channels) {
        const referenceId = String(channel?.channel_id?.reference_id || "");
        if (!referenceId || seen.has(referenceId)) continue;
        seen.add(referenceId);
        output.push(channel);
      }

      const info = payload?.pagination_info || payload?.data?.pagination_info || {};
      const next = info?.next_backward_page_token || null;
      if (!info?.has_next_page || !next || next === backwardPageToken || channels.length === 0) {
        break;
      }
      backwardPageToken = String(next);
    }
  }

  return output;
}

async function findChannelForMatch(token: string, matchId: string) {
  const channels = await queryChannels(token);
  return channels.find(
    (channel: any) =>
      String(channel?.channel_id?.reference_id || "") === String(matchId),
  ) || null;
}

async function fetchMessagesFromMatchesList(token: string, matchId: string, myUserId: string) {
  try {
    const payload = await tinderFetch(
      token,
      "/v2/matches?locale=pt&count=60&message=1&is_tinder_u=false",
    );
    const rawMatches = payload?.data?.matches || payload?.matches || [];
    const target = rawMatches.find((m: any) => String(m?.id || m?._id || "") === String(matchId));
    if (!target || !Array.isArray(target.messages)) return [];

    return target.messages.map((m: any) => {
      const sender = String(m?.from || m?.sender_id || "");
      return {
        id: String(m?._id || m?.id || ""),
        text: String(m?.message || m?.text || ""),
        sentAt: m?.sent_date || m?.created_date || null,
        from: sender || null,
        isMine: sender ? sender === myUserId : false,
      };
    }).sort((a: any, b: any) => {
      const at = a.sentAt ? new Date(a.sentAt).getTime() : 0;
      const bt = b.sentAt ? new Date(b.sentAt).getTime() : 0;
      return at - bt;
    });
  } catch {
    return [];
  }
}

async function fetchChannelMessages(
  token: string,
  matchId: string,
  myUserId: string,
) {
  try {
    const channel = await findChannelForMatch(token, matchId);
    if (channel?.channel_id) {
      const payload = await tinderFetch(
        token,
        "/v1/chat/channels/messages/query?locale=pt",
        {
          method: "POST",
          body: JSON.stringify({
            channel_id: channel.channel_id,
            pagination_params: { limit: 100 },
          }),
        },
      );

      const rawMessages = Array.isArray(payload?.messages)
        ? payload.messages
        : Array.isArray(payload?.data?.messages)
          ? payload.data.messages
          : [];

      if (rawMessages.length > 0) {
        return rawMessages
          .map((message: any) => {
            const sender =
              message?.sender_id?.id ||
              message?.sender_id ||
              message?.from ||
              "";
            return {
              id: String(
                message?.message_id?.id ||
                message?.message_id ||
                message?.id ||
                "",
              ),
              text: String(
                message?.content?.text?.message ??
                message?.message ??
                message?.text ??
                "",
              ),
              sentAt: message?.created_at || message?.sent_date || null,
              from: sender || null,
              isMine: String(sender) === String(myUserId || ""),
            };
          })
          .sort((a: any, b: any) => {
            const at = a.sentAt ? new Date(a.sentAt).getTime() : 0;
            const bt = b.sentAt ? new Date(b.sentAt).getTime() : 0;
            return at - bt;
          });
      }
    }
  } catch {
    // Fallback para lista de matches
  }

  return fetchMessagesFromMatchesList(token, matchId, myUserId);
}

async function sendChannelMessage(
  token: string,
  matchId: string,
  messageText: string,
) {
  // Tentativa 1: Canal v1
  try {
    const channel = await findChannelForMatch(token, matchId);
    if (channel?.channel_id?.id) {
      const payload = await tinderFetch(
        token,
        "/v1/chat/channels/messages?locale=pt",
        {
          method: "POST",
          body: JSON.stringify({
            channel_id: channel.channel_id,
            message: {
              content: {
                text: {
                  message: messageText,
                },
              },
            },
          }),
        },
      );

      const messageId =
        payload?.message_id?.id ||
        payload?.message?.message_id?.id ||
        null;

      if (messageId) {
        return {
          id: String(messageId),
          text: messageText,
          sentAt: payload?.created_at || new Date().toISOString(),
          isMine: true,
        };
      }
    }
  } catch {
    // Fallback para endpoint universal /user/matches/{matchId}
  }

  // Tentativa 2: Endpoint universal do Tinder /user/matches/{matchId}
  const fallbackPayload = await tinderFetch(
    token,
    `/user/matches/${encodeURIComponent(matchId)}`,
    {
      method: "POST",
      body: JSON.stringify({ message: messageText }),
    },
  );

  const fallbackId =
    fallbackPayload?._id ||
    fallbackPayload?.id ||
    fallbackPayload?.data?._id ||
    crypto.randomUUID();

  return {
    id: String(fallbackId),
    text: messageText,
    sentAt: new Date().toISOString(),
    isMine: true,
  };
}

async function startBoost(token: string) {
  const payload = await tinderFetch(token, "/boost", {
    method: "POST",
    body: JSON.stringify({ amount: 1 }),
  });

  return {
    boostId: payload?.boost_id || payload?.data?.boost_id || null,
    multiplier: payload?.multiplier ?? payload?.data?.multiplier ?? null,
    duration: payload?.duration ?? payload?.data?.duration ?? null,
    expiresAt: payload?.expires_at ?? payload?.data?.expires_at ?? null,
    remaining: payload?.remaining ?? payload?.data?.remaining ?? null,
  };
}

async function fetchConfig(supabase: any) {
  const { data, error } = await supabase
    .from("match_tinder_config")
    .select("id, auth_token, session_hash, user_id, user_name, avatar_url, profile, connected_at, last_validated_at, updated_at")
    .eq("id", "default")
    .maybeSingle();
  if (error) throw error;
  return data || null;
}

async function requireSession(
  _request: Request,
  supabase: any,
): Promise<{ config: any; token: string }> {
  const config = await fetchConfig(supabase);
  if (!config?.auth_token) {
    const err: any = new Error("Tinder não está conectado.");
    err.status = 401;
    err.code = "MATCH_TINDER_NOT_CONNECTED";
    throw err;
  }

  return { config, token: String(config.auth_token) };
}

function compactBody(values: Record<string, unknown>) {
  return Object.fromEntries(
    Object.entries(values).filter(
      ([, value]) => value !== undefined && value !== null && value !== "",
    ),
  );
}

async function performSwipe(
  token: string,
  userId: string,
  action: TinderAction,
  meta: {
    sNumber?: number | null;
    contentHash?: string | null;
    photoId?: string | null;
    undo?: boolean;
    fastMatch?: boolean;
  } = {},
) {
  const baseMeta = compactBody({
    s_number: meta.sNumber,
    content_hash: meta.contentHash,
    undo: meta.undo || undefined,
    fast_match: meta.fastMatch || undefined,
  });

  if (action === "like") {
    const payload = await tinderFetch(token, `/like/${encodeURIComponent(userId)}`, {
      method: "POST",
      body: JSON.stringify(
        compactBody({
          ...baseMeta,
          liked_content_id: meta.photoId || undefined,
          liked_content_type: meta.photoId ? "photo" : undefined,
        }),
      ),
    });
    return {
      matched: Boolean(payload?.match || payload?.data?.match),
      likesRemaining: payload?.likes_remaining ?? payload?.data?.likes_remaining ?? null,
    };
  }
  if (action === "pass") {
    await tinderFetch(token, `/pass/${encodeURIComponent(userId)}`, {
      method: "POST",
      body: JSON.stringify(
        compactBody({
          ...baseMeta,
          photoId: meta.photoId || undefined,
        }),
      ),
    });
    return { matched: false, likesRemaining: null };
  }
  const payload = await tinderFetch(token, `/like/${encodeURIComponent(userId)}/super`, {
    method: "POST",
    body: JSON.stringify(
      compactBody({
        ...baseMeta,
        liked_content_id: meta.photoId || undefined,
        liked_content_type: meta.photoId ? "photo" : undefined,
      }),
    ),
  });
  return {
    matched: Boolean(payload?.match || payload?.data?.match),
    likesRemaining: payload?.likes_remaining ?? payload?.data?.likes_remaining ?? null,
  };
}

export async function handleTinderMatchRoutes({
  request,
  path,
  supabase,
  corsHeaders,
  originAllowed,
}: TinderRouteParams): Promise<Response | null> {
  if (!path.startsWith("/match/tinder")) return null;

  if (!originAllowed) {
    return json({ success: false, error: "origin_not_allowed" }, 403, corsHeaders);
  }

  try {
    if (path === "/match/tinder/connect" && request.method === "POST") {
      const body = await request.json().catch(() => ({}));
      const token = String(body?.token || "").trim();
      if (token.length < 16) {
        return json(
          { success: false, error: "Informe um token válido do Tinder." },
          400,
          corsHeaders,
        );
      }

      const profile = await fetchOwnProfile(token);
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
        connected_at: now,
        last_validated_at: now,
        updated_at: now,
      });

      if (error) throw error;

      return json(
        {
          success: true,
          connected: true,
          sessionSecret,
          profile,
        },
        200,
        corsHeaders,
      );
    }

    if (path === "/match/tinder/status" && request.method === "GET") {
      const config = await fetchConfig(supabase);
      if (!config?.auth_token) {
        return json(
          {
            success: true,
            connected: false,
            serverHasConnection: false,
          },
          200,
          corsHeaders,
        );
      }

      const session = String(request.headers.get("x-match-session") || "").trim();
      let sessionValid = false;

      if (session) {
        const candidateHash = await sha256Hex(session);
        if (candidateHash === config.session_hash) {
          sessionValid = true;
        }
      }

      let emittedSessionSecret: string | null = null;
      const token = String(config.auth_token);
      let profile = config.profile || null;
      let stale = false;

      if (!sessionValid) {
        try {
          profile = await fetchOwnProfile(token);
          const newSessionSecret = randomSessionSecret();
          const newSessionHash = await sha256Hex(newSessionSecret);
          const now = new Date().toISOString();

          await supabase
            .from("match_tinder_config")
            .update({
              session_hash: newSessionHash,
              user_id: profile.id,
              user_name: profile.name,
              avatar_url: profile.photos?.[0]?.url || null,
              profile,
              last_validated_at: now,
              updated_at: now,
            })
            .eq("id", "default");

          emittedSessionSecret = newSessionSecret;
          sessionValid = true;
        } catch (authError: any) {
          if (Number(authError?.status) === 401) {
            return json(
              {
                success: true,
                connected: false,
                serverHasConnection: true,
                tokenExpired: true,
                error: "Token do Tinder expirado ou revogado. Cole um novo token em Configurações para restabelecer a conexão.",
              },
              200,
              corsHeaders,
            );
          }
          stale = true;
        }
      } else {
        const lastValidated = config.last_validated_at
          ? new Date(config.last_validated_at).getTime()
          : 0;

        if (!profile || Date.now() - lastValidated > 15 * 60 * 1000) {
          try {
            profile = await fetchOwnProfile(token);
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
            if (Number(error?.status) === 401) {
              return json(
                {
                  success: true,
                  connected: false,
                  serverHasConnection: true,
                  tokenExpired: true,
                  error: "Token do Tinder expirado ou revogado. Cole um novo token em Configurações para restabelecer a conexão.",
                },
                200,
                corsHeaders,
              );
            }
            stale = true;
          }
        }
      }

      return json(
        {
          success: true,
          connected: sessionValid,
          serverHasConnection: true,
          profile,
          stale,
          ...(emittedSessionSecret ? { sessionSecret: emittedSessionSecret } : {}),
        },
        200,
        corsHeaders,
      );
    }

    if (path === "/match/tinder/disconnect" && request.method === "POST") {
      await requireSession(request, supabase);
      const { error } = await supabase
        .from("match_tinder_config")
        .delete()
        .eq("id", "default");
      if (error) throw error;
      return json({ success: true, connected: false }, 200, corsHeaders);
    }

    if (path === "/match/tinder/recommendations" && request.method === "GET") {
      const { token } = await requireSession(request, supabase);
      const profiles = await fetchRecommendations(token);
      return json(
        {
          success: true,
          profiles,
          count: profiles.length,
        },
        200,
        corsHeaders,
      );
    }

    if (path === "/match/tinder/account" && request.method === "GET") {
      const { token } = await requireSession(request, supabase);
      const account = await fetchAccountState(token);
      return json({ success: true, account }, 200, corsHeaders);
    }

    if (path === "/match/tinder/likes" && request.method === "GET") {
      const { token } = await requireSession(request, supabase);
      const likes = await fetchLikesYou(token);
      return json({ success: true, ...likes }, 200, corsHeaders);
    }

    if (path === "/match/tinder/matches" && request.method === "GET") {
      const { token } = await requireSession(request, supabase);
      const matches = await fetchMatches(token);
      return json(
        {
          success: true,
          matches,
          count: matches.length,
        },
        200,
        corsHeaders,
      );
    }

    const messagesMatch = path.match(/^\/match\/tinder\/messages\/([^/]+)$/);
    if (messagesMatch && request.method === "GET") {
      const { config, token } = await requireSession(request, supabase);
      const matchId = decodeURIComponent(messagesMatch[1]);
      const messages = await fetchChannelMessages(
        token,
        matchId,
        String(config?.user_id || ""),
      );
      return json(
        { success: true, messages, count: messages.length },
        200,
        corsHeaders,
      );
    }

    if (messagesMatch && request.method === "POST") {
      const { token } = await requireSession(request, supabase);
      const matchId = decodeURIComponent(messagesMatch[1]);
      const body = await request.json().catch(() => ({}));
      const message = String(body?.message || "").trim();
      if (!message) {
        return json(
          { success: false, error: "Mensagem vazia.", code: "TINDER_MESSAGE_EMPTY" },
          400,
          corsHeaders,
        );
      }
      if (message.length > 1000) {
        return json(
          {
            success: false,
            error: "Mensagem longa demais para o Tinder.",
            code: "TINDER_MESSAGE_TOO_LONG",
          },
          400,
          corsHeaders,
        );
      }
      const sent = await sendChannelMessage(token, matchId, message);
      return json({ success: true, message: sent }, 200, corsHeaders);
    }

    if (path === "/match/tinder/boost" && request.method === "POST") {
      const { token } = await requireSession(request, supabase);
      const boost = await startBoost(token);
      return json({ success: true, ...boost }, 200, corsHeaders);
    }

    if (path === "/match/tinder/swipe" && request.method === "POST") {
      const { token } = await requireSession(request, supabase);
      const body = await request.json().catch(() => ({}));
      const userId = String(body?.userId || "").trim();
      const action = String(body?.action || "").trim() as TinderAction;

      if (!userId || !["like", "pass", "superlike"].includes(action)) {
        return json(
          { success: false, error: "userId e action válidos são obrigatórios." },
          400,
          corsHeaders,
        );
      }

      const result = await performSwipe(token, userId, action, {
        sNumber: Number.isFinite(Number(body?.sNumber)) ? Number(body.sNumber) : null,
        contentHash: body?.contentHash ? String(body.contentHash) : null,
        photoId: body?.photoId ? String(body.photoId) : null,
        undo: Boolean(body?.undo),
        fastMatch: Boolean(body?.fastMatch),
      });
      return json(
        {
          success: true,
          action,
          userId,
          ...result,
        },
        200,
        corsHeaders,
      );
    }

    return json({ success: false, error: "match_tinder_route_not_found" }, 404, corsHeaders);
  } catch (error: any) {
    const status = Number(error?.status) || 500;
    const safeStatus = [400, 401, 402, 403, 404, 409, 429, 502, 503, 504].includes(status)
      ? status
      : 500;

    if (safeStatus >= 500) {
      console.error("[Match/Tinder] route failure:", error?.message || error);
    }

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
