export function normalizeWhatsAppAccountId(value: unknown): string | null;
export function whatsappAccountIdFromWid(wid: unknown): string | null;
export function whatsapp2ConversationIdForAccount(chatId: unknown, accountId: unknown): string;
export function whatsappAccountIdFromConversationId(conversationId: unknown): string | null;
export function whatsappProviderIdFromConversationId(conversationId: unknown): string;
export function whatsappConversationBelongsToAccount(conversationId: unknown, accountId: unknown): boolean;
export function isLatestWhatsAppAccountLoad(requestId: unknown, latestRequestId: unknown): boolean;
export function resolveWhatsAppContactDisplayName(input?: {
  savedContactName?: unknown;
  profileName?: unknown;
  fallbackName?: unknown;
  providerId?: unknown;
}): string;
