import { NextRequest, NextResponse } from "next/server";
import { SupabaseInstagramRepository } from "@/infrastructure/repositories/SupabaseInstagramRepository";
import { InstagramApiClient } from "@/infrastructure/instagram/InstagramApiClient";

export const dynamic = "force-static";

export async function GET() {

  try {
    const repo = new SupabaseInstagramRepository();
    const config = await repo.getConfig();

    if (!config || !config.isConnected) {
      return NextResponse.json({
        isConnected: false,
        account: null,
      });
    }

    return NextResponse.json({
      isConnected: true,
      account: {
        id: config.instagramAccountId,
        username: config.username || "instagram_user",
        name: config.name,
        profilePictureUrl: config.profilePictureUrl,
        isConnected: true,
        pageId: config.pageId,
        updatedAt: config.updatedAt,
      },
    });
  } catch (error: unknown) {
    const errMessage = error instanceof Error ? error.message : "Erro desconhecido ao carregar configuração.";
    return NextResponse.json({ error: errMessage, isConnected: false }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const accessToken = (body?.accessToken || body?.access_token || "").trim();
    const instagramAccountId = (body?.instagramAccountId || body?.instagram_account_id || "").trim();
    const pageId = (body?.pageId || body?.page_id || "").trim();
    const appSecret = (body?.appSecret || body?.app_secret || "").trim();

    if (!accessToken) {
      return NextResponse.json(
        { error: "O Access Token da Meta/Instagram é obrigatório para a conexão." },
        { status: 400 }
      );
    }

    // Validação e descoberta da conta na API do Instagram ou Meta
    let discoveredAccount;
    let resolvedPageId = pageId;
    let resolvedAccessToken = accessToken;

    try {
      const discovery = await InstagramApiClient.validateAndDiscoverAccount(accessToken);
      discoveredAccount = discovery.account;
      resolvedPageId = resolvedPageId || discovery.pageId;
      resolvedAccessToken = discovery.pageAccessToken;
    } catch (apiErr: unknown) {
      const msg = apiErr instanceof Error ? apiErr.message : "Falha ao validar credenciais na API do Instagram/Meta.";
      return NextResponse.json({ error: msg }, { status: 400 });
    }

    // Persistir no Supabase
    const repo = new SupabaseInstagramRepository();
    await repo.saveConfig({
      accessToken: resolvedAccessToken,
      instagramAccountId: discoveredAccount.id,
      pageId: resolvedPageId,
      appSecret: appSecret || undefined,
      username: discoveredAccount.username,
      name: discoveredAccount.name,
      profilePictureUrl: discoveredAccount.profilePictureUrl,
      isConnected: true,
    });

    // Sincronização inicial automática de conversas
    try {
      const liveConvs = await InstagramApiClient.getConversations(
        resolvedAccessToken,
        discoveredAccount.id,
        discoveredAccount.username
      );
      for (const c of liveConvs) {
        await repo.saveConversation({
          id: c.id,
          username: c.username,
          fullName: c.fullName,
          avatar: c.avatar,
          lastMessage: c.lastMessage,
          lastMessageAt: c.lastMessageAt,
          lastDirection: c.lastDirection,
          unread: c.unread,
          status: "active",
        });
      }
    } catch (syncErr) {
      console.warn("Aviso na sincronização inicial de conversas:", syncErr);
    }

    return NextResponse.json({
      success: true,
      account: discoveredAccount,
      message: `Conta @${discoveredAccount.username} conectada com sucesso!`,
    });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : "Erro inesperado ao conectar conta.";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function DELETE() {
  try {
    const repo = new SupabaseInstagramRepository();
    await repo.disconnect();
    return NextResponse.json({ success: true, message: "Conta do Instagram desconectada com sucesso." });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : "Erro ao desconectar conta.";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
