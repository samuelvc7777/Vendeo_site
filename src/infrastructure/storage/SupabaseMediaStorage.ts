import { getSupabaseAdminClient } from "../supabase/server";

export interface StoredMediaResult {
  url: string;
  fileName: string;
  contentType: string;
  sizeBytes: number;
}

/**
 * Serviço de Mídia para Download e Armazenamento no Supabase Storage
 * Responsável por persistir mídias temporárias (como URLs efêmeras da Meta)
 * de forma permanente e pública no Supabase.
 */
export class SupabaseMediaStorage {
  private bucketName = "instagram_media";

  /**
   * Garante que o bucket público exista
   */
  private async ensureBucket(): Promise<void> {
    const supabase = getSupabaseAdminClient();
    if (!supabase) return;

    try {
      const { data: buckets } = await supabase.storage.listBuckets();
      const exists = buckets?.some((b) => b.name === this.bucketName);
      if (!exists) {
        await supabase.storage.createBucket(this.bucketName, {
          public: true,
          fileSizeLimit: 20971520, // 20MB
          allowedMimeTypes: [
            "audio/m4a",
            "audio/mp3",
            "audio/wav",
            "audio/aac",
            "audio/ogg",
            "audio/webm",
            "image/jpeg",
            "image/png",
            "image/webp",
            "video/mp4",
            "video/quicktime",
          ],
        });
      }
    } catch (err) {
      console.warn("Aviso ao verificar bucket no Supabase Storage:", err);
    }
  }

  /**
   * Faz o download de uma URL remota e envia para o bucket do Supabase Storage
   *
   * @param remoteUrl URL temporária da Meta (ou CDN externo)
   * @param prefix Prefixo do arquivo ("audio", "photo", etc.)
   * @returns URL pública permanente gerada pelo Supabase Storage
   */
  async downloadAndPersist(
    remoteUrl: string,
    prefix: "audio" | "image" | "video" = "audio"
  ): Promise<string | null> {
    const supabase = getSupabaseAdminClient();
    if (!supabase || !remoteUrl) return null;

    try {
      await this.ensureBucket();

      // Download do buffer da URL remota
      const res = await fetch(remoteUrl, {
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
        },
      });

      if (!res.ok) {
        console.error(
          `Falha ao baixar mídia remota (${res.status} ${res.statusText}):`,
          remoteUrl
        );
        return null;
      }

      const contentType =
        res.headers.get("content-type") ||
        (prefix === "audio" ? "audio/m4a" : "image/jpeg");
      const buffer = await res.arrayBuffer();

      let ext = "m4a";
      if (contentType.includes("mp3")) ext = "mp3";
      else if (contentType.includes("wav")) ext = "wav";
      else if (contentType.includes("ogg")) ext = "ogg";
      else if (contentType.includes("webm")) ext = "webm";
      else if (contentType.includes("png")) ext = "png";
      else if (contentType.includes("webp")) ext = "webp";
      else if (contentType.includes("jpeg") || contentType.includes("jpg")) ext = "jpg";
      else if (contentType.includes("mp4")) ext = "mp4";

      const fileName = `${prefix}_${Date.now()}_${Math.random().toString(36).substring(2, 8)}.${ext}`;

      const { error: uploadError } = await supabase.storage
        .from(this.bucketName)
        .upload(fileName, Buffer.from(buffer), {
          contentType,
          upsert: true,
        });

      if (uploadError) {
        console.error("Erro no upload para Supabase Storage:", uploadError);
        return null;
      }

      const { data: publicUrlData } = supabase.storage
        .from(this.bucketName)
        .getPublicUrl(fileName);

      return publicUrlData.publicUrl;
    } catch (error) {
      console.error("Erro inesperado ao persistir mídia no Supabase:", error);
      return null;
    }
  }

  /**
   * Salva diretamente um Buffer de arquivo (ex: vindo de um FormData de upload)
   */
  async uploadBuffer(
    buffer: Buffer | ArrayBuffer,
    fileName: string,
    contentType: string
  ): Promise<string | null> {
    const supabase = getSupabaseAdminClient();
    if (!supabase) return null;

    try {
      await this.ensureBucket();

      const normalizedBuffer =
        buffer instanceof Buffer
          ? buffer
          : Buffer.from(new Uint8Array(buffer));

      const uniqueFileName = `${Date.now()}_${fileName.replace(/[^a-zA-Z0-9._-]/g, "_")}`;

      const { error: uploadError } = await supabase.storage
        .from(this.bucketName)
        .upload(uniqueFileName, normalizedBuffer, {
          contentType,
          upsert: true,
        });

      if (uploadError) {
        console.error("Erro ao fazer upload no Supabase Storage:", uploadError);
        return null;
      }

      const { data: publicUrlData } = supabase.storage
        .from(this.bucketName)
        .getPublicUrl(uniqueFileName);

      return publicUrlData.publicUrl;
    } catch (error) {
      console.error("Erro inesperado ao fazer upload de buffer:", error);
      return null;
    }
  }
}
