export type WhatsAppStatusType = "text" | "image" | "video";
export type WhatsAppStatusDeliveryState = "pending" | "sent" | "failed";

export interface WhatsAppStatusItem {
  id: string;
  whatsappStatusId?: string | null;
  type: WhatsAppStatusType;
  textContent?: string | null;
  backgroundColor?: string | null;
  fontIndex?: number;
  mediaUrl?: string | null;
  mediaBase64Preview?: string | null;
  caption?: string | null;
  mimeType?: string | null;
  fileSize?: number | null;
  durationSeconds?: number | null;
  status: WhatsAppStatusDeliveryState;
  errorMessage?: string | null;
  idempotencyKey?: string | null;
  privacyType?: "contact" | "deny-list" | "allow-list";
  privacyCount?: number;
  createdAt: string;
}
