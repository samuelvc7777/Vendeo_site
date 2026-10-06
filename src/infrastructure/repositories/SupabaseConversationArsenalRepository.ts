import { ConversationArsenalItem } from "@/domain/entities/ConversationArsenal";
import { IConversationArsenalRepository } from "@/domain/repositories/IConversationArsenalRepository";
import { getSupabaseBrowserClient } from "../supabase/client";
import { getSupabaseServerClient } from "../supabase/server";

export class SupabaseConversationArsenalRepository implements IConversationArsenalRepository {
  private customClient?: any;

  constructor(client?: any) {
    this.customClient = client;
  }

  private getClient() {
    if (this.customClient) return this.customClient;
    return typeof window !== "undefined" ? getSupabaseBrowserClient() : getSupabaseServerClient();
  }

  private map(row: any): ConversationArsenalItem {
    return {
      id: String(row.id),
      scheduleId: String(row.schedule_id),
      type: row.item_type,
      title: String(row.title || ""),
      description: row.description || undefined,
      semanticContent: row.semantic_content || undefined,
      usageInstruction: row.usage_instruction || undefined,
      socialFunction: row.social_function || undefined,
      assetId: row.asset_id || undefined,
      mediaUrl: row.media_url || undefined,
      whatsappMediaUrl: row.whatsapp_media_url || undefined,
      transcript: row.transcript || undefined,
      visualDescription: row.visual_description || undefined,
      validityType: row.validity_type || "evergreen",
      validFrom: row.valid_from || null,
      validUntil: row.valid_until || null,
      recurringRules: row.recurring_rules && typeof row.recurring_rules === "object" ? row.recurring_rules : {},
      maxUsesPerConversation: row.max_uses_per_conversation == null ? null : Number(row.max_uses_per_conversation),
      cooldownMinutes: Number(row.cooldown_minutes || 0),
      priority: Number(row.priority ?? 50),
      enabled: row.enabled !== false,
      createdAt: String(row.created_at || ""),
      updatedAt: String(row.updated_at || ""),
    };
  }

  async getItems(scheduleId: string): Promise<ConversationArsenalItem[]> {
    const client = this.getClient();
    if (!client) return [];
    const { data, error } = await client
      .from("conversation_arsenal_items")
      .select("*")
      .eq("schedule_id", scheduleId)
      .order("priority", { ascending: false })
      .order("created_at", { ascending: true });
    if (error) throw new Error(error.message || "Falha ao carregar arsenal.");
    return (data || []).map((row: any) => this.map(row));
  }

  async createItem(data: Omit<ConversationArsenalItem, "id" | "createdAt" | "updatedAt">): Promise<ConversationArsenalItem> {
    const client = this.getClient();
    if (!client) throw new Error("Cliente Supabase indisponível.");
    const now = new Date().toISOString();
    const id = "arsenal_" + Date.now() + "_" + Math.random().toString(36).slice(2, 7);
    const payload = {
      id,
      schedule_id: data.scheduleId,
      item_type: data.type,
      title: data.title.trim(),
      description: data.description || null,
      semantic_content: data.semanticContent || null,
      usage_instruction: data.usageInstruction || null,
      social_function: data.socialFunction || null,
      asset_id: data.assetId || null,
      media_url: data.mediaUrl || null,
      whatsapp_media_url: data.whatsappMediaUrl || null,
      transcript: data.transcript || null,
      visual_description: data.visualDescription || null,
      validity_type: data.validityType,
      valid_from: data.validFrom || null,
      valid_until: data.validUntil || null,
      recurring_rules: data.recurringRules || {},
      max_uses_per_conversation: data.maxUsesPerConversation ?? null,
      cooldown_minutes: data.cooldownMinutes || 0,
      priority: data.priority ?? 50,
      enabled: data.enabled !== false,
      created_at: now,
      updated_at: now,
    };
    const { data: inserted, error } = await client
      .from("conversation_arsenal_items")
      .insert(payload)
      .select()
      .single();
    if (error) throw new Error(error.message || "Falha ao adicionar item ao arsenal.");
    return this.map(inserted);
  }

  async updateItem(id: string, data: Partial<Omit<ConversationArsenalItem, "id" | "scheduleId" | "createdAt" | "updatedAt">>): Promise<ConversationArsenalItem> {
    const client = this.getClient();
    if (!client) throw new Error("Cliente Supabase indisponível.");
    const payload: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (data.type !== undefined) payload.item_type = data.type;
    if (data.title !== undefined) payload.title = data.title.trim();
    if (data.description !== undefined) payload.description = data.description || null;
    if (data.semanticContent !== undefined) payload.semantic_content = data.semanticContent || null;
    if (data.usageInstruction !== undefined) payload.usage_instruction = data.usageInstruction || null;
    if (data.socialFunction !== undefined) payload.social_function = data.socialFunction || null;
    if (data.assetId !== undefined) payload.asset_id = data.assetId || null;
    if (data.mediaUrl !== undefined) payload.media_url = data.mediaUrl || null;
    if (data.whatsappMediaUrl !== undefined) payload.whatsapp_media_url = data.whatsappMediaUrl || null;
    if (data.transcript !== undefined) payload.transcript = data.transcript || null;
    if (data.visualDescription !== undefined) payload.visual_description = data.visualDescription || null;
    if (data.validityType !== undefined) payload.validity_type = data.validityType;
    if (data.validFrom !== undefined) payload.valid_from = data.validFrom || null;
    if (data.validUntil !== undefined) payload.valid_until = data.validUntil || null;
    if (data.recurringRules !== undefined) payload.recurring_rules = data.recurringRules || {};
    if (data.maxUsesPerConversation !== undefined) payload.max_uses_per_conversation = data.maxUsesPerConversation ?? null;
    if (data.cooldownMinutes !== undefined) payload.cooldown_minutes = data.cooldownMinutes;
    if (data.priority !== undefined) payload.priority = data.priority;
    if (data.enabled !== undefined) payload.enabled = data.enabled;
    const { data: updated, error } = await client
      .from("conversation_arsenal_items")
      .update(payload)
      .eq("id", id)
      .select()
      .single();
    if (error) throw new Error(error.message || "Falha ao atualizar item do arsenal.");
    return this.map(updated);
  }

  async deleteItem(id: string): Promise<void> {
    const client = this.getClient();
    if (!client) throw new Error("Cliente Supabase indisponível.");
    const { error } = await client.from("conversation_arsenal_items").delete().eq("id", id);
    if (error) throw new Error(error.message || "Falha ao remover item do arsenal.");
  }
}
