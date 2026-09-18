import { NextRequest, NextResponse } from "next/server";
import { SupabaseInstagramRepository } from "@/infrastructure/repositories/SupabaseInstagramRepository";
import { resolveContactAvatar } from "@/domain/services/AvatarResolverService";
import { formatMessageTime } from "@/lib/utils";

export const dynamic = "force-static";

export async function GET(req: NextRequest) {

  try {
    const repo = new SupabaseInstagramRepository();
    const config = await repo.getConfig();

    // 1. Buscar lista consolidada exclusivamente do banco Supabase (< 20ms)
    const rawConversations = await repo.getConversations(300);

    // Deduplicação defensiva: garante que cada username apareça apenas uma vez na lista
    const uniqueMap = new Map<string, any>();
    for (const c of rawConversations) {
      const isTemp = c.username?.startsWith("ig_");
      const cleanUsername = isTemp ? "instagram_user" : c.username;
      const cleanFullName = isTemp ? "Novo Contato" : (c.fullName || cleanUsername);
      const avatar = resolveContactAvatar(cleanUsername, cleanFullName, c.avatar);

      const convObj = {
        id: c.id,
        username: cleanUsername,
        fullName: cleanFullName,
        avatar,
        isOnline: false,
        lastActive: formatMessageTime(c.lastMessageAt),
        lastMessage: c.lastDirection === "out" ? `Você: ${c.lastMessage || ""}` : (c.lastMessage || ""),
        lastSender: c.lastDirection === "out" ? "me" : "them",
        lastStatus: c.lastStatus,
        seenAt: c.seenAt,
        unread: Boolean(c.unread),
        type: "instagram" as const,
        lastMessageAt: c.lastMessageAt,
        isRestricted: Boolean(c.isRestricted),
        status: c.status || (c.isRestricted ? "restricted" : "active"),
      };

      const key = cleanUsername && cleanUsername !== "instagram_user" 
        ? cleanUsername.toLowerCase() 
        : c.id;

      if (!uniqueMap.has(key)) {
        uniqueMap.set(key, convObj);
      } else {
        // Se já existe, mantém o que tem mensagem mais recente
        const existing = uniqueMap.get(key);
        const existingTime = new Date(existing.lastMessageAt || 0).getTime();
        const currentTime = new Date(c.lastMessageAt || 0).getTime();
        if (currentTime > existingTime) {
          uniqueMap.set(key, convObj);
        }
      }
    }

    const conversations = Array.from(uniqueMap.values());

    return NextResponse.json({
      conversations,
      isConnected: Boolean(config?.isConnected),
    });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : "Erro ao buscar conversas do Instagram.";
    return NextResponse.json({ error: msg, conversations: [] }, { status: 500 });
  }
}
