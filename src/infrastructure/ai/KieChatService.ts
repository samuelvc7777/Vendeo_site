import { getSupabaseAdminClient, getSupabaseServerClient } from "@/infrastructure/supabase/server";
import { AiStructuredResponse } from "@/domain/entities/AiPrompt";
import { normalizeIndices } from "@/lib/aiResponseNormalizer";
import { GroqChatCompletionResult } from "./GroqChatService";

export interface KieChatCompletionOptions {
  model?: string;
  reasoningEffort?: "low" | "medium" | "high";
  timeoutMs?: number;
}

export class KieChatService {
  private static readonly KIE_API_URL = "https://api.kie.ai/codex/v1/responses";
  public static readonly SOL_MODEL = "gpt-5-6-sol";
  public static readonly TERRA_MODEL = "gpt-5-6-terra";
  public static readonly DEFAULT_MODEL = "gpt-5-6-sol";

  /**
   * Recupera a chave da Kie.ai do ambiente ou do banco Supabase (instagram_config).
   */
  public static async getApiKey(): Promise<string | null> {
    const envKey = (process.env.KIE_API_KEY || "").trim();
    if (envKey) return envKey;

    try {
      const supabase = getSupabaseAdminClient() || getSupabaseServerClient();
      if (supabase) {
        const { data } = await supabase
          .from("instagram_config")
          .select("app_secret")
          .eq("id", "kie_api_key")
          .maybeSingle();

        if (typeof data?.app_secret === "string" && data.app_secret.trim()) {
          return data.app_secret.trim();
        }
      }
    } catch (err) {
      console.warn("[KieChatService] Erro ao buscar kie_api_key no Supabase:", err);
    }

    // Fallback padrão configurado via variável de ambiente
    return process.env.KIE_API_KEY || "";
  }

  /**
   * Salva a chave de API da Kie.ai na tabela instagram_config do Supabase.
   */
  public static async setApiKey(apiKey: string): Promise<boolean> {
    try {
      const supabase = getSupabaseAdminClient() || getSupabaseServerClient();
      if (!supabase) return false;

      const { error } = await supabase
        .from("instagram_config")
        .upsert({
          id: "kie_api_key",
          app_secret: apiKey.trim(),
          updated_at: new Date().toISOString(),
        });

      if (error) {
        console.error("[KieChatService] Erro ao salvar chave:", error);
        return false;
      }
      return true;
    } catch (err) {
      console.error("[KieChatService] Exceção ao salvar chave:", err);
      return false;
    }
  }

  /**
   * Extrai o texto limpo da resposta SSE / payload da Kie.ai.
   */
  public static extractKieResponseText(rawTextOrPayload: any): string {
    if (!rawTextOrPayload) return "";
    if (typeof rawTextOrPayload === "object") {
      if (typeof rawTextOrPayload.output_text === "string") return rawTextOrPayload.output_text;
      if (Array.isArray(rawTextOrPayload.output)) {
        return rawTextOrPayload.output
          .flatMap((item: any) => (Array.isArray(item?.content) ? item.content : []))
          .map((content: any) => (typeof content?.text === "string" ? content.text : ""))
          .filter(Boolean)
          .join("\n");
      }
    }

    if (typeof rawTextOrPayload === "string") {
      try {
        const parsed = JSON.parse(rawTextOrPayload);
        const res = this.extractKieResponseText(parsed);
        if (res) return res;
      } catch {}

      const lines = rawTextOrPayload.split("\n");
      let accumulatedDelta = "";
      for (const line of lines) {
        if (!line.startsWith("data: ")) continue;
        const dataStr = line.slice(6).trim();
        if (!dataStr || dataStr === "[DONE]") continue;
        try {
          const data = JSON.parse(dataStr);
          if (data.type === "response.output_text.done" && typeof data.text === "string") {
            return data.text;
          }
          if (data.type === "response.output_item.done" && Array.isArray(data.item?.content)) {
            const joined = data.item.content
              .map((c: any) => c.text || "")
              .filter(Boolean)
              .join("\n");
            if (joined) return joined;
          }
          if (data.type === "response.output_text.delta" && typeof data.delta === "string") {
            accumulatedDelta += data.delta;
          }
        } catch {}
      }
      if (accumulatedDelta.trim()) return accumulatedDelta.trim();
    }

    return "";
  }

  /**
   * Dispara requisição para a API da Kie.ai com streaming e parseamento JSON.
   */
  public static async generateChatResponse(
    prompt: string,
    options?: KieChatCompletionOptions
  ): Promise<GroqChatCompletionResult> {
    const startTime = Date.now();
    const apiKey = await this.getApiKey();

    if (!apiKey) {
      throw new Error(
        "Chave de API da Kie.ai não encontrada. Configure KIE_API_KEY ou salve no Supabase (instagram_config)."
      );
    }

    const model = options?.model || this.DEFAULT_MODEL;
    const reasoningEffort = options?.reasoningEffort || "high";
    const timeoutMs = options?.timeoutMs ?? 45000;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(this.KIE_API_URL, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model,
          input: [
            {
              role: "user",
              content: [{ type: "input_text", text: prompt }],
            },
          ],
          reasoning: { effort: reasoningEffort },
        }),
        signal: controller.signal,
      });

      clearTimeout(timer);

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(
          `Falha na chamada à Kie.ai HTTP ${response.status}: ${errorText.slice(0, 200)}`
        );
      }

      const sseText = await response.text();
      const extractedText = this.extractKieResponseText(sseText);

      if (!extractedText.trim()) {
        throw new Error("A API da Kie.ai retornou sucesso, mas o texto da resposta veio vazio.");
      }

      const parsed = this.parseJsonFromResponse(extractedText);

      return {
        text: extractedText,
        parsed,
        model: `Kie.ai (${model})`,
        latencyMs: Date.now() - startTime,
      };
    } catch (err: any) {
      clearTimeout(timer);
      if (err.name === "AbortError") {
        throw new Error(
          `Timeout de requisição com a Kie.ai (${timeoutMs / 1000}s excedidos).`
        );
      }
      throw err;
    }
  }

  /**
   * Extrai e sanitiza o bloco JSON retornado pelo modelo.
   */
  private static parseJsonFromResponse(rawText: string): AiStructuredResponse {
    let clean = rawText.trim();

    // 1. Extração de markdown se houver ```json ... ```
    const codeBlockMatch = clean.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
    if (codeBlockMatch) {
      clean = codeBlockMatch[1].trim();
    } else {
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
      throw new Error(`Resposta da Kie.ai não contém um JSON válido: ${rawText.slice(0, 150)}...`);
    }

    let responses: string[] = [];
    if (Array.isArray(parsedObj.responses)) {
      responses = parsedObj.responses
        .map((r: any) => (typeof r === "string" ? r.trim() : ""))
        .filter(Boolean);
    } else if (typeof parsedObj.response === "string" && parsedObj.response.trim()) {
      responses = [parsedObj.response.trim()];
    }

    if (responses.length === 0) {
      throw new Error("A Kie.ai gerou uma resposta, mas não incluiu balões na lista 'responses'.");
    }

    // Se a IA devolver múltiplos itens/perguntas aglutinados com quebras de linha (\n) dentro de um único balão,
    // fatia em balões independentes para que sejam enviados e agendados separadamente
    const separatedResponses: string[] = [];
    for (const r of responses) {
      if (r.startsWith("[audio:") || r.startsWith("[image:") || r.startsWith("[video:")) {
        separatedResponses.push(r);
      } else if (r.includes("\n")) {
        const parts = r.split(/\n+/).map((p) => p.trim()).filter(Boolean);
        if (parts.length > 1) {
          separatedResponses.push(...parts);
        } else {
          separatedResponses.push(r);
        }
      } else {
        separatedResponses.push(r);
      }
    }
    responses = separatedResponses;

    responses = responses.map((text) => this.cleanCasualPunctuation(text));
    const indices = normalizeIndices(responses, parsedObj.indices);

    const completedChecklistIds = Array.isArray(parsedObj.completedChecklistIds)
      ? parsedObj.completedChecklistIds.map(String)
      : Array.isArray(parsedObj.completed_checklist_ids)
      ? parsedObj.completed_checklist_ids.map(String)
      : undefined;

    const isRaffleStepReached = Boolean(
      parsedObj.isRaffleStepReached || parsedObj.is_raffle_step_reached
    );

    const analysis = typeof parsedObj.analise_do_pretendente === "string"
      ? parsedObj.analise_do_pretendente
          .replace(/:contentReference\[[^\]]*\]\{[^}]*\}/gi, "")
          .replace(/\[oaicite[^\]]*\]/gi, "")
          .replace(/\s{2,}/g, " ")
          .trim()
      : undefined;

    return {
      responses,
      indices,
      analise_do_pretendente: analysis,
      completedChecklistIds,
      isRaffleStepReached,
      raffle_readiness: parsedObj.raffle_readiness,
    };
  }

  /**
   * Remove ponto final formal no término de mensagens curtas casuais (regra anti-robô).
   */
  private static cleanCasualPunctuation(text: string): string {
    if (!text || typeof text !== "string") return text;
    if (text.startsWith("[audio:") || text.startsWith("[image:") || text.startsWith("[video:")) {
      return text;
    }

    let clean = text.trim();
    if (clean.endsWith(".") && !clean.endsWith("...")) {
      clean = clean.slice(0, -1).trim();
    }
    return clean;
  }
}
