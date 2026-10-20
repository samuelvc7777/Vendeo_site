export type WhatsAppStoryMediaType = "image" | "video";

export interface WhatsAppStoryMedia {
  id: string;
  title: string;
  type: WhatsAppStoryMediaType;
  mediaUrl: string; // Base64 legado ou URL pública do Supabase
  storyKey?: string; // Identidade estável para o histórico anti-repetição após migração
  automationEnabled?: boolean;
  triggerMode?: "anytime" | "after_start" | "clock" | "window";
  sortOrder?: number;
  afterMinutes?: number;
  publishTime?: string | null;
  windowStart?: string | null;
  windowEnd?: string | null;
  minGapMinutes?: number;
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
