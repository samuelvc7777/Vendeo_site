import { NextRequest, NextResponse } from "next/server";
import { TinderApiClient } from "@/infrastructure/tinder/TinderApiClient";
import { getSupabaseServerClient } from "@/infrastructure/supabase/server";
import {
  NetworkTimeoutError,
  RateLimitError,
  UnauthorizedError,
  ServiceUnavailableError,
} from "@/infrastructure/http/network";
import { TinderRawMatch } from "@/domain/entities/Tinder";
import { formatMessageTime } from "@/lib/utils";


interface FormattedMatch {
  id: string;
  username: string;
  fullName: string;
  avatar: string;
  isOnline: boolean;
  lastActive: string;
  lastMessage: string;
  unread: boolean;
  type: string;
  lastSender: "me" | "them";
  isNewMatch: boolean;
  photos?: string[];
  bio?: string;
  city?: string;
  isRestricted?: boolean;
  status?: string;
}

interface SupabaseConversationRow {
  match_id: string;
  name?: string | null;
  birth_date?: string | null;
  bio?: string | null;
  city?: string | null;
  photos?: unknown;
  last_message_at?: string | null;
  created_at?: string | null;
  last_direction?: string | null;
  last_message_preview?: string | null;
  status?: string | null;
}

/**
 * Recupera e formata os matches persistidos no Supabase como camada de cache e resiliência.
 */
async function getCachedMatchesFromSupabase(
  client: NonNullable<ReturnType<typeof getSupabaseServerClient>>
): Promise<FormattedMatch[]> {
  const { data, error } = await client
    .from("tinder_conversations")
    .select("*")
    .order("last_message_at", { ascending: false, nullsFirst: false })
    .limit(100);

  if (error || !data || data.length === 0) {
    return [];
  }

  return (data as SupabaseConversationRow[]).map((m) => {
    let ageStr = "";
    if (m.birth_date) {
      const birthYear = new Date(m.birth_date).getFullYear();
      if (!isNaN(birthYear)) {
        const age = new Date().getFullYear() - birthYear;
        ageStr = `, ${age}`;
      }
    }

    let avatarUrl = "https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=120&auto=format&fit=crop&q=80";
    if (Array.isArray(m.photos) && m.photos.length > 0) {
      const firstPhoto = m.photos[0];
      if (typeof firstPhoto === "string") {
        avatarUrl = firstPhoto;
      } else if (typeof firstPhoto === "object" && firstPhoto !== null) {
        const photoObj = firstPhoto as { url?: string };
        avatarUrl = photoObj.url || avatarUrl;
      }
    }

    let lastActive = "";
    if (m.last_message_at || m.created_at) {
      const d = new Date(m.last_message_at || m.created_at || "");
      if (!isNaN(d.getTime())) {
        const now = new Date();
        const isToday =
          d.getDate() === now.getDate() &&
          d.getMonth() === now.getMonth() &&
          d.getFullYear() === now.getFullYear();

        lastActive = isToday
          ? formatMessageTime(d)
          : d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", timeZone: "America/Sao_Paulo" });
      }

    }

    const isSentByMe = m.last_direction === "outbound";
    const hasPreview = Boolean(m.last_message_preview);
    const isNewMatch = !hasPreview && m.status === "Novo";

    let displayLastMessage = "Novo Match";
    if (hasPreview && m.last_message_preview) {
      displayLastMessage = isSentByMe
        ? `Você: ${m.last_message_preview}`
        : m.last_message_preview;
    }

    const photosList = Array.isArray(m.photos) && m.photos.length > 0
      ? m.photos.map((p: any) => (typeof p === "string" ? p : p?.url || "")).filter(Boolean)
      : [avatarUrl];

    return {
      id: m.match_id,
      username: (m.name || "match").toLowerCase().replace(/\s+/g, "_"),
      fullName: `${m.name || "Match"}${ageStr}`,
      avatar: avatarUrl,
      isOnline: false,
      lastActive: lastActive || "Recente",
      lastMessage: displayLastMessage,
      unread: !isSentByMe && hasPreview,
      type: "tinder",
      lastSender: isSentByMe ? ("me" as const) : ("them" as const),
      isNewMatch,
      photos: photosList,
      bio: m.bio || "",
      city: m.city || "",
      isRestricted: m.status === "restricted",
      status: m.status || (m.status === "restricted" ? "restricted" : "active"),
    };
  });
}

function formatApiMatches(rawMatches: TinderRawMatch[], myUserId: string): FormattedMatch[] {
  return rawMatches.map((m) => {
    const person = m.person || { _id: "", name: "Match" };
    const name = person.name || "Match";

    let ageStr = "";
    if (person.birth_date) {
      const birthYear = new Date(person.birth_date).getFullYear();
      if (!isNaN(birthYear)) {
        const age = new Date().getFullYear() - birthYear;
        ageStr = `, ${age}`;
      }
    }

    const avatar =
      person.photos?.[0]?.url ||
      person.photos?.[0]?.processedFiles?.[0]?.url ||
      "/favicon.ico";

    const msgs = m.messages || [];
    const hasMessages = msgs.length > 0;
    const lastMsg = hasMessages ? msgs[msgs.length - 1] : null;

    const isSentByMe = lastMsg ? lastMsg.from === myUserId : false;
    const lastSender: "me" | "them" = isSentByMe ? "me" : "them";
    const isNewMatch = !hasMessages || Boolean(m.is_new_match);

    let displayLastMessage = "Novo Match";
    if (hasMessages && lastMsg) {
      displayLastMessage = isSentByMe
        ? `Você: ${lastMsg.message}`
        : lastMsg.message;
    }

    let lastActive = "";
    const targetDateStr = lastMsg?.sent_date || m.last_activity_date || m.created_date;
    if (targetDateStr) {
      const d = new Date(targetDateStr);
      if (!isNaN(d.getTime())) {
        const now = new Date();
        const isToday =
          d.getDate() === now.getDate() &&
          d.getMonth() === now.getMonth() &&
          d.getFullYear() === now.getFullYear();

        if (isToday) {
          lastActive = formatMessageTime(d);
        } else {
          lastActive = d.toLocaleDateString("pt-BR", {
            day: "2-digit",
            month: "2-digit",
            timeZone: "America/Sao_Paulo",
          });
        }

      }
    }

    const photosList =
      Array.isArray(person.photos) && person.photos.length > 0
        ? person.photos
            .map((p: any) => (typeof p === "string" ? p : p?.url || p?.processedFiles?.[0]?.url || ""))
            .filter(Boolean)
        : [avatar];

    return {
      id: m.id,
      username: name.toLowerCase().replace(/\s+/g, "_"),
      fullName: `${name}${ageStr}`,
      avatar,
      isOnline: false,
      lastActive,
      lastMessage: displayLastMessage,
      unread: Boolean(m.unread_count && m.unread_count > 0),
      type: "tinder",
      lastSender,
      isNewMatch,
      photos: photosList,
      bio: person.bio || "",
      city: (person as any).city?.name || (person as any).city || "",
    };
  });
}

export const dynamic = "force-static";

export async function GET(req: NextRequest) {
  if (process.env.NEXT_PHASE === "phase-production-build") {
    return NextResponse.json({ matches: [] });
  }

  const cookieHeader = req.headers.get("cookie") || "";

  const cookieToken = cookieHeader
    .split(";")
    .map((c) => c.trim())
    .find((c) => c.startsWith("tinder_token="))
    ?.split("=")[1];
  const authHeader = req.headers.get("Authorization")?.replace("Bearer ", "");

  let token = authHeader || cookieToken;

  const client = getSupabaseServerClient();

  // 1. Tenta recuperar token persistido se não fornecido nos headers/cookies
  if (!token && client) {
    try {
      const { data } = await client
        .from("tinder_config")
        .select("auth_token")
        .eq("id", "default")
        .single();
      if (data?.auth_token) {
        token = data.auth_token;
      }
    } catch {
      // prossegue
    }
  }

  // 2. Se houver token, tenta a API oficial do Tinder primeiro
  if (token) {
    try {
      const [profile, rawMatches] = await Promise.all([
        TinderApiClient.getProfile(token),
        TinderApiClient.getMatches(token, 60),
      ]);

      // 1. Busca matches restritos persistidos no Supabase para preservar o status
      let restrictedMatchIds = new Set<string>();
      if (client) {
        try {
          const { data: restrictedRows } = await client
            .from("tinder_conversations")
            .select("match_id")
            .eq("status", "restricted");
          if (restrictedRows) {
            restrictedMatchIds = new Set(restrictedRows.map((r: any) => r.match_id));
          }
        } catch {}
      }

      const formattedMatches = formatApiMatches(rawMatches, profile.id).map((m) => {
        const isRestr = restrictedMatchIds.has(m.id);
        return {
          ...m,
          isRestricted: isRestr,
          status: isRestr ? "restricted" : "active",
        };
      });

      // Sincroniza automaticamente no Supabase para persistência e memória contínua
      if (client) {
        try {
          // 1. Atualiza tinder_config
          await client.from("tinder_config").upsert({
            id: "default",
            auth_token: token,
            user_id: profile.id,
            user_name: profile.name,
            avatar_url: profile.photos?.[0]?.url,
            updated_at: new Date().toISOString(),
          });

          // 1.5 Carrega histórico existente para não sobrescrever previews com null
          const { data: existingRows } = await client
            .from("tinder_conversations")
            .select("match_id, last_message_preview, last_message_at, last_direction, status");
          const existingMap = new Map<string, any>();
          if (existingRows) {
            for (const r of existingRows) {
              existingMap.set(r.match_id, r);
            }
          }

          // 2. Upsert das conversas no Supabase (preservando matches restritos e mensagens anteriores)
          const convsToUpsert = rawMatches.map((m: any) => {
            const person = m.person || {};
            const msgs = Array.isArray(m.messages) ? m.messages : [];
            const existing = existingMap.get(m.id);
            const isRestricted = restrictedMatchIds.has(m.id) || existing?.status === "restricted";

            const sortedMsgs = [...msgs].sort((a: any, b: any) => {
              const tA = a.timestamp || (a.sent_date ? new Date(a.sent_date).getTime() : 0);
              const tB = b.timestamp || (b.sent_date ? new Date(b.sent_date).getTime() : 0);
              return tB - tA;
            });
            const newestMsg = sortedMsgs[0] || null;
            const isSentByMe = newestMsg ? newestMsg.from === profile.id : false;

            const preview = newestMsg?.message || existing?.last_message_preview || null;
            const lastAt = newestMsg?.sent_date
              ? new Date(newestMsg.sent_date).toISOString()
              : existing?.last_message_at || (m.last_activity_date ? new Date(m.last_activity_date).toISOString() : null);
            const direction = newestMsg
              ? (isSentByMe ? "outbound" : "inbound")
              : existing?.last_direction || null;
            const status = isRestricted
              ? "restricted"
              : preview
              ? "Conversando"
              : existing?.status || "Novo";

            return {
              match_id: m.id,
              person_id: person._id || null,
              name: person.name || "Match",
              birth_date: person.birth_date || null,
              bio: person.bio || null,
              photos: person.photos || [],
              last_message_preview: preview,
              last_message_at: lastAt,
              last_direction: direction,
              status,
              updated_at: new Date().toISOString(),
            };
          });

          if (convsToUpsert.length > 0) {
            await client.from("tinder_conversations").upsert(convsToUpsert, { onConflict: "match_id" });
          }

          // 3. Upsert de todas as mensagens que já vieram no lote de matches
          const messagesToUpsert: any[] = [];
          for (const m of rawMatches) {
            if (Array.isArray(m.messages) && m.messages.length > 0) {
              for (const msg of m.messages) {
                if (msg._id && msg.message) {
                  messagesToUpsert.push({
                    id: msg._id,
                    match_id: m.id,
                    sender_id: msg.from,
                    message: msg.message,
                    sent_date: msg.sent_date ? new Date(msg.sent_date).toISOString() : new Date().toISOString(),
                    created_at: msg.sent_date ? new Date(msg.sent_date).toISOString() : new Date().toISOString(),
                  });
                }
              }
            }
          }

          if (messagesToUpsert.length > 0) {
            await client.from("tinder_messages").upsert(messagesToUpsert, { onConflict: "id" });
          }
        } catch (syncErr) {
          console.error("Aviso ao persistir matches no Supabase:", syncErr);
        }
      }

      return NextResponse.json({
        matches: formattedMatches,
        myProfile: profile,
      });
    } catch (externalError: unknown) {
      const errorMessage =
        externalError instanceof Error ? externalError.message : "Erro desconhecido na API externa";

      // 3. Fallback: Se o Tinder externo der timeout ou erro, retorna o cache do Supabase com cabeçalho X-Fallback
      if (client) {
        try {
          const cachedMatches = await getCachedMatchesFromSupabase(client);
          if (cachedMatches.length > 0) {
            return NextResponse.json(
              {
                matches: cachedMatches,
                myProfile: {
                  id: "6a8451cb13ef7556bbdaa40e",
                  name: "Larissa",
                },
                fallback: true,
              },
              {
                headers: {
                  "X-Fallback": "true",
                  "X-Fallback-Reason": errorMessage,
                },
              }
            );
          }
        } catch (dbErr) {
          console.error("Erro ao buscar cache do Supabase durante fallback:", dbErr);
        }
      }

      // Se o cache também não puder atender, mapeia para status HTTP e código padronizado
      let status = 500;
      let code = "INTERNAL_SERVER_ERROR";

      if (externalError instanceof NetworkTimeoutError) {
        status = 504;
        code = "NETWORK_TIMEOUT";
      } else if (externalError instanceof RateLimitError) {
        status = 429;
        code = "RATE_LIMIT_EXCEEDED";
      } else if (externalError instanceof UnauthorizedError) {
        status = 401;
        code = "UNAUTHORIZED";
      } else if (externalError instanceof ServiceUnavailableError) {
        status = 503;
        code = "SERVICE_UNAVAILABLE";
      }

      return NextResponse.json(
        {
          error: errorMessage,
          code,
        },
        { status }
      );
    }
  }

  // 4. Se não há token, tenta recuperar do cache local do Supabase antes de negar
  if (client) {
    try {
      const cachedMatches = await getCachedMatchesFromSupabase(client);
      if (cachedMatches.length > 0) {
        return NextResponse.json(
          {
            matches: cachedMatches,
            myProfile: {
              id: "6a8451cb13ef7556bbdaa40e",
              name: "Larissa",
            },
            fallback: true,
          },
          {
            headers: {
              "X-Fallback": "true",
              "X-Fallback-Reason": "Nenhum token fornecido; usando cache local.",
            },
          }
        );
      }
    } catch {
      // prossegue para 401
    }
  }

  return NextResponse.json(
    {
      error: "Não autenticado no Tinder.",
      code: "UNAUTHORIZED",
    },
    { status: 401 }
  );
}
