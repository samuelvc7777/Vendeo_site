import type { WhatsAppStoryMedia, CreateWhatsAppStoryMediaInput } from "@/domain/entities/WhatsAppStoryMedia";
import { getSupabaseBrowserClient } from "@/infrastructure/supabase/client";
import { resolveWhatsApp2GatewayUrl } from "@/presentation/components/chat/whatsapp2-client";

const STORAGE_KEY = "vendeo_whatsapp_stories_library_v1";

type CloudRow = {
  id: string;
  title: string;
  type: "image" | "video";
  media_url: string;
  story_key: string;
  caption: string | null;
  times_posted: number;
  created_at: string;
  last_posted_at: string | null;
  automation_enabled: boolean;
  trigger_mode: "anytime" | "after_start" | "clock" | "window";
  sort_order: number;
  after_minutes: number;
  publish_time: string | null;
  window_start: string | null;
  window_end: string | null;
  min_gap_minutes: number;
};

function remoteStory(row: CloudRow): WhatsAppStoryMedia {
  return {
    id: row.id, title: row.title, type: row.type, mediaUrl: row.media_url,
    storyKey: row.story_key, caption: row.caption || "", seenContactIds: [],
    timesPosted: row.times_posted || 0, createdAt: row.created_at,
    lastPostedAt: row.last_posted_at || undefined,
    automationEnabled: row.automation_enabled,
    triggerMode: row.trigger_mode,
    sortOrder: row.sort_order,
    afterMinutes: row.after_minutes,
    publishTime: row.publish_time,
    windowStart: row.window_start,
    windowEnd: row.window_end,
    minGapMinutes: row.min_gap_minutes,
  };
}

async function gatewayPost<T>(path: string, body: unknown): Promise<T> {
  const gatewayUrl = (await resolveWhatsApp2GatewayUrl()).replace(/\/$/, "");
  const response = await fetch(`${gatewayUrl}${path}`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload.ok === false) {
    throw new Error(payload.error || `Biblioteca indisponível (HTTP ${response.status})`);
  }
  return payload as T;
}

export class WhatsAppStoryMediaRepository {
  private static remoteCache: WhatsAppStoryMedia[] = [];
  private static remoteLoaded = false;

  private static getStorage(): Storage | null {
    if (typeof window === "undefined") return null;
    return window.localStorage;
  }

  private static getLocalOnly(): WhatsAppStoryMedia[] {
    const storage = this.getStorage();
    if (!storage) return [];
    try {
      const raw = storage.getItem(STORAGE_KEY);
      return raw && Array.isArray(JSON.parse(raw)) ? JSON.parse(raw) : [];
    } catch {
      return [];
    }
  }

  static getAll(): WhatsAppStoryMedia[] {
    const local = this.getLocalOnly();
    const merged = new Map<string, WhatsAppStoryMedia>();
    for (const story of local) {
      if (!this.remoteLoaded || /^data:[^;]+;base64,/i.test(story.mediaUrl) ||
          this.remoteCache.some((remote) => remote.id === story.id)) {
        merged.set(story.id, story);
      }
    }
    for (const story of this.remoteCache) {
      const original = merged.get(story.id);
      merged.set(story.id, {
        ...story,
        seenContactIds: original?.seenContactIds || [],
      });
    }
    return [...merged.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  static async loadAll(): Promise<WhatsAppStoryMedia[]> {
    const db = getSupabaseBrowserClient();
    if (!db) throw new Error("Supabase não configurado para a biblioteca.");
    const { data, error } = await db.from("whatsapp_status_story_library")
      .select("id,title,type,media_url,story_key,caption,times_posted,created_at,last_posted_at,automation_enabled,trigger_mode,sort_order,after_minutes,publish_time,window_start,window_end,min_gap_minutes")
      .order("created_at", { ascending: false }).limit(1000);
    if (error) throw error;
    this.remoteCache = (data || []).map((row: CloudRow) => remoteStory(row));
    this.remoteLoaded = true;
    return this.getAll();
  }

  static getById(id: string): WhatsAppStoryMedia | null {
    return this.getAll().find((story) => story.id === id) || null;
  }

  static save(story: WhatsAppStoryMedia): WhatsAppStoryMedia {
    const storage = this.getStorage();
    const local = this.getLocalOnly();
    const updated = [story, ...local.filter((item) => item.id !== story.id)];
    try { storage?.setItem(STORAGE_KEY, JSON.stringify(updated)); }
    catch (err) { console.warn("[StoryLibrary] Erro ao gravar cache local:", err); }
    return story;
  }

  static create(input: CreateWhatsAppStoryMediaInput): WhatsAppStoryMedia {
    const story: WhatsAppStoryMedia = {
      id: `story_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      title: input.title.trim(),
      type: input.type,
      mediaUrl: input.mediaUrl,
      thumbnailUrl: input.thumbnailUrl,
      caption: input.caption?.trim() || "",
      backgroundColor: input.backgroundColor,
      font: input.font || 0,
      seenContactIds: [], timesPosted: 0,
      createdAt: new Date().toISOString(),
    };
    return this.save(story);
  }

  static async storyKey(story: WhatsAppStoryMedia): Promise<string> {
    if (story.storyKey) return story.storyKey;
    const media = String(story.mediaUrl || "");
    const sampleSize = 64 * 1024;
    const sampled = media.length <= sampleSize * 2
      ? media
      : `${media.slice(0, sampleSize)}::${media.slice(-sampleSize)}`;
    const payload = [story.type, String(story.caption || "").trim(), String(media.length), sampled].join("\n");
    if (typeof crypto !== "undefined" && crypto.subtle) {
      const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(payload));
      const hex = [...new Uint8Array(digest)].map((v) => v.toString(16).padStart(2, "0")).join("");
      return `sha256:${hex}`;
    }
    let hash = 2166136261;
    for (let i = 0; i < payload.length; i += 1) {
      hash ^= payload.charCodeAt(i);
      hash = Math.imul(hash, 16777619);
    }
    return `fnv1a:${(hash >>> 0).toString(16)}:${media.length}`;
  }

  static async createCloud(input: {
    id?: string; title: string; type: "image" | "video";
    mediaBase64: string; caption?: string; createdAt?: string;
    timesPosted?: number; lastPostedAt?: string; seenContactIds?: string[];
    storyKey?: string;
  }): Promise<WhatsAppStoryMedia> {
    const result = await gatewayPost<{ ok: true; story: WhatsAppStoryMedia }>("/status/library", input);
    this.remoteCache = [result.story, ...this.remoteCache.filter((item) => item.id !== result.story.id)];
    return this.save({ ...result.story, seenContactIds: input.seenContactIds || [] });
  }

  static async migrateLocalStories(): Promise<{ migrated: number; failed: number }> {
    let migrated = 0;
    let failed = 0;
    // Only locally stored Base64 content requires migration.
    for (const story of this.getLocalOnly()) {
      if (!/^data:[^;]+;base64,/i.test(story.mediaUrl || "")) continue;
      try {
        const key = await this.storyKey(story);
        await this.createCloud({
          id: story.id, title: story.title, type: story.type,
          mediaBase64: story.mediaUrl, caption: story.caption,
          storyKey: key, createdAt: story.createdAt,
          timesPosted: story.timesPosted, lastPostedAt: story.lastPostedAt,
          seenContactIds: story.seenContactIds,
        });
        migrated++;
      } catch (err) {
        failed++;
        console.warn("[StoryLibrary] Story local preservado após falha de migração:", story.id, err);
      }
    }
    return { migrated, failed };
  }

  static delete(id: string): boolean {
    const local = this.getLocalOnly();
    this.remoteCache = this.remoteCache.filter((item) => item.id !== id);
    try { this.getStorage()?.setItem(STORAGE_KEY, JSON.stringify(local.filter((item) => item.id !== id))); }
    catch (err) { console.warn("[StoryLibrary] Falha ao excluir cache:", err); }
    return local.some((item) => item.id === id);
  }

  static async deleteCloud(id: string): Promise<void> {
    const story = this.getById(id);
    if (this.remoteCache.some((item) => item.id === id) ||
        /^https?:\/\//i.test(story?.mediaUrl || "")) {
      await gatewayPost("/status/library/delete", { id });
    }
    this.delete(id);
  }

  static async markCloudPosted(id: string): Promise<void> {
    const story = this.getById(id);
    if (!this.remoteCache.some((item) => item.id === id) &&
        !/^https?:\/\//i.test(story?.mediaUrl || "")) return;
    await gatewayPost("/status/library/posted", { id });
    this.remoteCache = this.remoteCache.map((story) => story.id === id
      ? { ...story, timesPosted: story.timesPosted + 1, lastPostedAt: new Date().toISOString() }
      : story);
  }

  static recordContactsSeen(storyId: string, newContactIds: string[]): WhatsAppStoryMedia | null {
    const story = this.getById(storyId);
    if (!story) return null;
    const seen = new Set(story.seenContactIds || []);
    for (const id of newContactIds) {
      const value = String(id || "").trim();
      if (!value) continue;
      seen.add(value);
      if (value.includes("@")) seen.add(value.replace(/@.*$/, ""));
      else seen.add(`${value}@c.us`);
    }
    return this.save({
      ...story, seenContactIds: [...seen],
      timesPosted: story.timesPosted + 1, lastPostedAt: new Date().toISOString(),
    });
  }

  static resetSeenContacts(id: string): WhatsAppStoryMedia | null {
    const story = this.getById(id);
    return story ? this.save({ ...story, seenContactIds: [] }) : null;
  }
}
