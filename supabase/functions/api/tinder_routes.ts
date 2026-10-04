// tinder_routes.ts
// Endpoints oficiais do Tinder para a Edge Function do Supabase (Vendeo Social)
// Deno TypeScript Runtime

const TINDER_API_BASE = "https://api.gotinder.com";
const TIMEOUT_MS = 8000;

const DEFAULT_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
  Accept: "application/json",
  "Content-Type": "application/json",
  platform: "web",
  "app-version": "1040800",
  Origin: "https://tinder.com",
  Referer: "https://tinder.com/",
};

async function fetchWithTimeout(url: string, options: RequestInit = {}, timeoutMs = TIMEOUT_MS): Promise<Response> {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(id);
  }
}

interface RawPhotoItem {
  id?: string;
  url?: string;
  processedFiles?: Array<{ url?: string; width?: number; height?: number }>;
}

async function fetchTinderProfile(token: string) {
  const res = await fetchWithTimeout(`${TINDER_API_BASE}/v2/profile?include=user`, {
    method: "GET",
    headers: { ...DEFAULT_HEADERS, "X-Auth-Token": token },
  });

  if (!res.ok) {
    const errorText = await res.text();
    throw new Error(`Tinder getProfile (${res.status}): ${errorText || res.statusText}`);
  }

  const data = await res.json();
  const user = data?.data?.user;
  if (!user) throw new Error("Usuário não encontrado na resposta do Tinder.");

  const photos = (user.photos || []).map((p: RawPhotoItem) => ({
    id: p.id || String(Math.random()),
    url: p.url || p.processedFiles?.[0]?.url || "",
  }));

  return {
    id: user._id || user.id,
    name: user.name || "Usuário Tinder",
    bio: user.bio,
    birthDate: user.birth_date,
    photos,
    isVerified: Boolean(user.is_tinder_u || user.badges?.length),
  };
}

async function fetchTinderMatches(token: string, count = 60) {
  const res = await fetchWithTimeout(
    `${TINDER_API_BASE}/v2/matches?count=${count}&is_tinder_u=false`,
    {
      method: "GET",
      headers: { ...DEFAULT_HEADERS, "X-Auth-Token": token },
    }
  );

  if (!res.ok) {
    const errorText = await res.text();
    throw new Error(`Tinder getMatches (${res.status}): ${errorText || res.statusText}`);
  }

  const data = await res.json();
  return data?.data?.matches || [];
}

async function fetchTinderMessages(token: string, matchId: string, count = 100) {
  const res = await fetchWithTimeout(
    `${TINDER_API_BASE}/v2/matches/${matchId}/messages?count=${count}`,
    {
      method: "GET",
      headers: { ...DEFAULT_HEADERS, "X-Auth-Token": token },
    }
  );

  if (!res.ok) {
    const errorText = await res.text();
    throw new Error(`Tinder getMessages (${res.status}): ${errorText || res.statusText}`);
  }

  const data = await res.json();
  return data?.data?.messages || [];
}

async function sendTinderMessage(token: string, matchId: string, message: string) {
  // Tentativa 1: Endpoint v1 oficial padrão web
  const res = await fetchWithTimeout(`${TINDER_API_BASE}/user/matches/${matchId}`, {
    method: "POST",
    headers: { ...DEFAULT_HEADERS, "X-Auth-Token": token },
    body: JSON.stringify({ message }),
  });

  if (res.ok) {
    return await res.json();
  }

  // Se falhar com 404 ou 405, fallback para endpoint v2
  if (res.status === 404 || res.status === 405) {
    const resV2 = await fetchWithTimeout(`${TINDER_API_BASE}/v2/matches/${matchId}/messages`, {
      method: "POST",
      headers: { ...DEFAULT_HEADERS, "X-Auth-Token": token },
      body: JSON.stringify({ message, temp_id: `temp_${Date.now()}` }),
    });

    if (resV2.ok) {
      return await resV2.json();
    }
    const errV2 = await resV2.text();
    throw new Error(`Tinder sendMessage v2 (${resV2.status}): ${errV2 || resV2.statusText}`);
  }

  const errText = await res.text();
  throw new Error(`Tinder sendMessage (${res.status}): ${errText || res.statusText}`);
}

export async function handleTinderRoutes(params: {
  request: Request;
  path: string;
  supabase: any;
  corsHeaders: Record<string, string>;
}): Promise<Response | null> {
  const { request, path, supabase, corsHeaders } = params;

  if (!path.startsWith("/tinder/") && path !== "/tinder") {
    return null;
  }

  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  // 1. GET /tinder/status
  if (path === "/tinder/status" && request.method === "GET") {
    try {
      const { data: config } = await supabase
        .from("tinder_config")
        .select("*")
        .eq("id", "default")
        .maybeSingle();

      const token = config?.auth_token;
      if (!token) {
        return new Response(
          JSON.stringify({
            connected: false,
            isConnected: false,
            code: "NO_TOKEN",
          }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      try {
        const profile = await fetchTinderProfile(token);
        return new Response(
          JSON.stringify({
            connected: true,
            isConnected: true,
            token,
            profile,
            profileId: profile.id,
          }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      } catch (profileErr: any) {
        // Se o token for inválido/expirado
        if (profileErr?.message?.includes("401")) {
          return new Response(
            JSON.stringify({
              connected: false,
              isConnected: false,
              code: "INVALID_TOKEN",
              error: "Token do Tinder expirado ou inválido.",
            }),
            { headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }

        // Se for erro temporário de rede, retorna o perfil em cache no banco
        if (config.user_id) {
          return new Response(
            JSON.stringify({
              connected: true,
              isConnected: true,
              token,
              profileId: config.user_id,
              profile: {
                id: config.user_id,
                name: config.user_name || "Usuário Tinder",
                photos: config.avatar_url ? [{ id: "main", url: config.avatar_url }] : [],
              },
            }),
            { headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }

        throw profileErr;
      }
    } catch (err: any) {
      return new Response(
        JSON.stringify({ connected: false, isConnected: false, error: err.message }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
  }

  // 2. POST /tinder/auth
  if (path === "/tinder/auth" && request.method === "POST") {
    try {
      const body = await request.json().catch(() => ({}));
      const token = String(body?.token || "").trim();

      if (!token) {
        return new Response(
          JSON.stringify({ error: "Token de autenticação do Tinder não informado." }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const profile = await fetchTinderProfile(token);

      await supabase.from("tinder_config").upsert({
        id: "default",
        auth_token: token,
        user_id: profile.id,
        user_name: profile.name,
        avatar_url: profile.photos?.[0]?.url || null,
        updated_at: new Date().toISOString(),
      });

      return new Response(
        JSON.stringify({
          success: true,
          connected: true,
          isConnected: true,
          profile,
          token,
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    } catch (err: any) {
      return new Response(
        JSON.stringify({ error: err.message || "Falha ao autenticar no Tinder" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
  }

  // 3. POST /tinder/disconnect
  if (path === "/tinder/disconnect" && request.method === "POST") {
    try {
      await supabase
        .from("tinder_config")
        .update({ auth_token: "", updated_at: new Date().toISOString() })
        .eq("id", "default");

      return new Response(JSON.stringify({ success: true, connected: false }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    } catch (err: any) {
      return new Response(JSON.stringify({ error: err.message }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
  }

  // 4. GET /tinder/matches
  if (path === "/tinder/matches" && request.method === "GET") {
    try {
      const { data: config } = await supabase
        .from("tinder_config")
        .select("*")
        .eq("id", "default")
        .maybeSingle();

      const token = config?.auth_token;
      let rawMatches: any[] = [];

      if (token) {
        try {
          rawMatches = await fetchTinderMatches(token, 60);

          // Sincroniza em segundo plano no Supabase
          for (const m of rawMatches) {
            const matchId = String(m.id || m._id);
            const person = m.person || {};
            const lastMsg = m.messages && m.messages.length > 0 ? m.messages[m.messages.length - 1] : null;
            const isOutbound = lastMsg ? (lastMsg.from === config.user_id || lastMsg.is_mine) : false;

            const photos = (person.photos || []).map((p: any) => ({
              id: p.id || String(Math.random()),
              url: p.url || p.processedFiles?.[0]?.url || "",
            }));

            // Upsert tinder_conversations
            await supabase.from("tinder_conversations").upsert({
              match_id: matchId,
              person_id: person._id || person.id || null,
              name: person.name || "Match Tinder",
              birth_date: person.birth_date || null,
              bio: person.bio || null,
              photos,
              last_message_preview: lastMsg?.message || null,
              last_message_at: m.last_activity_date || new Date().toISOString(),
              last_direction: isOutbound ? "outbound" : "inbound",
              status: lastMsg ? "active" : "Novo",
              updated_at: new Date().toISOString(),
            });

            // Upsert instagram_conversations (canal unificado)
            await supabase.from("instagram_conversations").upsert({
              id: matchId,
              username: person.name || "Match Tinder",
              full_name: person.name || "Match Tinder",
              avatar_url: photos[0]?.url || null,
              channel: "tinder",
              last_message_text: lastMsg?.message || "Novo match!",
              last_message_at: m.last_activity_date || new Date().toISOString(),
              unread_count: Number(m.unread_count || 0),
              metadata: {
                is_tinder: true,
                bio: person.bio || null,
                city: person.city?.name || null,
                photos,
              },
            });
          }
        } catch (fetchErr) {
          console.warn("[Tinder] Aviso ao buscar matches remotos:", fetchErr);
        }
      }

      // Se a API retornou matches diretamente, formata
      if (rawMatches.length > 0) {
        return new Response(
          JSON.stringify({
            matches: rawMatches,
            profileId: config?.user_id,
          }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      // Fallback para conversas salvas no Supabase
      const { data: cached } = await supabase
        .from("tinder_conversations")
        .select("*")
        .order("last_message_at", { ascending: false })
        .limit(60);

      const fallbackMatches = (cached || []).map((c: any) => ({
        id: c.match_id,
        person: {
          name: c.name,
          bio: c.bio,
          birth_date: c.birth_date,
          photos: c.photos || [],
        },
        messages: c.last_message_preview ? [{ message: c.last_message_preview, is_mine: c.last_direction === "outbound" }] : [],
        last_activity_date: c.last_message_at,
        is_new_match: !c.last_message_preview,
      }));

      return new Response(
        JSON.stringify({
          matches: fallbackMatches,
          profileId: config?.user_id,
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    } catch (err: any) {
      return new Response(JSON.stringify({ error: err.message }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
  }

  // 5. GET e POST /tinder/messages/:matchId
  const messagesMatch = path.match(/^\/tinder\/messages\/([^/]+)$/);
  if (messagesMatch) {
    const matchId = messagesMatch[1];

    const { data: config } = await supabase
      .from("tinder_config")
      .select("*")
      .eq("id", "default")
      .maybeSingle();

    const token = config?.auth_token;

    if (request.method === "GET") {
      try {
        let rawMessages: any[] = [];
        if (token) {
          try {
            rawMessages = await fetchTinderMessages(token, matchId, 100);

            // Sincroniza mensagens no banco
            for (const m of rawMessages) {
              const msgId = String(m._id || m.id);
              const isMine = m.from === config.user_id || m.is_mine;

              await supabase.from("tinder_messages").upsert({
                id: msgId,
                match_id: matchId,
                sender_id: m.from || (isMine ? "me" : matchId),
                message: m.message || "",
                sent_date: m.sent_date || new Date().toISOString(),
                status: "sent",
              });

              await supabase.from("instagram_messages").upsert({
                id: msgId,
                conversation_id: matchId,
                sender_id: m.from || (isMine ? "me" : matchId),
                sender_type: isMine ? "human" : "customer",
                text: m.message || "",
                channel: "tinder",
                created_at: m.sent_date || new Date().toISOString(),
                is_from_me: Boolean(isMine),
              });
            }
          } catch (fetchErr) {
            console.warn("[Tinder] Aviso ao buscar mensagens remotas:", fetchErr);
          }
        }

        // Busca mensagens consolidadas
        const { data: dbMsgs } = await supabase
          .from("tinder_messages")
          .select("*")
          .eq("match_id", matchId)
          .order("sent_date", { ascending: true });

        const formatted = (dbMsgs && dbMsgs.length > 0 ? dbMsgs : rawMessages).map((m: any) => ({
          id: m.id || m._id,
          from: m.sender_id || m.from,
          message: m.message,
          sent_date: m.sent_date,
          timestamp: m.sent_date ? new Date(m.sent_date).getTime() : Date.now(),
          is_mine: m.sender_id === "me" || m.sender_id === config?.user_id || m.from === config?.user_id || m.is_mine,
        }));

        return new Response(JSON.stringify({ messages: formatted }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      } catch (err: any) {
        return new Response(JSON.stringify({ error: err.message }), {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    if (request.method === "POST") {
      try {
        const body = await request.json().catch(() => ({}));
        const messageText = String(body?.message || "").trim();

        if (!messageText) {
          return new Response(JSON.stringify({ error: "Mensagem vazia." }), {
            status: 400,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }

        let sentResult: any = null;
        if (token) {
          sentResult = await sendTinderMessage(token, matchId, messageText);
        }

        const msgId = sentResult?._id || sentResult?.id || `sent-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
        const nowIso = new Date().toISOString();

        // Grava no tinder_messages
        await supabase.from("tinder_messages").insert({
          id: msgId,
          match_id: matchId,
          sender_id: config?.user_id || "me",
          message: messageText,
          sent_date: nowIso,
          status: "sent",
        });

        // Grava no instagram_messages
        await supabase.from("instagram_messages").insert({
          id: msgId,
          conversation_id: matchId,
          sender_id: config?.user_id || "me",
          sender_type: "human",
          text: messageText,
          channel: "tinder",
          created_at: nowIso,
          is_from_me: true,
        });

        // Atualiza última mensagem na conversa
        await supabase
          .from("tinder_conversations")
          .update({
            last_message_preview: messageText,
            last_message_at: nowIso,
            last_direction: "outbound",
            status: "active",
            updated_at: nowIso,
          })
          .eq("match_id", matchId);

        await supabase
          .from("instagram_conversations")
          .update({
            last_message_text: messageText,
            last_message_at: nowIso,
          })
          .eq("id", matchId);

        return new Response(
          JSON.stringify({
            success: true,
            message: {
              id: msgId,
              message: messageText,
              sent_date: nowIso,
              is_mine: true,
            },
          }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      } catch (err: any) {
        return new Response(JSON.stringify({ error: err.message }), {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }
  }

  // 6. POST /tinder/matches/:matchId/restrict
  const restrictMatch = path.match(/^\/tinder\/matches\/([^/]+)\/restrict$/);
  if (restrictMatch && request.method === "POST") {
    try {
      const matchId = restrictMatch[1];
      const body = await request.json().catch(() => ({}));
      const isRestricted = Boolean(body?.isRestricted);

      await supabase
        .from("instagram_conversations")
        .update({ is_restricted: isRestricted })
        .eq("id", matchId);

      return new Response(JSON.stringify({ success: true, isRestricted }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    } catch (err: any) {
      return new Response(JSON.stringify({ error: err.message }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
  }

  return new Response(JSON.stringify({ error: "tinder_route_not_found" }), {
    status: 404,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
