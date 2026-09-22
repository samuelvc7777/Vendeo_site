// audio_transcription.ts
// Módulo Oficial de Transcrição de Áudio Inbound com Groq Whisper Large v3 (pt)

/**
 * Obtém a chave da API Groq a partir das variáveis de ambiente ou tabela instagram_config do Supabase.
 */
export async function getGroqApiKey(supabase: any): Promise<string | null> {
  const envKey = (
    typeof Deno !== "undefined"
      ? Deno.env.get("GROQ_API_KEY")
      : typeof process !== "undefined"
      ? process.env.GROQ_API_KEY
      : ""
  ) || "";

  if (envKey.trim()) return envKey.trim();

  try {
    if (supabase && typeof supabase.from === "function") {
      const { data } = await supabase
        .from("instagram_config")
        .select("app_secret")
        .eq("id", "groq_api_key")
        .maybeSingle();

      if (data?.app_secret?.startsWith("gsk_")) {
        return data.app_secret.trim();
      }
    }
  } catch (err) {
    console.warn("[getGroqApiKey] Aviso ao buscar chave da Groq no Supabase:", err);
  }
  return null;
}

/**
 * Transcreve um arquivo de áudio acessível via URL usando o Groq Cloud Whisper Large v3 em português.
 */
export async function transcribeWithGroqCloud(
  supabase: any,
  mediaUrl: string,
  providedKey?: string
): Promise<string | null> {
  const apiKey = (providedKey || (await getGroqApiKey(supabase)) || "").trim();
  if (!apiKey) {
    console.warn("[transcribeWithGroqCloud] Nenhuma chave GROQ_API_KEY configurada.");
    return null;
  }

  try {
    const audioRes = await fetch(mediaUrl, { signal: AbortSignal.timeout(15_000) });
    if (!audioRes.ok) {
      console.warn(`[transcribeWithGroqCloud] Falha ao baixar áudio: HTTP ${audioRes.status}`);
      return null;
    }

    const rawBytes = await audioRes.arrayBuffer();
    if (!rawBytes || rawBytes.byteLength === 0) return null;

    const detectedMime = audioRes.headers.get("content-type")?.split(";")[0] || "audio/m4a";
    const mimeType = detectedMime === "application/octet-stream" ? "audio/m4a" : detectedMime;

    let extension = "m4a";
    if (mimeType.includes("mp3") || mimeType.includes("mpeg")) extension = "mp3";
    else if (mimeType.includes("ogg")) extension = "ogg";
    else if (mimeType.includes("wav")) extension = "wav";
    else if (mimeType.includes("webm")) extension = "webm";
    else if (mimeType.includes("mp4")) extension = "m4a";

    const form = new FormData();
    const audioBlob = new Blob([rawBytes], { type: mimeType });
    form.set("file", audioBlob, `audio.${extension}`);
    form.set("model", "whisper-large-v3");
    form.set("language", "pt");
    form.set("temperature", "0");
    form.set("response_format", "json");

    const groqRes = await fetch("https://api.groq.com/openai/v1/audio/transcriptions", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}` },
      body: form,
      signal: AbortSignal.timeout(30_000),
    });

    const payload = await groqRes.json().catch(() => ({}));
    if (!groqRes.ok) {
      console.error(`[transcribeWithGroqCloud] Erro Groq HTTP ${groqRes.status}:`, payload);
      return null;
    }

    const text = typeof payload?.text === "string" ? payload.text.trim() : "";
    return text || null;
  } catch (err: unknown) {
    console.error("[transcribeWithGroqCloud] Exceção na transcrição:", err);
    return null;
  }
}

export interface ResolvedAudioResult {
  text: string;
  isAudio: boolean;
  hasValidTranscript: boolean;
  transcript: string | null;
  /** Mensagem de erro quando a transcrição falha. null quando ok ou quando não é áudio. */
  transcriptionError: string | null;
}

/**
 * Resolve o conteúdo de áudio inbound de forma determinística:
 * 1. Se já existe audio_transcript no banco/objeto, reutiliza imediatamente (cache / 0 custo).
 * 2. Se for áudio e não houver transcrição, tenta transcrever com Groq Cloud Whisper Large v3.
 * 3. Se transcrito com sucesso, persiste no Supabase (audio_transcript, audio_transcribed_at).
 * 4. Se falhar, registra erro no banco e retorna marcador explícito sem inventar conteúdo.
 */
export async function resolveInboundAudioMessage(
  supabase: any,
  msg: {
    id?: string;
    text?: string | null;
    media_type?: string | null;
    mediaType?: string | null;
    media_url?: string | null;
    mediaUrl?: string | null;
    audio_transcript?: string | null;
    audioTranscript?: string | null;
  }
): Promise<ResolvedAudioResult> {
  const rawText = String(msg.text || "").trim();
  const mediaType = msg.media_type || msg.mediaType;
  const isAudio =
    mediaType === "audio" ||
    rawText.startsWith("[audio:") ||
    rawText.includes("[audio:");

  if (!isAudio) {
    return {
      text: rawText,
      isAudio: false,
      hasValidTranscript: false,
      transcript: null,
      transcriptionError: null,
    };
  }

  // 1. Já existe áudio transcrito em cache/banco?
  const existingTranscript = (msg.audio_transcript || msg.audioTranscript || "").trim();
  if (existingTranscript) {
    return {
      text: existingTranscript,
      isAudio: true,
      hasValidTranscript: true,
      transcript: existingTranscript,
      transcriptionError: null,
    };
  }

  // 2. Extrai media_url se não estiver explícita
  let audioUrl = msg.media_url || msg.mediaUrl;
  if (!audioUrl && rawText.includes("[audio:")) {
    const match = rawText.match(/\[audio:(.*?)\]/);
    if (match?.[1]) audioUrl = match[1];
  }

  if (!audioUrl || !audioUrl.startsWith("http")) {
    return {
      text: "[áudio recebido — transcrição indisponível]",
      isAudio: true,
      hasValidTranscript: false,
      transcript: null,
      transcriptionError: "URL de áudio ausente ou inválida",
    };
  }

  // 3. Tenta transcrever com Groq Cloud Whisper Large v3
  try {
    const transcript = await transcribeWithGroqCloud(supabase, audioUrl);
    if (transcript && transcript.trim()) {
      const cleanTranscript = transcript.trim();
      // UPDATE seguro: usado nos paths onde a linha já existe (cron-tick, trigger, send-now).
      // No webhook o caller usa o retorno para incluir no upsert — sem risco de UPDATE em linha inexistente.
      if (msg.id && supabase && typeof supabase.from === "function") {
        await supabase
          .from("instagram_messages")
          .update({
            audio_transcript: cleanTranscript,
            audio_transcribed_at: new Date().toISOString(),
            audio_transcription_error: null,
          })
          .eq("id", msg.id);
      }
      return {
        text: cleanTranscript,
        isAudio: true,
        hasValidTranscript: true,
        transcript: cleanTranscript,
        transcriptionError: null,
      };
    } else {
      const errMsg = "Falha na transcrição ou áudio inaudível";
      // Não fazemos UPDATE aqui pois no path do webhook a linha ainda não existe.
      // O caller (webhook) inclui transcriptionError no upsert inicial.
      // Nos paths cron/trigger a linha já existe; o UPDATE seria seguro mas desnecessário
      // pois o campo fica persistido via retorno.
      return {
        text: "[áudio recebido — transcrição indisponível]",
        isAudio: true,
        hasValidTranscript: false,
        transcript: null,
        transcriptionError: errMsg,
      };
    }
  } catch (err: any) {
    console.error(`[resolveInboundAudioMessage] Erro ao transcrever áudio ${msg.id}:`, err);
    const errMsg = String(err?.message || err || "Erro desconhecido na transcrição");
    return {
      text: "[áudio recebido — transcrição indisponível]",
      isAudio: true,
      hasValidTranscript: false,
      transcript: null,
      transcriptionError: errMsg,
    };
  }
}
