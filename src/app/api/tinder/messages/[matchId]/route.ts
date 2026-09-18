import { NextRequest, NextResponse } from "next/server";
import { TinderApiClient } from "@/infrastructure/tinder/TinderApiClient";
import { getSupabaseServerClient } from "@/infrastructure/supabase/server";
import {
  NetworkTimeoutError,
  RateLimitError,
  UnauthorizedError,
  ServiceUnavailableError,
} from "@/infrastructure/http/network";
import { TinderRawMessage } from "@/domain/entities/Tinder";
import { formatMessageTime } from "@/lib/utils";


export const dynamic = "force-static";
export function generateStaticParams() {
  return [{ matchId: "default" }];
}

const MAX_MESSAGE_LENGTH = 1000;

interface RouteParams {
  params: Promise<{
    matchId: string;
  }>;
}

export async function GET(req: NextRequest, context: RouteParams) {
  if (process.env.NEXT_PHASE === "phase-production-build") {
    return NextResponse.json({ messages: [] });
  }

  const { matchId } = await context.params;


  if (!matchId || typeof matchId !== "string" || matchId.trim() === "") {
    return NextResponse.json(
      {
        error: "Identificador de match inválido.",
        code: "INVALID_MATCH_ID",
      },
      { status: 400 }
    );
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

  // 1. Se não houver token no cabeçalho ou cookie, tenta recuperar do config no Supabase
  if (!token && client) {
    try {
      const { data } = await client
        .from("tinder_config")
        .select("auth_token")
        .eq("id", "default")
        .single();
      if (data?.auth_token) token = data.auth_token;
    } catch {
      // prossegue
    }
  }

  // 2. Se houver token, busca da API oficial do Tinder e persiste TUDO no Supabase
  if (token) {
    try {
      const [profile, rawMessages] = await Promise.all([
        TinderApiClient.getProfile(token),
        TinderApiClient.getMessages(token, matchId, 100),
      ]);

      const myUserId = profile.id;

      // Ordena cronologicamente
      const sortedMessages = [...rawMessages].sort((a: TinderRawMessage, b: TinderRawMessage) => {
        const timeA = a.timestamp || (a.sent_date ? new Date(a.sent_date).getTime() : 0);
        const timeB = b.timestamp || (b.sent_date ? new Date(b.sent_date).getTime() : 0);
        return timeA - timeB;
      });

      // 3. PERSISTE TODAS AS MENSAGENS (DO PRETENDENTE E MINHAS) NO SUPABASE
      if (client && sortedMessages.length > 0) {
        try {
          const rowsToUpsert = sortedMessages
            .filter((m) => Boolean(m._id && m.message))
            .map((m) => {
              const isoDate = m.sent_date
                ? new Date(m.sent_date).toISOString()
                : new Date().toISOString();
              return {
                id: m._id,
                match_id: matchId,
                sender_id: m.from || "unknown",
                message: m.message,
                sent_date: isoDate,
                created_at: isoDate,
              };
            });

          if (rowsToUpsert.length > 0) {
            await client.from("tinder_messages").upsert(rowsToUpsert, { onConflict: "id" });
          }

          // Atualiza prévia na tabela tinder_conversations se houver mensagens
          const lastMsg = sortedMessages[sortedMessages.length - 1];
          if (lastMsg) {
            const isSentByMe = lastMsg.from === myUserId;
            await client
              .from("tinder_conversations")
              .update({
                last_message_preview: lastMsg.message,
                last_message_at: lastMsg.sent_date ? new Date(lastMsg.sent_date).toISOString() : new Date().toISOString(),
                last_direction: isSentByMe ? "outbound" : "inbound",
                updated_at: new Date().toISOString(),
              })
              .eq("match_id", matchId);
          }
        } catch (dbErr) {
          console.error("Aviso ao persistir mensagens do Tinder no Supabase:", dbErr);
        }
      }

      // 4. Formata as mensagens para a UI
      const formattedMessages = sortedMessages.map((m: TinderRawMessage) => {
        const isMine = m.from === myUserId || m.from === "me";
        const timeStr = m.sent_date ? formatMessageTime(m.sent_date) : "Agora";
        const ts = m.timestamp || (m.sent_date ? new Date(m.sent_date).getTime() : Date.now());

        return {
          id: m._id || String(Math.random()),
          senderId: isMine ? "me" : m.from,
          text: m.message || "",
          createdAt: timeStr || "Agora",
          timestamp: ts,
          sentDate: m.sent_date,
          isMine,
        };
      });

      // Se houver mensagens locais no Supabase recém-enviadas que ainda não sincronizaram com o Tinder
      if (client) {
        try {
          const { data: localMsgs } = await client
            .from("tinder_messages")
            .select("*")
            .eq("match_id", matchId)
            .ilike("id", "sent-%")
            .order("sent_date", { ascending: true });

          if (localMsgs && localMsgs.length > 0) {
            const remoteTexts = new Set(formattedMessages.map((f) => f.text.trim()));
            for (const local of localMsgs) {
              if (!remoteTexts.has(local.message.trim())) {
                formattedMessages.push({
                  id: local.id,
                  senderId: "me",
                  text: local.message,
                  createdAt: formatMessageTime(local.sent_date || Date.now()),
                  timestamp: local.sent_date ? new Date(local.sent_date).getTime() : Date.now(),
                  sentDate: local.sent_date || new Date().toISOString(),
                  isMine: true,
                });
              }
            }
          }
        } catch {
          // ignora
        }
      }

      return NextResponse.json({ messages: formattedMessages });
    } catch (externalError: unknown) {
      console.warn("Aviso ao buscar mensagens no Tinder oficial, tentando cache do Supabase:", externalError);
    }
  }

  // 5. Fallback: Recupera mensagens persistidas no Supabase (cache offline)
  if (client) {
    try {
      const { data, error } = await client
        .from("tinder_messages")
        .select("*")
        .eq("match_id", matchId)
        .order("sent_date", { ascending: true })
        .limit(200);

      if (!error && data && data.length > 0) {
        const { data: configData } = await client
          .from("tinder_config")
          .select("user_id")
          .eq("id", "default")
          .maybeSingle();

        const myUserId = configData?.user_id || "6a8451cb13ef7556bbdaa40e";

        const messages = data.map((m) => {
          const isMine = m.sender_id === "me" || m.sender_id === myUserId;
          const timeStr = m.sent_date ? formatMessageTime(m.sent_date) : "Agora";
          const ts = m.sent_date ? new Date(m.sent_date).getTime() : Date.now();

          return {
            id: m.id,
            senderId: isMine ? "me" : m.sender_id,
            text: m.message,
            createdAt: timeStr,
            timestamp: ts,
            sentDate: m.sent_date,
            isMine,
          };
        });


        return NextResponse.json({ messages, fallback: true });
      }
    } catch (err) {
      console.error("Erro ao consultar mensagens no Supabase:", err);
    }
  }

  return NextResponse.json({ messages: [] });
}

export async function POST(req: NextRequest, context: RouteParams) {
  const { matchId } = await context.params;

  if (!matchId || typeof matchId !== "string" || matchId.trim() === "") {
    return NextResponse.json(
      {
        error: "Identificador de match inválido.",
        code: "INVALID_MATCH_ID",
      },
      { status: 400 }
    );
  }

  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      {
        error: "Corpo da requisição inválido. Certifique-se de enviar um JSON válido.",
        code: "INVALID_JSON_BODY",
      },
      { status: 400 }
    );
  }

  const rawMessage = body?.message;

  if (rawMessage === undefined || rawMessage === null) {
    return NextResponse.json(
      {
        error: "O campo 'message' é obrigatório.",
        code: "MISSING_MESSAGE_FIELD",
      },
      { status: 400 }
    );
  }

  if (typeof rawMessage !== "string") {
    return NextResponse.json(
      {
        error: "O campo 'message' deve ser do tipo texto (string).",
        code: "INVALID_MESSAGE_TYPE",
      },
      { status: 400 }
    );
  }

  const messageText = rawMessage.trim();

  if (messageText.length === 0) {
    return NextResponse.json(
      {
        error: "A mensagem não pode ser vazia ou conter apenas espaços.",
        code: "EMPTY_MESSAGE",
      },
      { status: 400 }
    );
  }

  if (messageText.length > MAX_MESSAGE_LENGTH) {
    return NextResponse.json(
      {
        error: `A mensagem excede o limite máximo permitido de ${MAX_MESSAGE_LENGTH} caracteres. Enviados: ${messageText.length}.`,
        code: "MESSAGE_TOO_LONG",
      },
      { status: 400 }
    );
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
  const nowIso = new Date().toISOString();
  const newId = `sent-${Date.now()}`;

  try {
    // 1. Descobre o ID do usuário para salvar como sender_id correto
    let myUserId = "6a8451cb13ef7556bbdaa40e";
    if (client) {
      try {
        const { data: configData } = await client
          .from("tinder_config")
          .select("auth_token, user_id")
          .eq("id", "default")
          .single();
        if (configData?.auth_token && !token) token = configData.auth_token;
        if (configData?.user_id) myUserId = configData.user_id;
      } catch {
        // prossegue
      }
    }

    // 2. Salva no Supabase imediatamente
    if (client) {
      try {
        await client.from("tinder_messages").insert({
          id: newId,
          match_id: matchId,
          sender_id: myUserId,
          message: messageText,
          sent_date: nowIso,
          created_at: nowIso,
        });

        await client
          .from("tinder_conversations")
          .update({
            last_message_preview: messageText,
            last_message_at: nowIso,
            last_direction: "outbound",
            updated_at: nowIso,
          })
          .eq("match_id", matchId);
      } catch (dbErr) {
        console.error("Erro ao persistir mensagem no Supabase:", dbErr);
      }
    }

    // 3. Se houver token, despacha para a API oficial do Tinder
    if (token) {
      try {
        await TinderApiClient.sendMessage(token, matchId, messageText);
      } catch (apiErr: unknown) {
        console.warn("Aviso: envio na API remota do Tinder falhou, mensagem mantida localmente:", apiErr);

        if (apiErr instanceof UnauthorizedError) {
          return NextResponse.json(
            { error: "Token do Tinder expirado ou inválido.", code: "UNAUTHORIZED" },
            { status: 401 }
          );
        }
        if (apiErr instanceof RateLimitError) {
          return NextResponse.json(
            { error: "Limite de mensagens no Tinder atingido. Tente novamente mais tarde.", code: "RATE_LIMIT_EXCEEDED" },
            { status: 429 }
          );
        }
        if (apiErr instanceof NetworkTimeoutError) {
          return NextResponse.json(
            { error: "Tempo limite esgotado ao enviar mensagem para a API do Tinder.", code: "NETWORK_TIMEOUT" },
            { status: 504 }
          );
        }
      }
    }

    const newMsg = {
      id: newId,
      senderId: "me",
      text: messageText,
      createdAt: formatMessageTime(new Date()),
      isMine: true,
    };


    return NextResponse.json({ success: true, message: newMsg });
  } catch (error: unknown) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Erro inesperado ao processar mensagem.",
        code: "INTERNAL_SERVER_ERROR",
      },
      { status: 500 }
    );
  }
}