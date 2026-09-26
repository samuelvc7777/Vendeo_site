import { GroqCloudAudioTranscriber } from "./GroqCloudAudioTranscriber";
import { AiStructuredResponse } from "@/domain/entities/AiPrompt";
import { normalizeIndices } from "@/lib/aiResponseNormalizer";

export interface GroqChatCompletionOptions {
  model?: string;
  temperature?: number;
  maxTokens?: number;
  timeoutMs?: number;
}

export interface GroqChatCompletionResult {
  text: string;
  parsed: AiStructuredResponse;
  model: string;
  latencyMs: number;
}

export class GroqChatService {
  private static readonly GROQ_API_URL = "https://api.groq.com/openai/v1/chat/completions";
  public static readonly DEFAULT_MODEL = "qwen/qwen3.8-27b";
  public static readonly DEEPSEEK_FLASH = "qwen/qwen3.8-27b";
  public static readonly QWEN_27B = "qwen/qwen3.8-27b";
  public static readonly GPT_OSS_120B = "openai/gpt-oss-120b";
  public static readonly DEEP_MODEL = "openai/gpt-oss-120b";
  public static readonly DEEPSEEK_V4_PRO = "deepseek-ai/deepseek-v4-flash-0731";
  public static readonly KIMI_K3 = "moonshotai/kimi-k3";
  public static readonly BAI_MODEL = "qwen3.8-flash";

  /**
   * Envia o prompt para a API da Groq e retorna o JSON estruturado das mensagens da Larissa.
   */
  public static async generateChatResponse(
    prompt: string,
    options?: GroqChatCompletionOptions
  ): Promise<GroqChatCompletionResult> {
    const startTime = Date.now();
    const apiKey = await GroqCloudAudioTranscriber.getApiKey();

    if (!apiKey) {
      throw new Error(
        "Chave de API da Groq não encontrada. Configure GROQ_API_KEY ou salve no Supabase."
      );
    }

    const model = options?.model || this.DEFAULT_MODEL;
    const temperature = options?.temperature ?? 0.7;
    const maxTokens = options?.maxTokens ?? 400;
    const timeoutMs = options?.timeoutMs ?? 20000;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const payloadBody: Record<string, any> = {
        model,
        messages: [{ role: "user", content: prompt }],
        temperature,
        max_tokens: maxTokens,
      };

      if (model.includes("qwen3.8")) {
        payloadBody.response_format = { type: "json_object" };
      }

      let response = await fetch(this.GROQ_API_URL, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
          "User-Agent": "Vendeo-Ai/1.0",
        },
        body: JSON.stringify(payloadBody),
        signal: controller.signal,
      });

      // Se falhar com 400 json_validate_failed, tenta uma vez sem response_format
      if (!response.ok && payloadBody.response_format) {
        delete payloadBody.response_format;
        response = await fetch(this.GROQ_API_URL, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json",
            "User-Agent": "Vendeo-Ai/1.0",
          },
          body: JSON.stringify(payloadBody),
          signal: controller.signal,
        });
      }

      clearTimeout(timer);

      if (!response.ok) {
        const errBody = await response.text();
        throw new Error(
          `Erro na API da Groq (${response.status}): ${errBody || response.statusText}`
        );
      }

      const data = await response.json();
      const rawContent = data?.choices?.[0]?.message?.content || "";
      const latencyMs = Date.now() - startTime;

      const parsed = this.extractAndValidateJson(rawContent);

      return {
        text: rawContent,
        parsed,
        model: data?.model || model,
        latencyMs,
      };
    } catch (err: any) {
      clearTimeout(timer);
      if (err.name === "AbortError") {
        throw new Error(`Tempo limite excedido na requisição para a Groq (${timeoutMs / 1000}s).`);
      }
      throw err;
    }
  }

  /**
   * Extração resiliente de JSON estruturado mesmo se o modelo envolver em markdown ou tags de raciocínio.
   */
  public static extractAndValidateJson(rawText: string): AiStructuredResponse {
    let clean = rawText.replace(/<think>[\s\S]*?<\/think>/gi, "").trim();

    // 1. Bloco marcado como ```json ... ```
    const markdownMatch = clean.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
    if (markdownMatch && markdownMatch[1]) {
      clean = markdownMatch[1].trim();
    } else {
      // 2. Procura pelo primeiro { e último }
      const firstBrace = clean.indexOf("{");
      const lastBrace = clean.lastIndexOf("}");
      if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
        clean = clean.slice(firstBrace, lastBrace + 1);
      }
    }

    let parsedObj: any;
    try {
      parsedObj = JSON.parse(clean);
    } catch (parseErr) {
      throw new Error(`Resposta da IA não contém um JSON válido: ${rawText.slice(0, 150)}...`);
    }

    // Normalização das respostas
    let responses: string[] = [];
    if (Array.isArray(parsedObj.responses)) {
      responses = parsedObj.responses
        .map((r: any) => (typeof r === "string" ? r.trim() : ""))
        .filter(Boolean);
    } else if (typeof parsedObj.response === "string" && parsedObj.response.trim()) {
      responses = [parsedObj.response.trim()];
    }

    if (responses.length === 0) {
      throw new Error("A IA gerou uma resposta, mas não incluiu balões na lista 'responses'.");
    }

    // Limpeza de pontuação robótica final indesejada (garantia de estilometria casual mobile)
    responses = responses.map((text) => this.cleanCasualPunctuation(text));

    const indices = normalizeIndices(responses, parsedObj.indices);

    const completedChecklistIds = Array.isArray(parsedObj.completedChecklistIds)
      ? parsedObj.completedChecklistIds.map(String)
      : Array.isArray(parsedObj.completed_checklist_ids)
      ? parsedObj.completed_checklist_ids.map(String)
      : undefined;

    const isRaffleStepReached = Boolean(parsedObj.isRaffleStepReached || parsedObj.is_raffle_step_reached);

    return {
      responses,
      indices,
      completedChecklistIds,
      isRaffleStepReached,
      raffle_readiness: parsedObj.raffle_readiness,
    };
  }

  /**
   * Remove ponto final formal no término de mensagens curtas casuais (regra anti-robô).
   */
  private static cleanCasualPunctuation(text: string): string {
    let cleaned = text.trim();
    // Preserva tags de áudio e imagem intactas
    if (cleaned.startsWith("[audio:") || cleaned.startsWith("[image:") || cleaned.startsWith("[video:")) {
      return cleaned;
    }
    // Se terminar com ponto final simples (mas não com reticências ... nem emoji), remove o ponto final
    if (cleaned.endsWith(".") && !cleaned.endsWith("..")) {
      cleaned = cleaned.slice(0, -1).trim();
    }
    return cleaned;
  }
}
