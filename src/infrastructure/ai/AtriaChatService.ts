import { getSupabaseAdminClient, getSupabaseServerClient } from "@/infrastructure/supabase/server";
import { AiStructuredResponse } from "@/domain/entities/AiPrompt";
import { normalizeIndices } from "@/lib/aiResponseNormalizer";
import { GroqChatCompletionResult } from "./GroqChatService";

export interface AtriaChatCompletionOptions {
  model?: string;
  temperature?: number;
  maxTokens?: number;
  timeoutMs?: number;
  /**
   * DNA da persona (identidade + regras + exemplos). Quando informado, é enviado
   * como mensagem de "system" — o motor assume a persona com peso e responde com
   * muito mais calor humano, em vez da resposta "seca" do prompt monolítico.
   */
  systemPrompt?: string;
}

/**
 * Serviço de inferência da Atria (Atria-Dawn-Preview / api.atria-asi.ai).
 * Endpoint compatível com OpenAI Chat Completions (vLLM).
 *
 * A chave é lida, em ordem, de:
 *   1) ATRIA_API_KEY / HERMES_CUSTOM_ATRIA_DAWN_PREVIEW_API_KEY no ambiente
 *   2) Coluna app_secret id=atria_api_key da tabela instagram_config (Supabase)
 * Em último caso usa a chave padrão embarcada (mesmo fluxo do KieChatService).
 */
export class AtriaChatService {
  private static readonly ATRIA_API_URL =
    "https://api.atria-asi.ai/v1/chat/completions";
  public static readonly DAWN_MODEL = "Atria-Dawn-Preview";
  public static readonly DEFAULT_MODEL = "Atria-Dawn-Preview";

  /**
   * Resolve a chave de API da Atria (ambiente ➔ Supabase ➔ padrão embarcado).
   */
  public static async getApiKey(): Promise<string | null> {
    const envKeys = [
      process.env.ATRIA_API_KEY,
      process.env.HERMES_CUSTOM_ATRIA_DAWN_PREVIEW_API_KEY,
    ];
    for (const key of envKeys) {
      const trimmed = (key || "").trim();
      if (trimmed) return trimmed;
    }

    try {
      const supabase = getSupabaseAdminClient() || getSupabaseServerClient();
      if (supabase) {
        const { data } = await supabase
          .from("instagram_config")
          .select("app_secret")
          .eq("id", "atria_api_key")
          .maybeSingle();

        if (typeof data?.app_secret === "string" && data.app_secret.trim()) {
          return data.app_secret.trim();
        }
      }
    } catch (err) {
      console.warn("[AtriaChatService] Erro ao buscar atria_api_key no Supabase:", err);
    }

    // Sem fallback embarcado: a chave da Atria é particular do operador.
    return null;
  }

  /**
   * Envia o prompt para a API da Atria e retorna o JSON estruturado (balões da Larissa).
   */
  public static async generateChatResponse(
    prompt: string,
    options?: AtriaChatCompletionOptions
  ): Promise<GroqChatCompletionResult> {
    const startTime = Date.now();
    const apiKey = await this.getApiKey();

    if (!apiKey) {
      throw new Error(
        "Chave de API da Atria não encontrada. Configure ATRIA_API_KEY ou HERMES_CUSTOM_ATRIA_DAWN_PREVIEW_API_KEY no ambiente."
      );
    }

    const model = options?.model || this.DEFAULT_MODEL;
    const temperature = options?.temperature ?? 0.6;
    // Atria é um reasoning model: parte do orçamento vai para o raciocínio (reasoning_content),
    // por isso o teto precisa ser bem mais alto que o dos outros motores.
    const maxTokens = options?.maxTokens ?? 4000;
    const timeoutMs = options?.timeoutMs ?? 150000;
    // Nível de raciocínio: "high" é o máximo suportado pela API da Atria
    // ("ultra" é rejeitado com upstream_error).
    const reasoningEffort = "high" as const;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      // DNA da persona como mensagem de system: o motor "veste" a Larissa e
      // responde com calor humano. Sem isso, a resposta vinha seca (poucas
      // palavras, sem personalidade) tratando tudo como instrução solta.
      const messages: { role: "system" | "user"; content: string }[] = [];
      if (options?.systemPrompt && options.systemPrompt.trim()) {
        messages.push({ role: "system", content: options.systemPrompt });
      }
      messages.push({ role: "user", content: prompt });

      const response = await fetch(this.ATRIA_API_URL, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
          "User-Agent": "Vendeo-Ai/1.0",
        },
        body: JSON.stringify({
          model,
          messages,
          temperature,
          max_tokens: maxTokens,
          reasoning_effort: reasoningEffort,
          stream: false,
        }),
        signal: controller.signal,
      });

      clearTimeout(timer);

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(
          `Falha na chamada à Atria HTTP ${response.status}: ${errorText.slice(0, 200)}`
        );
      }

      const data = await response.json();
      // vLLM: conteúdo final em choices[0].message.content (raciocínio vai em reasoning_content)
      const rawContent: string = data?.choices?.[0]?.message?.content || "";

      if (!rawContent.trim()) {
        throw new Error("A API da Atria retornou sucesso, mas o texto da resposta veio vazio.");
      }

      const parsed = this.parseJsonFromResponse(rawContent);

      return {
        text: rawContent,
        parsed,
        model: data?.model || `Atria (${model})`,
        latencyMs: Date.now() - startTime,
      };
    } catch (err: any) {
      clearTimeout(timer);
      if (err.name === "AbortError") {
        throw new Error(
          `Timeout de requisição com a Atria (${timeoutMs / 1000}s excedidos).`
        );
      }
      throw err;
    }
  }

  /**
   * Extrai e sanitiza o bloco JSON retornado pelo modelo.
   * Resiliente a JSON pretty-printed, truncamento por limite de tokens e markdown.
   */
  private static parseJsonFromResponse(rawText: string): AiStructuredResponse {
    let clean = (rawText || "").trim();

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
      // A Atria às vezes interrompe a geração no meio do JSON (reasoning models
      // podem parar cedo). Tentamos duas coisas, em ordem:
      //   1. Reparar fechando as estruturas pendentes.
      //   2. Extração tolerante via regex (garante os balões mesmo truncados).
      const repaired = this.repairTruncatedJson(clean);
      if (repaired) {
        try {
          parsedObj = JSON.parse(repaired);
        } catch (secondErr) {
          parsedObj = this.extractFieldsTolerant(clean);
        }
      } else {
        parsedObj = this.extractFieldsTolerant(clean);
      }

      if (!parsedObj) {
        throw new Error(`Resposta da Atria não contém um JSON válido: ${rawText.slice(0, 150)}...`);
      }
    }

    if (process.env.NODE_ENV === "development" && !parsedObj.analise_do_pretendente) {
      console.warn("[AtriaChatService] Resposta sem analise_do_pretendente:", rawText.slice(0, 200));
    }

    // Compatibilidade: alguns motores devolvem o campo em snake_case
    if (!parsedObj.analise_do_pretendente && parsedObj.analise) {
      parsedObj.analise_do_pretendente = parsedObj.analise;
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
      throw new Error("A Atria gerou uma resposta, mas não incluiu balões na lista 'responses'.");
    }

    // Se a IA devolver múltiplos itens/perguntas aglutinados com quebras de linha (\n)
    // dentro de um único balão, fatia em balões independentes (mesma regra do Kie)
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
   * Extração tolerante de campos de um JSON possivelmente truncado.
   * Usa regex para ler "analise_do_pretendente" e os balões de "responses",
   * sem depender de o JSON estar sintaticamente completo.
   * Retorna null se não encontrar nenhum balão.
   */
  private static extractFieldsTolerant(text: string): any | null {
    if (!text) return null;

    const result: any = {};

    // 1. analise_do_pretendente: a Atria às vezes usa aspas internas SEM escape
    //    (ex: "reagir com "simpatia" à proximidade"), o que invalida o JSON.
    //    Estratégia: o valor vai da abertura até o marcador "responses": (a
    //    análise nunca contém essa palavra), sem depender de aspas bem formadas.
    const analiseStart = text.match(/"analise_do_pretendente"\s*:\s*"/);
    if (analiseStart && analiseStart.index !== undefined) {
      const start = analiseStart.index + analiseStart[0].length;
      const rest = text.slice(start);
      const end = rest.search(/"responses"\s*:/);
      const rawValue = end === -1 ? rest : rest.slice(0, end);
      result.analise_do_pretendente = rawValue
        .replace(/\\n/g, " ")
        .replace(/\\r/g, "")
        .replace(/\\t/g, " ")
        .replace(/\\"/g, '"')
        .replace(/\\\\/g, "\\")
        .replace(/[\x00-\x1F]/g, "")
        .replace(/[\s",]+$/, "")
        .trim();
    }

    // 2. responses: coleta cada balão na lista (mesmo que a lista esteja aberta)
    const responses: string[] = [];
    const responsesSection = text.match(/"responses"\s*:\s*\[([\s\S]*)/);
    // Conteúdo da lista: tudo até o fechamento "]" (ou o fim do texto se truncado)
    let listContent = "";
    if (responsesSection) {
      const inside = responsesSection[1];
      const listEnd = inside.indexOf("]");
      listContent = listEnd === -1 ? inside : inside.slice(0, listEnd);
      const balloonRegex = /"((?:[^"\\]|\\.)*)"/g;
      let m: RegExpExecArray | null;
      while ((m = balloonRegex.exec(listContent)) !== null) {
        const balloon = (m[1] || "")
          .replace(/\\n/g, " ")
          .replace(/\\r/g, "")
          .replace(/\\t/g, " ")
          .replace(/\\"/g, '"')
          .replace(/\\\\/g, "\\")
          .replace(/[\x00-\x1F]/g, "")
          .trim();
        // Aceita o balão se for texto plausível de mensagem (descarta rótulos
        // estruturais como "indices" que porventura casem dentro da lista)
        if (balloon.length >= 2 && !/^(indices|responses|analise_do_pretendente)$/i.test(balloon)) {
          responses.push(balloon);
        }
      }
    }
    result.responses = responses;

    // Se a lista veio truncada no meio de um balão e nenhum balão inteiro foi
    // encontrado, recupera o texto parcial final como último balão (quantidade
    // mínima de palavras para não devolver lixo).
    if (responses.length === 0 && listContent) {
      const partialMatch = listContent.match(/"([^"]{6,})$/);
      if (partialMatch && partialMatch[1]) {
        const partial = partialMatch[1].trim();
        if (partial.split(/\s+/).length >= 2) {
          responses.push(partial);
        }
      }
    }

    if (responses.length === 0) return null;
    return result;
  }

  /**
   * Tenta reparar um JSON truncado por limite de tokens.
   * Estratégia: fecha a string pendente, remove vírgula solta e fecha as
   * estruturas abertas na ordem inversa. Se ainda assim falhar, descarta o
   * último par chave/valor incompleto e tenta de novo.
   * Retorna null quando não há nada recuperável.
   */
  private static repairTruncatedJson(text: string): string | null {
    if (!text || !text.includes("{")) return null;

    let s = text.trim();
    if (s.endsWith("}")) return null; // já está fechado, outro é o problema

    for (let attempt = 0; attempt < 6; attempt++) {
      const candidate = this.closeStructures(s);
      try {
        JSON.parse(candidate);
        return candidate;
      } catch {}

      // Descarta o último par/fragmento pendente cortando na última vírgula
      // que esteja fora de uma string e dentro do objeto raiz.
      const cut = this.dropTrailingFragment(s);
      if (!cut || cut === s) return null;
      s = cut;
    }

    return null;
  }

  /**
   * Fecha strings/arrays/objetos pendentes de um JSON (possivelmente truncado).
   */
  private static closeStructures(text: string): string {
    let s = text;

    let depth: ("[" | "{")[] = [];
    let inStr = false;
    let escape = false;
    for (let i = 0; i < s.length; i++) {
      const ch = s[i];
      if (escape) { escape = false; continue; }
      if (ch === "\\") { escape = true; continue; }
      if (ch === '"') { inStr = !inStr; continue; }
      if (inStr) continue;
      if (ch === "{" || ch === "[") depth.push(ch);
      else if (ch === "}" || ch === "]") depth.pop();
    }

    if (inStr) s += '"'; // fecha string pendente

    // Remove vírgula final solta antes de fechar as estruturas
    s = s.replace(/,(\s*)$/, "$1");

    let closed = 0;
    while (depth.length > 0 && closed < 20) {
      const top = depth.pop()!;
      s += top === "[" ? "]" : "}";
      closed++;
    }

    return s;
  }

  /**
   * Corta o texto na última vírgula "limpa" (fora de strings), removendo o
   * par chave/valor que estava sendo escrito quando o modelo foi truncado.
   */
  private static dropTrailingFragment(text: string): string | null {
    let inStr = false;
    let escape = false;
    let depth = 0;
    let lastComma = -1;

    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (escape) { escape = false; continue; }
      if (ch === "\\") { escape = true; continue; }
      if (ch === '"') { inStr = !inStr; continue; }
      if (inStr) continue;
      if (ch === "{" || ch === "[") depth++;
      else if (ch === "}" || ch === "]") depth--;
      else if (ch === "," && depth >= 1) lastComma = i;
    }

    if (lastComma === -1) return null;
    return text.slice(0, lastComma);
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
