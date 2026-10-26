"use client";

import { useEffect, useState } from "react";
import { storeWhatsAppManagementToken, useWhatsAppAccounts } from "@/presentation/hooks/useWhatsAppAccounts";
import { WhatsAppAccountProvider } from "../chat/WhatsAppAccountContext";
import { WhatsApp2ConnectionCard } from "./WhatsApp2ConnectionCard";

export function WhatsAppAccountsManager({ onConnectionChange }: { onConnectionChange?: (connected: boolean) => void }) {
  const manager = useWhatsAppAccounts();
  const [name, setName] = useState("");
  const [managementToken, setManagementToken] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (manager.supported) onConnectionChange?.(manager.accounts.some(account => account.status === "ready"));
  }, [manager.supported, manager.accounts, onConnectionChange]);

  if (manager.loading) return <p role="status" className="p-4 text-sm text-zinc-500">Carregando WhatsApps…</p>;
  if (!manager.supported && !manager.error) return <WhatsApp2ConnectionCard onConnectionChange={onConnectionChange} />;

  return <section className="space-y-3">
    <div className="flex items-center justify-between"><h3 className="font-semibold">Contas de WhatsApp</h3><span className="text-xs text-zinc-500">{manager.accounts.length}/{manager.limit}</span></div>
    <form className="flex flex-wrap gap-2" onSubmit={event => {
      event.preventDefault();
      storeWhatsAppManagementToken(managementToken.trim());
      setManagementToken("");
      setError(null);
    }}>
      <input aria-label="Chave de gerenciamento do WhatsApp" type="password" autoComplete="off" placeholder="Chave para adicionar ou pausar contas" value={managementToken} onChange={event => setManagementToken(event.target.value)} className="min-h-10 min-w-0 flex-1 rounded-xl border border-zinc-200 bg-transparent px-3 text-xs dark:border-zinc-700" />
      <button type="submit" disabled={!managementToken.trim()} className="min-h-10 rounded-xl border border-zinc-300 px-3 text-xs font-semibold dark:border-zinc-700">Salvar chave nesta aba</button>
    </form>
    {manager.accounts.map(account => <WhatsAppAccountProvider key={account.id} account={account}>
      <div className="space-y-2 rounded-2xl border border-zinc-200 p-3 dark:border-zinc-800">
        <div className="flex items-center justify-between gap-3">
          <p className="text-sm font-semibold">{account.name}</p>
          {account.id !== "legacy" && <button type="button" className="min-h-10 text-xs text-emerald-600" disabled={busy} onClick={async () => {
            setBusy(true); setError(null);
            try { await manager.configure(account.id, { enabled: !account.enabled }); }
            catch (err) { setError((err as Error).message); }
            finally { setBusy(false); }
          }}>{account.enabled ? "Pausar conexão" : "Retomar conexão"}</button>}
        </div>
        {account.enabled ? <WhatsApp2ConnectionCard /> : <p className="text-xs text-zinc-500">Conexão pausada. A sessão e o histórico estão salvos.</p>}
      </div>
    </WhatsAppAccountProvider>)}
    <form className="flex flex-wrap gap-2" onSubmit={async event => {
      event.preventDefault(); setBusy(true); setError(null);
      try { await manager.create(name); setName(""); }
      catch (err) { setError((err as Error).message); }
      finally { setBusy(false); }
    }}>
      <input aria-label="Nome do novo WhatsApp" placeholder="Nome do WhatsApp" maxLength={60} value={name} onChange={event => setName(event.target.value)} className="min-h-11 min-w-0 flex-1 rounded-xl border border-zinc-200 bg-transparent px-3 text-sm dark:border-zinc-700" />
      <button type="submit" disabled={busy || !name.trim() || manager.accounts.length >= manager.limit} className="min-h-11 rounded-xl bg-emerald-600 px-4 text-sm font-semibold text-white disabled:opacity-50">{busy ? "Aguarde…" : "Adicionar WhatsApp"}</button>
    </form>
    {(error || manager.error) && <p role="alert" className="text-sm text-red-500">{error || manager.error}</p>}
  </section>;
}
