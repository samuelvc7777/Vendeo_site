export type WhatsAppStoryMediaType = "image" | "video";

export interface WhatsAppStoryMedia {
  id: string;
  title: string;
  type: WhatsAppStoryMediaType;
  mediaUrl: string; // Base64 data URL ou URL pública/Supabase
  thumbnailUrl?: string;
  caption?: string;
  backgroundColor?: string;
  font?: number;
  seenContactIds: string[]; // IDs de contatos (@c.us ou número) que já viram este story
  timesPosted: number;
  createdAt: string;
  lastPostedAt?: string;
}

export interface CreateWhatsAppStoryMediaInput {
  title: string;
  type: WhatsAppStoryMediaType;
  mediaUrl: string;
  thumbnailUrl?: string;
  caption?: string;
  backgroundColor?: string;
  font?: number;
}
