// Supabase Edge Function - Backend Vendeo Social
// Deno TypeScript Runtime
import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.8";
import {
  runBrainOrchestration,
  authorizeManualAutopilotRetryAtomic,
  releaseExperimentalCycleAtomic,
  runDurableOutboxDispatcher,
  resolveConfiguredOpenAiModel,
} from "./brain_orchestrator.ts";
import { publishAutoPilotState, patchAutoPilotProjectionState, activity } from "./autopilot_state.ts";
import { enrichBrainDecisionActionRows, enrichBrainTurnEventRows } from "./brain_event_enrichment.ts";
import {
  getGroqApiKey,
  transcribeWithGroqCloud,
  resolveInboundAudioMessage,
} from "./audio_transcription.ts";
import { resolveInboundImageMessage } from "./image_analysis.ts";
export { getGroqApiKey, transcribeWithGroqCloud, resolveInboundAudioMessage };
import {
  isActionableInboundMessage,
  isPureEmojiMessage,
} from "./ConversationQualityGate.ts";
import { getStaleCycleThresholdIso } from "./autopilot_cycle_safety.ts";
import { isPrivilegedOperationalRequest } from "./operational_authorization.ts";
import { brainLateRecoveryDisposition, getExistingOpenAiTurn } from "./openai_brain.ts";
import { brainOperatorAllowedOrigin } from "./brain_operator_auth.ts";
import { handleOperatorChatProgress } from "./operator_chat_progress.ts";
import {
  processOpenAiConversationSyncQueue,
} from "./openai_conversation_runtime.ts";
import { processAutopilotInboundQueue } from "./autopilot_inbound_queue.ts";
import {
  processInstagramProfileQueue,
} from "./instagram_profile_queue.ts";
import { parseInstagramReactionEvent } from "./instagram_reactions.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
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

async function hasWaitingManualBrainTurn(
  supabase: any,
  conversationId: string,
): Promise<boolean> {
  const { data, error } = await supabase
    .from("brain_turns")
    .select("id")
    .eq("conversation_id", conversationId)
    .eq("status", "waiting_manual")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) {
    console.warn("[Brain] Não foi possível confirmar waiting_manual; preservando estado por segurança.", error);
    return true;
  }
  return Boolean(data?.id);
}

async function resolveInstagramConversationId(
  supabase: any,
  rawContactId: string,
): Promise<string> {
  if (!/^\d+$/.test(rawContactId)) return rawContactId;

  try {
    const { data, error } = await supabase.rpc("resolve_instagram_conversation_id_fast", {
      p_raw_contact_id: rawContactId,
    });
    if (!error && data) return String(data);
  } catch {
    // Rollout-safe: fall through to the legacy lookup until the migration exists.
  }

  const { data: convByContact } = await supabase
    .from("instagram_conversations")
    .select("id")
    .or(`id.eq.${rawContactId},contact_id.eq.${rawContactId}`)
    .limit(1)
    .maybeSingle();
  if (convByContact?.id) return convByContact.id;

  const { data: convRow } = await supabase
    .from("instagram_messages")
    .select("conversation_id")
    .or(`sender_id.eq.${rawContactId},contact_id.eq.${rawContactId}`)
    .neq("conversation_id", rawContactId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  return convRow?.conversation_id || rawContactId;
}

async function getOpenAiApiKey(supabase: any): Promise<string | null> {
  const envKey = (Deno.env.get("OPENAI_API_KEY") || "").trim();
  if (envKey) return envKey;

  try {
    const { data } = await supabase
      .from("instagram_config")
      .select("app_secret")
      .eq("id", "openai_api_key")
      .maybeSingle();

    if (data?.app_secret?.startsWith("sk-")) {
      return data.app_secret.trim();
    }
  } catch (err) {
    console.warn("Aviso ao buscar chave da OpenAI no Supabase:", err);
  }
  return null;
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

  const operatorRouteAliases: Record<string, string> = {
    "/operator/brain/events": "/autopilot/brain-events",
    "/operator/brain/retry-failed-action": "/autopilot/retry-failed-action",
    "/operator/brain/manual-resolution": "/autopilot/manual-resolution",
    "/operator/brain/media-observation": "/autopilot/media-observation",
    "/operator/brain/consultation": "/autopilot/brain-consultation",
    "/operator/brain/retry-once": "/autopilot/retry-once",
  };
  path = operatorRouteAliases[path] || path;

  // Trata OPTIONS para CORS
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabase = getSupabaseClient();

    if (path === "/operator/session" && ["GET", "POST", "DELETE"].includes(req.method)) {
      if (!brainOperatorAllowedOrigin(req)) {
        return new Response(JSON.stringify({ authenticated: false, error: "Origem inválida." }), {
          status: 403,
          headers: { ...corsHeaders, "Content-Type": "application/json", "Cache-Control": "no-store" },
        });
      }
      return new Response(JSON.stringify({
        success: true,
        enabled: false,
        authenticated: true,
        accessToken: "public-site",
      }), {
        headers: { ...corsHeaders, "Content-Type": "application/json", "Cache-Control": "no-store" },
      });
    }

    if (path === "/operator/chat-progress" && req.method === "POST") {
      return await handleOperatorChatProgress(req, supabase, brainOperatorAllowedOrigin(req), corsHeaders);
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
        const body = await req.json().catch(() => ({}));
        const entries = body.entry || [];

        for (const entry of entries) {
          const messagingList = entry.messaging || [];
          for (const msgEvent of messagingList) {
            const senderId = msgEvent.sender?.id;
            const recipientId = msgEvent.recipient?.id;
            const message = msgEvent.message;
            const readEvent = msgEvent.read;

            // 1. READ RECEIPT: resolução + updates em uma única transação.
            if (readEvent && senderId) {
              const rawContactId = senderId;
              const watermark = readEvent.watermark || msgEvent.timestamp || Date.now();
              const seenAtIso = new Date(watermark).toISOString();

              try {
                const { data: seenResult, error: seenError } = await supabase.rpc(
                  "mark_instagram_seen_atomic",
                  {
                    p_raw_contact_id: rawContactId,
                    p_seen_at: seenAtIso,
                  },
                );

                if (seenError || seenResult?.success !== true) {
                  console.warn(
                    "[Webhook] mark_instagram_seen_atomic falhou:",
                    seenError || seenResult,
                  );
                } else {
                  const conversationId = String(seenResult.conversation_id || rawContactId);

                  // A conversa já atualiza via postgres_changes. Este único broadcast
                  // existe para refletir status seen nas mensagens, cuja assinatura
                  // atual da UI não escuta UPDATE.
                  const seenBroadcast = (async () => {
                    try {
                      const channel = supabase.channel("vendeo_realtime_chat");
                      await channel.send({
                        type: "broadcast",
                        event: "instagram_seen",
                        payload: {
                          conversationId,
                          watermark,
                          seenAt: seenAtIso,
                        },
                      });
                    } catch {
                      // O estado canônico já está persistido no PostgreSQL.
                    }
                  })();

                  if (typeof (globalThis as any).EdgeRuntime?.waitUntil === "function") {
                    (globalThis as any).EdgeRuntime.waitUntil(seenBroadcast);
                  } else {
                    void seenBroadcast;
                  }
                }
              } catch (seenException) {
                console.warn("[Webhook] read receipt exception:", seenException);
              }

              continue;
            }

            // 2. MESSAGE REACTION: contexto leve. Não vira mensagem nem dispara turno do Brain.
            const parsedReaction = parseInstagramReactionEvent(msgEvent);
            if (parsedReaction) {
              try {
                const { data: reactionResult, error: reactionError } = await supabase.rpc(
                  "apply_instagram_message_reaction_atomic",
                  {
                    p_message_id: parsedReaction.messageId,
                    p_sender_id: parsedReaction.senderId,
                    p_emoji: parsedReaction.emoji,
                    p_action: parsedReaction.action,
                    p_reacted_at: parsedReaction.reactedAt,
                  },
                );

                if (reactionError || reactionResult?.success !== true) {
                  console.warn(
                    "[Webhook] apply_instagram_message_reaction_atomic falhou:",
                    reactionError || reactionResult,
                  );
                } else if (reactionResult?.ignored !== true) {
                  const conversationId = String(reactionResult.conversation_id || "");
                  const reactionBroadcast = (async () => {
                    try {
                      const channel = supabase.channel("vendeo_realtime_chat");
                      await channel.send({
                        type: "broadcast",
                        event: "instagram_reaction",
                        payload: {
                          conversationId,
                          messageId: parsedReaction.messageId,
                          senderId: parsedReaction.senderId,
                          action: parsedReaction.action,
                          emoji: parsedReaction.emoji,
                          reactedAt: parsedReaction.reactedAt,
                        },
                      });
                    } catch {
                      // A reação já está persistida; broadcast é somente projeção de UI.
                    }
                  })();

                  if (typeof (globalThis as any).EdgeRuntime?.waitUntil === "function") {
                    (globalThis as any).EdgeRuntime.waitUntil(reactionBroadcast);
                  } else {
                    void reactionBroadcast;
                  }
                }
              } catch (reactionException) {
                console.warn("[Webhook] reaction exception:", reactionException);
              }

              continue;
            }

            if (!message) continue;

            const isEcho = Boolean(message.is_echo);
            const rawContactId = isEcho ? recipientId : senderId;
            if (!rawContactId) continue;

            // Mapeia IGSID numérico para a thread real sem repetir scans REST no hot path.
            const conversationId = await resolveInstagramConversationId(supabase, rawContactId);
            const messageId = message.mid || `msg_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;

            let text = message.text || "";
            const isAudioMsg =
              Boolean(message.is_unsupported) ||
              message.attachments?.some((a: any) => a.type === "audio" || a.mime_type?.includes("audio"));

            let audioUrl: string | undefined;
            let imageUrl: string | undefined;
            let videoUrl: string | undefined;

            if (isAudioMsg) {
              const firstAtt = message.attachments?.[0];
              const rawAudioUrl = firstAtt?.payload?.url || firstAtt?.file_url;

              if (rawAudioUrl) {
                // Inbound fica no hot path apenas com a URL da Meta. O worker
                // durável persiste no Vault e transcreve fora do webhook.
                if (!isEcho) {
                  audioUrl = rawAudioUrl;
                } else if (rawAudioUrl.includes("lookaside.fbsbx.com") || rawAudioUrl.includes("cdninstagram.com")) {
                  try {
                    const audioRes = await fetch(rawAudioUrl, { signal: AbortSignal.timeout(15_000) });
                    if (audioRes.ok) {
                      const audioBytes = await audioRes.arrayBuffer();
                      const safeMessageId = messageId.replace(/[^a-zA-Z0-9_-]/g, "_");
                      const fileName = `echo_voice_${safeMessageId}.mp4`;
                      const contentType = audioRes.headers.get("content-type") || "video/mp4";

                      const { data: upData, error: upErr } = await supabase.storage
                        .from("vendeo_vault")
                        .upload(fileName, audioBytes, { contentType, upsert: true });

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
                    console.error("Erro ao persistir áudio echo da CDN no Supabase Storage:", err);
                    audioUrl = rawAudioUrl;
                  }
                } else {
                  audioUrl = rawAudioUrl;
                }
              }

              text = audioUrl ? `[audio:${audioUrl}]` : "🎙️ Mensagem de voz";
            } else if (!text && message.attachments && message.attachments.length > 0) {
              const att = message.attachments[0];
              if (att.type === "image" && att.payload?.url) {
                imageUrl = att.payload.url;
                text = `[image:${imageUrl}]`;
              } else if (att.type === "video" && att.payload?.url) {
                videoUrl = att.payload.url;
                text = `[video:${videoUrl}]`;
              }
            }

            const timestamp = msgEvent.timestamp
              ? new Date(msgEvent.timestamp).toISOString()
              : new Date().toISOString();

            const previewText = isAudioMsg
              ? "🎙️ Mensagem de voz"
              : imageUrl
              ? "📷 Foto"
              : videoUrl
              ? "🎬 Vídeo"
              : text;
            const replyToMid =
              message.reply_to?.mid ||
              message.reply_to?.id ||
              (typeof message.reply_to === "string" ? message.reply_to : null) ||
              null;

            // Conversa/mensagem/filas serão persistidas atomicamente abaixo.
            // O echo de áudio pode fazer persistência/transcrição externa antes disso.

            let audioTranscript: string | null = null;
            let audioTranscriptionError: string | null = null;
            let shouldTranscribeAudio = true;
            if (isEcho && isAudioMsg) {
              try {
                const { data: existingOpenAiReceipt } = await supabase
                  .from("openai_message_receipts")
                  .select("openai_item_id, synced_at")
                  .eq("provider_message_id", messageId)
                  .maybeSingle();
                shouldTranscribeAudio = !(existingOpenAiReceipt?.openai_item_id && existingOpenAiReceipt?.synced_at);
              } catch {
                shouldTranscribeAudio = true;
              }
            }
            if (isEcho && isAudioMsg && audioUrl && shouldTranscribeAudio) {
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

            const inboundIsActionable = !isEcho && isActionableInboundMessage({
              text,
              mediaType: isAudioMsg ? "audio" : imageUrl ? "image" : videoUrl ? "video" : undefined,
              audioTranscript,
            });

            if (!isEcho) {
              try {
                const { data, error: inboundRpcErr } = await supabase.rpc(
                  "ingest_instagram_inbound_atomic",
                  {
                    p_conversation_id: conversationId,
                    p_raw_contact_id: rawContactId,
                    p_message_id: messageId,
                    p_sender_id: senderId,
                    p_text: text,
                    p_timestamp: timestamp,
                    p_preview_text: previewText,
                    p_media_url: audioUrl || imageUrl || videoUrl || null,
                    p_media_type: isAudioMsg ? "audio" : imageUrl ? "image" : videoUrl ? "video" : null,
                    p_reply_to_message_id: replyToMid,
                    p_audio_transcript: audioTranscript,
                    p_audio_transcription_error: audioTranscriptionError,
                    p_actionable: inboundIsActionable,
                  }
                );
                if (inboundRpcErr || !data?.success) {
                  console.error(
                    `[Webhook] ingest_instagram_inbound_atomic falhou (fail-closed): conv=${conversationId} msg=${messageId}`,
                    inboundRpcErr || data
                  );
                  // Não confirme para a Meta um evento que ainda não foi persistido.
                  // A RPC é idempotente por message id, então a redelivery pode
                  // repetir com segurança as mensagens anteriores do mesmo lote.
                  return new Response(JSON.stringify({ error: "inbound_persistence_unavailable", retryable: true }), {
                    status: 503,
                    headers: { ...corsHeaders, "Content-Type": "application/json", "Cache-Control": "no-store" },
                  });
                }
                if (
                  data?.eligible_after_activation === true &&
                  inboundIsActionable &&
                  data?.queued !== true
                ) {
                  console.warn(
                    `[Webhook] inbound persistida sem job da fila; cron legado poderá recuperar conv=${conversationId} msg=${messageId}`,
                    data,
                  );
                }
              } catch (rErr) {
                console.error(
                  `[Webhook] ingest_instagram_inbound_atomic exception (fail-closed): conv=${conversationId} msg=${messageId}`,
                  rErr
                );
                return new Response(JSON.stringify({ error: "inbound_persistence_unavailable", retryable: true }), {
                  status: 503,
                  headers: { ...corsHeaders, "Content-Type": "application/json", "Cache-Control": "no-store" },
                });
              }
            } else {
              // Echo: conversa + mensagem + filas em uma única transação.
              try {
                const { data: echoResult, error: echoSaveErr } = await supabase.rpc(
                  "ingest_instagram_echo_atomic",
                  {
                    p_conversation_id: conversationId,
                    p_raw_contact_id: rawContactId,
                    p_message_id: messageId,
                    p_text: text,
                    p_timestamp: timestamp,
                    p_preview_text: previewText,
                    p_media_url: audioUrl || imageUrl || videoUrl || null,
                    p_media_type: isAudioMsg ? "audio" : imageUrl ? "image" : videoUrl ? "video" : null,
                    p_reply_to_message_id: replyToMid,
                    p_audio_transcript: audioTranscript,
                    p_audio_transcription_error: audioTranscriptionError,
                  },
                );
                if (echoSaveErr || echoResult?.success !== true) {
                  console.error(
                    "[Webhook] ingest_instagram_echo_atomic falhou:",
                    echoSaveErr || echoResult,
                  );
                }
              } catch (echoException) {
                console.error("[Webhook] Echo persistence exception:", echoException);
              }
            }

            // Inbound já chega à UI por postgres_changes:
            // instagram_messages INSERT + instagram_conversations INSERT/UPDATE.
            // Não duplicamos esse tráfego com broadcast por mensagem.
            //
            // Echo é a exceção: o upsert pode virar UPDATE de mensagem, enquanto a
            // assinatura atual da UI escuta INSERT. Mantemos apenas esse evento,
            // fora do hot path da resposta do webhook.
            if (isEcho) {
              const echoBroadcast = (async () => {
                try {
                  const realtimeChannel = supabase.channel("vendeo_realtime_chat");
                  await realtimeChannel.send({
                    type: "broadcast",
                    event: "instagram_message",
                    payload: {
                      id: messageId,
                      conversationId,
                      senderId: "me",
                      text,
                      timestamp,
                      isMine: true,
                      status: "sent",
                      mediaUrl: audioUrl || imageUrl || videoUrl,
                      mediaType: isAudioMsg ? "audio" : imageUrl ? "image" : videoUrl ? "video" : undefined,
                      replyToMessageId: replyToMid,
                    },
                  });
                } catch (broadcastError) {
                  console.warn("[Webhook] Echo broadcast falhou:", broadcastError);
                }
              })();

              if (typeof (globalThis as any).EdgeRuntime?.waitUntil === "function") {
                (globalThis as any).EdgeRuntime.waitUntil(echoBroadcast);
              } else {
                void echoBroadcast;
              }
            }

            // Inbound texto/imagem e echo já enfileiram OpenAI sync dentro
            // das respectivas transações SQL. Áudio inbound espera transcrição no worker.

            // O Brain não roda no webhook. A admissão atômica acima criou/atualizou
            // o job durável; o worker com backpressure processa fora desta requisição.
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
      const pageSize = 1000;
      const data: any[] = [];
      let error: any = null;

      for (let from = 0; ; from += pageSize) {
        const page = await supabase
          .from("instagram_conversations")
          .select("id, username, full_name, avatar, last_message, last_message_at, last_direction, last_status, seen_at, unread, status, is_restricted, current_stage_id, is_converted, ai_auto_respond, created_at, updated_at")
          .neq("status", "vault")
          .neq("status", "system")
          .order("last_message_at", { ascending: false, nullsFirst: false })
          .range(from, from + pageSize - 1);

        if (page.error) {
          error = page.error;
          break;
        }

        data.push(...(page.data || []));
        if (!page.data || page.data.length < pageSize) break;
      }

      if (error) {
        return new Response(
          JSON.stringify({ conversations: [], error: error.message || "instagram_conversations_snapshot_failed" }),
          {
            status: 503,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          }
        );
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
          currentStageId: c.current_stage_id || null,
          isConverted: Boolean(c.is_converted),
          aiAutoRespond: Boolean(c.ai_auto_respond),
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
        let { data, error } = await supabase
          .from("instagram_messages")
          .select("id, conversation_id, sender_id, text, timestamp, is_mine, status, seen_at, deliver_at, reply_to_message_id, media_url, media_type, audio_transcript")
          .or(`conversation_id.eq.${conversationId},contact_id.eq.${conversationId}`)
          .order("timestamp", { ascending: false })
          .limit(150);

        if (data && data.length > 0) {
          data = data.reverse();
        }

        const urlObj = new URL(req.url);
        const forceSync = urlObj.searchParams.get("sync") === "true" || urlObj.searchParams.get("sync") === "1";
        const shouldSyncWithMeta = forceSync;

        // A abertura do chat serve o cache do Supabase. Meta só é consultada
        // quando a pessoa solicita uma sincronização manual.
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
                      .select("id, conversation_id, sender_id, text, timestamp, is_mine, status, seen_at, deliver_at, reply_to_message_id, media_url, media_type, audio_transcript")
                      .or(`conversation_id.eq.${conversationId},contact_id.eq.${conversationId}`)
                      .order("timestamp", { ascending: true })
                      .limit(150);
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
            audioTranscript: m.audio_transcript || undefined,
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

    // ==========================================
    // 8.5. CONFIGURAÇÃO DO OPENAI BRAIN (/ai/openai-config)
    // A chave nunca é devolvida ao browser. O modelo é aplicado no Agent remoto único.
    // ==========================================
    if (path === "/ai/openai-config") {
      const allowedModels = ["gpt-6-luna", "gpt-6-sol", "gpt-6.1-sol"] as const;
      // Valores suportados pelos modelos GPT-6 do Brain; `max` é o teto de esforço.
      const allowedReasoningEfforts = ["none", "low", "medium", "high", "xhigh", "max"] as const;
      const allowedVerbosityLevels = ["low", "medium", "high"] as const;
      const labels: Record<string, string> = {
        "gpt-6-luna": "GPT-6 Luna",
        "gpt-6-sol": "GPT-6 Sol",
        "gpt-6.1-sol": "GPT-6.1 Sol",
      };
      const { data: configRows, error: configError } = await supabase
        .from("instagram_config")
        .select("id, app_secret")
        .in("id", ["openai_api_key", "openai_brain_model", "openai_brain_agent_id"]);
      if (configError) return new Response(JSON.stringify({ error: configError.message }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      const configs = new Map((configRows || []).map((row: any) => [row.id, String(row.app_secret || "").trim()]));
      const apiKey = (Deno.env.get("OPENAI_API_KEY") || configs.get("openai_api_key") || "").trim();
      const agentId = (Deno.env.get("OPENAI_BRAIN_AGENT_ID") || configs.get("openai_brain_agent_id") || "agent_aa96ea5a95c04c8895e310e69cb27dd9279dbdf7ea0e4d8482").trim();
      const mask = (key: string) => key ? `${key.slice(0, 7)}...${key.slice(-4)}` : null;
      if (!apiKey) return new Response(JSON.stringify({ configured: false, maskedKey: null, model: null, modelLabel: null }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
      const agentUrl = `https://api.openai.com/v1/agents/${agentId}`;
      const agentHeaders = { Authorization: `Bearer ${apiKey}`, "OpenAI-Beta": "agents=v1" };
      const getAgent = () => fetch(agentUrl, { headers: agentHeaders });

      if (req.method === "GET") {
        const remote = await getAgent();
        if (!remote.ok) return new Response(JSON.stringify({ error: `Falha ao consultar Agent remoto (${remote.status})` }), { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } });
        const agent = await remote.json();
        const model = String(agent.model || configs.get("openai_brain_model") || "").trim() || null;
        const reasoningEffort = allowedReasoningEfforts.includes(agent.reasoning?.effort) ? agent.reasoning.effort : null;
        const verbosity = allowedVerbosityLevels.includes(agent.text?.verbosity) ? agent.text.verbosity : null;
        const modelLabel = model ? labels[model] || model : null;
        return new Response(JSON.stringify({ configured: true, maskedKey: mask(apiKey), model, modelLabel, reasoningEffort, verbosity }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }

      if (req.method === "PUT") {
        const body = await req.json().catch(() => ({}));
        const hasModel = body?.model !== undefined;
        const hasReasoningEffort = body?.reasoningEffort !== undefined;
        const hasVerbosity = body?.verbosity !== undefined;
        if (!hasModel && !hasReasoningEffort && !hasVerbosity && typeof body?.apiKey !== "string") return new Response(JSON.stringify({ error: "Nenhuma configuração foi informada." }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
        const model = hasModel ? body.model : undefined;
        const reasoningEffort = hasReasoningEffort ? body.reasoningEffort : undefined;
        const verbosity = hasVerbosity ? body.verbosity : undefined;
        if (hasModel && !allowedModels.includes(model)) return new Response(JSON.stringify({ error: "Modelo OpenAI inválido. Escolha GPT-6 Luna, GPT-6 Sol ou GPT-6.1 Sol." }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
        if (hasReasoningEffort && !allowedReasoningEfforts.includes(reasoningEffort)) return new Response(JSON.stringify({ error: "Reasoning effort inválido. Escolha none, low, medium, high, xhigh ou max." }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
        if (hasVerbosity && !allowedVerbosityLevels.includes(verbosity)) return new Response(JSON.stringify({ error: "Verbosity inválida. Escolha low, medium ou high (máxima)." }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
        const suppliedKey = typeof body?.apiKey === "string" ? body.apiKey.trim() : "";
        const effectiveKey = suppliedKey || apiKey;
        if (!effectiveKey) return new Response(JSON.stringify({ error: "Configure a chave da API OpenAI antes de escolher o modelo." }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
        const currentResponse = await fetch(agentUrl, { headers: { Authorization: `Bearer ${effectiveKey}`, "OpenAI-Beta": "agents=v1" } });
        if (!currentResponse.ok) return new Response(JSON.stringify({ error: `Falha ao consultar Agent remoto (${currentResponse.status})` }), { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } });
        const currentAgent = await currentResponse.json();
        const targetModel = model || currentAgent.model;
        const targetReasoningEffort = reasoningEffort || currentAgent.reasoning?.effort;
        const targetVerbosity = verbosity || currentAgent.text?.verbosity;
        if (targetModel === "gpt-6.1-sol" && targetReasoningEffort === "none") {
          return new Response(JSON.stringify({
            error: "GPT-6.1 Sol não suporta reasoning none. Escolha low, medium, high, xhigh ou max.",
          }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
        }
        const remotePatch: Record<string, any> = {};
        if (hasModel) remotePatch.model = model;
        if (hasReasoningEffort) remotePatch.reasoning = { ...(currentAgent.reasoning || {}), effort: reasoningEffort };
        if (hasVerbosity) remotePatch.text = { ...(currentAgent.text || {}), verbosity };
        let updatedAgent = currentAgent;
        if (Object.keys(remotePatch).length > 0) {
          const updateResponse = await fetch(agentUrl, {
            method: "POST",
            headers: { Authorization: `Bearer ${effectiveKey}`, "Content-Type": "application/json", "OpenAI-Beta": "agents=v1" },
            body: JSON.stringify(remotePatch),
          });
          if (!updateResponse.ok) return new Response(JSON.stringify({ error: `Falha ao atualizar a configuração do Agent remoto (${updateResponse.status})` }), { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } });
          updatedAgent = await updateResponse.json();
          if ((hasModel && updatedAgent.model !== model) || (hasReasoningEffort && updatedAgent.reasoning?.effort !== reasoningEffort) || (hasVerbosity && updatedAgent.text?.verbosity !== verbosity)) return new Response(JSON.stringify({ error: "O Agent remoto não confirmou toda a configuração selecionada" }), { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } });
        }
        const writes = [];
        if (hasModel) writes.push(supabase.from("instagram_config").upsert({ id: "openai_brain_model", app_secret: model, updated_at: new Date().toISOString() }));
        if (hasReasoningEffort) writes.push(supabase.from("instagram_config").upsert({ id: "openai_brain_reasoning_effort", app_secret: reasoningEffort, updated_at: new Date().toISOString() }));
        if (hasVerbosity) writes.push(supabase.from("instagram_config").upsert({ id: "openai_brain_verbosity", app_secret: verbosity, updated_at: new Date().toISOString() }));
        const writeResults = await Promise.all(writes);
        const writeError = writeResults.find((result: any) => result.error)?.error;
        if (writeError) return new Response(JSON.stringify({ error: writeError.message }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
        if (suppliedKey) {
          const keyWrite = await supabase.from("instagram_config").upsert({ id: "openai_api_key", app_secret: suppliedKey, updated_at: new Date().toISOString() });
          if (keyWrite.error) return new Response(JSON.stringify({ error: keyWrite.error.message }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
        }
        const finalModel = updatedAgent.model || targetModel;
        const modelLabel = finalModel ? labels[finalModel] || finalModel : null;
        return new Response(JSON.stringify({ success: true, configured: true, maskedKey: mask(effectiveKey), model: finalModel, modelLabel, reasoningEffort: updatedAgent.reasoning?.effort || targetReasoningEffort || null, verbosity: updatedAgent.text?.verbosity || targetVerbosity || null }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
    }

    // ==========================================
    // 8.6. REFERÊNCIAS CANÔNICAS DE PERSONA (/ai/persona-references)
    // ==========================================
    if (path === "/ai/persona-references") {
      if (req.method === "GET") {
        const { data: refs, error: refsErr } = await supabase
          .from("ai_persona_references")
          .select("*")
          .order("created_at", { ascending: false });

        if (refsErr) {
          return new Response(JSON.stringify({ error: refsErr.message }), {
            status: 500,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }

        return new Response(JSON.stringify({ success: true, references: refs || [] }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }


    // ==========================================
    // 8.5. AUTOPILOT: CRON TICK ASSÍNCRONO (/autopilot/cron-tick)
    // Acionado pelo pg_cron a cada 15s. O tick rápido só reivindica trabalho devido;
    // manutenção pesada é limitada pelas scheduler lanes.
    // ==========================================
    if ((path === "/autopilot/cron-tick" || path === "/api/autopilot/cron-tick") && (req.method === "POST" || req.method === "GET")) {
      try {
        const nowIso = new Date().toISOString();
        console.log(`[TRACE-AUTOPILOT] cron:tick check at ${nowIso}`);

        // Worker durável do inbound: reivindica poucos jobs por tick. O trabalho
        // pesado roda fora do webhook; leases recuperam qualquer worker encerrado.
        let inboundQueueAvailable = false;
        let inboundQueueClaimed = 0;
        try {
          const inboundQueue = await processAutopilotInboundQueue({
            supabase,
            limit: 3,
          });
          inboundQueueAvailable = true;
          inboundQueueClaimed = inboundQueue.claimed;
          if (inboundQueue.claimed > 0) {
            console.log(`[Inbound Queue] cron:tick claimed=${inboundQueue.claimed}`);
          }
        } catch (inboundQueueError) {
          // O scheduler legado abaixo permanece como recuperação durante o rollout.
          console.error("[Inbound Queue] Falha ao reivindicar jobs:", inboundQueueError);
        }

        // Recovery técnico não precisa rodar 4x/min. O claim é atômico no banco,
        // então cron ticks sobrepostos não duplicam a manutenção.
        let runMaintenance = true;
        try {
          const { data: maintenanceLane, error: maintenanceLaneError } = await supabase.rpc(
            "claim_autopilot_scheduler_lane",
            { p_lane: "brain_maintenance", p_min_interval_seconds: 60 },
          );
          if (maintenanceLaneError || maintenanceLane?.success !== true) {
            console.warn("[AutoPilot Scheduler] Lane de manutenção indisponível; usando fallback compatível.", maintenanceLaneError || maintenanceLane);
          } else {
            runMaintenance = maintenanceLane.acquired === true;
          }
        } catch (maintenanceLaneError) {
          console.warn("[AutoPilot Scheduler] Falha no claim da lane; usando fallback compatível.", maintenanceLaneError);
        }

        // OpenAI Conversation é uma lane de baixa prioridade. O histórico continua
        // durável, mas a sync não compete com webhook/Brain em todo tick de 15s.
        let runOpenAiSync = true;
        try {
          const { data: openAiLane, error: openAiLaneError } = await supabase.rpc(
            "claim_autopilot_scheduler_lane",
            { p_lane: "openai_conversation_sync", p_min_interval_seconds: 30 },
          );
          if (!openAiLaneError && openAiLane?.success === true) {
            runOpenAiSync = openAiLane.acquired === true;
          }
        } catch {
          // Durante rollout da migration, mantém compatibilidade.
          runOpenAiSync = true;
        }

        if (runOpenAiSync) {
          const openAiSyncPromise = processOpenAiConversationSyncQueue({
            supabase,
            limit: 25,
          }).catch((syncErr) => {
            console.warn("[OpenAI Sync Queue] cron:tick falhou:", syncErr);
          });
          if (typeof (globalThis as any).EdgeRuntime?.waitUntil === "function") {
            (globalThis as any).EdgeRuntime.waitUntil(openAiSyncPromise);
          } else {
            void openAiSyncPromise;
          }
        }

        // Enriquecimento de perfil é best-effort e de baixa prioridade.
        // Nunca compete com cada tick do inbound/Brain.
        let runProfileEnrichment = true;
        try {
          const { data: profileLane, error: profileLaneError } = await supabase.rpc(
            "claim_autopilot_scheduler_lane",
            { p_lane: "instagram_profile_enrichment", p_min_interval_seconds: 60 },
          );
          if (!profileLaneError && profileLane?.success === true) {
            runProfileEnrichment = profileLane.acquired === true;
          }
        } catch {
          runProfileEnrichment = true;
        }

        if (runProfileEnrichment) {
          const profilePromise = processInstagramProfileQueue({
            supabase,
            resolveProfile: resolveInstagramContactProfile,
            limit: 2,
          }).catch((profileError) => {
            console.warn("[Instagram Profile Queue] cron:tick falhou:", profileError);
          });
          if (typeof (globalThis as any).EdgeRuntime?.waitUntil === "function") {
            (globalThis as any).EdgeRuntime.waitUntil(profilePromise);
          } else {
            void profilePromise;
          }
        }

        if (runMaintenance) {
          // Recovery dedicado: reivindica brain_late com lease e consulta somente o
          // provider_turn_id existente. Turnos ativos ficam intactos; nenhum POST
          // ao provider é feito por este scanner.
          const recoveryWorkerToken = crypto.randomUUID();
        const { data: lateTurns, error: lateClaimError } = await supabase.rpc("claim_brain_late_turns", {
          p_worker_token: recoveryWorkerToken,
          p_limit: 5,
          p_lease_seconds: 300,
        });
        if (lateClaimError) {
          console.error("[Brain recovery] Falha ao reivindicar turnos tardios:", lateClaimError);
        } else {
          for (const lateTurn of lateTurns || []) {
            const releaseLateTurn = async (status = "brain_late") => supabase.rpc("release_brain_late_turn", {
              p_turn_id: lateTurn.id,
              p_worker_token: recoveryWorkerToken,
              p_status: status,
            });
            const finishRecoveredTurnLease = async (restoreForRetry: boolean) => {
              const patch: Record<string, unknown> = {
                recovery_lease_token: null,
                recovery_lease_expires_at: null,
                updated_at: new Date().toISOString(),
              };
              if (restoreForRetry) patch.status = "brain_late";

              let update = supabase.from("brain_turns")
                .update(patch)
                .eq("id", lateTurn.id)
                .eq("recovery_lease_token", recoveryWorkerToken);
              if (restoreForRetry) {
                update = update.in("status", ["brain_late", "executing"]);
              }
              const { error: finishError } = await update;
              if (finishError) {
                console.error(
                  `[Brain recovery] Falha ao finalizar lease do turno ${lateTurn.id} (restoreForRetry=${restoreForRetry}):`,
                  finishError,
                );
              }
            };
            try {
              if (!lateTurn.provider_turn_id || !lateTurn.session_id || !Array.isArray(lateTurn.inbound_message_ids)) {
                await releaseLateTurn("failed_technical");
                continue;
              }
              const { data: sessionRow, error: sessionError } = await supabase.from("brain_sessions")
                .select("provider_session_id")
                .eq("id", lateTurn.session_id)
                .maybeSingle();
              if (sessionError || !sessionRow?.provider_session_id) throw new Error("late_session_reference_missing");
              const apiKey = await getOpenAiApiKey(supabase);
              if (!apiKey) throw new Error("openai_api_key_unavailable");
              const existing = await getExistingOpenAiTurn({
                apiKey,
                sessionId: sessionRow.provider_session_id,
                turnId: lateTurn.provider_turn_id,
              });
              const disposition = brainLateRecoveryDisposition(existing.status);
              if (disposition !== "recover") {
                if (disposition === "fail") await releaseLateTurn("failed_technical");
                else await releaseLateTurn("brain_late");
                continue;
              }

              const { data: originalMessages, error: messagesError } = await supabase.from("instagram_messages")
                .select("id, text, timestamp, created_at, sender_id, media_type, audio_transcript")
                .eq("conversation_id", lateTurn.conversation_id)
                .in("id", lateTurn.inbound_message_ids);
              if (messagesError || !originalMessages?.length) throw new Error("late_turn_inbounds_missing");
              const original = originalMessages.sort((a: any, b: any) =>
                String(a.created_at || a.timestamp || "").localeCompare(String(b.created_at || b.timestamp || ""))
              ).at(-1);
              const resolvedAudio = await resolveInboundAudioMessage(supabase, original);
              // O próprio orquestrador persiste a decisão e outbox de forma atômica.
              // Se houver inbound novo, o dispatcher valida o ledger e bloqueia o
              // envio até o Brain revisar as ações pendentes no ciclo correspondente.
              const recovery = await runBrainOrchestration({
                supabase,
                conversationId: lateTurn.conversation_id,
                newMessage: {
                  id: original.id,
                  text: resolvedAudio.text,
                  timestamp: original.timestamp || original.created_at,
                  sender: original.sender_id || "them",
                  mediaType: resolvedAudio.isAudio ? "audio" : original.media_type,
                  audioTranscript: resolvedAudio.hasValidTranscript ? resolvedAudio.transcript : original.audio_transcript,
                } as any,
              });
              if (!recovery.handled || recovery.error) {
                console.warn(`[Brain recovery] Turno ${lateTurn.id} continua recuperável: ${recovery.error || "recovery_not_handled"}`);
                await finishRecoveredTurnLease(true);
              } else {
                await finishRecoveredTurnLease(false);
              }
            } catch (recoveryError) {
              console.error(`[Brain recovery] Falha no turno ${lateTurn.id}:`, recoveryError);
              await finishRecoveredTurnLease(true);
            }
          }
        }
        }

        // 0. Entrega durável independente do toggle global.
        // O caminho normal usa brain_decision_actions indexada; não varre o JSON
        // de todas as conversas a cada tick.
        try {
          const { data: dueOutboxConvs, error: dueOutboxError } = await supabase.rpc(
            "list_due_brain_action_conversations",
            { p_now: nowIso, p_limit: 6 },
          );
          if (dueOutboxError) throw dueOutboxError;

          const dueConversationIds = (dueOutboxConvs || [])
            .map((row: any) => String(row?.conversation_id || ""))
            .filter(Boolean);

          if (dueConversationIds.length > 0) {
            const dispatchPromise = Promise.allSettled(
              dueConversationIds.map((conversationId: string) =>
                runDurableOutboxDispatcher({ supabase, conversationId })
              ),
            );
            if (typeof (globalThis as any).EdgeRuntime?.waitUntil === "function") {
              (globalThis as any).EdgeRuntime.waitUntil(dispatchPromise);
            } else {
              void dispatchPromise;
            }
          }

          // Recuperação compatível para outboxes históricos sem action row.
          // É uma lane rara; não volta a transformar JSON em hot path.
          if (runMaintenance) {
            let runLegacyOutboxRecovery = false;
            try {
              const { data: legacyLane, error: legacyLaneError } = await supabase.rpc(
                "claim_autopilot_scheduler_lane",
                { p_lane: "legacy_outbox_recovery", p_min_interval_seconds: 300 },
              );
              runLegacyOutboxRecovery =
                !legacyLaneError && legacyLane?.success === true && legacyLane?.acquired === true;
            } catch {
              runLegacyOutboxRecovery = false;
            }

            if (runLegacyOutboxRecovery) {
              const { data: legacyOutboxConvs, error: legacyOutboxError } = await supabase.rpc(
                "list_legacy_outbox_conversations",
                { p_limit: 5 },
              );
              if (legacyOutboxError) throw legacyOutboxError;

              const legacyIds = (legacyOutboxConvs || [])
                .map((row: any) => String(row?.conversation_id || ""))
                .filter(Boolean);

              if (legacyIds.length > 0) {
                const legacyDispatch = Promise.allSettled(
                  legacyIds.map((conversationId: string) =>
                    runDurableOutboxDispatcher({ supabase, conversationId })
                  ),
                );
                if (typeof (globalThis as any).EdgeRuntime?.waitUntil === "function") {
                  (globalThis as any).EdgeRuntime.waitUntil(legacyDispatch);
                } else {
                  void legacyDispatch;
                }
              }
            }
          }
        } catch (outboxTickErr: any) {
          console.warn(
            "[Cloud AutoPilot] cron:tick erro ao descobrir/despachar outbox normalizada:",
            outboxTickErr?.message || outboxTickErr,
          );
        }

        // 1. Só depois da entrega durável, o toggle global decide se NOVAS inferências podem rodar.
        const { data: configRow } = await supabase
          .from("autopilot_settings")
          .select("config")
          .eq("id", "global")
          .single();
        const apConfig = configRow?.config || {};
        const isEnabledGlobally = apConfig?.isEnabledGlobally !== false;

        if (!isEnabledGlobally) {
          console.log("[Cloud AutoPilot] cron:tick em modo OFF global: sem novos ciclos; apenas drenagem/recuperação.");

          // Recovery técnico fica na lane lenta mesmo com global OFF.
          // A finalização de chats em draining continua a cada tick abaixo.
          if (runMaintenance) {
            try {
              const { error: staleDrainError } = await supabase.rpc(
                "recover_stale_experimental_cycles_atomic",
                { p_stale_before: getStaleCycleThresholdIso(), p_limit: 10 },
              );
              if (staleDrainError) {
                console.warn("[Cloud AutoPilot] recovery stale durante drenagem global falhou:", staleDrainError.message);
              }
            } catch (staleDrainError) {
              console.warn("[Cloud AutoPilot] recovery stale durante drenagem global lançou exceção:", staleDrainError);
            }
          }

          const { data: finalizedDrains, error: finalizedDrainsError } = await supabase.rpc(
            "finalize_all_pending_autopilot_disables_atomic"
          );
          if (finalizedDrainsError) {
            console.warn("[Cloud AutoPilot] finalização de drenagens globais falhou:", finalizedDrainsError.message);
          }

          if (runMaintenance) {
            await supabase
              .from("instagram_conversations")
              .update({ ai_debounce_until: null })
              .not("ai_debounce_until", "is", null);
          }

          return new Response(JSON.stringify({
            success: true,
            message: "Piloto desativado globalmente. Nenhum ciclo novo será iniciado.",
            processedCount: 0,
            drainedChats: finalizedDrains?.disabled || 0,
          }), {
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }

        // Auto-recuperação atômica de ciclos stale é manutenção, não hot path.
        if (runMaintenance) {
          try {
            const staleThresholdIso = getStaleCycleThresholdIso();
            const { data: staleRecovery, error: staleRecoveryError } = await supabase.rpc(
              "recover_stale_experimental_cycles_atomic",
              {
                p_stale_before: staleThresholdIso,
                p_limit: 10,
              },
            );

            if (staleRecoveryError) {
              console.error("[Cloud AutoPilot] Erro na recuperação atômica de ciclos stale:", staleRecoveryError);
            } else if (staleRecovery) {
              console.log("[Cloud AutoPilot] Recuperação atômica de ciclos stale concluída:", staleRecovery);
            }
          } catch (staleErr) {
            console.error("[Cloud AutoPilot] Falha fechada na recuperação atômica de ciclos stale:", staleErr);
          }
        }

        // A fila durável é a autoridade de novas inbounds. O scanner legado só
        // roda se a infraestrutura da fila estiver indisponível durante o rollout.
        if (inboundQueueAvailable) {
          return new Response(JSON.stringify({
            success: true,
            processor: "durable_inbound_queue",
            processedCount: inboundQueueClaimed,
          }), {
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }

        // 1. FALLBACK: busca conversas prontas apenas se a fila estiver indisponível
        // durante o rollout/migração.
        // 1. Busca conversas prontas para serem respondidas cujo tempo de espera já venceu
        const { data: readyConvs, error: queryErr } = await supabase.rpc(
          "list_autopilot_due_work",
          { p_now: nowIso, p_limit: 40 },
        );

        if (queryErr) {
          console.error("[Cloud AutoPilot] Erro ao buscar conversas agendadas:", queryErr);
          return new Response(JSON.stringify({ error: queryErr.message }), {
            status: 500,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }

        // Filtro em memória seguro: garante que linhas internas de sistema (__autopilot_config__, etc.) nunca sejam processadas
        const validConvs = (readyConvs || []).filter((c: any) => typeof c.id === "string" && !c.id.startsWith("__"));
        console.log(`[TRACE-AUTOPILOT] cron:tick found ${validConvs.length} valid conversations ready.`);

        // O semaforo global dentro do Brain limita a execucao cara. O tick apenas
        // alimenta a fila em pequenos lotes para manter os slots ocupados.
        const batchConvs = validConvs.slice(0, 3);
        const processed: string[] = [];

        if (batchConvs.length > 0) {
          for (const conv of batchConvs) {
            // O claim_experimental_cycle é o CAS real. Não limpar debounce antes
            // dele: uma falha do worker deixaria a conversa sem agenda.

            // A mensagem mais recente pode já ter sido processada enquanto uma
            // inbound anterior continua pendente. Pagina apenas a janela de 48h.
            const watermark = conv.stage_completed_rules?.orchestration?.activation_watermark;
            const ledger = conv.stage_completed_rules?.orchestration?.messageLedger || {};
            let lastMsg: any = null;
            let messageOffset = 0;
            while (!lastMsg) {
              const { data: inboundPage, error: inboundError } = await supabase
                .from("instagram_messages")
                .select("id, text, timestamp, created_at, sender_id, is_mine, media_type, media_url, audio_transcript")
                .eq("conversation_id", conv.id)
                .eq("is_mine", false)
                .gte("created_at", new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString())
                .order("created_at", { ascending: false })
                .range(messageOffset, messageOffset + 99);
              if (inboundError || !inboundPage?.length) break;
              lastMsg = inboundPage.find((message: any) => {
                if (message.sender_id === "me") return false;
                if (ledger[message.id] === "processed") return false;
                if (message.id === conv.stage_completed_rules?.orchestration?.lastProcessedMessageId) return false;
                // Regra P0: Autoridade estrita por inboundRevision monotônica (Zero heurísticas temporais)
                if (watermark && typeof watermark.inboundRevision === "number") {
                  const msgRevs = conv.stage_completed_rules?.orchestration?.messageInboundRevisions;
                  const msgRev = msgRevs?.[message.id];
                  // Fail-closed: sem revisão individual não existe prova de que a mensagem
                  // foi admitida depois do watermark. Revisão global da conversa não basta.
                  if (typeof msgRev !== "number") return false;
                  if (msgRev <= watermark.inboundRevision) return false;
                }
                return true;
              });
              if (inboundPage.length < 100) break;
              messageOffset += 100;
            }

            const isFromThem = Boolean(lastMsg);

            if (isFromThem) {
              const convRules = conv.stage_completed_rules || {};
              const lastMediaType = String(lastMsg.media_type || "").toLowerCase();
              const rawLastText = String(lastMsg.text || "");
              const looksVideo = lastMediaType === "video" || rawLastText.startsWith("[video:");
              const looksImage = lastMediaType === "image" || rawLastText.startsWith("[image:");
              const operatorObservation = String(lastMsg.media_operator_observation || "").trim();

              if (looksVideo && !operatorObservation) {
                const pauseReason = `media_observation_required|video|${lastMsg.id}`;
                await supabase.rpc("set_autopilot_runtime_state_atomic", {
                  p_conversation_id: conv.id,
                  p_status: "waiting_human",
                  p_reason: pauseReason,
                  p_cancel_current_cycle: false,
                  p_clear_cancel_current_cycle: false,
                });
                await publishAutoPilotState(supabase, conv.id, {
                  status: "waiting_human",
                  pauseReason,
                  pausedAt: new Date().toISOString(),
                  activity: activity(
                    "waiting",
                    "Precisa de observação",
                    "Vídeo recebido. Assista e descreva o que é relevante para o Brain continuar.",
                    { event: "media_observation_required", mediaKind: "video", messageId: lastMsg.id },
                  ),
                  event: "media_observation_required",
                  eventMetadata: { mediaKind: "video", messageId: lastMsg.id },
                });
                processed.push(conv.id);
                continue;
              }

              let preparedText = rawLastText;
              if (looksImage) {
                const resolvedImage = await resolveInboundImageMessage(supabase, lastMsg);
                if (!resolvedImage.hasValidDescription) {
                  const pauseReason = `media_observation_required|image|${lastMsg.id}`;
                  await supabase.rpc("set_autopilot_runtime_state_atomic", {
                    p_conversation_id: conv.id,
                    p_status: "waiting_human",
                    p_reason: pauseReason,
                    p_cancel_current_cycle: false,
                    p_clear_cancel_current_cycle: false,
                  });
                  await publishAutoPilotState(supabase, conv.id, {
                    status: "waiting_human",
                    pauseReason,
                    pausedAt: new Date().toISOString(),
                    activity: activity(
                      "waiting",
                      "Precisa de observação",
                      "Não consegui interpretar a foto automaticamente. Descreva o que aparece nela para o Brain continuar.",
                      { event: "media_observation_required", mediaKind: "image", messageId: lastMsg.id },
                    ),
                    event: "media_observation_required",
                    eventMetadata: { mediaKind: "image", messageId: lastMsg.id },
                  });
                  processed.push(conv.id);
                  continue;
                }
                preparedText = resolvedImage.text;
              } else if (looksVideo) {
                preparedText = `[VÍDEO OBSERVADO PELO OPERADOR]\n${operatorObservation}`;
              }

              // BRAIN: Único orquestrador oficial (fail-closed)
              console.log(`[Brain] cron:tick roteando para Brain em ${conv.id}`);
              const resolvedAudio = await resolveInboundAudioMessage(supabase, lastMsg);
              if (resolvedAudio.isAudio) preparedText = resolvedAudio.text;

              const brainPromise = runBrainOrchestration({
                supabase,
                conversationId: conv.id,
                newMessage: {
                  id: lastMsg.id,
                  text: preparedText,
                  timestamp: lastMsg.timestamp || lastMsg.created_at,
                  sender: lastMsg.sender_id || "them",
                  mediaType: resolvedAudio.isAudio ? "audio" : (looksVideo ? "video" : (lastMsg.media_type || undefined)),
                  audioTranscript: resolvedAudio.hasValidTranscript ? resolvedAudio.transcript : (lastMsg.audio_transcript || undefined),
                },
              });

              if (typeof (globalThis as any).EdgeRuntime?.waitUntil === "function") {
                (globalThis as any).EdgeRuntime.waitUntil(brainPromise);
              } else {
                void brainPromise;
              }

              processed.push(conv.id);
            } else {
              console.log(`[Cloud AutoPilot] Conversa ${conv.id} agendada foi ignorada pois a última mensagem não é do cliente.`);
              await publishAutoPilotState(supabase, conv.id, {
                status: "idle",
                activity: null,
                scheduledResponseAt: null,
              });
              // Limpar ai_debounce_until para evitar varredura em loop infinito
              await supabase
                .from("instagram_conversations")
                .update({ ai_debounce_until: null })
                .eq("id", conv.id);
            }
          }
        }

        return new Response(JSON.stringify({ success: true, processedCount: processed.length, processed }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      } catch (err: unknown) {
        return new Response(JSON.stringify({ error: err instanceof Error ? err.message : "Erro no cron tick" }), {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    // ==========================================
    // 8.6. AUTOPILOT: GATILHO DE ATIVAÇÃO IMEDIATA (/autopilot/trigger)
    // Se a IA for ativada e a última mensagem for do pretendente sem resposta, inicia o ciclo em nuvem na hora!
    // ==========================================
    if ((path === "/autopilot/trigger" || path === "/api/autopilot/trigger") && req.method === "POST") {
      try {
        const body = await req.json().catch(() => ({}));
        const conversationId = body?.conversationId;
        if (!conversationId) {
          return new Response(JSON.stringify({ error: "conversationId é obrigatório." }), {
            status: 400,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }

        // 1. Busca a conversa para verificar o activation_watermark determinístico
        const { data: convData } = await supabase
          .from("instagram_conversations")
          .select("stage_completed_rules, ai_auto_respond")
          .eq("id", conversationId)
          .maybeSingle();

        const activationWatermark = convData?.stage_completed_rules?.orchestration?.activation_watermark;

        // 2. Busca a última mensagem registrada para esta conversa
        const { data: lastMsgs, error: msgErr } = await supabase
          .from("instagram_messages")
          .select("id, text, timestamp, created_at, sender_id, is_mine, media_type, media_url, audio_transcript")
          .eq("conversation_id", conversationId)
          .order("timestamp", { ascending: false })
          .limit(1);

        if (msgErr || !lastMsgs || lastMsgs.length === 0) {
          return new Response(JSON.stringify({ triggered: false, status: "idle", reason: "no_messages_found", detail: "Nenhuma mensagem encontrada." }), {
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }

        const lastMsg = lastMsgs[0];
        const isFromThem = !lastMsg.is_mine && lastMsg.sender_id !== "me";

        // 3. Validação determinística contra o Watermark de Ativação
        // Autoridade unicamente baseada em inboundRevision monotônica sob lock FOR UPDATE
        if (isFromThem) {
          const currentInboundRev = convData?.stage_completed_rules?.orchestration?.inboundRevision || 0;
          const watermarkRev = typeof activationWatermark?.inboundRevision === "number"
            ? activationWatermark.inboundRevision
            : null;
          const messageInboundRevisions = convData?.stage_completed_rules?.orchestration?.messageInboundRevisions || {};
          const msgRev = messageInboundRevisions[lastMsg.id];
          const isProvenPostWatermark = Boolean(
            watermarkRev === null ||
            (typeof msgRev === "number" && msgRev > watermarkRev)
          );

          const isPriorToWatermark = Boolean(
            activationWatermark &&
            watermarkRev !== null &&
            !isProvenPostWatermark
          );

          if (isPriorToWatermark) {
            console.log(`[Autopilot] activation_noop_no_new_inbound conv=${conversationId} msgRev=${typeof msgRev === "number" ? msgRev : "missing"} watermarkRev=${watermarkRev} currentRev=${currentInboundRev}`);
            return new Response(JSON.stringify({
              triggered: false,
              status: "idle",
              reason: "activation_noop_no_new_inbound",
              detail: "Autopiloto armado em espera. Nenhuma nova mensagem recebida após a ativação.",
            }), {
              headers: { ...corsHeaders, "Content-Type": "application/json" },
            });
          }

          // Se a mensagem for comprovadamente NOVA pós-ativação:
          console.log(`[Autopilot] new_inbound_after_activation conv=${conversationId} rev=${currentInboundRev} > watermarkRev=${watermarkRev}`);

          // Limpa agendamento e travas manuais antigas para que o ciclo execute imediatamente
          await supabase.from("instagram_conversations").update({ ai_debounce_until: null }).eq("id", conversationId);

          // BRAIN: Único orquestrador oficial (fail-closed)
          console.log(`[Brain] activation_trigger roteando para Brain em ${conversationId}`);
          const resolvedAudio = await resolveInboundAudioMessage(supabase, lastMsg);

          const brainPromise = runBrainOrchestration({
            supabase,
            conversationId,
            newMessage: {
              id: lastMsg.id,
              text: resolvedAudio.text,
              timestamp: lastMsg.timestamp,
              sender: lastMsg.sender_id || "them",
              mediaType: resolvedAudio.isAudio ? "audio" : (lastMsg.media_type || undefined),
              audioTranscript: resolvedAudio.hasValidTranscript ? resolvedAudio.transcript : (lastMsg.audio_transcript || undefined),
            },
          });

          if (typeof (globalThis as any).EdgeRuntime?.waitUntil === "function") {
            (globalThis as any).EdgeRuntime.waitUntil(brainPromise);
          } else {
            void brainPromise;
          }

          return new Response(JSON.stringify({
            triggered: true,
            messageId: lastMsg.id,
            status: "processing",
            detail: "Nova mensagem pós-ativação detectada. Autopiloto iniciado!",
          }), {
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }

        // Se a última mensagem for nossa, mantém apenas a projeção canônica em espera.
        await publishAutoPilotState(supabase, conversationId, {
          status: "idle",
          activity: activity(
            "waiting",
            "IA esperando responder",
            "Aguardando o cliente responder para a IA agir.",
          ),
          scheduledResponseAt: null,
        });

        return new Response(JSON.stringify({
          triggered: false,
          status: "idle",
          detail: "Última mensagem enviada por nós. IA armada aguardando resposta do pretendente.",
        }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      } catch (err: unknown) {
        return new Response(JSON.stringify({ error: err instanceof Error ? err.message : "Erro no trigger" }), {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    // Cancelamento operacional invalida somente o ciclo atual; a intenção do operador fica intacta.
    if ((path === "/autopilot/pause" || path === "/api/autopilot/pause") && req.method === "POST") {
      try {
        const body = await req.json().catch(() => ({}));
        const conversationId = body?.conversationId;
        if (!conversationId) {
          return new Response(JSON.stringify({ error: "conversationId é obrigatório." }), {
            status: 400,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }

        const source = typeof body?.source === "string" ? body.source.slice(0, 64) : "unspecified";
        console.info(JSON.stringify({ event: "autopilot_cycle_cancel_requested", conversationId, source, route: path, timestamp: new Date().toISOString() }));
        const { data: pauseRpcResult, error: pauseRpcErr } = await supabase.rpc("set_autopilot_runtime_state_atomic", {
          p_conversation_id: conversationId,
          p_status: "idle",
          p_reason: null,
          p_cancel_current_cycle: true,
          p_clear_cancel_current_cycle: false,
        });

        if (pauseRpcErr || !pauseRpcResult?.success) {
          console.error("[AutoPilot] RPC de pausa falhou; mantendo a alteração sem confirmação.", pauseRpcErr || pauseRpcResult);
          return new Response(JSON.stringify({ success: false, error: "pause_failed" }), {
            status: 503,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }

        const nowIso = new Date().toISOString();
        await publishAutoPilotState(supabase, conversationId, {
          isEnabled: pauseRpcResult.isEnabled,
          status: "idle",
          activity: activity("cancelled", "Ação cancelada", "Ciclo atual cancelado pelo operador.", { event: "cycle_cancelled" }),
          scheduledResponseAt: null,
          pendingAction: null,
        });

        return new Response(JSON.stringify({ success: true, result: "cancelled", isEnabled: pauseRpcResult.isEnabled, status: "idle", stateUpdatedAt: nowIso, detail: "Ação cancelada. A IA permanece ligada para próximas mensagens." }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      } catch (err: unknown) {
        return new Response(JSON.stringify({ error: err instanceof Error ? err.message : "Erro ao pausar" }), {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    // Rota atômica para ATIVAR OU DESATIVAR o Piloto Automático em um chat específico
    if ((path === "/autopilot/toggle-chat" || path === "/api/autopilot/toggle-chat") && req.method === "POST") {
      try {
        const body = await req.json().catch(() => ({}));
        const conversationId = body?.conversationId;
        const isEnabled = Boolean(body?.isEnabled);
        const triggerImmediate = Boolean(body?.triggerImmediate || body?.mode === "immediate");
        if (!conversationId) {
          return new Response(JSON.stringify({ error: "conversationId é obrigatório." }), {
            status: 400,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }

        let immediateResult: { started: boolean; reason?: string; cycleId?: string } | null = null;
        let activationResult: any = null;
        let deactivationResult: any = null;

        if (isEnabled) {
          // Ativação atômica via RPC: busca a última mensagem sob lock FOR UPDATE e grava o watermark + ai_auto_respond = true sem janela de race!
          const { data: armResult, error: armErr } = await supabase.rpc(
            "arm_autopilot_with_watermark_atomic",
            { p_conversation_id: conversationId }
          );

          if (armErr || !armResult?.success) {
            console.error(`[Autopilot] arm_autopilot_with_watermark_atomic falhou para conv=${conversationId}.`, armErr?.message || armErr);
            return new Response(JSON.stringify({ success: false, isEnabled: false, error: "activation_failed" }), {
              status: 503,
              headers: { ...corsHeaders, "Content-Type": "application/json" },
            });
          } else {
            activationResult = armResult;
            console.log(`[Autopilot] autopilot_armed_atomic conv=${conversationId} watermark_rev=${armResult?.inbound_revision ?? armResult?.watermark?.inboundRevision}`);
          }

          // Se já existe uma resolução manual pendente, ativar a IA não pode atropelar
          // esse handoff nem trocar o HUD para "starting".
          if (triggerImmediate && await hasWaitingManualBrainTurn(supabase, conversationId)) {
            immediateResult = { started: false, reason: "waiting_manual" };
          } else if (triggerImmediate) {
            const { data: lastMsgs } = await supabase
              .from("instagram_messages")
              .select("id, text, timestamp, sender_id, is_mine, media_type, media_url, audio_transcript")
              .eq("conversation_id", conversationId)
              .order("timestamp", { ascending: false })
              .limit(1);
            const lastMsg = lastMsgs?.[0];

            if (lastMsg && !lastMsg.is_mine && lastMsg.sender_id !== "me") {
              const lastMediaType = String(lastMsg.media_type || "").toLowerCase();
              const needsMediaWorker =
                lastMediaType === "image" ||
                lastMediaType === "video" ||
                String(lastMsg.text || "").startsWith("[image:") ||
                String(lastMsg.text || "").startsWith("[video:");

              if (needsMediaWorker) {
                const { data: queueResult, error: queueError } = await supabase.rpc(
                  "enqueue_autopilot_inbound_job",
                  {
                    p_conversation_id: conversationId,
                    p_message_id: lastMsg.id,
                    p_due_at: new Date().toISOString(),
                  },
                );
                if (queueError || queueResult?.success !== true) {
                  immediateResult = { started: false, reason: queueError?.message || queueResult?.reason || "media_queue_failed" };
                } else {
                  immediateResult = { started: true, reason: "media_queued" };
                  await publishAutoPilotState(supabase, conversationId, {
                    status: "starting",
                    activity: activity(
                      "starting",
                      lastMediaType === "video" ? "Preparando observação" : "Analisando foto",
                      lastMediaType === "video"
                        ? "Vídeo encaminhado para observação humana antes do Brain."
                        : "Foto encaminhada para descrição visual antes do Brain.",
                      { event: "media_worker_queued", mediaType: lastMediaType, messageId: lastMsg.id },
                    ),
                    scheduledResponseAt: null,
                  });
                }
              } else {
              const proposedCycleId = `corr_toggle_imm_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
              const { data: authResult } = await supabase.rpc(
                "authorize_send_now_atomic",
                {
                  p_conversation_id: conversationId,
                  p_new_cycle_token: proposedCycleId,
                  p_stale_seconds: 300,
                }
              );

              if (authResult?.success) {
                const cycleId = authResult.cycleToken || proposedCycleId;
                const resolvedAudio = await resolveInboundAudioMessage(supabase, lastMsg);
                await publishAutoPilotState(supabase, conversationId, {
                  cycleId,
                  status: "starting",
                  activity: activity("starting", "Iniciando...", "Ciclo iniciado imediatamente ao ativar o piloto.", { cycleId, event: "toggle_immediate_started" }),
                  scheduledResponseAt: null,
                });

                const brainPromise = runBrainOrchestration({
                  supabase,
                  conversationId,
                  correlationId: cycleId,
                  preClaimedCycleToken: cycleId,
                  newMessage: {
                    id: lastMsg.id,
                    text: resolvedAudio.text,
                    timestamp: lastMsg.timestamp,
                    sender: lastMsg.sender_id || "them",
                    mediaType: resolvedAudio.isAudio ? "audio" : (lastMsg.media_type || undefined),
                    audioTranscript: resolvedAudio.hasValidTranscript ? resolvedAudio.transcript : (lastMsg.audio_transcript || undefined),
                  },
                });

                if (typeof (globalThis as any).EdgeRuntime?.waitUntil === "function") {
                  (globalThis as any).EdgeRuntime.waitUntil(brainPromise);
                } else {
                  void brainPromise;
                }
                immediateResult = { started: true, cycleId };
              } else if (authResult?.reason === "already_processing") {
                immediateResult = { started: true, reason: "already_processing", cycleId: authResult.active_cycle_token };
              } else {
                immediateResult = { started: false, reason: authResult?.reason || "auth_failed" };
              }
              }
            } else {
              immediateResult = { started: false, reason: "nothing_to_answer" };
            }
          }
        } else {
          // Somente este toggle explícito pode desligar a intenção persistente.
          const { data: pauseRpcResult, error: pauseRpcErr } = await supabase.rpc("disable_autopilot_explicitly_atomic", {
            p_conversation_id: conversationId,
            p_reason: "operator_toggle_off",
          });

          if (pauseRpcErr || !pauseRpcResult?.success) {
            console.error(`[Autopilot] disable_autopilot_explicitly_atomic falhou para conv=${conversationId}.`, pauseRpcErr || pauseRpcResult);
            return new Response(JSON.stringify({ success: false, isEnabled: true, error: "deactivation_failed" }), {
              status: 503,
              headers: { ...corsHeaders, "Content-Type": "application/json" },
            });
          }
          deactivationResult = pauseRpcResult;
        }

        const { data: canonicalRow, error: canonicalError } = await supabase
          .from("instagram_conversations")
          .select("ai_auto_respond, updated_at")
          .eq("id", conversationId)
          .maybeSingle();
        if (canonicalError || !canonicalRow) throw new Error("canonical_state_unavailable");
        if (canonicalRow.ai_auto_respond !== isEnabled) throw new Error("canonical_state_mismatch");
        if (isEnabled && activationResult?.oldValue === false) {
          console.info(JSON.stringify({ event: "autopilot_enable_changed", conversationId, oldValue: false, newValue: true, reason: "operator_toggle_on", source: "operator_toggle", route: path, timestamp: canonicalRow.updated_at }));
        } else if (!isEnabled && deactivationResult?.oldValue === true) {
          console.info(JSON.stringify({ event: "autopilot_enable_changed", conversationId, oldValue: true, newValue: false, reason: "operator_toggle_off", source: "operator_toggle", route: path, timestamp: canonicalRow.updated_at }));
        }

        // Atualiza apenas a projeção desta conversa; a RPC lê ai_auto_respond sob lock.
        const nowIso = new Date().toISOString();
        const updated = {
          conversationId,
          isEnabled,
          status: isEnabled ? "idle" : "disabled",
          pauseReason: isEnabled ? undefined : "operator_toggle_off",
          pausedAt: isEnabled ? undefined : nowIso,
          enabledAt: isEnabled ? canonicalRow.updated_at : undefined,
          activity: null,
          scheduledResponseAt: null,
          updatedAt: canonicalRow.updated_at,
          stateUpdatedAt: canonicalRow.updated_at,
        };
        const projectionResult = await patchAutoPilotProjectionState(supabase, conversationId, updated);
        updated.isEnabled = projectionResult.isEnabled;
        if (projectionResult.stateUpdatedAt) updated.stateUpdatedAt = projectionResult.stateUpdatedAt;

        // Broadcast Realtime para sincronizar imediatamente todas as abas
        const rt = supabase.channel("vendeo_realtime_chat");
        await rt.send({
          type: "broadcast",
          event: "autopilot_state_update",
          payload: { ...updated, timestamp: nowIso },
        });

        return new Response(JSON.stringify({
          success: true,
          isEnabled,
          immediateTriggered: immediateResult?.started === true,
          immediateReason: immediateResult?.reason,
          cycleId: immediateResult?.cycleId,
          stateUpdatedAt: updated.stateUpdatedAt,
          detail: isEnabled
            ? (immediateResult?.started ? "Piloto ativado e resposta imediata iniciada!" : "Piloto ativado no chat.")
            : "Piloto desativado no chat.",
        }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      } catch (err: unknown) {
        return new Response(JSON.stringify({ error: err instanceof Error ? err.message : "Erro no toggle-chat" }), {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    // Rota para PAUSAR / RETOMAR A CONTAGEM DURANTE A EDIÇÃO DO BALÃO (HUD Control)
    if ((path === "/autopilot/hold-edit" || path === "/api/autopilot/hold-edit") && req.method === "POST") {
      try {
        const body = await req.json().catch(() => ({}));
        const { conversationId, isEditing } = body || {};
        if (!conversationId) {
          return new Response(JSON.stringify({ error: "conversationId é obrigatório." }), {
            status: 400,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }

        const { data: rpcHoldResult, error: rpcHoldErr } = await supabase.rpc(
          "patch_autopilot_hold_edit_atomic",
          {
            p_conversation_id: conversationId,
            p_is_editing: Boolean(isEditing),
          }
        );

        if (rpcHoldErr || !rpcHoldResult?.success) {
          // FAIL-CLOSED: se a RPC falhar, terminantemente proibido fazer read-modify-write de stage_completed_rules em JS
          console.warn(`[Autopilot] patch_autopilot_hold_edit_atomic falhou para conv=${conversationId}. FAIL-CLOSED: zero escrita direta em stage_completed_rules.`);
        }

        return new Response(JSON.stringify({ success: true, editing_in_progress: Boolean(isEditing) }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      } catch (err: unknown) {
        return new Response(JSON.stringify({ error: err instanceof Error ? err.message : "Erro ao pausar contagem para edição" }), {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    // Rota para EDITAR A PRÉVIA do balão antes do envio (HUD Control)
    if ((path === "/autopilot/edit-preview" || path === "/api/autopilot/edit-preview") && req.method === "POST") {
      try {
        const body = await req.json().catch(() => ({}));
        const { conversationId, editedText } = body || {};
        if (!conversationId || typeof editedText !== "string") {
          return new Response(JSON.stringify({ error: "conversationId e editedText são obrigatórios." }), {
            status: 400,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }

        const { data: rpcEditResult, error: rpcEditErr } = await supabase.rpc(
          "patch_autopilot_edit_preview_atomic",
          {
            p_conversation_id: conversationId,
            p_edited_text: editedText,
          }
        );

        if (rpcEditErr || !rpcEditResult?.success) {
          // FAIL-CLOSED: se a RPC falhar, terminantemente proibido fazer read-modify-write de stage_completed_rules em JS
          console.warn(`[Autopilot] patch_autopilot_edit_preview_atomic falhou para conv=${conversationId}. FAIL-CLOSED: zero escrita direta em stage_completed_rules.`);
        }

        return new Response(JSON.stringify({ success: true, detail: "Edição gravada para o ciclo atual." }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      } catch (err: unknown) {
        return new Response(JSON.stringify({ error: err instanceof Error ? err.message : "Erro ao editar" }), {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    // Rota para iniciar o ciclo imediatamente, com resultado operacional explícito.
    if ((path === "/autopilot/send-now" || path === "/api/autopilot/send-now") && req.method === "POST") {
      try {
        const body = await req.json().catch(() => ({}));
        const conversationId = body?.conversationId;
        if (!conversationId) {
          return new Response(JSON.stringify({ error: "conversationId é obrigatório." }), {
            status: 400,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }

        if (await hasWaitingManualBrainTurn(supabase, conversationId)) {
          return new Response(JSON.stringify({
            success: false,
            result: "waiting_manual",
            status: "waiting_human",
            detail: "O Brain ainda aguarda uma resposta do operador; o envio imediato não pode atropelar esse handoff.",
          }), {
            status: 409,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }

        const proposedCycleId = `corr_sendnow_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

        // 1. Autorização atômica sob lock FOR UPDATE no PostgreSQL
        const { data: authResult, error: authErr } = await supabase.rpc(
          "authorize_send_now_atomic",
          {
            p_conversation_id: conversationId,
            p_new_cycle_token: proposedCycleId,
            p_stale_seconds: 300,
          }
        );

        if (authErr) {
          console.error(`[Brain] send-now erro ao chamar authorize_send_now_atomic:`, authErr.message);
        }

        if (authResult) {
          if (!authResult.success) {
            if (authResult.reason === "disabled") {
              return new Response(JSON.stringify({ success: false, result: "disabled", status: "disabled", detail: "IA está desativada neste chat." }), {
                status: 409,
                headers: { ...corsHeaders, "Content-Type": "application/json" },
              });
            }
            if (authResult.reason === "already_processing") {
              return new Response(JSON.stringify({
                success: true,
                result: "already_processing",
                cycleId: authResult.active_cycle_token || null,
                status: "processing",
                detail: "Ciclo do agente já está em andamento. Envio acelerado sem duplicação de execução."
              }), {
                headers: { ...corsHeaders, "Content-Type": "application/json" },
              });
            }
            return new Response(JSON.stringify({ success: false, result: authResult.reason, detail: "Falha na autorização do send-now." }), {
              status: 409,
              headers: { ...corsHeaders, "Content-Type": "application/json" },
            });
          }
        } else {
          // FAIL-CLOSED: Se a RPC authorize_send_now_atomic falhar ou estiver indisponível,
          // é TERMINANTEMENTE PROIBIDO fazer read-modify-write de stage_completed_rules em JS.
          console.error(`[Brain] send-now: RPC authorize_send_now_atomic falhou ou retornou nulo. FAIL-CLOSED: zero escrita direta em stage_completed_rules.`);
          return new Response(JSON.stringify({ success: false, result: "infra_failure", detail: "Falha na autorização atômica do send-now. Operação abortada com segurança." }), {
            status: 500,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }

        const cycleId = proposedCycleId;

        // O ciclo é disparado mesmo quando o debounce já expirou, desde que ainda haja inbound pendente.
        {
          const { data: lastMsgs } = await supabase
            .from("instagram_messages")
            .select("id, text, timestamp, sender_id, is_mine, media_type, media_url, audio_transcript")
            .eq("conversation_id", conversationId)
            .order("timestamp", { ascending: false })
            .limit(1);
          const lastMsg = lastMsgs?.[0];
          if (lastMsg && !lastMsg.is_mine && lastMsg.sender_id !== "me") {
            const lastMediaType = String(lastMsg.media_type || "").toLowerCase();
            const needsMediaWorker =
              lastMediaType === "image" ||
              lastMediaType === "video" ||
              String(lastMsg.text || "").startsWith("[image:") ||
              String(lastMsg.text || "").startsWith("[video:");

            if (needsMediaWorker) {
              await releaseExperimentalCycleAtomic({
                supabase,
                conversationId,
                cycleToken: cycleId,
                processingStatus: "idle",
              }).catch(() => null);

              const { data: queueResult, error: queueError } = await supabase.rpc(
                "enqueue_autopilot_inbound_job",
                {
                  p_conversation_id: conversationId,
                  p_message_id: lastMsg.id,
                  p_due_at: new Date().toISOString(),
                },
              );
              if (queueError || queueResult?.success !== true) {
                return new Response(JSON.stringify({
                  success: false,
                  result: "media_queue_failed",
                  detail: queueError?.message || queueResult?.reason || "Falha ao encaminhar mídia para processamento.",
                }), {
                  status: 503,
                  headers: { ...corsHeaders, "Content-Type": "application/json" },
                });
              }

              await publishAutoPilotState(supabase, conversationId, {
                status: "starting",
                activity: activity(
                  "starting",
                  lastMediaType === "video" ? "Preparando observação" : "Analisando foto",
                  lastMediaType === "video"
                    ? "Vídeo encaminhado para observação humana antes do Brain."
                    : "Foto encaminhada para descrição visual antes do Brain.",
                  { event: "media_worker_queued", mediaType: lastMediaType, messageId: lastMsg.id },
                ),
                scheduledResponseAt: null,
              });
              return new Response(JSON.stringify({
                success: true,
                result: "media_queued",
                status: "starting",
              }), {
                headers: { ...corsHeaders, "Content-Type": "application/json" },
              });
            }

            // BRAIN: Único orquestrador oficial (fail-closed)
            console.log(`[Brain] send-now roteando para Brain em ${conversationId}`);
            const resolvedAudio = await resolveInboundAudioMessage(supabase, lastMsg);

            await publishAutoPilotState(supabase, conversationId, {
              cycleId,
              status: "starting",
              activity: activity("starting", "Iniciando...", "Ciclo iniciado manualmente pelo operador.", { cycleId, event: "send_now_started" }),
              scheduledResponseAt: null,
            });
            const brainPromise = runBrainOrchestration({
              supabase,
              conversationId,
              correlationId: cycleId,
              preClaimedCycleToken: cycleId,
              newMessage: {
                id: lastMsg.id,
                text: resolvedAudio.text,
                timestamp: lastMsg.timestamp,
                sender: lastMsg.sender_id || "them",
                mediaType: resolvedAudio.isAudio ? "audio" : (lastMsg.media_type || undefined),
                audioTranscript: resolvedAudio.hasValidTranscript ? resolvedAudio.transcript : (lastMsg.audio_transcript || undefined),
              },
            });

            if (typeof (globalThis as any).EdgeRuntime?.waitUntil === "function") {
              (globalThis as any).EdgeRuntime.waitUntil(brainPromise);
            } else {
              void brainPromise;
            }
            return new Response(JSON.stringify({ success: true, result: "started", cycleId, status: "starting" }), {
              headers: { ...corsHeaders, "Content-Type": "application/json" },
            });
          }
        }

        // Se não houver inbound pendente, libera o ciclo para não manter lock zombie
        await releaseExperimentalCycleAtomic({
          supabase,
          conversationId,
          cycleToken: cycleId,
          processingStatus: "idle",
        }).catch(() => null);

        return new Response(JSON.stringify({ success: false, result: "nothing_to_answer", status: "idle", detail: "Nenhuma mensagem inbound pendente para responder." }), {
          status: 409,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      } catch (err: unknown) {
        return new Response(JSON.stringify({ error: err instanceof Error ? err.message : "Erro ao adiantar envio" }), {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    // ==========================================
    // Retoma o turno persistido após o operador responder uma resolução manual.
    if ((path === "/autopilot/brain-events" || path === "/api/autopilot/brain-events") && req.method === "GET") {
      if (!isPrivilegedOperationalRequest(req, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")) && !brainOperatorAllowedOrigin(req)) {
        return new Response(JSON.stringify({ success: false, error: "Acesso operacional exige credencial de serviço privilegiada; não há identidade de operador configurada neste app." }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
      const conversationId = new URL(req.url).searchParams.get("conversationId") || "";
      if (!conversationId) return new Response(JSON.stringify({ success: false, error: "conversationId é obrigatório." }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      const { data: events, error: eventError } = await supabase.from("brain_turn_events")
        .select("id, conversation_id, session_id, turn_id, decision_id, action_id, event_type, status, human_message, metadata, created_at")
        .eq("conversation_id", conversationId).order("created_at", { ascending: false }).limit(100);
      if (eventError) return new Response(JSON.stringify({ success: false, error: eventError.message }), { status: 503, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      const { data: actions, error: actionError } = await supabase.from("brain_decision_actions")
        .select("id, decision_id, action_index, action_type, status, provider_message_id, attempts, created_at")
        .eq("conversation_id", conversationId).order("created_at", { ascending: false }).limit(200);
      if (actionError) return new Response(JSON.stringify({ success: false, error: actionError.message }), { status: 503, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      let operationalEvents = (events || []).reverse();
      const decisionIds = [...new Set([
        ...(actions || []).map((action: any) => action.decision_id).filter(Boolean),
        ...operationalEvents.map((event: any) => event.decision_id).filter(Boolean),
      ])].slice(0, 300);
      let decisions: any[] = [];
      if (decisionIds.length > 0) {
        const { data, error: decisionError } = await supabase.from("brain_decisions")
          .select("id, turn_id, session_id, payload, delivery_status, created_at")
          .eq("conversation_id", conversationId).in("id", decisionIds);
        if (decisionError) return new Response(JSON.stringify({ success: false, error: decisionError.message }), { status: 503, headers: { ...corsHeaders, "Content-Type": "application/json" } });
        decisions = data || [];
      }
      const needsTurnMapping = operationalEvents.some((event: any) => !event.turn_id
        && (typeof event.metadata?.cycleId === "string" || typeof event.metadata?.cycle_id === "string"));
      if (needsTurnMapping) {
        const { data: recentDecisions, error: recentDecisionError } = await supabase.from("brain_decisions")
          .select("turn_id, session_id, payload, created_at")
          .eq("conversation_id", conversationId).order("created_at", { ascending: false }).limit(100);
        if (recentDecisionError) return new Response(JSON.stringify({ success: false, error: recentDecisionError.message }), { status: 503, headers: { ...corsHeaders, "Content-Type": "application/json" } });
        if (Array.isArray(recentDecisions)) {
          const knownDecisionKeys = new Set(decisions.map((decision: any) => `${decision.turn_id}:${decision.created_at}`));
          decisions.push(...recentDecisions.filter((decision: any) => !knownDecisionKeys.has(`${decision.turn_id}:${decision.created_at}`)));
          operationalEvents = enrichBrainTurnEventRows(operationalEvents, decisions);
        }
      }
      const deliveryActions = enrichBrainDecisionActionRows(actions || [], decisions).map((action: any) => ({
        id: action.id,
        decision_id: action.decision_id,
        turn_id: action.turn_id,
        decision_delivery_status: action.decision_delivery_status,
        action_index: action.action_index,
        action_type: action.action_type,
        status: action.status,
        provider_message_id: action.provider_message_id || null,
        attempts: action.attempts || 0,
        created_at: action.created_at,
      }));
      const failedActions = deliveryActions.filter((action: any) => action.status === "failed_confirmed");
      return new Response(JSON.stringify({ success: true, events: operationalEvents, actions: deliveryActions, failedActions }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    if ((path === "/autopilot/retry-failed-action" || path === "/api/autopilot/retry-failed-action") && req.method === "POST") {
      if (!isPrivilegedOperationalRequest(req, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")) && !brainOperatorAllowedOrigin(req)) {
        return new Response(JSON.stringify({ success: false, error: "Acesso operacional exige credencial de serviço privilegiada; não há identidade de operador configurada neste app." }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
      try {
        const body = await req.json().catch(() => ({}));
        const conversationId = String(body?.conversationId || "");
        const actionId = String(body?.actionId || "");
        if (!conversationId || !actionId) return new Response(JSON.stringify({ success: false, error: "conversationId e actionId são obrigatórios." }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
        const { data: prepared, error: prepareError } = await supabase.rpc("prepare_brain_action_manual_retry", {
          p_conversation_id: conversationId, p_action_id: actionId,
        });
        if (prepareError || prepared?.success !== true) return new Response(JSON.stringify({ success: false, error: prepareError?.message || prepared?.reason || "Ação não está elegível para envio manual." }), { status: 409, headers: { ...corsHeaders, "Content-Type": "application/json" } });
        const result = await runDurableOutboxDispatcher({ supabase, conversationId, targetCycleId: prepared.entry?.cycleId });
        const queuedForBrainReview = result.errors.includes("pending_inbound_requires_brain_review") || result.errors.includes("brain_review_in_progress");
        return new Response(JSON.stringify({ success: result.dispatchedCount > 0 || queuedForBrainReview, queuedForBrainReview, result }), { status: result.dispatchedCount > 0 ? 200 : queuedForBrainReview ? 202 : 503, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      } catch (error: any) {
        return new Response(JSON.stringify({ success: false, error: error?.message || "Falha ao enviar a ação." }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
    }

    if ((path === "/autopilot/brain-consultation" || path === "/api/autopilot/brain-consultation") && req.method === "POST") {
      if (!isPrivilegedOperationalRequest(req, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")) && !brainOperatorAllowedOrigin(req)) {
        return new Response(JSON.stringify({ success: false, error: "A consulta privada exige uma sessão autenticada do operador." }), {
          status: 401,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      try {
        const body = await req.json().catch(() => ({}));
        const turnId = String(body?.turnId || "").trim();
        const operatorMessage = String(body?.message || "").trim().slice(0, 3000);
        const consultationHistory = Array.isArray(body?.history)
          ? body.history
              .slice(-12)
              .map((item: any) => ({
                role: item?.role === "brain" ? "assistant" : "user",
                content: String(item?.content || "").trim().slice(0, 2500),
              }))
              .filter((item: any) => item.content)
          : [];

        if (!turnId || !operatorMessage) {
          return new Response(JSON.stringify({ success: false, error: "turnId e message são obrigatórios." }), {
            status: 400,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }

        const { data: waitingTurn, error: turnError } = await supabase
          .from("brain_turns")
          .select("id, conversation_id, session_id, status, inbound_message_ids")
          .eq("id", turnId)
          .maybeSingle();

        if (turnError || !waitingTurn?.id || waitingTurn.status !== "waiting_manual") {
          return new Response(JSON.stringify({ success: false, error: "Este turno não está aguardando o operador." }), {
            status: 409,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }

        const conversationId = String(waitingTurn.conversation_id || "");

        const [
          manualDecisionResult,
          recentMessagesResult,
          sessionFactsResult,
          personaFactsResult,
        ] = await Promise.all([
          supabase
            .from("brain_decisions")
            .select("payload")
            .eq("turn_id", turnId)
            .eq("decision_type", "manual_resolution")
            .order("version", { ascending: false })
            .limit(1)
            .maybeSingle(),
          supabase
            .from("instagram_messages")
            .select("id, sender_id, is_mine, text, created_at, timestamp, audio_transcript, media_type")
            .eq("conversation_id", conversationId)
            .order("created_at", { ascending: false })
            .limit(40),
          supabase
            .from("manual_facts")
            .select("question, fact, permanent, created_at")
            .eq("conversation_id", conversationId)
            .eq("session_id", waitingTurn.session_id)
            .order("created_at", { ascending: false })
            .limit(20),
          supabase
            .from("persona_memory")
            .select("category, key, value, updated_at")
            .eq("persona_id", "larissa")
            .order("updated_at", { ascending: false })
            .limit(40),
        ]);

        const manualRequest = manualDecisionResult.data?.payload?.manualResolution || {};
        const manualQuestion = String(manualRequest.question || body?.question || "Informação necessária para continuar").trim();
        const manualContext = String(manualRequest.context || "").trim();

        const recentMessages = Array.isArray(recentMessagesResult.data)
          ? [...recentMessagesResult.data].reverse().map((row: any) => {
              const isMine = Boolean(row?.is_mine || row?.sender_id === "me" || row?.sender_id === "larissa");
              const transcript = String(row?.audio_transcript || "").trim();
              const text = String(row?.text || "").trim();
              const content = transcript
                ? `${text && !text.startsWith("[audio:") ? `${text} · ` : ""}[áudio transcrito: ${transcript}]`
                : text;
              return content ? `${isMine ? "Larissa" : "Contato"}: ${content}` : null;
            }).filter(Boolean)
          : [];

        const sessionFacts = Array.isArray(sessionFactsResult.data)
          ? sessionFactsResult.data.map((row: any) => `- ${String(row?.question || "Fato")}: ${String(row?.fact || "")}`).filter((line: string) => !line.endsWith(": "))
          : [];

        const personaFacts = Array.isArray(personaFactsResult.data)
          ? personaFactsResult.data
              .map((row: any) => {
                const rawValue = row?.value;
                if (rawValue && typeof rawValue === "object") {
                  const fact = String(rawValue?.fact || "").trim();
                  const question = String(rawValue?.question || "").trim();
                  if (fact) {
                    return `- [${String(row?.category || "memória")}] ${question ? `${question} → ` : ""}${fact}`;
                  }
                  try {
                    return `- [${String(row?.category || "memória")}] ${String(row?.key || "")}: ${JSON.stringify(rawValue)}`;
                  } catch {
                    return null;
                  }
                }
                const value = String(rawValue || "").trim();
                return value
                  ? `- [${String(row?.category || "memória")}] ${String(row?.key || "")}: ${value}`
                  : null;
              })
              .filter(Boolean)
          : [];

        const openAiKey = await getOpenAiApiKey(supabase);
        if (!openAiKey) {
          return new Response(JSON.stringify({ success: false, error: "OpenAI não está configurada para a consulta privada." }), {
            status: 503,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }

        const model = await resolveConfiguredOpenAiModel(supabase);
        const systemPrompt = [
          "Você é o modo CONSULTA PRIVADA do Brain do Vendeo.",
          "Sua conversa é exclusivamente com o operador humano. Nada do que você disser será enviado ao contato.",
          "Ajude o operador a entender contexto, recuperar fatos, identificar o que é conhecido versus inferência e pensar em caminhos de resposta.",
          "Não invente fatos sobre Larissa ou sobre o contato. Quando algo não estiver sustentado pelo contexto, diga claramente que é incerto.",
          "Se sugerir mensagens ao contato, preserve o estilo natural da conversa, mas apresente como opções para o operador escolher.",
          "Em temas políticos: não deduza ideologia a partir de sinais ambíguos e não recomende fingir alinhamento. Aponte apenas declarações explícitas, incertezas e perguntas neutras de esclarecimento.",
          "Seja direto e útil. Responda em português do Brasil.",
          "",
          `PEDIDO QUE BLOQUEOU O TURNO: ${manualQuestion}`,
          manualContext ? `CONTEXTO DO PEDIDO: ${manualContext}` : "",
          "",
          "ÚLTIMAS MENSAGENS DA CONVERSA:",
          recentMessages.length ? recentMessages.join("\n") : "(sem mensagens disponíveis)",
          "",
          "FATOS MANUAIS DESTA SESSÃO:",
          sessionFacts.length ? sessionFacts.join("\n") : "(nenhum)",
          "",
          "MEMÓRIA DISPONÍVEL DA LARISSA:",
          personaFacts.length ? personaFacts.join("\n") : "(nenhuma memória relevante carregada)",
        ].filter(Boolean).join("\n");

        const oaiResponse = await fetch("https://api.openai.com/v1/chat/completions", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${openAiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            model,
            messages: [
              { role: "system", content: systemPrompt },
              ...consultationHistory,
              { role: "user", content: operatorMessage },
            ],
          }),
          signal: AbortSignal.timeout(35_000),
        });

        if (!oaiResponse.ok) {
          const detail = (await oaiResponse.text()).slice(0, 500);
          console.error("[Brain Consultation] OpenAI error:", oaiResponse.status, detail);
          return new Response(JSON.stringify({ success: false, error: "O Brain não conseguiu responder à consulta agora." }), {
            status: 502,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }

        const oaiData = await oaiResponse.json();
        const answer = String(
          oaiData?.choices?.[0]?.message?.content ||
          oaiData?.choices?.[0]?.message?.reasoning_content ||
          "",
        ).trim();

        if (!answer) {
          return new Response(JSON.stringify({ success: false, error: "O Brain retornou uma consulta vazia." }), {
            status: 502,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }

        return new Response(JSON.stringify({
          success: true,
          answer,
          model,
          turnId,
          conversationId,
          context: {
            recentMessages: recentMessages.length,
            sessionFacts: sessionFacts.length,
            personaFacts: personaFacts.length,
          },
        }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      } catch (error: any) {
        console.error("[Brain Consultation] Falha:", error?.message || error);
        return new Response(JSON.stringify({ success: false, error: error?.message || "Falha na consulta privada com o Brain." }), {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    if ((path === "/autopilot/media-observation" || path === "/api/autopilot/media-observation") && req.method === "POST") {
      if (!isPrivilegedOperationalRequest(req, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")) && !brainOperatorAllowedOrigin(req)) {
        return new Response(JSON.stringify({ success: false, error: "Acesso operacional exige credencial de operador." }), {
          status: 401,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      try {
        const body = await req.json().catch(() => ({}));
        const conversationId = String(body?.conversationId || "").trim();
        const messageId = String(body?.messageId || "").trim();
        const observation = String(body?.observation || "").trim();
        if (!conversationId || !messageId || !observation) {
          return new Response(JSON.stringify({ success: false, error: "conversationId, messageId e observation são obrigatórios." }), {
            status: 400,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }

        const { data: prepared, error: prepareError } = await supabase.rpc("prepare_instagram_media_observation", {
          p_conversation_id: conversationId,
          p_message_id: messageId,
          p_observation: observation,
        });
        if (prepareError || prepared?.success !== true) {
          return new Response(JSON.stringify({
            success: false,
            error: prepareError?.message || prepared?.reason || "Falha ao registrar observação da mídia.",
          }), {
            status: 409,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }

        await publishAutoPilotState(supabase, conversationId, {
          status: "idle",
          pauseReason: null,
          pausedAt: null,
          scheduledResponseAt: null,
          activity: activity(
            "starting",
            "Observação recebida",
            "Contexto humano registrado. O Brain vai retomar a conversa com essa observação.",
            { event: "media_observation_received", messageId, mediaKind: prepared?.mediaKind || null },
          ),
          event: "media_observation_received",
          eventMetadata: { messageId, mediaKind: prepared?.mediaKind || null },
        });

        return new Response(JSON.stringify({
          success: true,
          queued: prepared?.queued === true,
          mediaKind: prepared?.mediaKind || null,
        }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      } catch (error: any) {
        console.error("[Media Observation] Falha:", error?.message || error);
        return new Response(JSON.stringify({ success: false, error: error?.message || "Falha ao registrar observação da mídia." }), {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    if ((path === "/autopilot/manual-resolution" || path === "/api/autopilot/manual-resolution") && req.method === "POST") {
      if (!isPrivilegedOperationalRequest(req, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")) && !brainOperatorAllowedOrigin(req)) {
        return new Response(JSON.stringify({ success: false, error: "Acesso operacional exige credencial de serviço privilegiada; não há identidade de operador configurada neste app." }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
      try {
        const body = await req.json().catch(() => ({}));
        const conversationId = String(body?.conversationId || "");
        const answer = String(body?.answer || "").trim();
        const saveForFuture = body?.saveForFuture === true;
        if (!conversationId || !answer) {
          return new Response(JSON.stringify({ success: false, error: "conversationId e answer são obrigatórios." }), {
            status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }

        const { data: waitingTurn, error: turnError } = await supabase.from("brain_turns")
          .select("id, inbound_message_ids").eq("conversation_id", conversationId)
          .eq("status", "waiting_manual").order("updated_at", { ascending: false }).limit(1).maybeSingle();
        if (turnError || !waitingTurn?.id || !Array.isArray(waitingTurn.inbound_message_ids) || waitingTurn.inbound_message_ids.length === 0) {
          return new Response(JSON.stringify({ success: false, error: "Não há uma resolução manual aguardando nesta conversa." }), {
            status: 409, headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }

        const { data: inbound } = await supabase.from("instagram_messages")
          .select("id, text, sender_id, created_at, timestamp")
          .eq("conversation_id", conversationId)
          .eq("id", waitingTurn.inbound_message_ids[waitingTurn.inbound_message_ids.length - 1])
          .maybeSingle();
        if (!inbound?.id) {
          return new Response(JSON.stringify({ success: false, error: "As mensagens do turno aguardando não estão disponíveis." }), {
            status: 409, headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }

        const { data: manualDecision } = await supabase.from("brain_decisions")
          .select("payload").eq("turn_id", waitingTurn.id).eq("decision_type", "manual_resolution")
          .order("version", { ascending: false }).limit(1).maybeSingle();
        const manualRequest = manualDecision?.payload?.manualResolution || {};
        const memoryKey = `manual_resolution_${String(manualRequest.question || "fato").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 90)}`;
        const { data: prepared, error: prepareError } = await supabase.rpc("prepare_brain_manual_resolution", {
          p_conversation_id: conversationId,
          p_turn_id: waitingTurn.id,
          p_answer: answer,
          p_save_for_future: saveForFuture,
          p_memory_key: memoryKey,
        });
        if (prepareError || prepared?.success !== true) {
          return new Response(JSON.stringify({ success: false, error: prepareError?.message || prepared?.error || "Falha ao preparar a retomada do Brain." }), {
            status: 503, headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }

        const resumeCorrelationId = `manual_resolution_${waitingTurn.id}_${Date.now()}`;
        const resumePromise = runBrainOrchestration({
          supabase,
          conversationId,
          newMessage: {
            id: inbound.id,
            text: inbound.text || "",
            timestamp: inbound.created_at || inbound.timestamp || new Date().toISOString(),
            sender: inbound.sender_id || "pretendente",
          },
          correlationId: resumeCorrelationId,
          responseDelayMinutes: 0,
          isManualRetry: true,
          manualResolution: {
            turnId: waitingTurn.id,
            question: String(prepared.question || body?.question || "Informação solicitada pelo Brain"),
            context: String(prepared.context || ""),
            answer,
            factId: String(prepared.manual_fact_id || ""),
          },
        }).then(async (result) => {
          if (!result.handled || result.error) {
            console.warn(`[Brain] Retomada manual em background terminou sem sucesso conv=${conversationId} turn=${waitingTurn.id}: ${result.error || "not_handled"}`);
          }
          return result;
        }).catch((error) => {
          console.error(`[Brain] Falha na retomada manual em background conv=${conversationId} turn=${waitingTurn.id}:`, error);
          return { handled: false, error: error instanceof Error ? error.message : String(error) };
        });

        if (typeof (globalThis as any).EdgeRuntime?.waitUntil === "function") {
          (globalThis as any).EdgeRuntime.waitUntil(resumePromise);
        } else {
          void resumePromise;
        }

        return new Response(JSON.stringify({
          success: true,
          status: "processing",
          turnId: waitingTurn.id,
          correlationId: resumeCorrelationId,
        }), {
          status: 202,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      } catch (err: any) {
        console.error("[Brain] Erro ao retomar resolução manual:", err?.message || err);
        return new Response(JSON.stringify({ success: false, error: err?.message || "Erro ao retomar o Brain." }), {
          status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    // 8.11. AUTOPILOT: RETRY MANUAL ÚNICO (/autopilot/retry-once)
    // Autoriza EXATAMENTE UMA tentativa manual do Brain quando technical_retry_exhausted
    // ==========================================
    if ((path === "/autopilot/retry-once" || path === "/api/autopilot/retry-once") && req.method === "POST") {
      if (!isPrivilegedOperationalRequest(req, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")) && !brainOperatorAllowedOrigin(req)) {
        return new Response(JSON.stringify({ error: "Acesso operacional exige a sessão autenticada do operador." }), {
          status: 401,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      try {
        const body = await req.json().catch(() => ({}));
        const conversationId = body?.conversationId;
        if (!conversationId) {
          return new Response(JSON.stringify({ success: false, reason: "missing_conversation_id", message: "conversationId é obrigatório." }), {
            status: 400,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }

        const newCycleToken = `manual_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;

        const authRes = await authorizeManualAutopilotRetryAtomic({
          supabase,
          conversationId,
          newCycleToken,
        });

        if (!authRes.success) {
          const httpStatus = authRes.reason === "active_cycle_running" ? 409 : 400;
          return new Response(JSON.stringify(authRes), {
            status: httpStatus,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }

        // Publica evento de autorização
        await publishAutoPilotState(supabase, conversationId, {
          cycleId: newCycleToken,
          status: "processing",
          activity: activity("analyzing", "Tentativa manual autorizada", "Iniciando ciclo manual solicitado pelo operador.", { cycleId: newCycleToken }),
          cycleEvent: {
            phase: "started",
            event: "manual_retry_authorized",
            label: "Tentativa manual autorizada",
            detail: "Operador autorizou uma única tentativa manual para este lote.",
            metadata: {
              cycleToken: newCycleToken,
              previousCycleToken: authRes.previousCycleToken,
              pendingCount: authRes.pendingCount,
            },
          },
        });

        // Localiza a mensagem inbound alvo
        let targetMessage = {
          id: authRes.pendingMessageIds?.[0] || `manual_inbound_${Date.now()}`,
          text: "",
          timestamp: new Date().toISOString(),
          sender: "pretendente",
        };
        const { data: dbMsg } = await supabase
          .from("instagram_messages")
          .select("id, text, created_at, sender_id")
          .eq("id", targetMessage.id)
          .maybeSingle();
        if (dbMsg) {
          targetMessage = {
            id: dbMsg.id,
            text: dbMsg.text || "",
            timestamp: dbMsg.created_at || new Date().toISOString(),
            sender: dbMsg.sender_id || "pretendente",
          };
        }

        // Dispara a orquestração oficial com isManualRetry: true
        const orchestrationPromise = runBrainOrchestration({
          supabase,
          conversationId,
          newMessage: targetMessage,
          correlationId: newCycleToken,
          isManualRetry: true,
          preClaimedCycleToken: newCycleToken,
        });

        // Aguarda a execução terminar para responder ao operador
        const result = await orchestrationPromise;

        return new Response(JSON.stringify({
          success: true,
          cycleToken: newCycleToken,
          result,
        }), {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      } catch (err: any) {
        console.error("[Autopilot] Erro ao executar retry manual:", err);
        return new Response(JSON.stringify({
          success: false,
          reason: "internal_error",
          message: err instanceof Error ? err.message : "Erro interno ao processar tentativa manual.",
        }), {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    // Rota para LIGAR / DESLIGAR A IA GLOBALMENTE COM PARADA GRACIOSA (HUD Control)
    if ((path === "/autopilot/toggle-global" || path === "/api/autopilot/toggle-global") && req.method === "POST") {
      try {
        const body = await req.json().catch(() => ({}));
        const { isEnabledGlobally } = body || {};
        const isEnabled = Boolean(isEnabledGlobally);

        // 1. Atualiza a configuração global canônica.
        const { data: cfgRow, error: cfgReadError } = await supabase
          .from("autopilot_settings")
          .select("config")
          .eq("id", "global")
          .single();
        if (cfgReadError) throw cfgReadError;

        const updatedConfig = {
          ...(cfgRow?.config || {}),
          isEnabledGlobally: isEnabled,
          updatedAt: new Date().toISOString(),
        };

        const { error: cfgWriteError } = await supabase
          .from("autopilot_settings")
          .upsert({
            id: "global",
            config: updatedConfig,
            updated_at: updatedConfig.updatedAt,
          });
        if (cfgWriteError) throw cfgWriteError;

        // 2. OFF global = drenagem graciosa:
        // - chats sem ciclo ativo desligam imediatamente;
        // - chats com Brain em execução recebem disable_after_cycle e terminam normalmente;
        // - nenhum ciclo novo nasce porque a chave global já foi persistida como OFF.
        let shutdownStats: Record<string, unknown> | null = null;
        if (!isEnabled) {
          const { data: gracefulDisable, error: gracefulDisableError } = await supabase.rpc(
            "request_global_autopilot_disable_graceful"
          );
          if (gracefulDisableError || gracefulDisable?.success !== true) {
            throw new Error(gracefulDisableError?.message || gracefulDisable?.reason || "Falha ao iniciar parada graciosa global");
          }
          shutdownStats = gracefulDisable;
        } else {
          // Se o operador religar antes de um ciclo drenado terminar, cancela a intenção
          // de desligamento pós-ciclo para que o chat continue ativo normalmente.
          const { error: clearDrainError } = await supabase.rpc("cancel_global_autopilot_disable_drain");
          if (clearDrainError) {
            console.warn("[AutoPilot] Falha ao limpar flags de drenagem após religar global:", clearDrainError.message);
          }
        }

        return new Response(
          JSON.stringify({
            success: true,
            isEnabledGlobally: isEnabled,
            shutdownStats,
            detail: isEnabled
              ? "Piloto Automático ativado globalmente."
              : "Piloto Automático desativado com parada graciosa; ciclos em andamento serão concluídos antes de desligar o chat.",
          }),
          {
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          }
        );
      } catch (err: unknown) {
        return new Response(
          JSON.stringify({
            error: err instanceof Error ? err.message : "Erro ao alternar chave mestra",
          }),
          {
            status: 500,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          }
        );
      }
    }

    // ==========================================
    // 8.6. CONSULTA DO ESTADO DE ORQUESTRAÇÃO BRAIN
    // ==========================================
    if (
      (path === "/autopilot/orchestration/state" || path === "/api/autopilot/orchestration/state") &&
      req.method === "GET"
    ) {
      try {
        const conversationId = url.searchParams.get("conversationId");
        if (!conversationId) {
          return new Response(
            JSON.stringify({ error: "conversationId query param é obrigatório" }),
            { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }

        const { data: conv } = await supabase
          .from("instagram_conversations")
          .select("id, stage_completed_rules")
          .eq("id", conversationId)
          .maybeSingle();

        const orchData = conv?.stage_completed_rules?.orchestration || {};
        const orchestration = {
          version: orchData.version || 1,
          currentPhase: orchData.currentPhase || orchData.phase || "conexao_inicial",
          checkpoint: orchData.checkpoint || "inicio",
          lastProcessedMessageId: orchData.lastProcessedMessageId || null,
          lastProcessedAt: orchData.lastProcessedAt || null,
          lastProcessingStatus: orchData.lastProcessingStatus || "idle",
          lastCorrelationId: orchData.lastCorrelationId || null,
          lastError: orchData.lastError || null,
          updatedAt: orchData.updatedAt || orchData.updated_at || null,
        };

        return new Response(
          JSON.stringify({
            success: true,
            conversationId,
            orchestration,
          }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      } catch (err: unknown) {
        return new Response(
          JSON.stringify({
            error: err instanceof Error ? err.message : "Erro ao consultar estado do Brain",
          }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
    }
  } catch (err: any) {
    return new Response(JSON.stringify({ error: err.message || "Erro interno" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
