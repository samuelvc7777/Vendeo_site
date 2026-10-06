import { getSupabaseBrowserClient } from "../supabase/client";
import type { WhatsAppStatusItem } from "../../domain/entities/WhatsAppStatus";

const LOCAL_STORAGE_KEY = "vendeo_whatsapp_status_history";
const MAX_LOCAL_HISTORY = 40;

export class WhatsAppStatusRepository {
  /**
   * Carrega histórico combinado (localStorage prioritário para velocidade + sync com Supabase)
   */
  static async loadHistory(): Promise<WhatsAppStatusItem[]> {
    let localItems: WhatsAppStatusItem[] = [];

    if (typeof window !== "undefined" && window.localStorage) {
      try {
        const stored = window.localStorage.getItem(LOCAL_STORAGE_KEY);
        if (stored) {
          localItems = JSON.parse(stored) as WhatsAppStatusItem[];
        }
      } catch (err) {
        console.warn("[WhatsAppStatus] Erro ao ler histórico do localStorage:", err);
      }
    }

    const supabase = getSupabaseBrowserClient();
    if (!supabase) {
      return localItems;
    }

    try {
      const { data, error } = await supabase
        .from("whatsapp_status_posts")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(30);

      if (!error && Array.isArray(data)) {
        const remoteItems: WhatsAppStatusItem[] = data.map((row: any) => ({
          id: row.id,
          whatsappStatusId: row.whatsapp_status_id,
          type: row.type,
          textContent: row.text_content,
          backgroundColor: row.background_color,
          fontIndex: row.font_index ?? 0,
          mediaUrl: row.media_url,
          caption: row.caption,
          mimeType: row.mime_type,
          fileSize: row.file_size,
          durationSeconds: row.duration_seconds,
          status: row.status,
          errorMessage: row.error_message,
          idempotencyKey: row.idempotency_key,
          createdAt: row.created_at,
        }));

        // Mescla garantindo unicidade por id ou idempotencyKey
        const map = new Map<string, WhatsAppStatusItem>();
        for (const item of remoteItems) {
          map.set(item.id, item);
        }
        for (const item of localItems) {
          const key = item.id;
          if (!map.has(key)) {
            map.set(key, item);
          } else {
            // Preserva preview local da miniatura que não sobe pro banco
            const existing = map.get(key)!;
            if (!existing.mediaBase64Preview && item.mediaBase64Preview) {
              existing.mediaBase64Preview = item.mediaBase64Preview;
            }
          }
        }

        const merged = Array.from(map.values()).sort(
          (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
        );

        this.saveToLocalStorage(merged);
        return merged;
      }
    } catch (err) {
      console.warn("[WhatsAppStatus] Supabase indisponível para histórico:", err);
    }

    return localItems;
  }

  /**
   * Salva uma publicação recém-criada localmente e no Supabase.
   */
  static async recordPost(item: WhatsAppStatusItem): Promise<void> {
    // 1. Salva no localStorage imediatamente
    let local = await this.loadFromLocalStorage();
    local = [item, ...local.filter((i) => i.id !== item.id)].slice(0, MAX_LOCAL_HISTORY);
    this.saveToLocalStorage(local);

    // 2. Tenta persistir no Supabase em background
    const supabase = getSupabaseBrowserClient();
    if (supabase) {
      try {
        await supabase.from("whatsapp_status_posts").insert({
          id: item.id.includes("-") && item.id.length === 36 ? item.id : undefined,
          whatsapp_status_id: item.whatsappStatusId || null,
          type: item.type,
          text_content: item.textContent || null,
          background_color: item.backgroundColor || null,
          font_index: item.fontIndex ?? 0,
          media_url: item.mediaUrl || null,
          caption: item.caption || null,
          mime_type: item.mimeType || null,
          file_size: item.fileSize || null,
          duration_seconds: item.durationSeconds || null,
          status: item.status,
          error_message: item.errorMessage || null,
          idempotency_key: item.idempotencyKey || null,
          created_at: item.createdAt,
        });
      } catch (err) {
        console.warn("[WhatsAppStatus] Não foi possível salvar status no Supabase:", err);
      }
    }
  }

  private static loadFromLocalStorage(): WhatsAppStatusItem[] {
    if (typeof window === "undefined" || !window.localStorage) return [];
    try {
      const stored = window.localStorage.getItem(LOCAL_STORAGE_KEY);
      return stored ? (JSON.parse(stored) as WhatsAppStatusItem[]) : [];
    } catch {
      return [];
    }
  }

  private static saveToLocalStorage(items: WhatsAppStatusItem[]) {
    if (typeof window === "undefined" || !window.localStorage) return;
    try {
      window.localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(items.slice(0, MAX_LOCAL_HISTORY)));
    } catch {}
  }
}
