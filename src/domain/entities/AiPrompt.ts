export interface AiPretendenteInfo {
  id: string;
  name: string;
  age?: number;
  city?: string;
  bio?: string;
  platform: "tinder" | "instagram";
  username?: string;
}

export interface AiMessageItem {
  id: string;
  sender: "me" | "them";
  text: string;
  timestamp?: string;
  sentDate?: string;
  replyToText?: string;
  audioTranscript?: string;
  mediaType?: "text" | "audio" | "image";
  mediaUrl?: string;
}

export interface AiRaffleReadiness {
  shouldOffer: boolean;
  confidence: number;
  stage: string;
  reason: string;
  signals?: string[];
}

export interface StageChecklistItemPrompt {
  id: string;
  type: "text" | "audio" | "image";
  title: string;
  content?: string;
  mediaUrl?: string;
  duration?: number;
  linkedItemId?: string;
  isCompleted: boolean;
}

export interface AiStructuredResponse {
  responses: string[];
  indices: number[][];
  analise_do_pretendente?: string;
  completedChecklistIds?: string[];
  isRaffleStepReached?: boolean;
  raffle_readiness?: AiRaffleReadiness;
}

export interface AiPersonaReferenceItem {
  category: string;
  them_message: string;
  larissa_response: string;
  notes?: string;
}

export interface AiPromptGenerateRequest {
  pretendente: AiPretendenteInfo;
  tinderHistory?: AiMessageItem[];
  instagramHistory?: AiMessageItem[];
  messagesToRespond?: AiMessageItem[];
  personaReferences?: AiPersonaReferenceItem[];
  mode?: "markdown" | "direct_api";
  stageContext?: {
    stageName: string;
    stageIndex: number;
    totalStages: number;
    checklist: StageChecklistItemPrompt[];
    turnGoalIds?: string[];
  };
  /** O roteiro de checklist é opcional e não deve contaminar o prompt conversacional. */
  includeChecklistContext?: boolean;
}

export interface AiPromptGenerateResult {
  prompt: string;
  /**
   * DNA da persona (identidade + regras + few-shot). No modo direct_api viaja
   * como mensagem de "system" para o motor de IA ganhar peso de persona.
   */
  systemPrompt?: string;
  pretendente: AiPretendenteInfo;
  newMessagesCount: number;
  newMessages: { index: number; text: string; id?: string }[];
  temporalContext: {
    dateStr: string;
    timeStr: string;
    period: "MANHÃ" | "TARDE" | "NOITE" | "MADRUGADA";
    dayOfWeek: string;
  };
  usedEmojis?: string[];
  lastHadEmoji?: boolean;
}

export interface AiGenerateResponseRequest extends AiPromptGenerateRequest {
  model?: "qwen/qwen3.8-27b" | "openai/gpt-oss-120b" | string;
  temperature?: number;
}

export interface AiGenerateResponseResult {
  success: boolean;
  responses: string[];
  indices: number[][];
  completedChecklistIds?: string[];
  isRaffleStepReached?: boolean;
  analise_do_pretendente?: string;
  modelUsed: string;
  latencyMs: number;
  rawText?: string;
  error?: string;
}
