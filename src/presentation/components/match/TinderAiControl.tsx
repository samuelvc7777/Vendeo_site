"use client";

import { useCallback, useEffect, useState } from "react";
import { Loader2, RefreshCw, ShieldAlert, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { getTinderAiState, prepareTinderAi, toggleTinderAi, type TinderAiState, type TinderMatchItem } from "./tinder-client";

export function TinderAiControl({ match }: { match: TinderMatchItem }) {
  const [state, setState] = useState<TinderAiState | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const next = await getTinderAiState(match.id);
      setState(next);
      setError(null);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Falha ao consultar o estado da IA.");
    } finally {
      setLoading(false);
    }
  }, [match.id]);

  useEffect(() => {
    setState(null);
    void refresh();
  }, [refresh]);

  const change = async () => {
    if (busy || loading || !state) return;
    const targetEnabled = !state.isEnabled;
    if (targetEnabled && !state.automation?.enabled) {
      toast.error("A IA do Tinder não está liberada para leitura e envio no servidor.");
      return;
    }
    setBusy(true);
    try {
      let conversationId = state.conversationId;
      if (targetEnabled) {
        // Apenas importa histórico e prepara cronograma; não responde ao passado.
        const prepared = await prepareTinderAi(match);
        conversationId = prepared.conversationId;
      }
      if (!conversationId) throw new Error("Conversa canônica ainda não disponível.");
      const result = await toggleTinderAi(conversationId, targetEnabled);
      if (!result.success || result.isEnabled !== targetEnabled) {
        throw new Error("O servidor não confirmou a alteração da IA.");
      }
      await refresh();
      toast.success(targetEnabled ? "IA ativada para novas mensagens deste match." : "IA pausada neste match.");
    } catch (reason) {
      toast.error(reason instanceof Error ? reason.message : "Falha ao alterar a IA.");
      await refresh();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="shrink-0 border-b border-zinc-200 bg-zinc-50 px-3 py-3 dark:border-white/10 dark:bg-[#141417]">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="flex items-center gap-1.5 text-xs font-bold text-zinc-900 dark:text-white">
            <Sparkles className="h-4 w-4 text-[#fd5068]" /> Brain neste match
          </p>
          <p className="mt-1 text-[11px] text-zinc-500">
            {loading ? "Consultando..." : state?.isEnabled ? "Ativa para novas mensagens" : "Desativada neste match"}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button type="button" aria-label="Atualizar estado da IA" onClick={() => void refresh()} disabled={busy || loading} className="rounded-full p-2 text-zinc-500 disabled:opacity-40">
            <RefreshCw className="h-4 w-4" />
          </button>
          <button type="button" onClick={() => void change()} disabled={busy || loading || !state || (!state.isEnabled && !state.automation?.enabled)} className="min-h-9 rounded-full bg-[#fd5068] px-4 text-xs font-bold text-white disabled:cursor-not-allowed disabled:bg-zinc-300 dark:disabled:bg-zinc-700">
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : state?.isEnabled ? "Desativar IA" : "Ativar IA"}
          </button>
        </div>
      </div>
      {error && <p role="alert" className="mt-2 text-[11px] text-red-600">{error}</p>}
      {!loading && state && !state.automation?.enabled && (
        <p className="mt-2 flex gap-1.5 text-[11px] text-amber-700 dark:text-amber-300">
          <ShieldAlert className="h-4 w-4 shrink-0" /> Automação bloqueada no servidor: requer leitura e envio Tinder liberados. Nenhuma mensagem será disparada.
        </p>
      )}
    </div>
  );
}
