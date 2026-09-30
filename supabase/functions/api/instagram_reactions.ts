export type InstagramReactionAction = "react" | "unreact";

export interface ParsedInstagramReactionEvent {
  messageId: string;
  senderId: string;
  recipientId?: string;
  action: InstagramReactionAction;
  emoji: string | null;
  reactedAt: string;
}

const REACTION_NAME_TO_EMOJI: Record<string, string> = {
  like: "👍",
  love: "❤️",
  haha: "😂",
  wow: "😮",
  sad: "😢",
  angry: "😡",
};

export function normalizeInstagramReactionEmoji(value: unknown): string | null {
  const raw = typeof value === "string" ? value.trim() : "";
  if (!raw) return null;
  return REACTION_NAME_TO_EMOJI[raw.toLowerCase()] || raw;
}

export function parseInstagramReactionEvent(msgEvent: any): ParsedInstagramReactionEvent | null {
  const reaction = msgEvent?.reaction;
  const messageId = String(reaction?.mid || "").trim();
  const senderId = String(msgEvent?.sender?.id || "").trim();
  if (!messageId || !senderId) return null;

  const rawAction = String(reaction?.action || "").trim().toLowerCase();
  if (rawAction !== "react" && rawAction !== "unreact") return null;

  const emoji = rawAction === "react"
    ? normalizeInstagramReactionEmoji(reaction?.emoji || reaction?.reaction)
    : null;
  if (rawAction === "react" && !emoji) return null;

  const rawTimestamp = Number(msgEvent?.timestamp);
  const timestampMs = Number.isFinite(rawTimestamp) && rawTimestamp > 0
    ? (rawTimestamp < 1_000_000_000_000 ? rawTimestamp * 1000 : rawTimestamp)
    : NaN;
  const reactedAt = Number.isFinite(timestampMs)
    ? new Date(timestampMs).toISOString()
    : new Date().toISOString();

  return {
    messageId,
    senderId,
    recipientId: msgEvent?.recipient?.id ? String(msgEvent.recipient.id) : undefined,
    action: rawAction,
    emoji,
    reactedAt,
  };
}
