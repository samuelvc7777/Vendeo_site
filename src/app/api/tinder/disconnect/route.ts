import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdminClient, getSupabaseServerClient } from "@/infrastructure/supabase/server";

export async function POST(req: NextRequest) {
  const client = getSupabaseAdminClient() || getSupabaseServerClient();
  if (client) {
    try {
      await client.from("tinder_config").delete().eq("id", "default");
    } catch (err) {
      console.warn("Aviso ao remover tinder_config no Supabase:", err);
    }
  }

  const response = NextResponse.json({ success: true, isConnected: false });
  response.cookies.delete("tinder_token");
  return response;
}
