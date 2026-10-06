export type ArsenalItemType = "topic" | "question" | "story" | "audio" | "photo";
export type ArsenalValidityType = "evergreen" | "recurring" | "moment";
export type ArsenalSocialFunction =
  | "open_topic"
  | "learn_about_contact"
  | "share_about_larissa"
  | "deepen_connection"
  | "humor"
  | "flirt"
  | "reciprocity"
  | "show_routine"
  | (string & {});

export interface ConversationArsenalItem {
  id: string;
  scheduleId: string;
  type: ArsenalItemType;
  title: string;
  description?: string;
  semanticContent?: string;
  usageInstruction?: string;
  socialFunction?: ArsenalSocialFunction;
  assetId?: string;
  mediaUrl?: string;
  whatsappMediaUrl?: string;
  transcript?: string;
  visualDescription?: string;
  validityType: ArsenalValidityType;
  validFrom?: string | null;
  validUntil?: string | null;
  recurringRules?: Record<string, unknown>;
  maxUsesPerConversation?: number | null;
  cooldownMinutes: number;
  priority: number;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ConversationArsenalUsage {
  id: string;
  conversationId: string;
  scheduleRunId: string;
  arsenalItemId: string;
  cycleId?: string | null;
  actionId?: string | null;
  status: "reserved" | "sending" | "sent" | "failed" | "cancelled";
  usedAt?: string | null;
  providerMessageId?: string | null;
  lastError?: string | null;
  createdAt: string;
  updatedAt: string;
}

export const ARSENAL_ITEM_TYPES: Array<{ value: ArsenalItemType; label: string }> = [
  { value: "topic", label: "Assunto" },
  { value: "question", label: "Pergunta" },
  { value: "story", label: "História da Larissa" },
  { value: "audio", label: "Áudio" },
  { value: "photo", label: "Foto" },
];

export const ARSENAL_SOCIAL_FUNCTIONS: Array<{ value: ArsenalSocialFunction; label: string }> = [
  { value: "open_topic", label: "Abrir assunto" },
  { value: "learn_about_contact", label: "Conhecer ele" },
  { value: "share_about_larissa", label: "Compartilhar sobre Larissa" },
  { value: "deepen_connection", label: "Aprofundar conexão" },
  { value: "humor", label: "Humor" },
  { value: "flirt", label: "Flerte" },
  { value: "reciprocity", label: "Reciprocidade" },
  { value: "show_routine", label: "Mostrar rotina" },
];
