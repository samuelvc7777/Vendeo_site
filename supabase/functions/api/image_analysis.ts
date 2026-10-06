export interface ResolvedImageResult {
  text: string;
  isImage: boolean;
  hasValidDescription: boolean;
  description: string | null;
  analysisError: string | null;
}

const IMAGE_MODEL = "gpt-6-luna";
const IMAGE_SERVICE_TIER = "flex";
const MAX_DESCRIPTION_CHARS = 1200;

function envOpenAiKey(): string {
  try {
    if (typeof Deno !== "undefined") return String(Deno.env.get("OPENAI_API_KEY") || "").trim();
  } catch {}
  try {
    return String(process?.env?.OPENAI_API_KEY || "").trim();
  } catch {
    return "";
  }
}

async function getOpenAiApiKey(supabase: any): Promise<string | null> {
  const envKey = envOpenAiKey();
  if (envKey) return envKey;
  const { data, error } = await supabase
    .from("instagram_config")
    .select("app_secret")
    .eq("id", "openai_api_key")
    .maybeSingle();
  const key = String(data?.app_secret || "").trim();
  if (error || !key) return null;
  return key;
}

function responseText(payload: any): string {
  const direct = String(payload?.output_text || "").trim();
  if (direct) return direct;
  const output = Array.isArray(payload?.output) ? payload.output : [];
  const texts: string[] = [];
  for (const item of output) {
    for (const content of Array.isArray(item?.content) ? item.content : []) {
      if (content?.type === "output_text" && typeof content?.text === "string") {
        texts.push(content.text);
      }
    }
  }
  return texts.join("\n").trim();
}

export async function describeImageWithLunaFlex(
  supabase: any,
  imageUrl: string,
): Promise<string | null> {
  const url = String(imageUrl || "").trim();
  if (!url.startsWith("http")) return null;
  const apiKey = await getOpenAiApiKey(supabase);
  if (!apiKey) throw new Error("openai_api_key_missing_for_image_analysis");

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 180_000);
  const requestBody = {
    model: IMAGE_MODEL,
    store: false,
    reasoning: { effort: "none" },
    max_output_tokens: 180,
    input: [{
      role: "user",
      content: [
        {
          type: "input_text",
          text: [
            "Descreva objetivamente esta imagem ou figurinha recebida em uma conversa do WhatsApp/Instagram.",
            "Se for figurinha, descreva o gesto, expressão, objeto e texto visível para que outra IA consiga responder naturalmente ao contexto.",
            "Use no máximo 3 frases curtas em português do Brasil.",
            "Inclua pessoas, cenário, objetos, ação e texto legível quando forem relevantes.",
            "Não invente identidade, relação, intenção, diagnóstico ou emoção incerta.",
            "Não converse com o usuário e não mencione que você é uma IA.",
          ].join(" "),
        },
        { type: "input_image", image_url: url, detail: "low" },
      ],
    }],
  };

  const callImageModel = async (useFlex: boolean) => {
    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(useFlex ? { ...requestBody, service_tier: IMAGE_SERVICE_TIER } : requestBody),
      signal: controller.signal,
    });
    const payload = await response.json().catch(() => ({}));
    return { response, payload };
  };

  try {
    let { response, payload } = await callImageModel(true);
    const providerMessage = String(payload?.error?.message || "");
    if (
      response.status === 429 &&
      /flex processing is temporarily unavailable/i.test(providerMessage)
    ) {
      ({ response, payload } = await callImageModel(false));
    }
    if (!response.ok) {
      throw new Error(`image_analysis_http_${response.status}:${String(payload?.error?.message || "").slice(0, 400)}`);
    }
    const description = responseText(payload)
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, MAX_DESCRIPTION_CHARS);
    return description || null;
  } finally {
    clearTimeout(timeout);
  }
}

export async function resolveInboundImageMessage(
  supabase: any,
  msg: {
    id?: string;
    text?: string | null;
    media_type?: string | null;
    mediaType?: string | null;
    media_url?: string | null;
    mediaUrl?: string | null;
    image_description?: string | null;
    imageDescription?: string | null;
    media_operator_observation?: string | null;
    mediaOperatorObservation?: string | null;
  },
): Promise<ResolvedImageResult> {
  const rawText = String(msg.text || "").trim();
  const mediaType = String(msg.media_type || msg.mediaType || "").toLowerCase();
  const isSticker = mediaType === "sticker" || rawText.startsWith("[sticker:");
  const isImage = mediaType === "image" || rawText.startsWith("[image:") || isSticker;
  if (!isImage) {
    return { text: rawText, isImage: false, hasValidDescription: false, description: null, analysisError: null };
  }

  const operatorObservation = String(
    msg.media_operator_observation || msg.mediaOperatorObservation || "",
  ).trim();
  if (operatorObservation) {
    return {
      text: isSticker
        ? `[FIGURINHA OBSERVADA PELO OPERADOR]\n${operatorObservation}`
        : `[IMAGEM OBSERVADA PELO OPERADOR]\n${operatorObservation}`,
      isImage: true,
      hasValidDescription: true,
      description: operatorObservation,
      analysisError: null,
    };
  }

  const existing = String(msg.image_description || msg.imageDescription || "").trim();
  if (existing) {
    return {
      text: isSticker
        ? `[FIGURINHA RECEBIDA — descrição visual automática]\n${existing}`
        : `[IMAGEM RECEBIDA — descrição visual automática]\n${existing}`,
      isImage: true,
      hasValidDescription: true,
      description: existing,
      analysisError: null,
    };
  }

  const imageUrl = String(msg.media_url || msg.mediaUrl || "").trim()
    || rawText.match(/\[(?:image|sticker):(https?:\/\/[^\]]+)\]/)?.[1]
    || "";
  if (!imageUrl) {
    return {
      text: "[imagem recebida — descrição indisponível]",
      isImage: true,
      hasValidDescription: false,
      description: null,
      analysisError: "URL de imagem ausente ou inválida",
    };
  }

  try {
    const description = await describeImageWithLunaFlex(supabase, imageUrl);
    if (!description) {
      return {
        text: "[imagem recebida — descrição indisponível]",
        isImage: true,
        hasValidDescription: false,
        description: null,
        analysisError: "Luna não retornou descrição da imagem",
      };
    }

    if (msg.id) {
      await supabase
        .from("instagram_messages")
        .update({
          image_description: description,
          image_described_at: new Date().toISOString(),
          image_description_error: null,
        })
        .eq("id", msg.id);
    }

    return {
      text: isSticker
        ? `[FIGURINHA RECEBIDA — descrição visual automática]\n${description}`
        : `[IMAGEM RECEBIDA — descrição visual automática]\n${description}`,
      isImage: true,
      hasValidDescription: true,
      description,
      analysisError: null,
    };
  } catch (error: any) {
    const message = String(error?.message || error || "Falha na análise da imagem").slice(0, 1000);
    if (msg.id) {
      await supabase
        .from("instagram_messages")
        .update({ image_description_error: message })
        .eq("id", msg.id);
    }
    return {
      text: "[imagem recebida — descrição indisponível]",
      isImage: true,
      hasValidDescription: false,
      description: null,
      analysisError: message,
    };
  }
}
