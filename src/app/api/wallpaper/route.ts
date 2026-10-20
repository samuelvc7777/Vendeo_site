import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdminClient } from "@/infrastructure/supabase/server";

const BUCKET_NAME = "whatsapp_wallpapers";
const WALLPAPER_PATH = "global/wallpaper.jpg";

async function ensureBucket(supabase: any): Promise<void> {
  try {
    const { data: buckets } = await supabase.storage.listBuckets();
    const exists = buckets?.some((b: any) => b.name === BUCKET_NAME);
    if (!exists) {
      await supabase.storage.createBucket(BUCKET_NAME, {
        public: true,
        fileSizeLimit: 10485760, // 10MB
        allowedMimeTypes: ["image/jpeg", "image/png", "image/webp"],
      });
    }
  } catch (err) {
    console.warn("Aviso ao verificar bucket wallpaper:", err);
  }
}

export async function GET() {
  const supabase = getSupabaseAdminClient();
  if (!supabase) {
    return NextResponse.json({ error: "Supabase não configurado" }, { status: 500 });
  }

  try {
    const { data } = supabase.storage.from(BUCKET_NAME).getPublicUrl(WALLPAPER_PATH);

    // Verifica se o arquivo existe tentando fazer um HEAD request
    const response = await fetch(data.publicUrl, { method: "HEAD" });
    if (!response.ok) {
      return NextResponse.json({ url: null });
    }

    return NextResponse.json({ url: data.publicUrl });
  } catch (error) {
    console.error("Erro ao buscar wallpaper:", error);
    return NextResponse.json({ url: null });
  }
}

export async function POST(request: NextRequest) {
  const supabase = getSupabaseAdminClient();
  if (!supabase) {
    return NextResponse.json({ error: "Supabase não configurado" }, { status: 500 });
  }

  try {
    const formData = await request.formData();
    const file = formData.get("file") as File | null;

    if (!file) {
      return NextResponse.json({ error: "Nenhum arquivo enviado" }, { status: 400 });
    }

    if (!file.type.startsWith("image/")) {
      return NextResponse.json({ error: "Apenas imagens são permitidas" }, { status: 400 });
    }

    if (file.size > 5 * 1024 * 1024) {
      return NextResponse.json({ error: "Imagem muito grande (máx 5MB)" }, { status: 400 });
    }

    await ensureBucket(supabase);

    const buffer = Buffer.from(await file.arrayBuffer());

    // Remove o wallpaper antigo se existir
    await supabase.storage.from(BUCKET_NAME).remove([WALLPAPER_PATH]);

    // Upload do novo wallpaper
    const { error: uploadError } = await supabase.storage
      .from(BUCKET_NAME)
      .upload(WALLPAPER_PATH, buffer, {
        contentType: file.type,
        upsert: true,
      });

    if (uploadError) {
      console.error("Erro no upload do wallpaper:", uploadError);
      return NextResponse.json({ error: "Erro ao salvar imagem" }, { status: 500 });
    }

    const { data: publicUrlData } = supabase.storage
      .from(BUCKET_NAME)
      .getPublicUrl(WALLPAPER_PATH);

    return NextResponse.json({ url: publicUrlData.publicUrl });
  } catch (error) {
    console.error("Erro ao processar upload do wallpaper:", error);
    return NextResponse.json({ error: "Erro interno" }, { status: 500 });
  }
}

export async function DELETE() {
  const supabase = getSupabaseAdminClient();
  if (!supabase) {
    return NextResponse.json({ error: "Supabase não configurado" }, { status: 500 });
  }

  try {
    const { error } = await supabase.storage.from(BUCKET_NAME).remove([WALLPAPER_PATH]);

    if (error && error.message !== "Not found") {
      console.error("Erro ao remover wallpaper:", error);
      return NextResponse.json({ error: "Erro ao remover imagem" }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Erro ao processar remoção do wallpaper:", error);
    return NextResponse.json({ error: "Erro interno" }, { status: 500 });
  }
}