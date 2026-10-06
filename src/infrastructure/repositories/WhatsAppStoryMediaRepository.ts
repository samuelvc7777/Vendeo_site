import { WhatsAppStoryMedia, CreateWhatsAppStoryMediaInput } from "@/domain/entities/WhatsAppStoryMedia";

const STORAGE_KEY = "vendeo_whatsapp_stories_library_v1";

export class WhatsAppStoryMediaRepository {
  private static getStorage(): Storage | null {
    if (typeof window === "undefined") return null;
    return window.localStorage;
  }

  static getAll(): WhatsAppStoryMedia[] {
    const storage = this.getStorage();
    if (!storage) return [];
    try {
      const raw = storage.getItem(STORAGE_KEY);
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) return [];
      return parsed;
    } catch (err) {
      console.warn("[WhatsAppStoryMediaRepository] Erro ao carregar stories da biblioteca:", err);
      return [];
    }
  }

  static getById(id: string): WhatsAppStoryMedia | null {
    const all = this.getAll();
    return all.find((s) => s.id === id) || null;
  }

  static save(story: WhatsAppStoryMedia): WhatsAppStoryMedia {
    const storage = this.getStorage();
    const all = this.getAll();
    const index = all.findIndex((s) => s.id === story.id);
    let updated: WhatsAppStoryMedia[];
    if (index >= 0) {
      updated = [...all];
      updated[index] = story;
    } else {
      updated = [story, ...all];
    }
    if (storage) {
      try {
        storage.setItem(STORAGE_KEY, JSON.stringify(updated));
      } catch (err) {
        console.warn("[WhatsAppStoryMediaRepository] Falha ao persistir no localStorage:", err);
      }
    }
    return story;
  }

  static create(input: CreateWhatsAppStoryMediaInput): WhatsAppStoryMedia {
    const newStory: WhatsAppStoryMedia = {
      id: `story_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      title: input.title.trim() || `Story ${new Date().toLocaleDateString("pt-BR")}`,
      type: input.type,
      mediaUrl: input.mediaUrl,
      thumbnailUrl: input.thumbnailUrl,
      caption: input.caption?.trim() || "",
      backgroundColor: input.backgroundColor,
      font: input.font ?? 0,
      seenContactIds: [],
      timesPosted: 0,
      createdAt: new Date().toISOString(),
    };
    return this.save(newStory);
  }

  static delete(id: string): boolean {
    const storage = this.getStorage();
    const all = this.getAll();
    const filtered = all.filter((s) => s.id !== id);
    if (storage) {
      try {
        storage.setItem(STORAGE_KEY, JSON.stringify(filtered));
      } catch (err) {
        console.warn("[WhatsAppStoryMediaRepository] Falha ao excluir do localStorage:", err);
      }
    }
    return filtered.length < all.length;
  }

  /**
   * Registra os contatos selecionados que receberam este story.
   * Garante que nenhum contato seja duplicado no conjunto de visualizadores.
   */
  static recordContactsSeen(storyId: string, newContactIds: string[]): WhatsAppStoryMedia | null {
    const story = this.getById(storyId);
    if (!story) return null;

    const currentSet = new Set(story.seenContactIds || []);
    for (const cid of newContactIds) {
      if (!cid) continue;
      // Normaliza para identificação consistente
      const clean = String(cid).trim();
      currentSet.add(clean);
      // Se tiver @c.us ou número puro, adiciona ambos para evitar discrepâncias
      if (clean.includes("@")) {
        currentSet.add(clean.replace(/@.*$/, ""));
      } else {
        currentSet.add(`${clean}@c.us`);
      }
    }

    const updated: WhatsAppStoryMedia = {
      ...story,
      seenContactIds: Array.from(currentSet),
      timesPosted: (story.timesPosted || 0) + 1,
      lastPostedAt: new Date().toISOString(),
    };

    return this.save(updated);
  }

  /**
   * Limpa o histórico de contatos que viram o story (caso o operador deseje recomeçar a distribuição).
   */
  static resetSeenContacts(storyId: string): WhatsAppStoryMedia | null {
    const story = this.getById(storyId);
    if (!story) return null;

    const updated: WhatsAppStoryMedia = {
      ...story,
      seenContactIds: [],
    };

    return this.save(updated);
  }
}
