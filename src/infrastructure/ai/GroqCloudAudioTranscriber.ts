import { getSupabaseServerClient } from "@/infrastructure/supabase/server";

export interface TranscribeResult {
  text: string;
  model: string;
  cached?: boolean;
}

export class GroqCloudAudioTranscriber {
  private static readonly GROQ_API_URL = "https://api.groq.com/openai/v1/audio/transcriptions";
  private static readonly DEFAULT_MODEL = "whisper-large-v3";

  /**
   * Recupera a chave de API da Groq do ambiente ou do banco de dados Supabase.
   */
  public static async getApiKey(): Promise<string | null> {
    const envKey = (process.env.GROQ_API_KEY || "").trim();
    if (envKey) return envKey;

    try {
      const supabase = getSupabaseServerClient();
      if (supabase) {
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
      console.warn("Aviso ao buscar chave da Groq no banco:", err);
    }

    return null;
  }

  /**
   * Salva a chave de API da Groq na tabela instagram_config do Supabase.
   */
  public static async setApiKey(apiKey: string): Promise<boolean> {
    try {
      const supabase = getSupabaseServerClient();
      if (!supabase) return false;

      const { error } = await supabase
        .from("instagram_config")
        .upsert({
          id: "groq_api_key",
          app_secret: apiKey.trim(),
          updated_at: new Date().toISOString(),
        });

      if (error) {
        console.error("[GroqCloudAudioTranscriber] Erro ao salvar chave:", error);
        return false;
      }
      return true;
    } catch (err) {
      console.error("[GroqCloudAudioTranscriber] Exceção ao salvar chave:", err);
      return false;
    }
  }

  /**
   * Transcreve um áudio a partir de uma URL pública ou de CDN.
   */
  public static async transcribeFromUrl(
    mediaUrl: string,
    providedKey?: string
  ): Promise<string | null> {
    const apiKey = (providedKey || (await this.getApiKey()) || "").trim();
    if (!apiKey) {
      console.warn("[GroqCloudAudioTranscriber] Nenhuma chave GROQ_API_KEY configurada.");
      return null;
    }

    try {
      // 1. Baixa os bytes do áudio
      const audioResponse = await fetch(mediaUrl, {
        signal: AbortSignal.timeout(15_000),
      });

      if (!audioResponse.ok) {
        console.warn(`[GroqCloudAudioTranscriber] Falha ao baixar áudio: HTTP ${audioResponse.status}`);
        return null;
      }

      const rawBytes = await audioResponse.arrayBuffer();
      if (!rawBytes || rawBytes.byteLength === 0) {
        return null;
      }

      const detectedMime = audioResponse.headers.get("content-type")?.split(";")[0] || "audio/m4a";
      const mimeType = detectedMime === "application/octet-stream" ? "audio/m4a" : detectedMime;

      let extension = "m4a";
      if (mimeType.includes("mp3") || mimeType.includes("mpeg")) extension = "mp3";
      else if (mimeType.includes("ogg")) extension = "ogg";
      else if (mimeType.includes("wav")) extension = "wav";
      else if (mimeType.includes("webm")) extension = "webm";
      else if (mimeType.includes("mp4")) extension = "m4a";

      // 2. Monta o FormData para a Groq
      const formData = new FormData();
      const audioBlob = new Blob([rawBytes], { type: mimeType });
      formData.set("file", audioBlob, `audio.${extension}`);
      formData.set("model", this.DEFAULT_MODEL);
      formData.set("language", "pt");
      formData.set("temperature", "0");
      formData.set("response_format", "json");

      // 3. Disparo na Groq Cloud
      const groqResponse = await fetch(this.GROQ_API_URL, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
        },
        body: formData,
        signal: AbortSignal.timeout(30_000),
      });

      const payload = await groqResponse.json().catch(() => ({}));

      if (!groqResponse.ok) {
        console.error(
          `[GroqCloudAudioTranscriber] Erro da API Groq: HTTP ${groqResponse.status}`,
          payload?.error || payload
        );
        return null;
      }

      const transcript = typeof payload?.text === "string" ? payload.text.trim() : "";
      return transcript || null;
    } catch (err: unknown) {
      console.error(
        "[GroqCloudAudioTranscriber] Exceção durante a transcrição:",
        err instanceof Error ? err.message : String(err)
      );
      return null;
    }
  }

  /**
   * Transcreve diretamente a partir de um buffer de bytes ou File.
   */
  public static async transcribeFromBytes(
    bytes: ArrayBuffer | Uint8Array,
    mimeType = "audio/m4a",
    providedKey?: string
  ): Promise<string | null> {
    const apiKey = (providedKey || (await this.getApiKey()) || "").trim();
    if (!apiKey) {
      return null;
    }

    try {
      let extension = "m4a";
      if (mimeType.includes("mp3") || mimeType.includes("mpeg")) extension = "mp3";
      else if (mimeType.includes("ogg")) extension = "ogg";
      else if (mimeType.includes("wav")) extension = "wav";
      else if (mimeType.includes("webm")) extension = "webm";

      const formData = new FormData();
      const audioBlob = new Blob([bytes as any], { type: mimeType });
      formData.set("file", audioBlob, `audio.${extension}`);
      formData.set("model", this.DEFAULT_MODEL);
      formData.set("language", "pt");
      formData.set("temperature", "0");
      formData.set("response_format", "json");

      const groqResponse = await fetch(this.GROQ_API_URL, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
        },
        body: formData,
        signal: AbortSignal.timeout(30_000),
      });

      const payload = await groqResponse.json().catch(() => ({}));
      if (!groqResponse.ok) return null;

      const transcript = typeof payload?.text === "string" ? payload.text.trim() : "";
      return transcript || null;
    } catch {
      return null;
    }
  }
}
