import { NextRequest, NextResponse } from "next/server";
import { SupabaseMediaStorage } from "@/infrastructure/storage/SupabaseMediaStorage";

export const dynamic = "force-static";

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const file = formData.get("file") as File | null;
    const mediaType = (formData.get("type") as string) || "audio";

    if (!file) {
      return NextResponse.json(
        { error: "Nenhum arquivo enviado" },
        { status: 400 }
      );
    }

    const arrayBuffer = await file.arrayBuffer();
    const storage = new SupabaseMediaStorage();

    const contentType =
      file.type || (mediaType === "audio" ? "audio/wav" : "image/jpeg");
    const ext = contentType.includes("wav") ? "wav" : contentType.includes("m4a") ? "m4a" : contentType.includes("mp3") ? "mp3" : "bin";
    const baseName = file.name ? file.name.replace(/\.[^.]+$/, "") : `${mediaType}_${Date.now()}`;

    const publicUrl = await storage.uploadBuffer(
      arrayBuffer,
      `${baseName}.${ext}`,
      contentType
    );

    if (!publicUrl) {
      return NextResponse.json(
        { error: "Falha ao processar upload no Supabase Storage" },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      url: publicUrl,
      fileName: `${baseName}.${ext}`,
      contentType,
      fileSize: file.size,
    });
  } catch (error: any) {
    console.error("Erro na rota de upload de mídia:", error);
    return NextResponse.json(
      { error: error?.message || "Erro interno do servidor" },
      { status: 500 }
    );
  }
}
