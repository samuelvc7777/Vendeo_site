// Supabase Edge Function - Backend Vendeo Social
// Deno TypeScript Runtime
import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.8";
import {
  runBrainOrchestration,
  requestBrainCyclePreemptionAtomic,
  authorizeManualAutopilotRetryAtomic,
  releaseExperimentalCycleAtomic,
  runDurableOutboxDispatcher,
} from "./brain_orchestrator.ts";
import { publishAutoPilotState, activity } from "./autopilot_state.ts";
import {
  getGroqApiKey,
  transcribeWithGroqCloud,
  resolveInboundAudioMessage,
} from "./audio_transcription.ts";
export { getGroqApiKey, transcribeWithGroqCloud, resolveInboundAudioMessage };
import {
  isActionableInboundMessage,
  isPureEmojiMessage,
} from "./ConversationQualityGate.ts";
import { createPendingManualResponse, detectProtectedInboundIntent } from "./manual_response_review.ts";
import { generateEpisodeFingerprint, saveConversationEpisodes } from "./conversation_episodic_memory.ts";
import { isAuthorizedAutopilotCron } from "./autopilot_cron_auth.ts";
import { createGlobalShutdownChatState, hasActiveBrainCycle } from "./autopilot_global_shutdown.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-autopilot-cron-token",
  "Access-Control-Allow-Methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS, HEAD",
};

const API_VERSION = "v21.0";
const API_BASE = `https://graph.instagram.com/${API_VERSION}`;

/**
 * Formata timestamps com precisão garantindo o fuso horário oficial de Brasília (America/Sao_Paulo / UTC-3).
 * Impede que servidores em nuvem rodando em UTC adiantem o relógio em 3 horas.
 */
function formatToBrasiliaTime(dateInput?: string | number | Date | null): string {
  if (!dateInput) return "Agora";
  try {
    const d = new Date(dateInput);
    if (isNaN(d.getTime())) return "Agora";
    return d.toLocaleTimeString("pt-BR", {
      hour: "2-digit",
      minute: "2-digit",
      timeZone: "America/Sao_Paulo",
    });
  } catch {
    return "Agora";
  }
}

function getSupabaseClient() {
  const url = Deno.env.get("SUPABASE_URL") || "";
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
  return createClient(url, key);
}

function constantTimeStringEquals(a: string, b: string): boolean {
  const encoder = new TextEncoder();
  const left = encoder.encode(a);
  const right = encoder.encode(b);
  if (left.length !== right.length) return false;
  let diff = 0;
  for (let i = 0; i < left.length; i++) diff |= left[i] ^ right[i];
  return diff === 0;
}

async function verifyMetaWebhookSignature(supabase: any, req: Request): Promise<boolean> {
  const supplied = req.headers.get("x-hub-signature-256") || "";
  if (!supplied.startsWith("sha256=")) return false;

  const { data: config } = await supabase
    .from("instagram_config")
    .select("app_secret")
    .eq("id", "default")
    .maybeSingle();
  const appSecret = (Deno.env.get("META_APP_SECRET") || config?.app_secret || "").trim();
  if (!appSecret) return false;

  const body = await req.clone().text();
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(appSecret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const digest = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body)));
  const expected = `sha256=${Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
  return constantTimeStringEquals(supplied.toLowerCase(), expected);
}


/**
 * Substitui todos os pontos (.) por vírgulas (,), mantendo estritamente os pontos de interrogação (?)
 * para simular a digitação jovem, fluida e informal do Instagram Direct / WhatsApp.
 */
function replaceDotsWithCommas(text: string): string {
  if (!text || typeof text !== "string") return text;
  if (text.startsWith("[audio:") || text.startsWith("[image:") || text.startsWith("[video:")) return text;

  // Substitui ponto seguido de espaço e letra por vírgula + espaço + letra minúscula
  let res = text.replace(/\s*\.\s*([A-Za-zÀ-ÖØ-öø-ÿ])/g, (_, letter) => `, ${letter.toLowerCase()}`);

  // Substitui qualquer outro ponto restante por vírgula
  res = res.replace(/\.+/g, ",");

  // Remove espaços antes de vírgula
  res = res.replace(/\s+,/g, ",");

  // Remove vírgulas coladas ou próximas de ponto de interrogação (ex: "né,?" ou "né?," -> "né?")
  res = res.replace(/,+\s*\?+/g, "?");
  res = res.replace(/\?+\s*,+/g, "?");

  // Remove vírgulas duplicadas (ex: ",," -> ",")
  res = res.replace(/,+/g, ",");

  return res.trim();
}

const EMOJI_REGEX = /[\p{Extended_Pictographic}\u{1F300}-\u{1F9FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}]/gu;

function extractUsedEmojis(messages?: { sender?: string; isMine?: boolean; text?: string }[]): string[] {
  if (!Array.isArray(messages)) return [];
  const myMessages = messages
    .filter((m) => m.isMine === true || m.sender === "me")
    .slice(-2);

  const used: string[] = [];
  for (const m of myMessages) {
    const text = m.text || "";
    const matches = text.match(EMOJI_REGEX);
    if (matches) {
      for (const em of matches) {
        if (!used.includes(em)) used.push(em);
      }
    }
  }
  return used;
}

function deduplicateAndCleanEmojis(
  responses: string[],
  bannedEmojis: string[] = []
): string[] {
  if (!Array.isArray(responses)) return [];
  const banned = new Set(bannedEmojis);
  let batchAlreadyHasEmoji = false;

  return responses.map((text) => {
    if (!text || typeof text !== "string") return text;
    if (text.startsWith("[audio:") || text.startsWith("[image:") || text.startsWith("[video:")) return text;

    let modified = text.replace(EMOJI_REGEX, (match) => {
      if (banned.has(match) || batchAlreadyHasEmoji) {
        return "";
      }
      batchAlreadyHasEmoji = true;
      return match;
    });

    // Limpa vírgula solta colada imediatamente antes do emoji (ex: "uai, 🥰" -> "uai 🥰")
    modified = modified.replace(/,\s*([\p{Extended_Pictographic}\u{1F300}-\u{1F9FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}])/gu, " $1");

    // Limpa espaços duplicados e pontuações residuais
    modified = modified
      .replace(/\s+/g, " ")
      .replace(/\s+,/g, ",")
      .replace(/\s+\?/g, "?")
      .trim();

    return modified;
  });
}

function sanitizeResponses(responses: string[], bannedEmojis: string[] = []): string[] {
  if (!Array.isArray(responses)) return [];
  const cleanedEmojis = deduplicateAndCleanEmojis(responses, bannedEmojis);
  return cleanedEmojis.map((r) => replaceDotsWithCommas(r)).filter(Boolean);
}


/**
 * Extrai o ID oficial da thread do Instagram diretamente do message ID (mid) da Meta.
 * Decodifica o payload binário da Meta em JS puro, sem dependências externas.
 */
function extractThreadIdFromMid(mid: string): string | null {
  try {
    if (!mid) return null;
    const binary = atob(mid.replace(/-/g, "+").replace(/_/g, "/"));
    let hex = "";
    for (let i = 0; i < binary.length; i++) {
      hex += binary.charCodeAt(i).toString(16).padStart(2, "0");
    }
    const matches = hex.match(/3a((?:3[0-9]){20,60})3a/g);
    if (!matches) return null;
    for (const m of matches) {
      const digitsHex = m.slice(2, -2);
      let asciiNum = "";
      for (let j = 0; j < digitsHex.length; j += 2) {
        asciiNum += String.fromCharCode(parseInt(digitsHex.slice(j, j + 2), 16));
      }
      if (asciiNum.length > 25) {
        return "aWdfZAG06" + btoa(asciiNum);
      }
    }
  } catch (_e) {
    return null;
  }
  return null;
}

/**
 * Resolve o perfil real de um contato do Instagram (username, fullName, avatar)
 * contornando o erro 230 ("User consent is required") da Meta através da rota de thread.
 */
async function resolveInstagramContactProfile(
  supabase: any,
  accessToken: string,
  myUsername: string,
  conversationId: string,
  mid?: string | null
): Promise<{
  username: string;
  fullName: string;
  avatar: string;
  threadId: string | null;
  igsid: string | null;
}> {
  let resolvedUsername: string | null = null;
  let resolvedFullName: string | null = null;
  let resolvedAvatar: string | null = null;
  let threadId: string | null = conversationId.startsWith("aWdf") ? conversationId : null;
  let igsid: string | null = /^\d+$/.test(conversationId) ? conversationId : null;

  if (!threadId && mid) {
    threadId = extractThreadIdFromMid(mid);
  }

  // 1. Consulta o nó da thread da Meta (NÃO dá erro 230! Retorna username de todos os participantes)
  if (threadId && accessToken) {
    try {
      const tRes = await fetch(
        `${API_BASE}/${threadId}?fields=id,participants{id,username},updated_time&access_token=${accessToken}`,
        { signal: AbortSignal.timeout(8000) }
      );
      if (tRes.ok) {
        const tData = await tRes.json();
        const participants: any[] = tData.participants?.data || [];
        const other = participants.find(
          (p: any) => p.username !== myUsername && p.username !== "lariresende_0611"
        );
        if (other) {
          if (other.username) {
            resolvedUsername = other.username;
            resolvedFullName = other.username;
          }
          if (other.id) {
            igsid = other.id;
          }
        }
      }
    } catch (tErr) {
      console.warn("[resolveInstagramContactProfile] Aviso na consulta da thread:", tErr);
    }
  }

  // 2. Tenta buscar nome completo e foto de perfil oficial via /IGSID
  const targetId = igsid || (/^\d+$/.test(conversationId) ? conversationId : null);
  if (targetId && accessToken) {
    try {
      const pRes = await fetch(
        `${API_BASE}/${targetId}?fields=id,name,username,profile_pic&access_token=${accessToken}`,
        { signal: AbortSignal.timeout(8000) }
      );
      if (pRes.ok) {
        const pData = await pRes.json();
        if (pData.username) resolvedUsername = pData.username;
        if (pData.name) resolvedFullName = pData.name;
        if (pData.profile_pic) resolvedAvatar = pData.profile_pic;
      }
    } catch (_pErr) {
      // Falha esperada caso a Meta ainda exija consentimento mútuo
    }
  }

  // 3. Fallback: consulta lista de conversas recentes da conta
  if (!resolvedUsername && accessToken) {
    try {
      const meRes = await fetch(
        `${API_BASE}/me/conversations?fields=id,participants{id,username}&limit=35&access_token=${accessToken}`,
        { signal: AbortSignal.timeout(8000) }
      );
      if (meRes.ok) {
        const meData = await meRes.json();
        const threads = meData.data || [];
        for (const th of threads) {
          const participants: any[] = th.participants?.data || [];
          const other = participants.find(
            (p: any) =>
              (igsid && p.id === igsid) ||
              (conversationId && p.id === conversationId) ||
              (th.id === conversationId)
          );
          if (other && other.username) {
            resolvedUsername = other.username;
            resolvedFullName = other.username;
            if (other.id) igsid = other.id;
            threadId = th.id;
            break;
          }
        }
      }
    } catch (_meErr) {}
  }

  const finalUsername = resolvedUsername || (conversationId.startsWith("aWdf") ? "instagram_user" : `ig_${conversationId.slice(-6)}`);
  const finalFullName = resolvedFullName || finalUsername;
  const finalAvatar = resolvedAvatar || "/images/default-avatar.svg";

  return {
    username: finalUsername,
    fullName: finalFullName,
    avatar: finalAvatar,
    threadId,
    igsid,
  };
}

serve(async (req: Request) => {
  const url = new URL(req.url);

  // Normaliza o path: remove prefixos duplicados /functions/v1/api, /api/api ou /api
  let path = url.pathname
    .replace(/^\/functions\/v1\/api/, "")
    .replace(/^\/functions\/v1/, "")
    .replace(/^\/api\/api/, "")
    .replace(/^\/api/, "");
  if (!path.startsWith("/")) path = `/${path}`;

  // Trata OPTIONS para CORS
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabase = getSupabaseClient();

    const isWebhook = path === "/meta/webhook" || path === "/instagram/webhook";
    const isInternalExport = path.startsWith("/internal/");
    const isCronTick = path === "/autopilot/cron-tick" || path === "/api/autopilot/cron-tick";

    if (isCronTick) {
      const authorized = await isAuthorizedAutopilotCron(
        supabase,
        req.headers.get("x-autopilot-cron-token"),
      );
      if (!authorized) {
        return new Response(JSON.stringify({ error: "Não autorizado." }), {
          status: 401,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    if (path === "/chat-stage/progress" && req.method === "POST") {
      const body = await req.json().catch(() => ({}));
      const conversationId = typeof body?.conversationId === "string" ? body.conversationId.trim() : "";
      const progressPatch = body?.progressPatch;
      if (!conversationId || !progressPatch || typeof progressPatch !== "object" || Array.isArray(progressPatch)) {
        return new Response(JSON.stringify({ error: "conversationId e progressPatch válidos são obrigatórios." }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const { data, error } = await supabase.rpc("patch_chat_progress_atomic", {
        p_conversation_id: conversationId,
        p_progress_patch: progressPatch,
      });
      if (error || data?.success !== true) {
        return new Response(JSON.stringify({ error: error?.message || data?.error || "Não foi possível salvar o progresso." }), {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      return new Response(JSON.stringify({ success: true, result: data }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (path === "/manual-response/memory" && req.method === "POST") {
      const body = await req.json().catch(() => ({})) as Record<string, unknown>;
      const conversationId = typeof body.conversationId === "string" ? body.conversationId.trim() : "";
      const inboundMessageIds = Array.isArray(body.inboundMessageIds)
        ? Array.from(new Set(body.inboundMessageIds.map((id) => String(id || "").trim()).filter(Boolean))).slice(0, 20)
        : [];
      const responseText = typeof body.responseText === "string" ? body.responseText.trim().slice(0, 2000) : "";

      if (!/^[a-zA-Z0-9_-]{1,128}$/.test(conversationId) || inboundMessageIds.length === 0 || !responseText) {
        return new Response(JSON.stringify({ error: "Dados válidos da resposta manual são obrigatórios." }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const { data: rawInboundRows, error: inboundError } = await supabase
        .from("instagram_messages")
        .select("id, text, is_mine")
        .eq("conversation_id", conversationId)
        .in("id", inboundMessageIds);

      const inboundRows = Array.isArray(rawInboundRows)
        ? rawInboundRows as Array<{ id: string; text: string | null; is_mine: boolean }>
        : null;

      if (inboundError || !inboundRows || inboundRows.length !== inboundMessageIds.length || inboundRows.some((message) => message.is_mine)) {
        return new Response(JSON.stringify({ error: "As mensagens recebidas não correspondem a esta conversa." }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const rowsById = new Map(inboundRows.map((message) => [String(message.id), message]));
      const orderedRows = inboundMessageIds.map((id) => rowsById.get(id)).filter(Boolean) as Array<{ id: string; text: string | null; is_mine: boolean }>;
      const originalText = orderedRows.map((message) => String(message.text || "").trim()).filter(Boolean).join("\n").slice(0, 3000);
      const detectedIntent = detectProtectedInboundIntent({ text: originalText });
      const lastInboundId = orderedRows[orderedRows.length - 1]?.id;
      const sourceMessageIds = orderedRows.map((message) => message.id);
      const invitation = detectedIntent?.intent === "invitation";
      const topic = invitation
        ? "invitation"
        : detectedIntent?.intent === "phone_contact_request"
        ? "contact_request"
        : detectedIntent?.intent === "photo_or_attachment"
        ? "shared_media"
        : "manual_response";
      const episodeSourceText = originalText || "Mensagem sem texto";
      const inviteEpisode = invitation
        ? [{
            conversation_id: conversationId,
            actor: "pretendente" as const,
            event_type: "plan" as const,
            topic,
            summary: `O pretendente já convidou Larissa para se encontrar. Convite: “${episodeSourceText}”. Resposta manual da Larissa: “${responseText}”.`,
            source_message_id: lastInboundId,
            source_message_ids: sourceMessageIds,
            original_text: episodeSourceText,
            semantic_keys: ["pretendente.invitation", "pretendente.meeting", "date_invitation", "encounter", "manual_response_history"],
            memory_class: "landmark" as const,
            metadata: { manual_review: true, response_text: responseText, memory_class: "landmark", importance: 0.95 },
          }]
        : [];
      const replyEpisode = {
        conversation_id: conversationId,
        actor: "larissa" as const,
        event_type: "answer" as const,
        topic,
        summary: invitation
          ? `Larissa respondeu manualmente ao convite do pretendente: “${responseText}”.`
          : `Larissa respondeu manualmente após a conversa precisar de revisão: “${responseText}”. Mensagem recebida: “${episodeSourceText}”.`,
        source_message_id: lastInboundId,
        source_message_ids: sourceMessageIds,
        original_text: responseText,
        semantic_keys: invitation
          ? ["larissa.invitation_response", "pretendente.invitation", "manual_response_history"]
          : [`larissa.manual_response.${topic}`, "manual_response_history"],
        memory_class: "speech_act" as const,
        metadata: { manual_review: true, inbound_text: episodeSourceText, memory_class: "speech_act" },
      };
      const episodes = [...inviteEpisode, replyEpisode].map((episode) => ({
        ...episode,
        episode_fingerprint: generateEpisodeFingerprint({
          conversation_id: conversationId,
          source_message_id: episode.source_message_id,
          actor: episode.actor,
          event_type: episode.event_type,
          topic: episode.topic,
          semantic_keys: episode.semantic_keys,
        }),
      }));

      const writeResult = await saveConversationEpisodes({ supabase, conversationId, episodes });
      const fingerprints = episodes.map((episode) => episode.episode_fingerprint);
      const { data: savedEpisodes, error: verifyError } = await supabase
        .from("conversation_episodic_memory")
        .select("episode_fingerprint")
        .eq("conversation_id", conversationId)
        .in("episode_fingerprint", fingerprints);
      if (verifyError || !Array.isArray(savedEpisodes) || savedEpisodes.length !== episodes.length) {
        console.error("[ManualResponseMemory] Não foi possível confirmar toda a memória manual:", verifyError || writeResult);
        return new Response(JSON.stringify({ error: "A resposta foi enviada, mas não foi possível confirmar a memória da conversa." }), {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      return new Response(JSON.stringify({ success: true, savedEpisodes: savedEpisodes.length, topic }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ==========================================
    // 1. INSTAGRAM / META WEBHOOK (Handshake & Events)
    // ==========================================
    if (path === "/meta/webhook" || path === "/instagram/webhook") {
      console.log(`[TRACE-AUTOPILOT] webhook:received method=${req.method}`);
      // GET: Handshake de verificação da Meta
      if (req.method === "GET") {
        const mode = url.searchParams.get("hub.mode");
        const token = url.searchParams.get("hub.verify_token");
        const challenge = url.searchParams.get("hub.challenge");

        const { data: config } = await supabase
          .from("instagram_config")
          .select("verify_token")
          .eq("id", "default")
          .maybeSingle();

        const expectedToken = config?.verify_token || "vendeo_ig_secret_token";

        if (mode === "subscribe" && token === expectedToken) {
          return new Response(challenge || "", { status: 200, headers: corsHeaders });
        }
        return new Response("Forbidden", { status: 403, headers: corsHeaders });
      }

      // POST: Recepção de mensagens do Instagram (incluindo echoes enviadas pelo app oficial)
      if (req.method === "POST") {
        if (!(await verifyMetaWebhookSignature(supabase, req))) {
          console.warn("[Webhook] Assinatura da Meta ausente ou inválida; evento rejeitado.");
          return new Response("Forbidden", { status: 403, headers: corsHeaders });
        }
        const body = await req.json().catch(() => ({}));
        const entries = body.entry || [];

        for (const entry of entries) {
          const messagingList = entry.messaging || [];
          for (const msgEvent of messagingList) {
            const senderId = msgEvent.sender?.id;
            const recipientId = msgEvent.recipient?.id;
            const message = msgEvent.message;
            const readEvent = msgEvent.read;

            // 1. TRATAMENTO DE READ RECEIPT (Cliente visualizou a mensagem da Larissa / Vendeo)
            if (readEvent && senderId) {
              const rawContactId = senderId;
              const watermark = readEvent.watermark || msgEvent.timestamp || Date.now();
              const seenAtIso = new Date(watermark).toISOString();

              let conversationId = rawContactId;
              if (/^\d+$/.test(rawContactId)) {
                // Procura na tabela instagram_conversations se já existe conversa com esse contact_id ou id
                const { data: convByContact } = await supabase
                  .from("instagram_conversations")
                  .select("id")
                  .or(`id.eq.${rawContactId},contact_id.eq.${rawContactId}`)
                  .limit(1)
                  .maybeSingle();

                if (convByContact?.id) {
                  conversationId = convByContact.id;
                } else {
                  // Procura em instagram_messages se já temos alguma mensagem desse contato vinculada a outro conversation_id
                  const { data: convRow } = await supabase
                    .from("instagram_messages")
                    .select("conversation_id")
                    .or(`sender_id.eq.${rawContactId},contact_id.eq.${rawContactId}`)
                    .neq("conversation_id", rawContactId)
                    .limit(1)
                    .maybeSingle();

                  if (convRow?.conversation_id) {
                    conversationId = convRow.conversation_id;
                  }
                }
              }

              // Atualiza conversa para status 'seen' e grava o momento exato em seen_at
              await supabase
                .from("instagram_conversations")
                .update({
                  last_status: "seen",
                  seen_at: seenAtIso,
                  updated_at: new Date().toISOString(),
                })
                .eq("id", conversationId);

              // Atualiza mensagens enviadas por nós até o watermark para status 'seen'
              await supabase
                .from("instagram_messages")
                .update({
                  status: "seen",
                  seen_at: seenAtIso,
                })
                .eq("conversation_id", conversationId)
                .eq("is_mine", true)
                .lte("timestamp", seenAtIso);

              // Dispara broadcasts instantâneos via Supabase Realtime (< 20ms)
              const channel = supabase.channel("vendeo_realtime_chat");
              channel.send({
                type: "broadcast",
                event: "instagram_seen",
                payload: {
                  conversationId,
                  watermark,
                  seenAt: seenAtIso,
                },
              }).catch(() => {});

              channel.send({
                type: "broadcast",
                event: "instagram_conversation_update",
                payload: {
                  id: conversationId,
                  lastStatus: "seen",
                  seenAt: seenAtIso,
                  lastDirection: "out",
                },
              }).catch(() => {});

              continue;
            }

            if (!message) continue;

            const isEcho = Boolean(message.is_echo);
            const rawContactId = isEcho ? recipientId : senderId;
            if (!rawContactId) continue;

            // Mapeia IGSID numérico para a thread real no banco para não fragmentar conversas
            let conversationId = rawContactId;
            if (/^\d+$/.test(rawContactId)) {
              // 1. Procura na tabela instagram_conversations se já existe conversa com esse contact_id ou id
              const { data: convByContact } = await supabase
                .from("instagram_conversations")
                .select("id")
                .or(`id.eq.${rawContactId},contact_id.eq.${rawContactId}`)
                .limit(1)
                .maybeSingle();

              if (convByContact?.id) {
                conversationId = convByContact.id;
              } else {
                // 2. Procura em instagram_messages se já temos alguma mensagem desse contato vinculada a outro conversation_id
                const { data: convRow } = await supabase
                  .from("instagram_messages")
                  .select("conversation_id")
                  .or(`sender_id.eq.${rawContactId},contact_id.eq.${rawContactId}`)
                  .neq("conversation_id", rawContactId)
                  .limit(1)
                  .maybeSingle();

                if (convRow?.conversation_id) {
                  conversationId = convRow.conversation_id;
                }
              }
            }

            let text = message.text || "";
            const isAudioMsg =
              Boolean(message.is_unsupported) ||
              message.attachments?.some((a: any) => a.type === "audio" || a.mime_type?.includes("audio"));

            let audioUrl: string | undefined;
            let imageUrl: string | undefined;
            let inboundMediaType: string | undefined;

            if (isAudioMsg) {
              inboundMediaType = "audio";
              const firstAtt = message.attachments?.[0];
              const rawAudioUrl = firstAtt?.payload?.url || firstAtt?.file_url;

              if (rawAudioUrl) {
                // Se a URL do áudio for da CDN da Meta (lookaside ou cdninstagram), baixa e persiste no Supabase Storage
                if (rawAudioUrl.includes("lookaside.fbsbx.com") || rawAudioUrl.includes("cdninstagram.com")) {
                  try {
                    const audioRes = await fetch(rawAudioUrl);
                    if (audioRes.ok) {
                      const audioBytes = await audioRes.arrayBuffer();
                      const fileName = `voice_${Date.now()}_${Math.random().toString(36).slice(2, 6)}.mp4`;
                      const contentType = audioRes.headers.get("content-type") || "video/mp4";

                      const { data: upData, error: upErr } = await supabase.storage
                        .from("vendeo_vault")
                        .upload(fileName, audioBytes, {
                          contentType,
                          upsert: true,
                        });

                      if (!upErr && upData?.path) {
                        const { data: pubData } = supabase.storage.from("vendeo_vault").getPublicUrl(upData.path);
                        audioUrl = pubData?.publicUrl || rawAudioUrl;
                      } else {
                        audioUrl = rawAudioUrl;
                      }
                    } else {
                      audioUrl = rawAudioUrl;
                    }
                  } catch (err) {
                    console.error("Erro ao persistir áudio da CDN no Supabase Storage:", err);
                    audioUrl = rawAudioUrl;
                  }
                } else {
                  audioUrl = rawAudioUrl;
                }
              }

              text = audioUrl ? `[audio:${audioUrl}]` : "🎙️ Mensagem de voz";
            } else if (message.attachments && message.attachments.length > 0) {
              const att = message.attachments[0];
              inboundMediaType = att.type || att.mime_type?.split("/")[0] || "file";
              if (inboundMediaType === "image" && att.payload?.url) {
                imageUrl = att.payload.url;
                if (!text) text = `[image:${imageUrl}]`;
              } else if (inboundMediaType === "video" && att.payload?.url) {
                if (!text) text = `[video:${att.payload.url}]`;
              } else if (!text) {
                text = `[file:${att.payload?.url || "anexo recebido"}]`;
              }
            }

            const messageId = message.mid || `msg_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
            const timestamp = msgEvent.timestamp
              ? new Date(msgEvent.timestamp).toISOString()
              : new Date().toISOString();

            const previewText = isAudioMsg ? "🎙️ Mensagem de voz" : imageUrl ? "📷 Foto" : text;

            // Busca configurações ativas do Instagram para resolução de perfil
            const { data: igCfg } = await supabase
              .from("instagram_config")
              .select("access_token, username")
              .eq("id", "default")
              .maybeSingle();

            const myIgUsername = igCfg?.username || "lariresende_0611";

            // PASSO 1 CRÍTICO: Garante a conversa na tabela instagram_conversations ANTES de salvar a mensagem
            // Isso evita 100% de violação de Foreign Key Constraint (instagram_messages_conversation_id_fkey)
            const { data: existingConv } = await supabase
              .from("instagram_conversations")
              .select("id, username, full_name, avatar")
              .or(`id.eq.${conversationId},id.eq.${rawContactId}`)
              .limit(1)
              .maybeSingle();

            if (!existingConv) {
              // Conversa nova: resolve perfil completo (thread do MID + IGSID)
              let resolved = {
                username: `ig_${conversationId.slice(-6)}`,
                fullName: `ig_${conversationId.slice(-6)}`,
                avatar: "/images/default-avatar.svg",
              };

              if (igCfg?.access_token) {
                resolved = await resolveInstagramContactProfile(
                  supabase,
                  igCfg.access_token,
                  myIgUsername,
                  conversationId,
                  messageId
                );
              }

              await supabase.from("instagram_conversations").upsert({
                id: conversationId,
                username: resolved.username,
                full_name: resolved.fullName,
                avatar: resolved.avatar,
                contact_id: rawContactId,
                last_message: previewText,
                last_message_preview: previewText,
                last_message_at: timestamp,
                last_direction: isEcho ? "out" : "in",
                last_status: isEcho ? "sent" : null,
                seen_at: null,
                unread: !isEcho,
                updated_at: timestamp,
                status: "active",
              });
            } else {
              // Conversa já existente: atualiza com a última mensagem
              const updatePayload: any = {
                last_message: previewText,
                last_message_preview: previewText,
                last_message_at: timestamp,
                last_direction: isEcho ? "out" : "in",
                last_status: isEcho ? "sent" : null,
                seen_at: null,
                unread: !isEcho,
                updated_at: timestamp,
              };

              // Se a conversa existente estava com username temporário ig_ ou sem avatar, tenta enriquecer
              if (
                (existingConv.username?.startsWith("ig_") ||
                  !existingConv.avatar ||
                  existingConv.avatar === "/images/default-avatar.svg") &&
                igCfg?.access_token
              ) {
                const resolved = await resolveInstagramContactProfile(
                  supabase,
                  igCfg.access_token,
                  myIgUsername,
                  conversationId,
                  messageId
                );
                if (resolved.username && !resolved.username.startsWith("ig_")) {
                  updatePayload.username = resolved.username;
                  updatePayload.full_name = resolved.fullName;
                  if (resolved.avatar && !resolved.avatar.includes("default-avatar.svg")) {
                    updatePayload.avatar = resolved.avatar;
                  }
                }
              }

              await supabase
                .from("instagram_conversations")
                .update(updatePayload)
                .eq("id", existingConv.id);
            }

            // PASSO 2 CRÍTICO: Agora que a conversa existe com 100% de certeza, salva a mensagem no Supabase
            const replyToMid =
              message.reply_to?.mid ||
              message.reply_to?.id ||
              (typeof message.reply_to === "string" ? message.reply_to : null) ||
              null;

            let audioTranscript: string | null = null;
            let audioTranscriptionError: string | null = null;
            if (isAudioMsg && !isEcho && audioUrl) {
              try {
                const resolved = await resolveInboundAudioMessage(supabase, {
                  id: messageId,
                  text: text,
                  media_type: "audio",
                  media_url: audioUrl,
                });
                if (resolved.hasValidTranscript && resolved.transcript) {
                  audioTranscript = resolved.transcript;
                }
                // Captura erro de transcrição para persistir no upsert abaixo
                audioTranscriptionError = resolved.transcriptionError ?? null;
              } catch (aErr) {
                console.warn("[Webhook] Erro na transcrição imediata do áudio:", aErr);
                audioTranscriptionError = String((aErr as any)?.message || aErr || "Erro inesperado");
              }
            }

            let inboundRpcData: any = null;
            if (!isEcho) {
              try {
                const { data, error: inboundRpcErr } = await supabase.rpc(
                  "record_inbound_message_atomic",
                  {
                    p_conversation_id: conversationId,
                    p_message_id: messageId,
                    p_contact_id: rawContactId,
                    p_sender_id: senderId,
                    p_text: text,
                    p_timestamp: timestamp,
                    p_media_url: audioUrl || imageUrl || null,
                    p_media_type: inboundMediaType || (imageUrl ? "image" : null),
                    p_reply_to_message_id: replyToMid,
                    p_audio_transcript: audioTranscript,
                    p_audio_transcription_error: audioTranscriptionError,
                  }
                );
                if (inboundRpcErr || !data?.success) {
                  console.error(
                    `[Webhook] record_inbound_message_atomic falhou (fail-closed): conv=${conversationId} msg=${messageId}`,
                    inboundRpcErr || data
                  );
                  continue; // FAIL-CLOSED ESTRITO: NUNCA cai para gravação não-serializada
                }
                inboundRpcData = data;
              } catch (rErr) {
                console.error(
                  `[Webhook] record_inbound_message_atomic exception (fail-closed): conv=${conversationId} msg=${messageId}`,
                  rErr
                );
                continue; // FAIL-CLOSED ESTRITO: NUNCA cai para gravação não-serializada
              }
            } else {
              // Echos de mensagens enviadas por nós no app oficial (outbound)
              const { error: echoSaveErr } = await supabase.from("instagram_messages").upsert({
                id: messageId,
                conversation_id: conversationId,
                contact_id: rawContactId,
                sender_id: "me",
                text: text,
                timestamp: timestamp,
                is_mine: true,
                status: "delivered",
                media_url: audioUrl || imageUrl || null,
                media_type: inboundMediaType || (imageUrl ? "image" : null),
                reply_to_message_id: replyToMid,
                direction: "outbound",
                audio_transcript: audioTranscript,
                audio_transcribed_at: audioTranscript ? new Date().toISOString() : null,
                audio_transcription_error: audioTranscriptionError,
              });
              if (echoSaveErr) {
                console.error("[Webhook] Erro ao persistir echo no Supabase:", echoSaveErr);
              }
            }

            // Dispara Broadcast Realtime imediato (< 20ms) para todas as telas conectadas
            try {
              const realtimeChannel = supabase.channel("vendeo_realtime_chat");
              await realtimeChannel.send({
                type: "broadcast",
                event: "instagram_message",
                payload: {
                  id: messageId,
                  conversationId: conversationId,
                  senderId: isEcho ? "me" : senderId,
                  text: text,
                  timestamp: timestamp,
                  isMine: isEcho,
                  status: "sent",
                  mediaUrl: audioUrl || imageUrl,
                  mediaType: inboundMediaType || (imageUrl ? "image" : undefined),
                  replyToMessageId: replyToMid,
                },
              });
              await realtimeChannel.send({
                type: "broadcast",
                event: "instagram_conversation_update",
                payload: {
                  id: conversationId,
                  lastMessage: previewText,
                  lastMessageAt: timestamp,
                  lastDirection: isEcho ? "out" : "in",
                  lastStatus: isEcho ? "sent" : undefined,
                  seenAt: null,
                  unread: !isEcho,
                },
              });
              if (rawContactId && rawContactId !== conversationId) {
                await realtimeChannel.send({
                  type: "broadcast",
                  event: "instagram_conversation_update",
                  payload: {
                    id: rawContactId,
                    lastMessage: previewText,
                    lastMessageAt: timestamp,
                    lastDirection: isEcho ? "out" : "in",
                    lastStatus: isEcho ? "sent" : undefined,
                    seenAt: null,
                    unread: !isEcho,
                  },
                });
              }
            } catch (bErr) {
              console.error("Aviso broadcast:", bErr);
            }

            // AutoPilot Inteligente: Agendamento assíncrono de Debounce (Sem timeout na nuvem)
            if (!isEcho) {
              try {
                // 1. Busca configuração global do piloto automático
                const { data: configRow } = await supabase
                  .from("instagram_conversations")
                  .select("stage_completed_rules")
                  .eq("id", "__autopilot_config__")
                  .maybeSingle();
                const apConfig = configRow?.stage_completed_rules?.config;
                const isEnabledGlobally = apConfig?.isEnabledGlobally !== false;
                const isManual = apConfig?.mode === "manual";

                // 2. Busca estado da conversa para checar pausas e restrições
                const { data: convRow } = await supabase
                  .from("instagram_conversations")
                  .select("status, is_restricted, stage_completed_rules, ai_debounce_until, ai_auto_respond")
                  .eq("id", conversationId)
                  .maybeSingle();

                // 2.1 Também checa no __autopilot_states__ para garantir que desativações no chat sejam honradas
                const { data: statesRow } = await supabase
                  .from("instagram_conversations")
                  .select("stage_completed_rules")
                  .eq("id", "__autopilot_states__")
                  .maybeSingle();
                const chatStateInCloud = statesRow?.stage_completed_rules?.states?.[conversationId];
                const isExplicitlyDisabled =
                  chatStateInCloud?.isEnabled === false ||
                  chatStateInCloud?.status === "disabled" ||
                  chatStateInCloud?.status === "paused_manual" ||
                  Boolean(chatStateInCloud?.pendingManualResponse);

                const convRules = convRow?.stage_completed_rules || {};
                const isPaused =
                  convRow?.ai_auto_respond === false ||
                  convRow?.is_restricted === true ||
                  convRules.status === "paused_handoff" ||
                  convRules.status === "paused_guardrail" ||
                  Boolean(chatStateInCloud?.pendingManualResponse) ||
                  (convRow?.ai_auto_respond !== true && (
                    convRules.status === "paused_manual" ||
                    convRules.status === "disabled" ||
                    isExplicitlyDisabled
                  ));

                const isEligibleByWatermark = inboundRpcData?.eligible_after_activation === true;
                const protectedIntent = detectProtectedInboundIntent({
                  text: audioTranscript || text,
                  mediaType: inboundMediaType || (imageUrl ? "image" : undefined),
                });
                const isActionable = isActionableInboundMessage({
                  text,
                  mediaType: inboundMediaType || (imageUrl ? "image" : undefined),
                  audioTranscript,
                });

                if (isPaused) {
                  console.log(
                    `[AutoPilot] Conversa ${conversationId} está desativada/pausada manualmente (ai_auto_respond=${convRow?.ai_auto_respond}, status=${convRules.status}, isExplicitlyDisabled=${isExplicitlyDisabled}). Não respondendo.`
                  );
                  if (convRow?.ai_debounce_until) {
                    await supabase
                      .from("instagram_conversations")
                      .update({ ai_debounce_until: null })
                      .eq("id", conversationId);
                  }
                } else if (!isEligibleByWatermark) {
                  console.log(
                    `[AutoPilot] Inbound ${messageId} para conv ${conversationId} pertence ao baseline do watermark (rev=${inboundRpcData?.inbound_revision} <= watermark=${inboundRpcData?.watermark_revision}). Zero Brain.`
                  );
                } else if (protectedIntent && isEnabledGlobally && !isManual) {
                  const pendingManualResponse = createPendingManualResponse({
                    inboundMessages: [audioTranscript || text || previewText],
                    inboundMessageIds: [messageId],
                    reason: protectedIntent.reason,
                    source: "protected_inbound",
                  });
                  const { data: reviewedResult, error: reviewedError } = await supabase.rpc(
                    "mark_manual_review_inbounds_processed_atomic",
                    { p_conversation_id: conversationId, p_message_ids: [messageId] },
                  );
                  if (reviewedError || reviewedResult?.success !== true) {
                    console.error(
                      `[AutoPilot] Não foi possível finalizar inbound retida no ledger: conv=${conversationId} msg=${messageId}`,
                      reviewedError || reviewedResult,
                    );
                  }
                  if (convRow?.ai_debounce_until) {
                    await supabase
                      .from("instagram_conversations")
                      .update({ ai_debounce_until: null })
                      .eq("id", conversationId);
                  }
                  await publishAutoPilotState(supabase, conversationId, {
                    status: "needs_manual_response",
                    pendingManualResponse,
                    scheduledResponseAt: null,
                    activity: activity(
                      "needs_manual_response",
                      "A IA precisa de você",
                      protectedIntent.reason,
                      { messageId, reason: protectedIntent.intent }
                    ),
                  });
                  console.log(`[AutoPilot] Inbound ${messageId} requer revisão humana (${protectedIntent.intent}); nenhuma resposta automática será enviada.`);
                } else if (!isActionable) {
                  console.log(
                    `[AutoPilot] Inbound ${messageId} para conv ${conversationId} ignorado para resposta da IA (apenas emoji isolado, foto ou mídia sem texto/áudio). Zero Brain.`
                  );
                }

                // BRAIN: Único orquestrador oficial de produção (fail-closed)
                if (!isPaused && isEnabledGlobally && !isManual && isEligibleByWatermark && isActionable && !protectedIntent) {
                  const delayMinutes =
                    typeof apConfig?.responseDelayMinutes === "number"
                      ? apConfig.responseDelayMinutes
                      : typeof convRules?.orchestration?.responseDelayMinutes === "number"
                      ? convRules.orchestration.responseDelayMinutes
                      : 0;

                  const hasActiveCycle = Boolean(
                    convRules?.orchestration?.activeCycle?.cycleToken &&
                    convRules?.orchestration?.activeCycle?.expiresAt &&
                    new Date(convRules.orchestration.activeCycle.expiresAt).getTime() > Date.now()
                  );

                  const quietPeriodMs = Math.round(delayMinutes * 60 * 1000);

                  if (hasActiveCycle) {
                    const newDebounceUntil = new Date(Date.now() + (quietPeriodMs || 2500)).toISOString();
                    console.log(
                      `[Brain] Concorrência/Ciclo ativo detectado em ${conversationId}. Sinalizando preempção atômica e novo debounce de ${delayMinutes}m (${newDebounceUntil}).`
                    );
                    await requestBrainCyclePreemptionAtomic({
                      supabase,
                      conversationId,
                      messageId: messageId || null,
                      debounceUntil: newDebounceUntil,
                    });
                    await publishAutoPilotState(supabase, conversationId, {
                      status: "scheduled",
                      activity: activity(
                        "scheduled",
                        `Ciclo preemptado por nova mensagem. Novo quiet period (${delayMinutes}m)...`,
                        "Aguardando período de silêncio para responder com o contexto atualizado.",
                        {
                          scheduledAt: newDebounceUntil,
                          quietPeriodMinutes: delayMinutes,
                        }
                      ),
                      scheduledResponseAt: newDebounceUntil,
                    });
                  } else if (delayMinutes > 0) {
                    const scheduledUntil = new Date(Date.now() + quietPeriodMs).toISOString();
                    console.log(
                      `[Brain] Inbound recebida em ${conversationId}. Agendando quiet period de ${delayMinutes}m (ai_debounce_until = ${scheduledUntil}).`
                    );
                    await supabase
                      .from("instagram_conversations")
                      .update({
                        ai_auto_respond: true,
                        ai_debounce_until: scheduledUntil,
                      })
                      .eq("id", conversationId);

                    await publishAutoPilotState(supabase, conversationId, {
                      status: "scheduled",
                      activity: activity(
                        "scheduled",
                        `Aguardando quiet period (${delayMinutes}m)...`,
                        "Respeitando o tempo de silêncio configurado após a mensagem inbound.",
                        {
                          scheduledAt: scheduledUntil,
                          quietPeriodMinutes: delayMinutes,
                        }
                      ),
                      scheduledResponseAt: scheduledUntil,
                    });
                  } else {
                    // responseDelayMinutes = 0: inicia imediatamente
                    console.log(`[Brain] responseDelayMinutes=0. Executando Brain imediatamente para conversa ${conversationId}`);
                    let brainInputText = text || "";
                    if (isAudioMsg) {
                      if (!audioTranscript) {
                        try {
                          const resolvedNow = await resolveInboundAudioMessage(supabase, {
                            id: messageId,
                            text: text,
                            media_type: "audio",
                            media_url: audioUrl,
                          });
                          if (resolvedNow.hasValidTranscript && resolvedNow.transcript) {
                            audioTranscript = resolvedNow.transcript;
                            brainInputText = resolvedNow.transcript;
                          } else {
                            brainInputText = "[áudio recebido — transcrição indisponível]";
                          }
                        } catch {
                          brainInputText = "[áudio recebido — transcrição indisponível]";
                        }
                      } else {
                        brainInputText = audioTranscript;
                      }
                    }

                    const brainPromise = (async () => {
                      const res = await runBrainOrchestration({
                        supabase,
                        conversationId,
                        newMessage: {
                          id: messageId,
                          text: brainInputText,
                          timestamp: timestamp || new Date().toISOString(),
                          sender: senderId || "them",
                          mediaType: isAudioMsg ? "audio" : undefined,
                          audioTranscript: audioTranscript || undefined,
                        },
                      });

                      // Em caso de concorrência com ciclo ativo, sinaliza preempção atômica no PostgreSQL
                      if (!res.handled && res.error === "Lock ativo concorrente") {
                        const newDebounceUntil = new Date(Date.now() + 2500).toISOString();
                        console.log(`[Brain] Concorrência detectada em ${conversationId}. Sinalizando preempção atômica.`);
                        await requestBrainCyclePreemptionAtomic({
                          supabase,
                          conversationId,
                          messageId: messageId || null,
                          debounceUntil: newDebounceUntil,
                        });
                      }

                      // FAIL-CLOSED: Nenhum fallback para legado
                      if (!res.handled && res.error) {
                        console.error(`[Brain] FAIL CLOSED: Erro no Brain para ${conversationId} (${res.error}). Nenhum fallback acionado.`);
                      }
                    })();

                    if (typeof (globalThis as any).EdgeRuntime?.waitUntil === "function") {
                      (globalThis as any).EdgeRuntime.waitUntil(brainPromise);
                    } else {
                      void brainPromise;
                    }
                  }
                }
              } catch (apErr) {
                console.error("[Cloud AutoPilot] Erro ao agendar resposta no webhook:", apErr);
              }
            }
          }
        }

        return new Response(JSON.stringify({ success: true }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    // ==========================================
    // INSTAGRAM: UPLOAD DE MÍDIA / ÁUDIO PARA O COFRE OU DIRECT
    // ==========================================
    if ((path === "/instagram/upload" || path === "/upload") && req.method === "POST") {
      try {
        const formData = await req.formData();
        const file = formData.get("file") as File | null;
        const mediaType = (formData.get("type") as string) || "audio";

        if (!file) {
          return new Response(JSON.stringify({ error: "Nenhum arquivo enviado" }), {
            status: 400,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }

        const arrayBuffer = await file.arrayBuffer();
        let ext = "wav";
        let contentType = file.type || "audio/wav";

        if (mediaType === "audio") {
          if (file.type?.includes("m4a") || file.name?.endsWith(".m4a")) {
            ext = "m4a";
            contentType = "audio/m4a";
          } else if (file.type?.includes("mp3") || file.name?.endsWith(".mp3")) {
            ext = "mp3";
            contentType = "audio/mpeg";
          } else {
            ext = "wav";
            contentType = "audio/wav";
          }
        } else if (mediaType === "image") {
          if (file.type?.includes("png") || file.name?.endsWith(".png")) {
            ext = "png";
            contentType = "image/png";
          } else if (file.type?.includes("webp") || file.name?.endsWith(".webp")) {
            ext = "webp";
            contentType = "image/webp";
          } else {
            ext = "jpg";
            contentType = "image/jpeg";
          }
        }

        const safeBase = file.name
          ? file.name.replace(/\.[^.]+$/, "").replace(/[^a-zA-Z0-9_-]/g, "_")
          : `${mediaType}_${Date.now()}`;
        const fileName = `${mediaType}_${Date.now()}_${safeBase}.${ext}`;
        const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";

        // 1. Tenta upload prioritário no bucket vendeo_vault (50MB, sem restrição de MIME)
        let publicUrl = "";
        const { data: uploadData, error: uploadErr } = await supabase.storage
          .from("vendeo_vault")
          .upload(fileName, arrayBuffer, {
            contentType,
            upsert: true,
          });

        if (!uploadErr && uploadData?.path) {
          const { data: publicData } = supabase.storage.from("vendeo_vault").getPublicUrl(uploadData.path);
          publicUrl = publicData?.publicUrl || `${supabaseUrl}/storage/v1/object/public/vendeo_vault/${fileName}`;
        } else {
          console.warn("Aviso no upload para vendeo_vault, tentando instagram_media:", uploadErr);
          const { data: fbData, error: fbErr } = await supabase.storage
            .from("instagram_media")
            .upload(fileName, arrayBuffer, {
              contentType,
              upsert: true,
            });

          if (fbErr) {
            console.error("Erro no upload do Supabase Storage:", fbErr);
            return new Response(JSON.stringify({
              error: "Falha ao gravar arquivo no Supabase Storage",
              details: fbErr.message,
            }), {
              status: 500,
              headers: { ...corsHeaders, "Content-Type": "application/json" },
            });
          }

          const { data: fbPublic } = supabase.storage.from("instagram_media").getPublicUrl(fbData.path);
          publicUrl = fbPublic?.publicUrl || `${supabaseUrl}/storage/v1/object/public/instagram_media/${fileName}`;
        }

        return new Response(JSON.stringify({
          success: true,
          url: publicUrl,
          fileName,
          contentType,
          fileSize: file.size,
        }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      } catch (uploadErr: any) {
        console.error("Erro no processamento de upload:", uploadErr);
        return new Response(JSON.stringify({ error: uploadErr?.message || "Erro no upload" }), {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    // ==========================================
    // 1.5 INTERNAL: MEMORY & CONVERSATION EXPORT (OBSIDIAN SYNC)
    // ==========================================
    const checkObsidianSyncAuth = (req: Request): Response | null => {
      const expectedToken = (Deno.env.get("OBSIDIAN_SYNC_TOKEN") || "").trim();
      if (!expectedToken) {
        return new Response(
          JSON.stringify({ error: "Configuração indisponível: OBSIDIAN_SYNC_TOKEN não configurado no servidor." }),
          { status: 503, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const authHeader = req.headers.get("authorization") || req.headers.get("Authorization") || "";
      const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";

      if (!token) {
        return new Response(
          JSON.stringify({ error: "Unauthorized: Token de sincronização ausente." }),
          { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const encoder = new TextEncoder();
      const aBuf = encoder.encode(token);
      const bBuf = encoder.encode(expectedToken);
      let isTokenMatch = aBuf.byteLength === bBuf.byteLength;
      if (isTokenMatch) {
        let diff = 0;
        for (let i = 0; i < aBuf.byteLength; i++) {
          diff |= aBuf[i] ^ bBuf[i];
        }
        isTokenMatch = diff === 0;
      }

      if (!isTokenMatch) {
        return new Response(
          JSON.stringify({ error: "Unauthorized: Token de sincronização inválido." }),
          { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      return null;
    };

    if (path === "/internal/memory-export" && req.method === "GET") {
      const authErr = checkObsidianSyncAuth(req);
      if (authErr) return authErr;

      // Validação estrita de contact_id / conversation_id
      const targetContactId = url.searchParams.get("contact_id") || url.searchParams.get("conversation_id");
      if (targetContactId) {
        const isValidId = /^[a-zA-Z0-9_-]{1,64}$/.test(targetContactId);
        if (!isValidId) {
          return new Response(
            JSON.stringify({ error: "Bad Request: Identificador de contato inválido." }),
            { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }
      }

      const limitParam = parseInt(url.searchParams.get("limit") || "100", 10);
      const offsetParam = parseInt(url.searchParams.get("offset") || "0", 10);
      const limit = Math.min(Math.max(isNaN(limitParam) ? 100 : limitParam, 1), 200);
      const offset = Math.max(isNaN(offsetParam) ? 0 : offsetParam, 0);

      let query = supabase
        .from("instagram_conversations")
        .select("id, contact_id, full_name, username, updated_at, stage_completed_rules");

      if (targetContactId) {
        query = query.or(`id.eq.${targetContactId},contact_id.eq.${targetContactId}`);
      } else {
        query = query.order("id", { ascending: true }).range(offset, offset + limit - 1);
      }

      const { data: convs, error: queryErr } = await query;
      if (queryErr) {
        return new Response(
          JSON.stringify({ error: queryErr.message || "Erro ao consultar memórias." }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      // Enriquecimento opcional com Contact Memory oficial (00-05)
      const allFactsByConv: Record<string, any[]> = {};
      const allQuotesByConv: Record<string, any[]> = {};
      if (Array.isArray(convs) && convs.length > 0) {
        const convIds = convs.map((c: any) => String(c.id)).filter(Boolean);
        try {
          const { data: dbFacts } = await supabase
            .from("contact_memory_facts")
            .select("conversation_id, entity, field, value, temporal_status, source_message_ids, confidence, importance, created_at")
            .in("conversation_id", convIds)
            .neq("temporal_status", "superseded")
            .order("importance", { ascending: false });

          if (Array.isArray(dbFacts)) {
            for (const f of dbFacts) {
              const cId = f.conversation_id;
              if (!allFactsByConv[cId]) allFactsByConv[cId] = [];
              allFactsByConv[cId].push(f);
            }
          }

          const { data: dbQuotes } = await supabase
            .from("contact_memory_quotes")
            .select("conversation_id, speaker, quote_text, context_or_reason, source_message_id, importance, created_at")
            .in("conversation_id", convIds)
            .order("importance", { ascending: false });

          if (Array.isArray(dbQuotes)) {
            for (const q of dbQuotes) {
              const cId = q.conversation_id;
              if (!allQuotesByConv[cId]) allQuotesByConv[cId] = [];
              allQuotesByConv[cId].push(q);
            }
          }
        } catch (_err) {}
      }

      const STAGE_DEFAULT_OBJECTIVES: Record<string, Array<{ id: string; label: string; memoryEntity?: string; memoryField?: string }>> = {
        conexao_inicial: [
          { id: "obj_conexao_acolhimento", label: "Acolher o pretendente e responder saudações" },
          { id: "obj_conexao_abertura", label: "Identificar disposição e clima da conversa" },
        ],
        descoberta: [
          { id: "goal_age", label: "Idade", memoryEntity: "self", memoryField: "age" },
          { id: "goal_city", label: "Cidade", memoryEntity: "self", memoryField: "city" },
          { id: "goal_job", label: "Profissão", memoryEntity: "self", memoryField: "job" },
          { id: "goal_relationship", label: "Relacionamento / Filhos", memoryEntity: "self", memoryField: "relationship_status" },
        ],
        compatibilidade: [
          { id: "obj_afinidades", label: "Afinidades e gostos pessoais", memoryEntity: "self", memoryField: "interests" },
          { id: "obj_rotina", label: "Rotina e estilo de vida", memoryEntity: "self", memoryField: "routine" },
          { id: "obj_planos", label: "Planos e expectativas futuras", memoryEntity: "self", memoryField: "future_plans" },
        ],
      };

      const contacts = (convs || []).map((conv: any) => {
        const stageRules = conv.stage_completed_rules || {};
        const orch = stageRules.orchestration || {};
        const mem = orch.memory || {};
        const entities = mem.entities || {};
        const currentStageId = String(orch.currentStageId || orch.currentPhase || "conexao_inicial").trim();
        const currentObjective = orch.currentObjective || null;
        const objectiveProgress = orch.objectiveProgress || {};
        const liveState = orch.liveState || null;
        const completedGoalIds = Array.isArray(orch.completedGoalIds)
          ? orch.completedGoalIds
          : Array.isArray(stageRules.completed_goals)
          ? stageRules.completed_goals
          : [];

        // Recupera os objetivos da etapa ativa (customizados da conversa ou defaults canônicos)
        const customStageObjectives = Array.isArray(orch.stageObjectives) && orch.stageObjectives.length > 0
          ? orch.stageObjectives
          : Array.isArray(stageRules.stage_objectives) && stageRules.stage_objectives.length > 0
          ? stageRules.stage_objectives
          : (STAGE_DEFAULT_OBJECTIVES[currentStageId] || STAGE_DEFAULT_OBJECTIVES.descoberta);

        const dbFacts = allFactsByConv[String(conv.id)] || [];
        const dbQuotes = allQuotesByConv[String(conv.id)] || [];

        const resolvedGoals = customStageObjectives.map((g: any) => {
          const entityKey = g.memoryEntity || "self";
          const entity = entities[entityKey] || {};
          let fact = g.memoryField ? entity[g.memoryField] : undefined;
          if (!fact && g.memoryField === "job") fact = entity.profession || entity.profissao;
          if (!fact && (g.memoryField === "city" || g.memoryField === "cidade")) fact = entity.city || entity.cidade;

          // Reconciliação direta com contact_memory_facts
          let dbFactMatch = null;
          if (g.memoryField) {
            const normFld = g.memoryField.toLowerCase();
            dbFactMatch = dbFacts.find((df: any) => {
              const dfFld = (df.field || "").toLowerCase();
              if (df.entity && df.entity.toLowerCase() !== entityKey.toLowerCase()) return false;
              if (dfFld === normFld) return true;
              if ((normFld === "city" || normFld === "cidade") && (dfFld === "city" || dfFld === "cidade")) return true;
              if ((normFld === "job" || normFld === "occupation" || normFld === "profissao" || normFld === "profession") &&
                  (dfFld === "job" || dfFld === "occupation" || dfFld === "profissao" || dfFld === "profession")) return true;
              if ((normFld === "age" || normFld === "idade") && (dfFld === "age" || dfFld === "idade")) return true;
              return false;
            });
          }

          const hasFact = (fact !== undefined && fact !== null && (fact.value !== undefined ? fact.value !== null : true)) ||
                          Boolean(dbFactMatch && dbFactMatch.value !== undefined && dbFactMatch.value !== null && dbFactMatch.value !== "");
          const isExplicit = completedGoalIds.includes(g.id);
          const isDone = hasFact || isExplicit;
          const isCurrent = currentObjective ? (currentObjective.id === g.id) : false;
          const val = hasFact ? (dbFactMatch?.value ?? (fact?.value !== undefined ? fact.value : fact)) : null;
          return {
            id: g.id,
            label: g.label || g.title || g.id,
            status: isDone ? "completed" : isCurrent ? "in_progress" : "pending",
            isCurrent,
            value: isDone ? val : null,
          };
        });

        return {
          id: String(conv.id || ""),
          contactId: String(conv.contact_id || conv.id || ""),
          fullName: String(conv.full_name || conv.username || conv.id || ""),
          username: String(conv.username || ""),
          updatedAt: conv.updated_at || new Date(0).toISOString(),
          currentPhase: orch.currentPhase || "conexao_inicial",
          currentStageId,
          currentObjective,
          objectiveProgress,
          liveState,
          checkpoint: orch.checkpoint || "",
          memory: {
            entities: mem.entities || {},
            snippets: Array.isArray(mem.snippets) ? mem.snippets : [],
            lastUpdated: mem.lastUpdated || "",
          },
          contactMemoryFacts: dbFacts,
          contactMemoryQuotes: dbQuotes,
          objectives: resolvedGoals,
          checklist: {
            stage: currentStageId === "conexao_inicial" ? "Conexão Inicial" : currentStageId === "descoberta" ? "Descoberta" : currentStageId,
            goals: resolvedGoals,
          },
        };
      });

      let personaData: any = null;
      try {
        const { data: pFacts } = await supabase
          .from("persona_memory")
          .select("id, persona_id, category, key, value, source_type, confidence, aliases, valid_from, valid_until, updated_at")
          .eq("persona_id", "larissa")
          .order("category", { ascending: true })
          .order("key", { ascending: true });

        if (Array.isArray(pFacts) && pFacts.length > 0) {
          personaData = {
            personaId: "larissa",
            totalFacts: pFacts.length,
            facts: pFacts,
          };
        }
      } catch (pErr) {
        console.warn("[MemoryExport] Falha ao consultar persona_memory:", pErr);
      }

      return new Response(
        JSON.stringify({
          success: true,
          timestamp: new Date().toISOString(),
          total: contacts.length,
          limit: targetContactId ? contacts.length : limit,
          offset: targetContactId ? 0 : offset,
          hasMore: targetContactId ? false : contacts.length === limit,
          contacts,
          persona: personaData,
        }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // ==========================================
    // 1.6 INTERNAL: CONVERSATION HISTORY EXPORT (SCOPED & PAGINATED)
    // ==========================================
    if (path === "/internal/conversation-history-export" && req.method === "GET") {
      const authErr = checkObsidianSyncAuth(req);
      if (authErr) return authErr;

      const conversationId = (url.searchParams.get("conversation_id") || url.searchParams.get("contact_id") || "").trim();
      if (!conversationId || !/^[a-zA-Z0-9_-]{1,64}$/.test(conversationId)) {
        return new Response(
          JSON.stringify({ error: "Bad Request: conversation_id obrigatório e válido." }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const limitParam = parseInt(url.searchParams.get("limit") || "50", 10);
      const limit = Math.min(Math.max(isNaN(limitParam) ? 50 : limitParam, 1), 100);
      const before = (url.searchParams.get("before") || "").trim();

      let query = supabase
        .from("instagram_messages")
        .select("id, conversation_id, sender_id, is_mine, text, media_type, media_url, audio_transcript, created_at")
        .eq("conversation_id", conversationId);

      if (before) {
        query = query.lt("created_at", before);
      }

      query = query.order("created_at", { ascending: false }).limit(limit + 1);

      const { data: msgs, error: msgErr } = await query;
      if (msgErr) {
        return new Response(
          JSON.stringify({ error: msgErr.message || "Erro ao consultar histórico." }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const list = msgs || [];
      const hasMore = list.length > limit;
      const sliced = hasMore ? list.slice(0, limit) : list;
      const nextBefore = sliced.length > 0 ? sliced[sliced.length - 1].created_at : null;

      const formatted = sliced.map((m: any) => {
        const isFromMe = Boolean(m.is_mine || m.sender_id === "me" || m.sender_id === "larissa");
        return {
          id: String(m.id || ""),
          conversationId: String(m.conversation_id || conversationId),
          sender: isFromMe ? "larissa" : "pretendente",
          isFromMe,
          text: String(m.text || "").trim(),
          audioUrl: (m.media_type === "audio" ? m.media_url : null) || null,
          audioTranscript: m.audio_transcript || null,
          createdAt: m.created_at || new Date().toISOString(),
        };
      });

      return new Response(
        JSON.stringify({
          success: true,
          conversationId,
          total: formatted.length,
          limit,
          hasMore,
          nextBefore,
          messages: formatted,
        }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // ==========================================
    // 1.7 INTERNAL: CONVERSATION EPISODES EXPORT (SCOPED & CLASSIFIED)
    // ==========================================
    if (path === "/internal/conversation-episodes-export" && req.method === "GET") {
      const authErr = checkObsidianSyncAuth(req);
      if (authErr) return authErr;

      const conversationId = (url.searchParams.get("conversation_id") || url.searchParams.get("contact_id") || "").trim();
      if (!conversationId || !/^[a-zA-Z0-9_-]{1,64}$/.test(conversationId)) {
        return new Response(
          JSON.stringify({ error: "Bad Request: conversation_id obrigatório e válido." }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const limitParam = parseInt(url.searchParams.get("limit") || "100", 10);
      const limit = Math.min(Math.max(isNaN(limitParam) ? 100 : limitParam, 1), 200);
      const before = (url.searchParams.get("before") || "").trim();

      let query = supabase
        .from("conversation_episodic_memory")
        .select("id, conversation_id, actor, event_type, topic, summary, source_message_id, metadata, loop_status, resolved_at, resolution_message_id, importance, created_at")
        .eq("conversation_id", conversationId);

      if (before) {
        query = query.lt("created_at", before);
      }

      query = query.order("created_at", { ascending: false }).limit(limit);

      const { data: eps, error: epErr } = await query;
      if (epErr) {
        return new Response(
          JSON.stringify({ error: epErr.message || "Erro ao consultar episódios." }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const list = eps || [];
      const landmarks: any[] = [];
      const speechActs: any[] = [];
      const openLoops: any[] = [];

      for (const e of list) {
        const meta = (typeof e.metadata === "object" && e.metadata !== null) ? e.metadata : {};
        const item = {
          id: String(e.id || ""),
          conversationId: String(e.conversation_id || conversationId),
          actor: e.actor || "desconhecido",
          eventType: e.event_type || "message",
          topic: e.topic || meta.topic || null,
          memoryClass: meta.memory_class || (["life_event", "preference", "boundary", "landmark"].includes(e.event_type) ? "landmark" : "speech_act"),
          summary: e.summary || "",
          details: meta.details || e.summary || null,
          emotionalTone: meta.emotional_tone || "neutro",
          relevanceScore: typeof meta.relevance_score === "number" ? meta.relevance_score : 1.0,
          importance: typeof e.importance === "number" ? e.importance : (typeof meta.importance === "number" ? meta.importance : 0.7),
          loopStatus: e.loop_status || null,
          resolvedAt: e.resolved_at || null,
          resolutionMessageId: e.resolution_message_id || null,
          messageId: e.source_message_id || null,
          createdAt: e.created_at || new Date().toISOString(),
        };

        if (item.loopStatus === "open" || item.eventType === "plan") {
          openLoops.push(item);
        }

        if (item.memoryClass === "landmark") {
          landmarks.push(item);
        } else {
          speechActs.push(item);
        }
      }

      return new Response(
        JSON.stringify({
          success: true,
          conversationId,
          total: list.length,
          totalLandmarks: landmarks.length,
          totalSpeechActs: speechActs.length,
          totalOpenLoops: openLoops.length,
          openLoops,
          landmarks,
          speechActs,
          episodes: list,
        }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // ==========================================
    // 2. INSTAGRAM: CONFIG & STATUS
    // ==========================================
    if (path === "/instagram/config") {
      const { data, error } = await supabase
        .from("instagram_config")
        .select("id, instagram_account_id, username, name, profile_picture_url, is_connected, updated_at")
        .eq("id", "default")
        .maybeSingle();

      return new Response(JSON.stringify({ config: data || null, error: error?.message }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ==========================================
    // 3. INSTAGRAM: CONVERSAS (GET)
    // ==========================================
    if (path === "/instagram/conversations" && req.method === "GET") {
      const { data, error } = await supabase
        .from("instagram_conversations")
        .select("*")
        .order("last_message_at", { ascending: false, nullsFirst: false })
        .limit(300);

      // Auto-cura instantânea: se houver conversas salvas com username 'ig_', resolve na hora
      const pendingConvs = (data || []).filter((c: any) => c.username?.startsWith("ig_"));
      if (pendingConvs.length > 0) {
        try {
          const { data: config } = await supabase
            .from("instagram_config")
            .select("access_token, username")
            .eq("id", "default")
            .maybeSingle();

          if (config?.access_token) {
            await Promise.all(
              pendingConvs.map(async (pConv: any) => {
                const { data: lastMsg } = await supabase
                  .from("instagram_messages")
                  .select("id")
                  .eq("conversation_id", pConv.id)
                  .order("timestamp", { ascending: false })
                  .limit(1)
                  .maybeSingle();

                const resolved = await resolveInstagramContactProfile(
                  supabase,
                  config.access_token,
                  config.username || "lariresende_0611",
                  pConv.id,
                  lastMsg?.id
                );

                if (resolved.username && !resolved.username.startsWith("ig_")) {
                  pConv.username = resolved.username;
                  pConv.full_name = resolved.fullName;
                  if (resolved.avatar && !resolved.avatar.includes("default-avatar.svg")) {
                    pConv.avatar = resolved.avatar;
                  }

                  await supabase
                    .from("instagram_conversations")
                    .update({
                      username: pConv.username,
                      full_name: pConv.full_name,
                      avatar: pConv.avatar,
                      updated_at: new Date().toISOString(),
                    })
                    .eq("id", pConv.id);
                }
              })
            );
          }
        } catch (healErr) {
          console.warn("Aviso na auto-cura de conversas:", healErr);
        }
      }

      const validConvs = (data || []).filter(
        (c: any) => !c.id?.startsWith("__") && c.status !== "system" && c.status !== "vault"
      );

      const uniqueMap = new Map<string, any>();
      for (const c of validConvs) {
        let avatar = c.avatar || "/images/default-avatar.svg";
        if (avatar.includes("images.unsplash.com")) {
          avatar = "/images/default-avatar.svg";
        }

        const isTemp = c.username?.startsWith("ig_");
        const cleanUsername = isTemp ? "instagram_user" : (c.username || "instagram_user");
        const cleanFullName = isTemp ? "Novo Contato" : (c.full_name || cleanUsername);

        const convObj = {
          id: c.id,
          username: cleanUsername,
          fullName: cleanFullName,
          avatar,
          isOnline: false,
          lastActive: c.last_message_at
            ? formatToBrasiliaTime(c.last_message_at)
            : "Recente",
          lastMessage: c.last_direction === "out" ? `Você: ${c.last_message || ""}` : (c.last_message || ""),
          lastSender: c.last_direction === "out" ? "me" : "them",
          lastStatus: c.last_status || undefined,
          seenAt: c.seen_at || undefined,
          unread: Boolean(c.unread),
          type: "instagram",
          lastMessageAt: c.last_message_at,
          isRestricted: Boolean(c.is_restricted),
          status: c.status || (c.is_restricted ? "restricted" : "active"),
        };

        const key = cleanUsername && cleanUsername !== "instagram_user"
          ? cleanUsername.toLowerCase()
          : c.id;

        if (!uniqueMap.has(key)) {
          uniqueMap.set(key, convObj);
        } else {
          const existing = uniqueMap.get(key);
          const existingTime = new Date(existing.lastMessageAt || 0).getTime();
          const currentTime = new Date(c.last_message_at || 0).getTime();
          if (currentTime > existingTime) {
            uniqueMap.set(key, convObj);
          }
        }
      }

      const conversations = Array.from(uniqueMap.values());

      return new Response(JSON.stringify({ conversations, error: error?.message }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ==========================================
    // 3.1 INSTAGRAM: MARCAR CONVERSA COMO LIDA (POST)
    // ==========================================
    const readConvMatch = path.match(/^\/instagram\/conversations\/([^/]+)\/read$/);
    if (readConvMatch && (req.method === "POST" || req.method === "PATCH")) {
      const convId = readConvMatch[1];
      await supabase
        .from("instagram_conversations")
        .update({ unread: false, updated_at: new Date().toISOString() })
        .eq("id", convId);

      return new Response(JSON.stringify({ success: true, conversationId: convId }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ==========================================
    // 3.2 INSTAGRAM: RESTRINGIR / DESRESTRINGIR CONVERSA (POST/PATCH)
    // ==========================================
    const restrictConvMatch = path.match(/^\/instagram\/conversations\/([^/]+)\/restrict$/);
    if (restrictConvMatch && (req.method === "POST" || req.method === "PATCH")) {
      const convId = restrictConvMatch[1];
      const body = await req.json().catch(() => ({}));
      const isRestricted = body?.isRestricted !== undefined ? Boolean(body.isRestricted) : true;
      const status = isRestricted ? "restricted" : "active";

      await supabase
        .from("instagram_conversations")
        .update({
          is_restricted: isRestricted,
          status,
          updated_at: new Date().toISOString(),
        })
        .eq("id", convId);

      return new Response(JSON.stringify({ success: true, conversationId: convId, isRestricted, status }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ==========================================
    // 4. INSTAGRAM: SYNC BACKGROUND (POST)
    // ==========================================
    if (path === "/instagram/sync" && req.method === "POST") {
      const body = await req.json().catch(() => ({}));
      const convId = body?.conversationId;

      const { data: config } = await supabase
        .from("instagram_config")
        .select("*")
        .eq("id", "default")
        .maybeSingle();

      if (!config?.access_token) {
        return new Response(JSON.stringify({ success: false, error: "Instagram não conectado" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      // Se uma conversa específica foi passada, sincroniza mensagens dessa conversa
      if (convId) {
        try {
          const isNumeric = /^\d+$/.test(convId);
          const metaUrl = isNumeric
            ? `${API_BASE}/me/conversations?user_id=${convId}&fields=id,messages{id,created_time,from,to,message,attachments,is_unsupported}&limit=50&access_token=${config.access_token}`
            : `${API_BASE}/${convId}?fields=id,messages{id,created_time,from,to,message,attachments,is_unsupported}&limit=50&access_token=${config.access_token}`;

          const res = await fetch(metaUrl, { signal: AbortSignal.timeout(5000) });
          const metaJson = await res.json();
          let messages: any[] = [];
          if (isNumeric) {
            messages = metaJson?.data?.[0]?.messages?.data || [];
          } else {
            messages = metaJson?.messages?.data || metaJson?.data || [];
          }

          // Garante que a conversa exista em instagram_conversations antes de salvar mensagens
          const { data: convCheck } = await supabase
            .from("instagram_conversations")
            .select("id")
            .eq("id", convId)
            .maybeSingle();

          if (!convCheck) {
            await supabase.from("instagram_conversations").upsert({
              id: convId,
              username: isNumeric ? `ig_${convId.slice(-6)}` : convId,
              full_name: isNumeric ? `ig_${convId.slice(-6)}` : convId,
              avatar: "/images/default-avatar.svg",
              contact_id: isNumeric ? convId : null,
              status: "active",
              updated_at: new Date().toISOString(),
            });
          }

          // 1. Busca mensagens já salvas no Supabase para preservar mídias e vínculos de citação (reply_to)
          const { data: existingMessages } = await supabase
            .from("instagram_messages")
            .select("id, media_url, media_type, text, reply_to_message_id")
            .or(`conversation_id.eq.${convId},contact_id.eq.${convId}`);

          const existingMap = new Map<string, any>();
          if (existingMessages) {
            for (const em of existingMessages) {
              existingMap.set(em.id, em);
            }
          }

          for (const m of messages) {
            const isMine =
              m.from?.username === config.username ||
              m.from?.id === config.instagram_account_id ||
              m.from?.username === "lariresende_0611";

            const existing = existingMap.get(m.id);

            let text = m.message || "";
            const isAudio =
              Boolean(m.is_unsupported) ||
              (!m.message && Boolean(m.attachments)) ||
              m.attachments?.data?.some((a: any) => a.mime_type?.includes("audio") || a.type === "audio");

            let audioUrl: string | undefined;
            let imageUrl: string | undefined;

            if (isAudio) {
              const att = m.attachments?.data?.[0];
              if (att?.file_url) {
                audioUrl = att.file_url;
              }
              // Se já temos o áudio salvo no Supabase Storage, NUNCA perde!
              if (!audioUrl && existing?.media_url && (existing.media_type === "audio" || existing.text?.startsWith("[audio:"))) {
                audioUrl = existing.media_url;
              }
              text = audioUrl ? `[audio:${audioUrl}]` : (existing?.text || "🎙️ Mensagem de voz");
            } else if (!text && m.attachments?.data?.length > 0) {
              const att = m.attachments.data[0];
              if (att.image_data?.url) {
                imageUrl = att.image_data.url;
                text = `[image:${imageUrl}]`;
              } else if (att.file_url) {
                audioUrl = att.file_url;
                text = `[audio:${audioUrl}]`;
              }
            }

            // Preserva mídias existentes no banco se a consulta da Meta vier vazia
            const finalMediaUrl = audioUrl || imageUrl || existing?.media_url || null;
            const finalMediaType = (audioUrl || existing?.media_type === "audio" || existing?.text?.startsWith("[audio:"))
              ? "audio"
              : (imageUrl || existing?.media_type === "image" || existing?.text?.startsWith("[image:"))
              ? "image"
              : null;
            const textToSave = text || existing?.text || (isAudio ? "🎙️ Mensagem de voz" : "📷 Mídia compartilhada");

            await supabase.from("instagram_messages").upsert({
              id: m.id,
              conversation_id: convId,
              contact_id: isNumeric ? convId : undefined,
              sender_id: isMine ? "me" : (m.from?.id || convId),
              text: textToSave,
              timestamp: m.created_time || new Date().toISOString(),
              is_mine: isMine,
              status: "delivered",
              media_url: finalMediaUrl,
              media_type: finalMediaType,
              reply_to_message_id: existing?.reply_to_message_id || null,
              direction: isMine ? "outbound" : "inbound",
            });
          }
        } catch (syncErr) {
          console.error("Aviso no sync de mensagens:", syncErr);
        }
      } else {
        // Sync geral: busca threads recentes da conta na Meta Graph API
        try {
          const res = await fetch(
            `${API_BASE}/me/conversations?fields=id,updated_time,participants{id,username},messages.limit(5){id,created_time,from,to,message,attachments,is_unsupported}&limit=20&access_token=${config.access_token}`,
            { signal: AbortSignal.timeout(6000) }
          );
          if (res.ok) {
            const data = await res.json();
            const threads = data.data || [];
            for (const th of threads) {
              const participants: any[] = th.participants?.data || [];
              const other = participants.find(
                (p: any) => p.username !== config.username && p.username !== "lariresende_0611" && p.id !== config.instagram_account_id
              ) || participants[0];

              const contactId = other?.id || th.id;
              const contactUsername = other?.username || `ig_${contactId.slice(-6)}`;

              // Garante conversa
              await supabase.from("instagram_conversations").upsert({
                id: contactId,
                username: contactUsername,
                full_name: contactUsername,
                avatar: "/images/default-avatar.svg",
                contact_id: contactId,
                status: "active",
                updated_at: th.updated_time || new Date().toISOString(),
              });

              // Sincroniza mensagens recentes
              const msgs = th.messages?.data || [];
              const msgRows = msgs.map((m: any) => {
                const isMine =
                  m.from?.username === config.username ||
                  m.from?.id === config.instagram_account_id ||
                  m.from?.username === "lariresende_0611";
                return {
                  id: m.id,
                  conversation_id: contactId,
                  contact_id: contactId,
                  sender_id: isMine ? "me" : (m.from?.id || contactId),
                  text: m.message || "📷 Mídia",
                  timestamp: m.created_time || new Date().toISOString(),
                  is_mine: isMine,
                  status: "delivered",
                  direction: isMine ? "outbound" : "inbound",
                };
              });

              if (msgRows.length > 0) {
                await supabase.from("instagram_messages").upsert(msgRows);
              }
            }
          }
        } catch (syncAllErr) {
          console.error("Aviso no sync geral de conversas:", syncAllErr);
        }
      }

      return new Response(JSON.stringify({ success: true, conversationId: convId }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ==========================================
    // 5. INSTAGRAM: MENSAGENS POR CONVERSA
    // ==========================================
    const messagesMatch = path.match(/^\/instagram\/messages\/([^/]+)/);
    if (messagesMatch) {
      const conversationId = messagesMatch[1];

      // GET: Busca mensagens do Supabase com normalização completa de áudio e imagem
      if (req.method === "GET") {
        // Marca a conversa automaticamente como lida no banco de dados
        supabase
          .from("instagram_conversations")
          .update({ unread: false, updated_at: new Date().toISOString() })
          .eq("id", conversationId)
          .then(() => {});

        let { data, error } = await supabase
          .from("instagram_messages")
          .select("*")
          .or(`conversation_id.eq.${conversationId},contact_id.eq.${conversationId}`)
          .order("timestamp", { ascending: false })
          .limit(500);

        if (data && data.length > 0) {
          data = data.reverse();
        }

        const urlObj = new URL(req.url);
        const forceSync = urlObj.searchParams.get("sync") === "true" || urlObj.searchParams.get("sync") === "1";
        const shouldSyncWithMeta = !data || data.length === 0 || forceSync;

        // Auto-Sync On-Demand com a Meta Graph API: executado se a conversa estiver vazia ou se sync for solicitado
        if (shouldSyncWithMeta) {
          try {
            const { data: igConfig } = await supabase
              .from("instagram_config")
              .select("access_token, username, instagram_account_id")
              .eq("id", "default")
              .maybeSingle();

            if (igConfig?.access_token) {
              const isNumeric = /^\d+$/.test(conversationId);
              const metaUrl = isNumeric
                ? `${API_BASE}/me/conversations?user_id=${conversationId}&fields=id,messages{id,created_time,from,to,message,attachments,is_unsupported}&limit=50&access_token=${igConfig.access_token}`
                : `${API_BASE}/${conversationId}?fields=id,messages{id,created_time,from,to,message,attachments,is_unsupported}&limit=50&access_token=${igConfig.access_token}`;

              const metaRes = await fetch(metaUrl, { signal: AbortSignal.timeout(4000) });
              if (metaRes.ok) {
                const metaJson = await metaRes.json();
                let metaMsgs: any[] = [];
                if (isNumeric) {
                  metaMsgs = metaJson?.data?.[0]?.messages?.data || [];
                } else {
                  metaMsgs = metaJson?.messages?.data || metaJson?.data || [];
                }

                if (metaMsgs.length > 0) {
                  // Garante que a conversa exista em instagram_conversations antes de upsertar mensagens
                  const { data: convCheck } = await supabase
                    .from("instagram_conversations")
                    .select("id")
                    .eq("id", conversationId)
                    .maybeSingle();

                  if (!convCheck) {
                    await supabase.from("instagram_conversations").upsert({
                      id: conversationId,
                      username: isNumeric ? `ig_${conversationId.slice(-6)}` : conversationId,
                      full_name: isNumeric ? `ig_${conversationId.slice(-6)}` : conversationId,
                      avatar: "/images/default-avatar.svg",
                      contact_id: isNumeric ? conversationId : null,
                      status: "active",
                      updated_at: new Date().toISOString(),
                    });
                  }

                  // Busca mensagens existentes para preservar mídias de áudio/foto já salvas
                  const { data: existingDbMsgs } = await supabase
                    .from("instagram_messages")
                    .select("id, media_url, media_type, text, reply_to_message_id")
                    .or(`conversation_id.eq.${conversationId},contact_id.eq.${conversationId}`);

                  const existingMap = new Map<string, any>();
                  if (existingDbMsgs) {
                    for (const em of existingDbMsgs) {
                      existingMap.set(em.id, em);
                    }
                  }

                  const rowsToUpsert: any[] = [];
                  for (const m of metaMsgs) {
                    const isMine =
                      m.from?.username === igConfig.username ||
                      m.from?.id === igConfig.instagram_account_id ||
                      m.from?.username === "lariresende_0611";

                    const existing = existingMap.get(m.id);

                    let text = m.message || "";
                    let audioUrl: string | undefined;
                    let imageUrl: string | undefined;

                    const isAudio =
                      Boolean(m.is_unsupported) ||
                      (!m.message && Boolean(m.attachments)) ||
                      m.attachments?.data?.some((a: any) => a.mime_type?.includes("audio") || a.type === "audio");

                    if (isAudio) {
                      const att = m.attachments?.data?.[0];
                      if (att?.file_url) audioUrl = att.file_url;
                      if (!audioUrl && existing?.media_url && (existing.media_type === "audio" || existing.text?.startsWith("[audio:"))) {
                        audioUrl = existing.media_url;
                      }
                      text = audioUrl ? `[audio:${audioUrl}]` : (existing?.text || "🎙️ Mensagem de voz");
                    } else if (!text && m.attachments?.data?.length > 0) {
                      const att = m.attachments.data[0];
                      if (att.image_data?.url) {
                        imageUrl = att.image_data.url;
                        text = `[image:${imageUrl}]`;
                      } else if (att.file_url) {
                        audioUrl = att.file_url;
                        text = `[audio:${audioUrl}]`;
                      }
                    }

                    const finalMediaUrl = audioUrl || imageUrl || existing?.media_url || null;
                    const finalMediaType = (audioUrl || existing?.media_type === "audio" || existing?.text?.startsWith("[audio:"))
                      ? "audio"
                      : (imageUrl || existing?.media_type === "image" || existing?.text?.startsWith("[image:"))
                      ? "image"
                      : null;
                    const textToSave = text || existing?.text || (isAudio ? "🎙️ Mensagem de voz" : "📷 Foto");

                    rowsToUpsert.push({
                      id: m.id,
                      conversation_id: conversationId,
                      contact_id: isNumeric ? conversationId : undefined,
                      sender_id: isMine ? "me" : (m.from?.id || conversationId),
                      text: textToSave,
                      timestamp: m.created_time || new Date().toISOString(),
                      is_mine: isMine,
                      status: "delivered",
                      media_url: finalMediaUrl,
                      media_type: finalMediaType,
                      reply_to_message_id: existing?.reply_to_message_id || null,
                      direction: isMine ? "outbound" : "inbound",
                    });
                  }

                  if (rowsToUpsert.length > 0) {
                    const { error: upsertErr } = await supabase.from("instagram_messages").upsert(rowsToUpsert);
                    if (upsertErr) {
                      console.error("[GET Messages] Erro ao salvar mensagens da Meta no Supabase:", upsertErr);
                    }
                    const { data: refetched } = await supabase
                      .from("instagram_messages")
                      .select("*")
                      .or(`conversation_id.eq.${conversationId},contact_id.eq.${conversationId}`)
                      .order("timestamp", { ascending: true })
                      .limit(500);
                    if (refetched && refetched.length > 0) {
                      data = refetched;
                    }
                  }
                }
              }
            }
          } catch (fetchMetaErr) {
            console.warn("Aviso ao buscar mensagens on-demand na Meta Graph API:", fetchMetaErr);
          }
        }

        // Cria mapa de mensagens para resolução rápida da citação (Quote Reply)
        const msgMap = new Map<string, any>();
        for (const raw of (data || [])) {
          msgMap.set(raw.id, raw);
        }

        const messages = (data || []).map((m: any) => {
          let text = m.text || "";
          let mediaUrl = m.media_url;
          let mediaType = m.media_type as "image" | "audio" | "video" | undefined;

          if (!mediaUrl && text) {
            const audioMatch = text.match(/^\[audio:(https?:\/\/[^\]]+)\]$/);
            const imageMatch = text.match(/^\[image:(https?:\/\/[^\]]+)\](?:\s*(.*))?$/);
            if (audioMatch) {
              mediaUrl = audioMatch[1];
              mediaType = "audio";
              text = "🎙️ Mensagem de voz";
            } else if (imageMatch) {
              mediaUrl = imageMatch[1];
              mediaType = "image";
              text = imageMatch[2] || "📷 Foto";
            }
          }

          if ((mediaType === "audio" || text === "🎙️ Mensagem de voz") && !mediaUrl) {
            mediaType = "audio";
          }

          const timeStr = formatToBrasiliaTime(m.timestamp);

          // Resolução de mensagem respondida (Quote Reply)
          const replyToMid = m.reply_to_message_id || null;
          let replyTo: any = undefined;
          if (replyToMid) {
            const parentMsg = msgMap.get(replyToMid);
            if (parentMsg) {
              replyTo = {
                id: parentMsg.id,
                senderId: parentMsg.sender_id,
                senderName: parentMsg.is_mine ? "Você" : "Contato",
                text: parentMsg.text || (parentMsg.media_type === "audio" ? "🎙️ Mensagem de voz" : "📷 Foto"),
              };
            } else {
              replyTo = {
                id: replyToMid,
                senderId: "",
                senderName: "Contato",
                text: "Mensagem citada",
              };
            }
          }

          return {
            id: m.id,
            conversationId: m.conversation_id,
            senderId: m.sender_id,
            text: text || (mediaType === "audio" ? "🎙️ Mensagem de voz" : mediaType === "image" ? "📷 Foto" : ""),
            mediaUrl,
            mediaType,
            createdAt: timeStr,
            timestamp: m.timestamp ? new Date(m.timestamp).getTime() : Date.now(),
            sentDate: m.timestamp ? new Date(m.timestamp).toISOString() : new Date().toISOString(),
            isMine: Boolean(m.is_mine),
            status: m.status || "sent",
            seenAt: m.seen_at || undefined,
            deliverAt: m.deliver_at ? new Date(m.deliver_at).getTime() : undefined,
            delaySeconds: m.deliver_at ? Math.max(0, Math.ceil((new Date(m.deliver_at).getTime() - Date.now()) / 1000)) : undefined,
            replyToMessageId: replyToMid,
            replyTo,
          };
        });

        return new Response(JSON.stringify({ messages, error: error?.message }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      // POST: Envio de mensagem com resolução de IGSID e verificação de entrega real na Meta
      if (req.method === "POST") {
        const body = await req.json().catch(() => ({}));
        const rawText = (body.text || body.message || "").trim();
        const audioUrl = (body.audioUrl || "").trim() || (rawText.startsWith("[audio:") ? rawText.match(/^\[audio:(https?:\/\/[^\]]+)\]/)?.[1] : undefined);
        const mediaUrl = (body.mediaUrl || "").trim() || (rawText.startsWith("[image:") ? rawText.match(/^\[image:(https?:\/\/[^\]]+)\]/)?.[1] : undefined);
        const delaySeconds = typeof body.delaySeconds === "number" ? Math.max(0, Math.min(300, Math.round(body.delaySeconds))) : 0;
        const replyToMessageId = body.replyToMessageId || body.reply_to_message_id || body.replyTo?.id || null;

        if (!rawText && !audioUrl && !mediaUrl) {
          return new Response(JSON.stringify({ error: "Mensagem não pode ser vazia." }), {
            status: 400,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }

        const nowIso = new Date().toISOString();
        let textToSave = rawText;
        if (audioUrl && !textToSave.startsWith("[audio:")) {
          textToSave = `[audio:${audioUrl}]`;
        } else if (mediaUrl && !textToSave.startsWith("[image:")) {
          textToSave = `[image:${mediaUrl}]${rawText ? ` ${rawText}` : ""}`;
        }

        // 1. Busca configurações da conta Meta
        const { data: config } = await supabase
          .from("instagram_config")
          .select("access_token, instagram_account_id, username")
          .eq("id", "default")
          .maybeSingle();

        // 2. Resolve o IGSID numérico do destinatário
        let targetRecipientId = conversationId;
        if (!/^\d+$/.test(conversationId)) {
          const { data: senderRows } = await supabase
            .from("instagram_messages")
            .select("sender_id")
            .eq("conversation_id", conversationId)
            .eq("is_mine", false)
            .neq("sender_id", "me")
            .limit(10);

          const found = senderRows?.find((r: any) => /^\d+$/.test(r.sender_id));
          if (found) {
            targetRecipientId = found.sender_id;
          } else if (config?.access_token) {
            try {
              const pRes = await fetch(`${API_BASE}/${conversationId}?fields=participants&access_token=${config.access_token}`);
              if (pRes.ok) {
                const pData = await pRes.json();
                const participants = pData?.participants?.data || [];
                const contact = participants.find(
                  (p: any) => p.username !== config.username && p.username !== "lariresende_0611"
                );
                if (contact?.id) {
                  targetRecipientId = contact.id;
                }
              }
            } catch (pErr) {
              console.error("Erro ao resolver participante da conversa:", pErr);
            }
          }
        }

        // 3. Monta payload de entrega compatível com a Meta Graph API
        let metaPayload: any;
        if (audioUrl) {
          metaPayload = {
            attachment: {
              type: "audio",
              payload: { url: audioUrl },
            },
          };
        } else if (mediaUrl) {
          metaPayload = {
            attachment: {
              type: "image",
              payload: { url: mediaUrl },
            },
          };
        } else {
          metaPayload = {
            text: rawText,
          };
        }

        // Se delaySeconds > 0, executa o fluxo assíncrono desacoplado no servidor (sem travar o app)
        if (delaySeconds > 0) {
          const deliverAtMs = Date.now() + delaySeconds * 1000;
          const deliverAtIso = new Date(deliverAtMs).toISOString();
          const queuedMsgId = `fwd_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
          const previewText = audioUrl ? "🎙️ Mensagem de voz" : mediaUrl ? "📷 Foto" : rawText;

          // 1. Grava no banco com status 'sending' e deliver_at
          await supabase.from("instagram_messages").upsert({
            id: queuedMsgId,
            conversation_id: conversationId,
            sender_id: "me",
            text: textToSave,
            timestamp: nowIso,
            is_mine: true,
            status: "sending",
            deliver_at: deliverAtIso,
            media_url: audioUrl || mediaUrl || null,
            media_type: audioUrl ? "audio" : mediaUrl ? "image" : null,
          });

          // 2. Atualiza a conversa
          await supabase.from("instagram_conversations").update({
            last_message: previewText,
            last_message_preview: previewText,
            last_message_at: nowIso,
            last_direction: "out",
            last_status: "sent",
            seen_at: null,
            updated_at: nowIso,
          }).eq("id", conversationId);

          // 3. Dispara broadcast Realtime imediato
          try {
            const realtimeChannel = supabase.channel("vendeo_realtime_chat");
            await realtimeChannel.send({
              type: "broadcast",
              event: "instagram_message",
              payload: {
                id: queuedMsgId,
                conversationId,
                senderId: "me",
                text: textToSave,
                timestamp: nowIso,
                isMine: true,
                status: "sending",
                deliverAt: deliverAtMs,
                delaySeconds,
                mediaUrl: audioUrl || mediaUrl,
                mediaType: audioUrl ? "audio" : mediaUrl ? "image" : undefined,
              },
            });
            await realtimeChannel.send({
              type: "broadcast",
              event: "instagram_conversation_update",
              payload: {
                id: conversationId,
                lastMessage: `Você: ${previewText}`,
                lastMessageAt: nowIso,
                lastDirection: "out",
                lastStatus: "sent",
                seenAt: null,
                unread: false,
              },
            });
          } catch {}

          // 4. Agenda envio em segundo plano após o delay
          const executeBackgroundDispatch = async () => {
            try {
              console.log(`[Queue] Aguardando ${delaySeconds}s antes de enviar na Meta para ${conversationId}...`);
              await new Promise((resolve) => setTimeout(resolve, delaySeconds * 1000));

              let metaMid: string | undefined;
              let metaError: string | undefined;

              if (config?.access_token) {
                try {
                  const metaRes = await fetch(`${API_BASE}/me/messages?access_token=${config.access_token}`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                      recipient: { id: targetRecipientId },
                      message: metaPayload,
                    }),
                  });

                  const metaData = await metaRes.json();
                  if (!metaRes.ok) {
                    console.error("[Queue] Erro da Meta:", metaData);
                    metaError = metaData?.error?.message || `Erro Meta API status ${metaRes.status}`;
                  } else {
                    metaMid = metaData.message_id;
                    console.log(`[Queue] Mensagem entregue na Meta com sucesso! ID: ${metaMid}`);
                  }
                } catch (netErr: any) {
                  metaError = netErr?.message || "Falha de conexão com a Meta";
                }
              } else {
                metaError = "Instagram não configurado";
              }

              const finalStatus = metaError ? "failed" : "sent";
              const finalMsgId = metaMid || queuedMsgId;

              if (metaMid && metaMid !== queuedMsgId) {
                await supabase.from("instagram_messages").delete().eq("id", queuedMsgId);
                await supabase.from("instagram_messages").upsert({
                  id: metaMid,
                  conversation_id: conversationId,
                  sender_id: "me",
                  text: textToSave,
                  timestamp: new Date().toISOString(),
                  is_mine: true,
                  status: finalStatus,
                  deliver_at: null,
                  media_url: audioUrl || mediaUrl || null,
                  media_type: audioUrl ? "audio" : mediaUrl ? "image" : null,
                });
              } else {
                await supabase.from("instagram_messages").update({
                  status: finalStatus,
                  deliver_at: null,
                }).eq("id", queuedMsgId);
              }

              // Dispara broadcast informando que o envio foi finalizado
              try {
                const realtimeChannel = supabase.channel("vendeo_realtime_chat");
                await realtimeChannel.send({
                  type: "broadcast",
                  event: "instagram_message",
                  payload: {
                    id: finalMsgId,
                    oldId: queuedMsgId,
                    conversationId,
                    senderId: "me",
                    text: textToSave,
                    timestamp: new Date().toISOString(),
                    isMine: true,
                    status: finalStatus,
                    deliverAt: undefined,
                    mediaUrl: audioUrl || mediaUrl,
                    mediaType: audioUrl ? "audio" : mediaUrl ? "image" : undefined,
                  },
                });
              } catch {}
            } catch (bgErr) {
              console.error("[Queue] Erro inesperado no despacho em background:", bgErr);
            }
          };

          if (typeof (globalThis as any).EdgeRuntime?.waitUntil === "function") {
            (globalThis as any).EdgeRuntime.waitUntil(executeBackgroundDispatch());
          } else {
            executeBackgroundDispatch().catch(console.error);
          }

          // Resposta imediata para liberar o app do usuário
          return new Response(JSON.stringify({
            success: true,
            queued: true,
            delaySeconds,
            message: {
              id: queuedMsgId,
              conversationId,
              senderId: "me",
              text: textToSave,
              createdAt: formatToBrasiliaTime(new Date()),
              timestamp: Date.now(),
              sentDate: new Date().toISOString(),
              isMine: true,
              status: "sending",
            },
          }), {
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }

        let metaMid: string | undefined;
        let metaError: string | undefined;

        // 4. Envia para a Meta Graph API (suporte a Quote Reply oficial na raiz do payload)
        if (config?.access_token) {
          try {
            console.log(`Enviando mensagem no Instagram para recipientId: ${targetRecipientId}...`, {
              hasReplyTo: Boolean(replyToMessageId),
              replyToMessageId,
            });

            const metaSendPayload: any = {
              recipient: { id: targetRecipientId },
              message: metaPayload,
            };
            if (replyToMessageId) {
              metaSendPayload.reply_to = { mid: replyToMessageId };
              metaSendPayload.messaging_type = "RESPONSE";
            }

            let metaRes = await fetch(`${API_BASE}/me/messages?access_token=${config.access_token}`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(metaSendPayload),
            });

            // Fallback resiliente: se falhou e tinha reply_to, reenvia sem reply_to para não perder a mensagem
            if (!metaRes.ok && replyToMessageId) {
              const errWithReply = await metaRes.clone().text();
              console.warn("⚠️ [Meta Graph API] Falha ao enviar com reply_to. Tentando reenvio direto:", errWithReply);
              delete metaSendPayload.reply_to;
              delete metaSendPayload.messaging_type;
              metaRes = await fetch(`${API_BASE}/me/messages?access_token=${config.access_token}`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(metaSendPayload),
              });
            }

            const metaData = await metaRes.json();
            if (!metaRes.ok) {
              console.error("Erro retornado pela Meta Graph API:", metaData);
              metaError = metaData?.error?.message || `Erro Meta API status ${metaRes.status}`;
            } else {
              metaMid = metaData.message_id;
              console.log(`Mensagem entregue na Meta com sucesso! message_id: ${metaMid}`);
            }
          } catch (netErr: any) {
            console.error("Falha de rede ao disparar na Meta:", netErr);
            metaError = netErr?.message || "Falha de conexão com a Meta";
          }
        } else {
          metaError = "Instagram não configurado ou sem access_token ativo.";
        }

        const finalMsgId = metaMid || `msg_local_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
        const msgStatus = metaError ? "failed" : "sent";

        await supabase.from("instagram_messages").upsert({
          id: finalMsgId,
          conversation_id: conversationId,
          sender_id: "me",
          text: textToSave,
          timestamp: nowIso,
          is_mine: true,
          status: msgStatus,
          media_url: audioUrl || mediaUrl || null,
          media_type: audioUrl ? "audio" : mediaUrl ? "image" : null,
          reply_to_message_id: replyToMessageId,
        });

        const previewText = audioUrl ? "🎙️ Mensagem de voz" : mediaUrl ? "📷 Foto" : rawText;

        const { error: convUpdErr, count: convUpdCount } = await supabase
          .from("instagram_conversations")
          .update({
            last_message: previewText,
            last_message_preview: previewText,
            last_message_at: nowIso,
            last_direction: "out",
            last_status: "sent",
            seen_at: null,
            updated_at: nowIso,
          }, { count: "exact" })
          .eq("id", conversationId);

        const myIgUsername = config?.username || "lariresende_0611";

        if (convUpdErr || convUpdCount === 0) {
          let resolved = {
            username: `ig_${conversationId.slice(-6)}`,
            fullName: `ig_${conversationId.slice(-6)}`,
            avatar: "/images/default-avatar.svg",
          };

          if (config?.access_token) {
            resolved = await resolveInstagramContactProfile(
              supabase,
              config.access_token,
              myIgUsername,
              conversationId,
              finalMsgId
            );
          }

          await supabase.from("instagram_conversations").insert({
            id: conversationId,
            username: resolved.username,
            full_name: resolved.fullName,
            avatar: resolved.avatar,
            last_message: previewText,
            last_message_preview: previewText,
            last_message_at: nowIso,
            last_direction: "out",
            last_status: "sent",
            seen_at: null,
            unread: false,
            updated_at: nowIso,
            status: "active",
          });
        } else {
          // Se conversa já existia mas com username ig_ ou sem avatar oficial, resolve agora que houve resposta
          const { data: currentConv } = await supabase
            .from("instagram_conversations")
            .select("username, full_name, avatar")
            .eq("id", conversationId)
            .maybeSingle();

          if (
            currentConv &&
            (currentConv.username?.startsWith("ig_") ||
              !currentConv.avatar ||
              currentConv.avatar === "/images/default-avatar.svg") &&
            config?.access_token
          ) {
            const resolved = await resolveInstagramContactProfile(
              supabase,
              config.access_token,
              myIgUsername,
              conversationId,
              finalMsgId
            );

            if (resolved.username && !resolved.username.startsWith("ig_")) {
              const updateFields: any = {
                username: resolved.username,
                full_name: resolved.fullName,
                updated_at: nowIso,
              };
              if (resolved.avatar && !resolved.avatar.includes("default-avatar.svg")) {
                updateFields.avatar = resolved.avatar;
              }
              await supabase
                .from("instagram_conversations")
                .update(updateFields)
                .eq("id", conversationId);
            }
          }
        }

        try {
          const realtimeChannel = supabase.channel("vendeo_realtime_chat");
          await realtimeChannel.send({
            type: "broadcast",
            event: "instagram_message",
            payload: {
              id: finalMsgId,
              conversationId,
              senderId: "me",
              text: textToSave,
              timestamp: nowIso,
              isMine: true,
              status: msgStatus,
              mediaUrl: audioUrl || mediaUrl,
              mediaType: audioUrl ? "audio" : mediaUrl ? "image" : undefined,
              replyToMessageId: replyToMessageId,
            },
          });
          await realtimeChannel.send({
            type: "broadcast",
            event: "instagram_conversation_update",
            payload: {
              id: conversationId,
              lastMessage: `Você: ${previewText}`,
              lastMessageAt: nowIso,
              lastDirection: "out",
              lastStatus: "sent",
              seenAt: null,
              unread: false,
            },
          });
        } catch {
          // Ignora falha de broadcast
        }

        if (metaError) {
          const isOutside24h =
            /outside.*allowed window/i.test(metaError) ||
            /outside.*24-hour window/i.test(metaError) ||
            /2018278/.test(metaError);

          return new Response(JSON.stringify({
            error: metaError,
            errorReason: isOutside24h ? "outside_24h_window" : "generic",
            isOutside24hWindow: isOutside24h,
            message: {
              id: finalMsgId,
              status: "failed",
              errorReason: isOutside24h ? "outside_24h_window" : "generic",
              replyToMessageId: replyToMessageId,
            }
          }), {
            status: 400,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }

        return new Response(JSON.stringify({
          success: true,
          message: {
            id: finalMsgId,
            conversationId,
            senderId: "me",
            text: textToSave,
            createdAt: formatToBrasiliaTime(new Date()),
            timestamp: Date.now(),
            sentDate: new Date().toISOString(),
            isMine: true,
            status: "sent",
            replyToMessageId: replyToMessageId,
          }
        }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    // ==========================================
    // 6. TINDER: STATUS & CONFIG
    // ==========================================
    if (path === "/tinder/status") {
      const { data, error } = await supabase
        .from("tinder_config")
        .select("id, user_id, user_name, avatar_url, auth_token, updated_at")
        .eq("id", "default")
        .maybeSingle();

      const isConnected = Boolean(data?.auth_token);
      return new Response(JSON.stringify({
        isConnected,
        profile: isConnected ? {
          id: data?.user_id || "default_user",
          name: data?.user_name || "Larissa",
          photos: data?.avatar_url ? [{ id: "1", url: data.avatar_url }] : [],
          isVerified: true,
        } : null,
        error: error?.message,
      }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ==========================================
    // 6.1 TINDER: AUTH / CONECTAR TOKEN
    // ==========================================
    if (path === "/tinder/auth" && req.method === "POST") {
      try {
        const body = await req.json().catch(() => ({}));
        const token = (body?.token || "").trim();

        if (!token) {
          return new Response(JSON.stringify({ error: "Token de autenticação do Tinder não informado." }), {
            status: 400,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }

        const tinderHeaders = {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
          Accept: "application/json",
          "Content-Type": "application/json",
          platform: "web",
          "app-version": "1040800",
          Origin: "https://tinder.com",
          Referer: "https://tinder.com/",
          "X-Auth-Token": token,
        };

        console.log("🔥 [Tinder Auth] Validando token no Tinder oficial...");
        const tinderRes = await fetch("https://api.gotinder.com/v2/profile?include=user", {
          method: "GET",
          headers: tinderHeaders,
        });

        if (!tinderRes.ok) {
          const errText = await tinderRes.text().catch(() => "");
          console.warn("⚠️ [Tinder Auth] Token rejeitado pela API do Tinder:", tinderRes.status, errText);
          return new Response(JSON.stringify({
            error: tinderRes.status === 401
              ? "Token do Tinder inválido ou expirado. Gere um novo token no Tinder Web."
              : `Falha ao validar token no Tinder (${tinderRes.status}): ${errText || tinderRes.statusText}`,
          }), {
            status: 401,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }

        const tinderData = await tinderRes.json();
        const user = tinderData?.data?.user;

        if (!user) {
          return new Response(JSON.stringify({ error: "Resposta do Tinder não continha dados de usuário válidos." }), {
            status: 400,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }

        const photos = (user.photos || []).map((p: any) => ({
          id: p.id || String(Math.random()),
          url: p.url || p.processedFiles?.[0]?.url || "",
        }));

        const profile = {
          id: user._id || user.id,
          name: user.name || "Usuário Tinder",
          bio: user.bio || "",
          birthDate: user.birth_date,
          photos,
          isVerified: Boolean(user.is_tinder_u || user.badges?.length),
        };

        // Salva token e perfil no Supabase para autonomia
        const avatarUrl = photos[0]?.url || null;
        await supabase.from("tinder_config").upsert({
          id: "default",
          auth_token: token,
          user_id: profile.id,
          user_name: profile.name,
          avatar_url: avatarUrl,
          updated_at: new Date().toISOString(),
        });

        console.log("✅ [Tinder Auth] Conectado com sucesso! Usuário:", profile.name, profile.id);

        // Dispara sincronização inicial de matches em background
        try {
          const matchesRes = await fetch("https://api.gotinder.com/v2/matches?count=60&is_tinder_u=false", {
            method: "GET",
            headers: tinderHeaders,
          });
          if (matchesRes.ok) {
            const matchesData = await matchesRes.json();
            const rawMatches = matchesData?.data?.matches || [];
            const convsToUpsert = rawMatches.map((m: any) => {
              const person = m.person || {};
              const msgs = m.messages || [];
              const lastMsg = msgs.length > 0 ? msgs[msgs.length - 1] : null;
              const isSentByMe = lastMsg ? lastMsg.from === profile.id : false;

              return {
                match_id: m.id,
                person_id: person._id || null,
                name: person.name || "Match",
                birth_date: person.birth_date || null,
                bio: person.bio || null,
                photos: person.photos || [],
                last_message_preview: lastMsg?.message || null,
                last_message_at: lastMsg?.sent_date ? new Date(lastMsg.sent_date).toISOString() : null,
                last_direction: lastMsg ? (isSentByMe ? "outbound" : "inbound") : null,
                status: msgs.length === 0 ? "Novo" : "Conversando",
                updated_at: new Date().toISOString(),
              };
            });

            if (convsToUpsert.length > 0) {
              await supabase.from("tinder_conversations").upsert(convsToUpsert, { onConflict: "match_id" });
            }

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
              await supabase.from("tinder_messages").upsert(messagesToUpsert, { onConflict: "id" });
            }
            console.log(`✅ [Tinder Auth] Sincronizados ${convsToUpsert.length} matches e ${messagesToUpsert.length} mensagens.`);
          }
        } catch (syncErr) {
          console.warn("Aviso na sincronização inicial do Tinder:", syncErr);
        }

        return new Response(JSON.stringify({
          success: true,
          profile,
          token,
        }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      } catch (err: any) {
        console.error("Erro interno no /tinder/auth:", err);
        return new Response(JSON.stringify({ error: err?.message || "Erro ao autenticar com o Tinder" }), {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    // ==========================================
    // 6.2 TINDER: DESCONECTAR
    // ==========================================
    if (path === "/tinder/disconnect" && req.method === "POST") {
      await supabase.from("tinder_config").update({
        auth_token: null,
        updated_at: new Date().toISOString(),
      }).eq("id", "default");

      return new Response(JSON.stringify({ success: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ==========================================
    // 7. TINDER: MATCHES (GET)
    // ==========================================
    if (path === "/tinder/matches" && req.method === "GET") {
      // Se houver token configurado, faz sync com o Tinder oficial
      const { data: tConfig } = await supabase
        .from("tinder_config")
        .select("auth_token, user_id")
        .eq("id", "default")
        .maybeSingle();

      if (tConfig?.auth_token) {
        try {
          const tinderHeaders = {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
            Accept: "application/json",
            "Content-Type": "application/json",
            platform: "web",
            "app-version": "1040800",
            Origin: "https://tinder.com",
            Referer: "https://tinder.com/",
            "X-Auth-Token": tConfig.auth_token,
          };

          const mRes = await fetch("https://api.gotinder.com/v2/matches?count=60&is_tinder_u=false", {
            headers: tinderHeaders,
          });

          if (mRes.ok) {
            const mData = await mRes.json();
            const rawMatches = mData?.data?.matches || [];

            // 1. Carrega histórico já existente para nunca sobrescrever com null conversas ativas
            const { data: existingRows } = await supabase
              .from("tinder_conversations")
              .select("match_id, last_message_preview, last_message_at, last_direction, status");
            const existingMap = new Map<string, any>();
            if (existingRows) {
              for (const r of existingRows) {
                existingMap.set(r.match_id, r);
              }
            }

            const convsToUpsert = rawMatches.map((m: any) => {
              const person = m.person || {};
              const msgs = Array.isArray(m.messages) ? m.messages : [];
              const existing = existingMap.get(m.id);
              const isRestricted = existing?.status === "restricted";

              // Ordena mensagens para garantir a mais recente no índice 0
              const sortedMsgs = [...msgs].sort((a: any, b: any) => {
                const tA = a.timestamp || (a.sent_date ? new Date(a.sent_date).getTime() : 0);
                const tB = b.timestamp || (b.sent_date ? new Date(b.sent_date).getTime() : 0);
                return tB - tA;
              });
              const newestMsg = sortedMsgs[0] || null;
              const isSentByMe = newestMsg ? newestMsg.from === tConfig.user_id : false;

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
              await supabase.from("tinder_conversations").upsert(convsToUpsert, { onConflict: "match_id" });
            }

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
              await supabase.from("tinder_messages").upsert(messagesToUpsert, { onConflict: "id" });
            }
          }
        } catch (syncErr) {
          console.warn("Aviso no sync de matches do Tinder:", syncErr);
        }
      }

      const { data, error } = await supabase
        .from("tinder_conversations")
        .select("*")
        .order("last_message_at", { ascending: false, nullsFirst: false })
        .limit(100);

      const matches = (data || []).map((m: any) => {
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
          avatarUrl = typeof firstPhoto === "string" ? firstPhoto : (firstPhoto.url || avatarUrl);
        }

        const isRestr = m.status === "restricted";

        return {
          id: m.match_id,
          username: (m.name || "match").toLowerCase().replace(/\s+/g, "_"),
          fullName: `${m.name || "Match"}${ageStr}`,
          avatar: avatarUrl,
          isOnline: false,
          lastActive: m.last_message_at
            ? formatToBrasiliaTime(m.last_message_at)
            : "Recente",
          lastMessage: m.last_message_preview || "Novo Match",
          unread: m.last_direction !== "outbound" && Boolean(m.last_message_preview),
          type: "tinder",
          lastSender: m.last_direction === "outbound" ? "me" : "them",
          lastMessageAt: m.last_message_at || m.created_at,
          isRestricted: isRestr,
          status: isRestr ? "restricted" : (m.status || "active"),
        };
      });

      return new Response(JSON.stringify({ matches, error: error?.message }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ==========================================
    // 8. TINDER: MENSAGENS POR MATCH
    // ==========================================
    const tinderMsgMatch = path.match(/^\/tinder\/messages\/([^/]+)/);
    if (tinderMsgMatch) {
      const matchId = tinderMsgMatch[1];

      // GET: Mensagens do Tinder
      if (req.method === "GET") {
        const { data: config } = await supabase
          .from("tinder_config")
          .select("user_id, auth_token")
          .eq("id", "default")
          .maybeSingle();

        const myUserId = config?.user_id || "6a8451cb13ef7556bbdaa40e";
        const authToken = config?.auth_token;

        // Se houver token configurado, sincroniza mensagens completas da API oficial do Tinder
        if (authToken) {
          try {
            const tinderHeaders = {
              "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
              Accept: "application/json",
              "Content-Type": "application/json",
              platform: "web",
              "app-version": "1040800",
              Origin: "https://tinder.com",
              Referer: "https://tinder.com/",
              "X-Auth-Token": authToken,
            };

            const tMsgRes = await fetch(`https://api.gotinder.com/v2/matches/${matchId}/messages?count=100`, {
              headers: tinderHeaders,
            });

            if (tMsgRes.ok) {
              const tMsgData = await tMsgRes.json();
              const rawMsgs = tMsgData?.data?.messages || [];

              if (Array.isArray(rawMsgs) && rawMsgs.length > 0) {
                const rowsToUpsert = rawMsgs
                  .filter((m: any) => Boolean(m._id && m.message))
                  .map((m: any) => {
                    const isoDate = m.sent_date ? new Date(m.sent_date).toISOString() : new Date().toISOString();
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
                  await supabase.from("tinder_messages").upsert(rowsToUpsert, { onConflict: "id" });
                }

                // Atualiza a conversa com a mensagem mais recente
                const sortedByTimeDesc = [...rawMsgs].sort((a: any, b: any) => {
                  const tA = a.timestamp || (a.sent_date ? new Date(a.sent_date).getTime() : 0);
                  const tB = b.timestamp || (b.sent_date ? new Date(b.sent_date).getTime() : 0);
                  return tB - tA;
                });
                const newestMsg = sortedByTimeDesc[0];
                if (newestMsg) {
                  const isSentByMe = newestMsg.from === myUserId;
                  await supabase
                    .from("tinder_conversations")
                    .update({
                      last_message_preview: newestMsg.message,
                      last_message_at: newestMsg.sent_date ? new Date(newestMsg.sent_date).toISOString() : new Date().toISOString(),
                      last_direction: isSentByMe ? "outbound" : "inbound",
                      updated_at: new Date().toISOString(),
                    })
                    .eq("match_id", matchId);
                }
              }
            }
          } catch (syncErr) {
            console.warn("Aviso ao sincronizar mensagens do Tinder oficial na Edge Function:", syncErr);
          }
        }

        // Lê do banco todas as mensagens do match ordenadas cronologicamente
        const { data, error } = await supabase
          .from("tinder_messages")
          .select("*")
          .eq("match_id", matchId)
          .order("sent_date", { ascending: true })
          .limit(200);

        const messages = (data || []).map((m: any) => ({
          id: m.id,
          senderId: m.sender_id,
          text: m.message,
          createdAt: m.sent_date
            ? formatToBrasiliaTime(m.sent_date)
            : "Agora",
          timestamp: m.sent_date ? new Date(m.sent_date).getTime() : Date.now(),
          sentDate: m.sent_date,
          isMine: m.sender_id === myUserId || m.sender_id === "me",
          status: m.status || "sent",
          deliverAt: m.deliver_at ? new Date(m.deliver_at).getTime() : undefined,
          delaySeconds: m.deliver_at ? Math.max(0, Math.ceil((new Date(m.deliver_at).getTime() - Date.now()) / 1000)) : undefined,
        }));

        return new Response(JSON.stringify({ messages, error: error?.message }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      // POST: Envio de mensagem Tinder oficial
      if (req.method === "POST") {
        const body = await req.json().catch(() => ({}));
        const text = (body.text || body.message || "").trim();

        if (!text) {
          return new Response(JSON.stringify({ error: "Texto não pode ser vazio." }), {
            status: 400,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }

        const delaySeconds = typeof body.delaySeconds === "number" ? Math.max(0, Math.min(300, Math.round(body.delaySeconds))) : 0;
        const nowIso = new Date().toISOString();
        const timeStr = formatToBrasiliaTime(new Date());

        const { data: config } = await supabase
          .from("tinder_config")
          .select("user_id, auth_token")
          .eq("id", "default")
          .maybeSingle();

        const myUserId = config?.user_id || "6a8451cb13ef7556bbdaa40e";
        const authToken = config?.auth_token;

        const tinderHeaders = {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
          Accept: "application/json",
          "Content-Type": "application/json",
          platform: "web",
          "app-version": "1040800",
          Origin: "https://tinder.com",
          Referer: "https://tinder.com/",
          "X-Auth-Token": authToken || "",
        };

        // Envio assíncrono com Delay Humano em segundo plano (respeitando delaySeconds, ex: 10s de texto ou duração de áudio)
        if (delaySeconds > 0) {
          const deliverAtMs = Date.now() + delaySeconds * 1000;
          const deliverAtIso = new Date(deliverAtMs).toISOString();
          const queuedMsgId = `fwd_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;

          // 1. Grava no banco com status 'sending' e deliver_at
          await supabase.from("tinder_messages").insert({
            id: queuedMsgId,
            match_id: matchId,
            sender_id: myUserId,
            message: text,
            sent_date: nowIso,
            created_at: nowIso,
            status: "sending",
            deliver_at: deliverAtIso,
          });

          // 2. Atualiza a conversa
          await supabase.from("tinder_conversations").update({
            last_message_preview: text,
            last_message_at: nowIso,
            last_direction: "outbound",
            updated_at: nowIso,
          }).eq("match_id", matchId);

          // 3. Dispara broadcast imediato
          try {
            const realtimeChannel = supabase.channel("vendeo_realtime_chat");
            await realtimeChannel.send({
              type: "broadcast",
              event: "tinder_message",
              payload: {
                id: queuedMsgId,
                conversationId: matchId,
                senderId: "me",
                text,
                timestamp: nowIso,
                isMine: true,
                status: "sending",
                deliverAt: deliverAtMs,
                delaySeconds,
              },
            });
          } catch {}

          // 4. Agenda envio em segundo plano após o delay configurado
          const executeBackgroundTinderDispatch = async () => {
            try {
              console.log(`🔥 [Queue Tinder] Aguardando ${delaySeconds}s antes de enviar para o Tinder match ${matchId}...`);
              await new Promise((resolve) => setTimeout(resolve, delaySeconds * 1000));

              let finalMsgId = queuedMsgId;
              if (authToken) {
                console.log(`🔥 [Queue Tinder] Despachando para a API oficial do Tinder após ${delaySeconds}s...`);
                let tinderRes = await fetch(`https://api.gotinder.com/user/matches/${matchId}`, {
                  method: "POST",
                  headers: tinderHeaders,
                  body: JSON.stringify({ message: text }),
                });

                if (tinderRes.status === 404 || tinderRes.status === 405) {
                  tinderRes = await fetch(`https://api.gotinder.com/v2/matches/${matchId}/messages`, {
                    method: "POST",
                    headers: tinderHeaders,
                    body: JSON.stringify({
                      message: text,
                      temp_id: `temp_${Date.now()}`,
                    }),
                  });
                }

                if (tinderRes.ok) {
                  const tinderData = await tinderRes.json().catch(() => null);
                  const officialId = tinderData?._id || tinderData?.data?._id || tinderData?.message?._id;
                  if (officialId && officialId !== queuedMsgId) {
                    finalMsgId = officialId;
                    await supabase.from("tinder_messages").delete().eq("id", queuedMsgId);
                    await supabase.from("tinder_messages").insert({
                      id: officialId,
                      match_id: matchId,
                      sender_id: myUserId,
                      message: text,
                      sent_date: new Date().toISOString(),
                      created_at: new Date().toISOString(),
                      status: "sent",
                      deliver_at: null,
                    });
                  } else {
                    await supabase.from("tinder_messages").update({
                      status: "sent",
                      deliver_at: null,
                    }).eq("id", queuedMsgId);
                  }
                  console.log(`✅ [Queue Tinder] Entregue com sucesso após delay! ID: ${finalMsgId}`);
                } else {
                  const errText = await tinderRes.text().catch(() => "");
                  console.error(`❌ [Queue Tinder] Falha ao entregar no Tinder (${tinderRes.status}):`, errText);
                  await supabase.from("tinder_messages").update({
                    status: "failed",
                    deliver_at: null,
                  }).eq("id", queuedMsgId);
                }
              }

              // Broadcast de confirmação final
              try {
                const realtimeChannel = supabase.channel("vendeo_realtime_chat");
                await realtimeChannel.send({
                  type: "broadcast",
                  event: "tinder_message",
                  payload: {
                    id: finalMsgId,
                    oldId: queuedMsgId,
                    conversationId: matchId,
                    senderId: "me",
                    text,
                    timestamp: new Date().toISOString(),
                    isMine: true,
                    status: "sent",
                    deliverAt: undefined,
                  },
                });
              } catch {}
            } catch (bgErr) {
              console.error("[Queue Tinder] Erro no despacho em background:", bgErr);
            }
          };

          if (typeof (globalThis as any).EdgeRuntime?.waitUntil === "function") {
            (globalThis as any).EdgeRuntime.waitUntil(executeBackgroundTinderDispatch());
          } else {
            executeBackgroundTinderDispatch().catch(console.error);
          }

          const messagePayload = {
            id: queuedMsgId,
            senderId: "me",
            text,
            createdAt: timeStr,
            timestamp: Date.now(),
            sentDate: nowIso,
            isMine: true,
            status: "sending",
          };

          return new Response(JSON.stringify({
            ...messagePayload,
            message: messagePayload,
            queued: true,
            delaySeconds,
            success: true,
          }), {
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }

        // Envio imediato (delaySeconds === 0)
        let newId = `msg_tinder_${Date.now()}`;

        // Se houver token configurado, envia para a API oficial do Tinder
        if (authToken) {
          try {
            console.log(`🔥 [Tinder Send] Enviando mensagem oficial para match ${matchId}...`);
            // Tentativa 1: endpoint padrão /user/matches/:matchId
            let tinderRes = await fetch(`https://api.gotinder.com/user/matches/${matchId}`, {
              method: "POST",
              headers: tinderHeaders,
              body: JSON.stringify({ message: text }),
            });

            // Fallback v2 se v1 retornar 404 ou 405
            if (tinderRes.status === 404 || tinderRes.status === 405) {
              console.log("🔥 [Tinder Send] Tentando fallback v2 /v2/matches/:matchId/messages...");
              tinderRes = await fetch(`https://api.gotinder.com/v2/matches/${matchId}/messages`, {
                method: "POST",
                headers: tinderHeaders,
                body: JSON.stringify({
                  message: text,
                  temp_id: `temp_${Date.now()}`,
                }),
              });
            }

            if (!tinderRes.ok) {
              const errBody = await tinderRes.text().catch(() => "");
              console.error(`❌ [Tinder Send] Erro da API do Tinder (${tinderRes.status}):`, errBody);
              if (tinderRes.status === 401) {
                return new Response(JSON.stringify({
                  error: "Token do Tinder expirado. Por favor, reconecte o Tinder em Configurações.",
                  code: "UNAUTHORIZED",
                }), {
                  status: 401,
                  headers: { ...corsHeaders, "Content-Type": "application/json" },
                });
              }
              return new Response(JSON.stringify({
                error: `Falha ao entregar mensagem no Tinder (${tinderRes.status}): ${errBody || tinderRes.statusText}`,
                code: "TINDER_API_ERROR",
              }), {
                status: tinderRes.status,
                headers: { ...corsHeaders, "Content-Type": "application/json" },
              });
            }

            const tinderData = await tinderRes.json().catch(() => null);
            console.log("✅ [Tinder Send] Mensagem entregue no Tinder com sucesso:", tinderData);
            if (tinderData?._id) {
              newId = tinderData._id;
            } else if (tinderData?.data?._id) {
              newId = tinderData.data._id;
            } else if (tinderData?.message?._id) {
              newId = tinderData.message._id;
            }
          } catch (tinderErr: any) {
            console.error("❌ [Tinder Send] Erro de rede ao conectar com o Tinder:", tinderErr);
            return new Response(JSON.stringify({
              error: `Erro ao conectar com o Tinder: ${tinderErr?.message || "Timeout"}`,
              code: "TINDER_NETWORK_ERROR",
            }), {
              status: 502,
              headers: { ...corsHeaders, "Content-Type": "application/json" },
            });
          }
        }

        await supabase.from("tinder_messages").insert({
          id: newId,
          match_id: matchId,
          sender_id: myUserId,
          message: text,
          sent_date: nowIso,
          created_at: nowIso,
        });

        await supabase.from("tinder_conversations").update({
          last_message_preview: text,
          last_message_at: nowIso,
          last_direction: "outbound",
          updated_at: nowIso,
        }).eq("match_id", matchId);

        const messagePayload = {
          id: newId,
          senderId: "me",
          text,
          createdAt: timeStr,
          timestamp: Date.now(),
          sentDate: nowIso,
          isMine: true,
          status: "sent",
        };

        return new Response(JSON.stringify({
          ...messagePayload,
          message: messagePayload,
          success: true,
        }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    // ==========================================
    // 8.5. MOTOR DE TRANSCRIÇÃO GROQ CLOUD (/ai/transcribe)
    // ==========================================
    if (path === "/ai/transcribe") {
      if (req.method === "GET") {
        const key = await getGroqApiKey(supabase);
        const isConfigured = Boolean(key && key.startsWith("gsk_"));
        const maskedKey = isConfigured && key ? `${key.slice(0, 7)}...${key.slice(-4)}` : null;
        return new Response(
          JSON.stringify({
            configured: isConfigured,
            model: "whisper-large-v3",
            provider: "Groq Cloud Audio",
            maskedKey,
          }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      if (req.method === "PUT") {
        const body = await req.json().catch(() => ({}));
        const apiKey = typeof body?.apiKey === "string" ? body.apiKey.trim() : "";

        if (!apiKey || !apiKey.startsWith("gsk_")) {
          return new Response(
            JSON.stringify({ error: "Chave inválida. Deve iniciar com 'gsk_'." }),
            { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }

        const { error } = await supabase.from("instagram_config").upsert({
          id: "groq_api_key",
          app_secret: apiKey,
          updated_at: new Date().toISOString(),
        });

        if (error) {
          return new Response(
            JSON.stringify({ error: "Falha ao salvar chave no Supabase." }),
            { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }

        return new Response(
          JSON.stringify({
            success: true,
            message: "Chave Groq API configurada com sucesso!",
            maskedKey: `${apiKey.slice(0, 7)}...${apiKey.slice(-4)}`,
          }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      if (req.method === "POST") {
        const body = await req.json().catch(() => ({}));
        const messageId = typeof body?.messageId === "string" ? body.messageId.trim() : "";
        const mediaUrl = typeof body?.mediaUrl === "string" ? body.mediaUrl.trim() : "";
        const apiKey = typeof body?.apiKey === "string" ? body.apiKey.trim() : undefined;

        if (!mediaUrl && !messageId) {
          return new Response(
            JSON.stringify({ error: "Informe 'mediaUrl' ou 'messageId'." }),
            { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }

        // 1. Tenta recuperar do cache no banco
        if (messageId) {
          const { data: existingMsg } = await supabase
            .from("instagram_messages")
            .select("audio_transcript")
            .eq("id", messageId)
            .maybeSingle();

          if (existingMsg?.audio_transcript) {
            return new Response(
              JSON.stringify({
                text: existingMsg.audio_transcript,
                cached: true,
                model: "whisper-large-v3",
              }),
              { headers: { ...corsHeaders, "Content-Type": "application/json" } }
            );
          }
        }

        if (!mediaUrl) {
          return new Response(
            JSON.stringify({ error: "Mídia não informada e transcrição não encontrada em cache." }),
            { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }

        // 2. Dispara transcrição na nuvem com a Groq
        const transcript = await transcribeWithGroqCloud(supabase, mediaUrl, apiKey);
        if (!transcript) {
          return new Response(
            JSON.stringify({ error: "Não foi possível transcrever o áudio na nuvem com a Groq." }),
            { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }

        // 3. Salva no banco de dados para evitar requisições repetidas
        if (messageId) {
          await supabase
            .from("instagram_messages")
            .update({
              audio_transcript: transcript,
              audio_transcribed_at: new Date().toISOString(),
              audio_transcription_error: null,
            })
            .eq("id", messageId);
        }

        return new Response(
          JSON.stringify({
            text: transcript,
            cached: false,
            model: "whisper-large-v3",
          }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
    }

    // Rota padrão 404
    return new Response(JSON.stringify({ error: "Endpoint não encontrado", path, rawPath: url.pathname }), {
      status: 404,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (err: any) {
    return new Response(JSON.stringify({ error: err.message || "Erro interno" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
