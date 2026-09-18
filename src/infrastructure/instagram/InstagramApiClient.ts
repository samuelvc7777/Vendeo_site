import { InstagramAccount, InstagramConversation, InstagramMessage } from "@/domain/entities/Instagram";
import { resolveContactAvatar } from "@/domain/services/AvatarResolverService";
import {
  fetchWithTimeout,
  RateLimitError,
  UnauthorizedError,
  ServiceUnavailableError,
} from "@/infrastructure/http/network";

const META_GRAPH_BASE = "https://graph.facebook.com/v21.0";
const INSTAGRAM_GRAPH_BASE = "https://graph.instagram.com/v21.0";
const TIMEOUT_MS = 9000;

/**
 * Detecta se o token de acesso pertence diretamente à API do Instagram (Instagram Login/Token)
 * ou se é um token de Página do Facebook Graph API.
 */
export function isInstagramToken(token: string): boolean {
  const trimmed = (token || "").trim();
  return (
    trimmed.startsWith("IGAA") ||
    trimmed.startsWith("IGQV") ||
    trimmed.startsWith("IG")
  );
}

function checkResponseStatus(res: Response, context: string): void {
  if (res.status === 401 || res.status === 403) {
    throw new UnauthorizedError(`Token de acesso da Meta/Instagram inválido, sem permissão ou expirado (${context}).`);
  }
  if (res.status === 429) {
    const retryAfterHeader = res.headers.get("Retry-After");
    const retryAfter = retryAfterHeader ? parseInt(retryAfterHeader, 10) : undefined;
    throw new RateLimitError(
      `Limite de requisições excedido na Meta Graph API (${context}).`,
      isNaN(Number(retryAfter)) ? undefined : retryAfter
    );
  }
  if (res.status === 503 || res.status === 502 || res.status === 504) {
    throw new ServiceUnavailableError(`Serviço da Meta Graph API temporariamente indisponível (${context}, HTTP ${res.status}).`);
  }
}

export interface MetaGraphUser {
  id: string;
  name?: string;
  accounts?: {
    data: Array<{
      id: string;
      name: string;
      access_token: string;
      instagram_business_account?: {
        id: string;
        username?: string;
        name?: string;
        profile_picture_url?: string;
      };
    }>;
  };
}

export interface MetaSendResponse {
  recipient_id: string;
  message_id: string;
}

export class InstagramApiClient {
  /**
   * Valida o token e descobre a conta oficial do Instagram (compatível com tokens IGAA e EAAB)
   */
  static async validateAndDiscoverAccount(accessToken: string): Promise<{
    account: InstagramAccount;
    pageId: string;
    pageAccessToken: string;
  }> {
    const token = accessToken.trim();

    // 1. SE FOR TOKEN DIRETO DO INSTAGRAM (IGAA... / IGQV...)
    if (isInstagramToken(token)) {
      const igUrl = `${INSTAGRAM_GRAPH_BASE}/me?fields=id,username,name,profile_picture_url,account_type&access_token=${encodeURIComponent(
        token
      )}`;

      const res = await fetchWithTimeout(igUrl, { method: "GET", cache: "no-store" }, TIMEOUT_MS);
      checkResponseStatus(res, "validateAndDiscoverAccount:InstagramDirect");

      if (!res.ok) {
        const err = await res.text();
        throw new Error(`Erro na API do Instagram (${res.status}): ${err}`);
      }

      const data = await res.json();
      return {
        account: {
          id: data.id,
          username: data.username || "instagram_user",
          name: data.name || data.username || "Larissa Resende",
          profilePictureUrl: data.profile_picture_url,
          isConnected: true,
          pageId: data.id,
          updatedAt: new Date().toISOString(),
        },
        pageId: data.id,
        pageAccessToken: token,
      };
    }

    // 2. SE FOR TOKEN DE PÁGINA/USUÁRIO FACEBOOK (EAAB...)
    const fbUrl = `${META_GRAPH_BASE}/me?fields=id,name,accounts{id,name,access_token,instagram_business_account{id,username,name,profile_picture_url}}&access_token=${encodeURIComponent(
      token
    )}`;

    try {
      const res = await fetchWithTimeout(fbUrl, { method: "GET", cache: "no-store" }, TIMEOUT_MS);
      if (res.ok) {
        const data: MetaGraphUser = await res.json();
        const pages = data.accounts?.data || [];

        for (const page of pages) {
          if (page.instagram_business_account) {
            const ig = page.instagram_business_account;
            return {
              account: {
                id: ig.id,
                username: ig.username || page.name,
                name: ig.name || page.name,
                profilePictureUrl: ig.profile_picture_url,
                isConnected: true,
                pageId: page.id,
                updatedAt: new Date().toISOString(),
              },
              pageId: page.id,
              pageAccessToken: page.access_token || token,
            };
          }
        }
      }
    } catch {
      // Continua para fallback
    }

    // Fallback Facebook /me direto
    const meRes = await fetchWithTimeout(
      `${META_GRAPH_BASE}/me?fields=id,name,username,profile_picture_url&access_token=${encodeURIComponent(token)}`,
      { method: "GET", cache: "no-store" },
      TIMEOUT_MS
    );

    if (meRes.ok) {
      const meData = await meRes.json();
      return {
        account: {
          id: meData.id,
          username: meData.username || meData.name || "Instagram Account",
          name: meData.name,
          profilePictureUrl: meData.profile_picture_url,
          isConnected: true,
          pageId: meData.id,
          updatedAt: new Date().toISOString(),
        },
        pageId: meData.id,
        pageAccessToken: token,
      };
    }

    // Fallback final: tenta a API do Instagram caso o prefixo não seja padrão
    try {
      const igFallbackRes = await fetchWithTimeout(
        `${INSTAGRAM_GRAPH_BASE}/me?fields=id,username,name,profile_picture_url,account_type&access_token=${encodeURIComponent(token)}`,
        { method: "GET", cache: "no-store" },
        TIMEOUT_MS
      );
      if (igFallbackRes.ok) {
        const data = await igFallbackRes.json();
        return {
          account: {
            id: data.id,
            username: data.username || "instagram_user",
            name: data.name || data.username,
            profilePictureUrl: data.profile_picture_url,
            isConnected: true,
            pageId: data.id,
            updatedAt: new Date().toISOString(),
          },
          pageId: data.id,
          pageAccessToken: token,
        };
      }
    } catch {
      // Ignora e lança erro geral abaixo
    }

    throw new Error(
      "Nenhuma conta de Instagram válida encontrada para este token de acesso. Verifique se o token tem as permissões instagram_basic e instagram_manage_messages."
    );
  }

  /**
   * Obtém detalhes de perfil da conta do Instagram
   */
  static async getAccountProfile(
    accessToken: string,
    instagramAccountId: string
  ): Promise<InstagramAccount> {
    const isIg = isInstagramToken(accessToken);
    const base = isIg ? INSTAGRAM_GRAPH_BASE : META_GRAPH_BASE;
    const url = `${base}/${instagramAccountId}?fields=id,username,name,profile_picture_url&access_token=${encodeURIComponent(
      accessToken
    )}`;

    const res = await fetchWithTimeout(url, { method: "GET", cache: "no-store" }, TIMEOUT_MS);
    checkResponseStatus(res, "getAccountProfile");

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Falha ao buscar perfil do Instagram (${res.status}): ${err}`);
    }

    const data = await res.json();
    return {
      id: data.id,
      username: data.username || data.name || "instagram_user",
      name: data.name,
      profilePictureUrl: data.profile_picture_url,
      isConnected: true,
      updatedAt: new Date().toISOString(),
    };
  }

  /**
   * Lista conversas da conta via Instagram/Meta Graph API
   */
  static async getConversations(
    accessToken: string,
    pageIdOrAccountId: string,
    myUsername?: string
  ): Promise<InstagramConversation[]> {
    const isIg = isInstagramToken(accessToken);

    // 1. Fluxo Instagram Graph API (tokens IGAA...)
    if (isIg) {
      const url = `${INSTAGRAM_GRAPH_BASE}/me/conversations?fields=id,participants,updated_time,unread_count,messages.limit(10){id,message,created_time,from,attachments{id,mime_type,file_url,image_data,video_data,audio_data},is_unsupported}&access_token=${encodeURIComponent(
        accessToken
      )}`;

      const res = await fetchWithTimeout(url, { method: "GET", cache: "no-store" }, TIMEOUT_MS);
      checkResponseStatus(res, "getConversations:Instagram");

      if (!res.ok) {
        return [];
      }

      const data = await res.json();
      const rawList = data?.data || [];

      return Promise.all(
        rawList.map(async (item: any) => {
        const participants: any[] = item.participants?.data || [];
        // O contato é o participante que não é a conta dona do token
        const contact =
          participants.find(
            (p) =>
              p.username !== myUsername &&
              p.id !== pageIdOrAccountId &&
              p.username !== "lariresende_0611"
          ) ||
          participants[0] ||
          {};

        let realName = contact.name || contact.username;
        let realPic = contact.profile_picture_url;

        // Se tiver ID de participante, tenta buscar foto e nome oficiais reais na Meta
        if (contact.id) {
          try {
            const pUrl = `${INSTAGRAM_GRAPH_BASE}/${contact.id}?fields=id,name,username,profile_pic&access_token=${encodeURIComponent(
              accessToken
            )}`;
            const pRes = await fetchWithTimeout(pUrl, { method: "GET", cache: "no-store" }, 3000);
            if (pRes.ok) {
              const pData = await pRes.json();
              if (pData.name) realName = pData.name;
              if (pData.profile_pic) realPic = pData.profile_pic;
            }
          } catch {
            // Continua graciosamente caso a consulta do perfil falhe
          }
        }

        const lastMsg = item.messages?.data?.[0];
        let lastMsgText = lastMsg?.message;
        if (!lastMsgText) {
          const firstAtt = lastMsg?.attachments?.data?.[0];
          const mime = (firstAtt?.mime_type || "").toLowerCase();
          if (mime.startsWith("audio/") || firstAtt?.audio_data || lastMsg?.is_unsupported) {
            lastMsgText = "🎙️ Mensagem de voz";
          } else if (mime.startsWith("video/") || firstAtt?.video_data) {
            lastMsgText = "📹 Vídeo";
          } else {
            lastMsgText = "📷 Foto";
          }
        }
        const isFromMe =
          lastMsg?.from?.username === myUsername ||
          lastMsg?.from?.id === pageIdOrAccountId ||
          lastMsg?.from?.username === "lariresende_0611";

        // Mapeia mensagens recentes já obtidas no nó da conversa para sincronização imediata
        const rawMsgs = item.messages?.data || [];
        const recentMessages: InstagramMessage[] = rawMsgs.map((m: any) => {
          const isMsgFromMe =
            m.from?.username === myUsername ||
            m.from?.id === pageIdOrAccountId ||
            m.from?.username === "lariresende_0611";

          let mediaUrl: string | undefined;
          let mediaType: "image" | "audio" | "video" | undefined;
          const firstAtt = m.attachments?.data?.[0];
          if (firstAtt) {
            const mime = (firstAtt.mime_type || "").toLowerCase();
            mediaUrl =
              firstAtt.file_url ||
              firstAtt.audio_data?.url ||
              firstAtt.image_data?.url ||
              firstAtt.video_data?.url;
            if (mime.startsWith("audio/") || firstAtt.audio_data) {
              mediaType = "audio";
            } else if (mime.startsWith("video/") || firstAtt.video_data) {
              mediaType = "video";
            } else {
              mediaType = "image";
            }
          }

          if (!m.message && !mediaUrl && (m.is_unsupported || mediaType === "audio")) {
            mediaType = "audio";
          }

          const finalConvId = contact.id || item.id;
          return {
            id: m.id,
            conversationId: finalConvId,
            senderId: isMsgFromMe ? "me" : (m.from?.id || m.from?.username || "them"),
            text: m.message || (mediaType === "audio" ? "🎙️ Mensagem de voz" : mediaType === "image" ? "📷 Foto" : ""),
            mediaUrl,
            mediaType,
            timestamp: m.created_time || item.updated_time || new Date().toISOString(),
            isMine: isMsgFromMe,
            status: "sent" as const,
          };
        });

        const finalConvId = contact.id || item.id;
        return {
          id: finalConvId,
          username: contact.username || "instagram_user",
          fullName: realName || contact.username || "Contato do Instagram",
          avatar: realPic || resolveContactAvatar(contact.username, realName),
          lastMessage: lastMsgText,
          lastMessageAt: lastMsg?.created_time || item.updated_time || new Date().toISOString(),
          lastDirection: isFromMe ? "out" : "in",
          unread: Boolean(item.unread_count && item.unread_count > 0),
          status: "active",
          recentMessages,
        };
      }));
    }

    // 2. Fluxo Facebook Graph API (tokens EAAB...)
    const url = `${META_GRAPH_BASE}/${pageIdOrAccountId}/conversations?platform=instagram&fields=id,participants,updated_time,unread_count,snippet&access_token=${encodeURIComponent(
      accessToken
    )}`;

    const res = await fetchWithTimeout(url, { method: "GET", cache: "no-store" }, TIMEOUT_MS);
    checkResponseStatus(res, "getConversations:Facebook");

    if (!res.ok) {
      return [];
    }

    const data = await res.json();
    const rawList = data?.data || [];

    return rawList.map((item: any) => {
      const participant = item.participants?.data?.[0] || {};
      return {
        id: item.id || participant.id,
        username: participant.username || participant.name || "usuário",
        fullName: participant.name,
        avatar: resolveContactAvatar(participant.username, participant.name, participant.profile_picture_url),
        lastMessage: item.snippet || "",
        lastMessageAt: item.updated_time || new Date().toISOString(),
        lastDirection: "in",
        unread: Boolean(item.unread_count && item.unread_count > 0),
        status: "active",
      };
    });
  }

  /**
   * Busca em profundidade links de mídia na árvore de dados da Meta Graph API
   */
  static firstMediaUrl(value: unknown): string | null {
    if (!value || typeof value !== "object") return null;
    const record = value as Record<string, unknown>;
    for (const key of ["url", "file_url", "audio_url", "src"]) {
      const candidate = record[key];
      if (typeof candidate === "string" && /^https:\/\//i.test(candidate)) return candidate;
    }
    for (const [key, child] of Object.entries(record)) {
      if (/audio|voice|attachment|payload|media|image|video/i.test(key)) {
        const found = Array.isArray(child)
          ? child.map((c) => InstagramApiClient.firstMediaUrl(c)).find(Boolean)
          : InstagramApiClient.firstMediaUrl(child);
        if (found) return found || null;
      }
    }
    return null;
  }

  /**
   * Hidrata e resolve informações de anexo (foto ou nota de voz) consultando a Meta Graph API
   */
  static async resolvedAttachmentInfo(
    accessToken: string,
    message: any
  ): Promise<{ type: "audio" | "image" | "video" | "attachment" | "text"; url: string | null }> {
    const isIg = isInstagramToken(accessToken);
    const base = isIg ? INSTAGRAM_GRAPH_BASE : META_GRAPH_BASE;

    const attachments = Array.isArray(message.attachments)
      ? message.attachments
      : message.attachments?.data || [];
    const attachment = attachments[0];

    if (!attachment) {
      const deepUrl = InstagramApiClient.firstMediaUrl(message);
      if (deepUrl) {
        const isAudio = /audio|voice|\.m4a|\.wav|\.aac|\.mp3/i.test(deepUrl);
        return { type: isAudio ? "audio" : "image", url: deepUrl };
      }
      return { type: "text", url: null };
    }

    const payload = attachment.payload && typeof attachment.payload === "object" ? attachment.payload : {};
    const mime = String(attachment.mime_type || attachment.type || payload.mime_type || "").toLowerCase();
    const hasAudioData = Boolean(attachment.audio_data || payload.audio_data);
    const isVoice = mime.includes("audio") || mime.includes("voice") || hasAudioData;
    const isImage = mime.includes("image");
    const isVideo = mime.includes("video");

    const directUrl =
      attachment.file_url ||
      attachment.url ||
      attachment.audio_data?.url ||
      attachment.image_data?.url ||
      attachment.video_data?.url ||
      payload.url ||
      payload.file_url ||
      payload.audio_data?.url ||
      payload.image_data?.url ||
      payload.video_data?.url ||
      null;

    if (directUrl) {
      const finalType = isVoice ? "audio" : isVideo ? "video" : isImage ? "image" : "attachment";
      return { type: finalType, url: String(directUrl) };
    }

    // Se temos um ID de anexo mas a URL não veio diretamente, hidrata via Graph API
    const attachmentId = attachment.id;
    if (attachmentId && typeof attachmentId === "string") {
      for (const fields of [
        "id,mime_type,name,size,file_url,audio_data,image_data,video_data",
        "id,mime_type,name,size,file_url",
        "id,mime_type,file_url",
      ]) {
        try {
          const hydrateUrl = `${base}/${encodeURIComponent(attachmentId)}?fields=${fields}&access_token=${encodeURIComponent(
            accessToken
          )}`;
          const hydrateRes = await fetchWithTimeout(hydrateUrl, { method: "GET", cache: "no-store" }, 4000);
          if (hydrateRes.ok) {
            const hydrated = await hydrateRes.json();
            const hydratedUrl =
              hydrated.file_url ||
              hydrated.audio_data?.url ||
              hydrated.image_data?.url ||
              hydrated.video_data?.url ||
              InstagramApiClient.firstMediaUrl(hydrated);

            if (hydratedUrl) {
              const hMime = String(hydrated.mime_type || "").toLowerCase();
              const hType =
                hMime.includes("audio") || hydrated.audio_data
                  ? "audio"
                  : hMime.includes("video")
                    ? "video"
                    : "image";
              return { type: hType, url: String(hydratedUrl) };
            }
          }
        } catch {
          // Continua para o próximo conjunto de campos
        }
      }
    }

    const fallbackType = isVoice ? "audio" : isVideo ? "video" : isImage ? "image" : "attachment";
    return { type: fallbackType, url: null };
  }

  /**
   * Busca histórico de mensagens de uma conversa específica na API do Instagram,
   * incluindo anexos de fotos, mensagens de voz (áudios) e vídeos com hidratação completa.
   */
  static async getConversationMessages(
    accessToken: string,
    conversationId: string,
    limit: number = 50
  ): Promise<
    Array<{
      id: string;
      message?: string;
      created_time: string;
      from: { id: string; username: string };
      mediaUrl?: string;
      mediaType?: "image" | "audio" | "video";
      isUnsupported?: boolean;
    }>
  > {
    const isIg = isInstagramToken(accessToken);
    const base = isIg ? INSTAGRAM_GRAPH_BASE : META_GRAPH_BASE;

    let rawList: any[] = [];

    // 1. ESTRATÉGIA PRIORITÁRIA: Se conversationId for numérico (IGSID), busca via user_id na rota /me/conversations
    const isNumeric = /^\d+$/.test(conversationId);
    if (isIg && isNumeric) {
      try {
        const userConvUrl = `${base}/me/conversations?user_id=${conversationId}&fields=id,updated_time,messages.limit(${limit}){id,message,created_time,from,attachments{id,mime_type,file_url,image_data,video_data,audio_data},is_unsupported}&access_token=${encodeURIComponent(accessToken)}`;
        const userRes = await fetchWithTimeout(userConvUrl, { method: "GET", cache: "no-store" }, TIMEOUT_MS);
        if (userRes.ok) {
          const userData = await userRes.json();
          if (Array.isArray(userData.data) && userData.data.length > 0) {
            const thread = userData.data[0];
            if (Array.isArray(thread.messages?.data) && thread.messages.data.length > 0) {
              rawList = thread.messages.data;
            }
          }
        }
      } catch (userErr) {
        console.warn("Consulta via /me/conversations?user_id retornou aviso:", userErr);
      }
    }

    // 2. Consulta o nó da conversa diretamente (para IDs de thread string como aWdf...)
    if (rawList.length === 0 && isIg && !isNumeric) {
      try {
        const nodeFields = `id,updated_time,messages.limit(${limit}){id,message,created_time,from,attachments{id,mime_type,file_url,image_data,video_data,audio_data},is_unsupported}`;
        const nodeUrl = `${base}/${conversationId}?fields=${nodeFields}&access_token=${encodeURIComponent(accessToken)}`;
        const nodeRes = await fetchWithTimeout(nodeUrl, { method: "GET", cache: "no-store" }, TIMEOUT_MS);
        if (nodeRes.ok) {
          const nodeData = await nodeRes.json();
          if (Array.isArray(nodeData.messages?.data) && nodeData.messages.data.length > 0) {
            rawList = nodeData.messages.data;
          }
        }
      } catch (nodeErr) {
        console.warn("Consulta ao nó da conversa retornou fallback:", nodeErr);
      }
    }

    // 3. ESTRATÉGIA DE FALLBACK 1: Busca em lote via /me/conversations
    if (rawList.length === 0 && isIg) {
      try {
        const meConvUrl = `${base}/me/conversations?fields=id,messages.limit(${limit}){id,message,created_time,from,attachments{id,mime_type,file_url,image_data,video_data,audio_data},is_unsupported}&access_token=${encodeURIComponent(accessToken)}`;
        const meRes = await fetchWithTimeout(meConvUrl, { method: "GET", cache: "no-store" }, TIMEOUT_MS);
        if (meRes.ok) {
          const meData = await meRes.json();
          const target = (meData.data || []).find((c: any) => c.id === conversationId);
          if (target && Array.isArray(target.messages?.data) && target.messages.data.length > 0) {
            rawList = target.messages.data;
          }
        }
      } catch (meErr) {
        console.warn("Consulta via /me/conversations retornou fallback:", meErr);
      }
    }

    // 3. ESTRATÉGIA DE FALLBACK 2: Endpoint legado de messages (usado para tokens Facebook EAAB...)
    if (rawList.length === 0) {
      const fieldsWithMedia =
        "id,message,created_time,from,attachments{id,mime_type,file_url,image_data,video_data,audio_data},is_unsupported";
      const url = `${base}/${conversationId}/messages?fields=${fieldsWithMedia}&limit=${limit}&access_token=${encodeURIComponent(
        accessToken
      )}`;

      try {
        let res = await fetchWithTimeout(url, { method: "GET", cache: "no-store" }, TIMEOUT_MS);

        if (!res.ok && res.status === 400) {
          const basicUrl = `${base}/${conversationId}/messages?fields=id,message,created_time,from,is_unsupported&limit=${limit}&access_token=${encodeURIComponent(
            accessToken
          )}`;
          res = await fetchWithTimeout(basicUrl, { method: "GET", cache: "no-store" }, TIMEOUT_MS);
        }

        if (res.ok) {
          const data = await res.json();
          rawList = data?.data || [];
        } else if (res.status === 403 || res.status === 429) {
          // Apenas registra aviso para não interromper a exibição das mensagens já em cache
          console.warn(`Rate limit evitado na rota /{id}/messages (${res.status}).`);
        }
      } catch (legacyErr) {
        console.warn("Fallback legado de mensagens indisponível:", legacyErr);
      }
    }

    return Promise.all(
      rawList.map(async (item: any) => {
        const resolved = await InstagramApiClient.resolvedAttachmentInfo(accessToken, item);

        let mediaUrl = resolved.url || undefined;
        let mediaType: "image" | "audio" | "video" | undefined =
          resolved.type === "text" || resolved.type === "attachment"
            ? undefined
            : (resolved.type as "image" | "audio" | "video");

        if (!item.message && !mediaUrl && (item.is_unsupported || resolved.type === "audio")) {
          mediaType = "audio";
        }

        return {
          id: item.id,
          message: item.message,
          created_time: item.created_time,
          from: item.from || { id: "unknown", username: "unknown" },
          mediaUrl,
          mediaType,
          isUnsupported: Boolean(item.is_unsupported),
        };
      })
    );
  }

  /**
   * Envia uma mensagem de texto, foto ou áudio no Direct do Instagram
   * Suporta payloads com attachment oficial da Meta (audio, image).
   */
  static async sendMessage(
    accessToken: string,
    pageIdOrAccountId: string,
    recipientOrConversationId: string,
    input:
      | string
      | {
          text?: string;
          audioUrl?: string;
          mediaUrl?: string;
          mediaType?: "audio" | "image" | "video";
          replyToMessageId?: string;
        },
    myUsername?: string
  ): Promise<MetaSendResponse> {
    const isIg = isInstagramToken(accessToken);
    const payloadInput = typeof input === "string" ? { text: input } : input;

    const text = payloadInput.text?.trim();
    const audioUrl = payloadInput.audioUrl?.trim();
    const mediaUrl = payloadInput.mediaUrl?.trim();

    // Constrói objeto de mensagem compatível com a Meta Graph API
    let messagePayload: any;
    if (audioUrl) {
      messagePayload = {
        attachment: {
          type: "audio",
          payload: { url: audioUrl },
        },
      };
    } else if (mediaUrl) {
      messagePayload = {
        attachment: {
          type: "image",
          payload: { url: mediaUrl },
        },
      };
    } else {
      messagePayload = {
        text: text || "",
      };
    }

    if (isIg) {
      let targetRecipientId = recipientOrConversationId;

      // Se o ID passado for uma thread do Instagram (começa com aWdf...), resolve o ID do usuário de destino
      if (recipientOrConversationId.startsWith("aWdf")) {
        try {
          const detailUrl = `${INSTAGRAM_GRAPH_BASE}/${recipientOrConversationId}?fields=participants&access_token=${encodeURIComponent(
            accessToken
          )}`;
          const detailRes = await fetchWithTimeout(detailUrl, { method: "GET", cache: "no-store" }, TIMEOUT_MS);
          if (detailRes.ok) {
            const detailData = await detailRes.json();
            const contact = detailData?.participants?.data?.find(
              (p: any) =>
                p.username !== myUsername &&
                p.id !== pageIdOrAccountId &&
                p.username !== "lariresende_0611"
            );
            if (contact?.id) {
              targetRecipientId = contact.id;
            }
          }
        } catch {
          // Mantém targetRecipientId caso a resolução falhe
        }
      }

      const url = `${INSTAGRAM_GRAPH_BASE}/me/messages?access_token=${encodeURIComponent(accessToken)}`;
      const payload: any = {
        recipient: {
          id: targetRecipientId,
        },
        message: messagePayload,
      };

      if (payloadInput.replyToMessageId) {
        payload.reply_to = { mid: payloadInput.replyToMessageId };
        payload.messaging_type = "RESPONSE";
      }

      console.log("📤 [Instagram Reply - Meta Client] Enviando para Instagram Graph API:", {
        url: `${INSTAGRAM_GRAPH_BASE}/me/messages`,
        targetRecipientId,
        replyToMessageId: payloadInput.replyToMessageId,
        payload: JSON.stringify(payload),
      });

      let res = await fetchWithTimeout(
        url,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
          cache: "no-store",
        },
        TIMEOUT_MS
      );

      // Fallback resiliente: se falhou e havia reply_to, tenta enviar sem reply_to para não perder a mensagem
      if (!res.ok && payloadInput.replyToMessageId) {
        const errWithReply = await res.clone().text();
        console.warn("⚠️ [Instagram Reply - Meta Client] Falha ao enviar com reply_to. Tentando reenvio direto:", {
          status: res.status,
          error: errWithReply,
        });

        const fallbackPayload = {
          recipient: { id: targetRecipientId },
          message: messagePayload,
        };

        const retryRes = await fetchWithTimeout(
          url,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(fallbackPayload),
            cache: "no-store",
          },
          TIMEOUT_MS
        );

        if (retryRes.ok) {
          res = retryRes;
          console.log("✅ [Instagram Reply - Meta Client] Reenvio direto sem citação obteve sucesso!");
        }
      }

      checkResponseStatus(res, "sendMessage:Instagram");

      if (!res.ok) {
        const err = await res.text();
        console.error("❌ [Instagram Reply - Meta Client] Erro final da Meta Graph API:", {
          status: res.status,
          error: err,
        });
        throw new Error(`Falha ao enviar mensagem no Instagram (${res.status}): ${err}`);
      }

      const data: MetaSendResponse = await res.json();
      console.log("📥 [Instagram Reply - Meta Client] Resposta de sucesso da Meta:", data);
      return data;
    }

    // Fluxo Facebook Graph API
    const url = `${META_GRAPH_BASE}/${pageIdOrAccountId}/messages?access_token=${encodeURIComponent(
      accessToken
    )}`;

    const payload: any = {
      recipient: {
        id: recipientOrConversationId,
      },
      message: messagePayload,
      messaging_type: "RESPONSE",
    };

    if (payloadInput.replyToMessageId) {
      payload.reply_to = { mid: payloadInput.replyToMessageId };
    }

    console.log("📤 [Instagram Reply - Meta Client] Enviando para Facebook Graph API:", {
      url: `${META_GRAPH_BASE}/${pageIdOrAccountId}/messages`,
      recipientId: recipientOrConversationId,
      replyToMessageId: payloadInput.replyToMessageId,
      payload: JSON.stringify(payload),
    });

    let res = await fetchWithTimeout(
      url,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
        cache: "no-store",
      },
      TIMEOUT_MS
    );

    // Fallback resiliente: se falhou e havia reply_to, tenta enviar sem reply_to
    if (!res.ok && payloadInput.replyToMessageId) {
      const errWithReply = await res.clone().text();
      console.warn("⚠️ [Instagram Reply - Meta Client] Falha ao enviar com reply_to (Facebook). Tentando reenvio direto:", {
        status: res.status,
        error: errWithReply,
      });

      const fallbackPayload = {
        recipient: { id: recipientOrConversationId },
        message: messagePayload,
        messaging_type: "RESPONSE",
      };

      const retryRes = await fetchWithTimeout(
        url,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(fallbackPayload),
          cache: "no-store",
        },
        TIMEOUT_MS
      );

      if (retryRes.ok) {
        res = retryRes;
        console.log("✅ [Instagram Reply - Meta Client] Reenvio direto sem citação obteve sucesso!");
      }
    }

    checkResponseStatus(res, "sendMessage:Facebook");

    if (!res.ok) {
      const err = await res.text();
      console.error("❌ [Instagram Reply - Meta Client] Erro final da Facebook Graph API:", {
        status: res.status,
        error: err,
      });
      throw new Error(`Falha ao enviar mensagem no Instagram (${res.status}): ${err}`);
    }

    const data: MetaSendResponse = await res.json();
    console.log("📥 [Instagram Reply - Meta Client] Resposta de sucesso da Meta:", data);
    return data;
  }
}
