import {
  ITinderRepository,
  TinderMatchItem,
  TinderMessageItem,
} from "@/domain/repositories/ITinderRepository";
import { TinderSession } from "@/domain/entities/Tinder";

export class ApiTinderRepository implements ITinderRepository {
  async connect(token: string): Promise<TinderSession> {
    const res = await fetch("/api/tinder/auth", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token }),
    });

    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.error || "Falha ao conectar conta do Tinder.");
    }

    return {
      token,
      isConnected: true,
      profile: data.profile,
      connectedAt: new Date().toISOString(),
    };
  }

  async disconnect(): Promise<void> {
    await fetch("/api/tinder/disconnect", { method: "POST" });
  }

  async getSession(): Promise<TinderSession | null> {
    try {
      const res = await fetch("/api/tinder/status");
      if (!res.ok) return null;
      const data = await res.json();
      if (!data.isConnected) return null;

      return {
        token: data.token || "",
        isConnected: true,
        profile: data.profile,
      };
    } catch {
      return null;
    }
  }

  async getMatches(): Promise<TinderMatchItem[]> {
    const res = await fetch("/api/tinder/matches");
    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.error || "Falha ao carregar matches.");
    }
    return data.matches || [];
  }

  async getMessages(matchId: string): Promise<TinderMessageItem[]> {
    const res = await fetch(`/api/tinder/messages/${matchId}`);
    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.error || "Falha ao carregar mensagens.");
    }
    return data.messages || [];
  }

  async sendMessage(matchId: string, text: string): Promise<TinderMessageItem> {
    const res = await fetch(`/api/tinder/messages/${matchId}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: text }),
    });
    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.error || "Falha ao enviar mensagem.");
    }
    return data.message;
  }
}
