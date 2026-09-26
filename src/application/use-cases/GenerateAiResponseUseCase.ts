import {
  AiGenerateResponseRequest,
  AiGenerateResponseResult,
} from "@/domain/entities/AiPrompt";
import { GenerateAiPromptUseCase } from "./GenerateAiPromptUseCase";
import { GroqChatService, GroqChatCompletionResult } from "@/infrastructure/ai/GroqChatService";
import { KieChatService } from "@/infrastructure/ai/KieChatService";
import { AtriaChatService } from "@/infrastructure/ai/AtriaChatService";

export class GenerateAiResponseUseCase {
  private promptUseCase: GenerateAiPromptUseCase;

  constructor() {
    this.promptUseCase = new GenerateAiPromptUseCase();
  }

  /**
   * Detecta se o modelo solicitado é o motor Atria (Atria-Dawn-Preview).
   */
  private isAtriaModel(model?: string): boolean {
    return Boolean(model && /atria/i.test(model));
  }

  public async execute(
    request: AiGenerateResponseRequest
  ): Promise<AiGenerateResponseResult> {
    const startTime = Date.now();

    try {
      // 1. Gera o prompt contextualizado no modo direct_api
      const promptResult = this.promptUseCase.execute({
        ...request,
        mode: "direct_api",
      });

      let completionResult: GroqChatCompletionResult | null = null;

      // 2. Motor Atria (Atria-Dawn-Preview) — OpenAI-compatible
      if (this.isAtriaModel(request.model)) {
        const atriaKey = await AtriaChatService.getApiKey();
        if (!atriaKey) {
          throw new Error(
            "Chave de API da Atria não configurada. Defina ATRIA_API_KEY ou HERMES_CUSTOM_ATRIA_DAWN_PREVIEW_API_KEY no .env.local."
          );
        }

        try {
          completionResult = await AtriaChatService.generateChatResponse(
            promptResult.prompt,
            {
              model: AtriaChatService.DAWN_MODEL,
              temperature: request.temperature ?? 0.6,
              timeoutMs: 90000,
              systemPrompt: promptResult.systemPrompt,
            }
          );
        } catch (firstErr: any) {
          console.warn("[GenerateAiResponseUseCase] 1ª tentativa Atria falhou, tentando novamente:", firstErr?.message);
          try {
            completionResult = await AtriaChatService.generateChatResponse(
              promptResult.prompt,
              {
                model: AtriaChatService.DAWN_MODEL,
                temperature: request.temperature ?? 0.6,
                timeoutMs: 90000,
                systemPrompt: promptResult.systemPrompt,
              }
            );
          } catch (retryErr: any) {
            throw new Error(`Erro na API da Atria: ${retryErr?.message || retryErr}`);
          }
        }

        return {
          success: true,
          responses: completionResult.parsed.responses,
          indices: completionResult.parsed.indices,
          completedChecklistIds: completionResult.parsed.completedChecklistIds,
          isRaffleStepReached: completionResult.parsed.isRaffleStepReached,
          analise_do_pretendente: completionResult.parsed.analise_do_pretendente,
          modelUsed: completionResult.model,
          latencyMs: completionResult.latencyMs,
          rawText: completionResult.text,
        };
      }

      // 3. Motor Kie.ai (gpt-5-6-sol / gpt-5-6-terra)
      const kieKey = await KieChatService.getApiKey();
      if (!kieKey) {
        throw new Error("Chave de API da Kie.ai não configurada. Defina KIE_API_KEY no .env.local.");
      }

      // Se for gpt-5-6-terra usa terra, caso contrário usa gpt-5-6-sol (persona padrão)
      const modelToUse =
        request.model === KieChatService.TERRA_MODEL
          ? KieChatService.TERRA_MODEL
          : KieChatService.SOL_MODEL;

      try {
        completionResult = await KieChatService.generateChatResponse(
          promptResult.prompt,
          {
            model: modelToUse,
            reasoningEffort: "high",
            timeoutMs: 45000,
          }
        );
      } catch (firstErr: any) {
        console.warn("[GenerateAiResponseUseCase] 1ª tentativa Kie.ai falhou, aguardando 3.5s para recuperação do servidor:", firstErr?.message);
        await new Promise((resolve) => setTimeout(resolve, 3500));
        try {
          completionResult = await KieChatService.generateChatResponse(
            promptResult.prompt,
            {
              model: modelToUse,
              reasoningEffort: "high",
              timeoutMs: 45000,
            }
          );
        } catch (retryErr: any) {
          throw new Error(`Erro na API da Kie.ai (${modelToUse}): ${retryErr?.message || retryErr}`);
        }
      }

      return {
        success: true,
        responses: completionResult.parsed.responses,
        indices: completionResult.parsed.indices,
        completedChecklistIds: completionResult.parsed.completedChecklistIds,
        isRaffleStepReached: completionResult.parsed.isRaffleStepReached,
        analise_do_pretendente: completionResult.parsed.analise_do_pretendente,
        modelUsed: completionResult.model,
        latencyMs: completionResult.latencyMs,
        rawText: completionResult.text,
      };
    } catch (err: any) {
      console.error("[GenerateAiResponseUseCase] Falha ao gerar resposta com IA:", err);
      return {
        success: false,
        responses: [],
        indices: [],
        modelUsed: request.model || GroqChatService.DEFAULT_MODEL,
        latencyMs: Date.now() - startTime,
        error: err.message || "Erro desconhecido ao gerar resposta com a IA.",
      };
    }
  }
}
