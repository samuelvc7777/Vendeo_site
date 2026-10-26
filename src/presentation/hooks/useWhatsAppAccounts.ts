"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { resolveWhatsApp2GatewayUrl } from "@/presentation/components/chat/whatsapp2-client";
import type { WhatsAppConnection } from "@/presentation/components/chat/WhatsAppAccountContext";

const SELECTION_KEY = "vendeo_whatsapp_connection";
const MANAGEMENT_TOKEN_KEY = "vendeo_whatsapp_management_token";
const UPDATED = "vendeo-whatsapp-accounts-updated";

export function storeWhatsAppManagementToken(token: string) {
  try {
    if (token) sessionStorage.setItem(MANAGEMENT_TOKEN_KEY, token);
    else sessionStorage.removeItem(MANAGEMENT_TOKEN_KEY);
  } catch {}
}

export async function whatsappAccountsRequest(path: string, init?: RequestInit) {
  const base = await resolveWhatsApp2GatewayUrl();
  const headers = new Headers(init?.headers);
  try {
    const token = sessionStorage.getItem(MANAGEMENT_TOKEN_KEY);
    if (token) headers.set("Authorization", `Bearer ${token}`);
  } catch {}
  const response = await fetch(`${base}${path}`, { cache: "no-store", ...init, headers });
  const body = await response.json().catch(() => ({}));
  if (!response.ok || body.ok === false) {
    throw Object.assign(new Error(body.error || "Gerenciamento de WhatsApps indisponível."), { status: response.status });
  }
  return body;
}

export function useWhatsAppAccounts(preferredAccountId?: string | null) {
  const [accounts, setAccounts] = useState<WhatsAppConnection[]>([]);
  const [selectedId, setSelectedId] = useState("legacy");
  const [loading, setLoading] = useState(true);
  const [supported, setSupported] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [limit, setLimit] = useState(4);
  const managed = useRef(false);

  const refresh = useCallback(async () => {
    try {
      const data = await whatsappAccountsRequest("/accounts");
      if (!Array.isArray(data.accounts) || !data.accounts.length) throw new Error("O gateway retornou um cadastro de contas inválido.");
      managed.current = true;
      setAccounts(data.accounts);
      setLimit(data.limit);
      setSupported(true);
      setError(null);
    } catch (err) {
      // Compatibilidade apenas quando a rota realmente não existe no gateway antigo.
      if ((err as { status?: number }).status === 404 && !managed.current) {
        setSupported(false);
        setAccounts([]);
        setError(null);
      } else setError((err as Error).message);
    } finally { setLoading(false); }
  }, []);

  useEffect(() => {
    try { setSelectedId(localStorage.getItem(SELECTION_KEY) || "legacy"); } catch {}
    void refresh();
    const timer = window.setInterval(() => void refresh(), 5000);
    window.addEventListener(UPDATED, refresh);
    return () => { window.clearInterval(timer); window.removeEventListener(UPDATED, refresh); };
  }, [refresh]);

  const preferred = preferredAccountId ? accounts.find(account => account.accountId === preferredAccountId) : undefined;
  const selected = preferred || accounts.find(account => account.id === selectedId) || accounts[0];
  const select = useCallback((id: string) => {
    setSelectedId(id);
    try { localStorage.setItem(SELECTION_KEY, id); } catch {}
  }, []);
  const create = useCallback(async (name: string) => {
    const data = await whatsappAccountsRequest("/accounts", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name }),
    });
    select(data.account.id);
    await refresh();
    window.dispatchEvent(new Event(UPDATED));
  }, [refresh, select]);
  const configure = useCallback(async (id: string, patch: { name?: string; enabled?: boolean }) => {
    await whatsappAccountsRequest(`/connections/${encodeURIComponent(id)}/configuration`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(patch),
    });
    await refresh();
    window.dispatchEvent(new Event(UPDATED));
  }, [refresh]);
  return { accounts, selected, select, loading, supported, error, limit, create, configure, refresh };
}
