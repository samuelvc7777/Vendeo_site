"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { reciprocityFetch, reciprocityJson, type ReciprocitySnapshotView } from "./reciprocity-client";
import { useReciprocityAccess } from "./useReciprocityAccess";
export function useReciprocity(conversationId: string | null, messageRevision: string) {
  const access = useReciprocityAccess();
  const [entry, setEntry] = useState<{
    conversationId: string;
    access: string;
    snapshot: ReciprocitySnapshotView;
  } | null>(null);
  const [failure, setFailure] = useState<{
    conversationId: string;
    access: string;
    message: string;
  } | null>(null);
  const [busy, setBusy] = useState(false);
  const [connection, setConnection] = useState<{
    conversationId: string;
    access: string;
    connected: boolean;
  } | null>(null);
  const current = useRef({ conversationId, access });
  const refreshSequence = useRef(0);
  useEffect(() => { current.current = { conversationId, access }; }, [conversationId, access]);
  const refresh = useCallback(async () => {
    if (!conversationId || !access)
      return;
    const sequence = ++refreshSequence.current;
    const requestedId = conversationId;
    try {
      const snapshot = await reciprocityJson<ReciprocitySnapshotView>(`?conversationId=${encodeURIComponent(requestedId)}`);
      if (sequence === refreshSequence.current && current.current.conversationId === requestedId && current.current.access === access) {
        setEntry({ conversationId: requestedId, access, snapshot });
        setFailure(null);
      }
    }
    catch (error) {
      if (sequence === refreshSequence.current && current.current.conversationId === requestedId && current.current.access === access)
        setFailure({ conversationId: requestedId, access, message: error instanceof Error ? error.message : "Erro ao consultar análise." });
    }
  }, [access, conversationId]);
  useEffect(() => {
    let active = true;
    void Promise.resolve().then(() => {
      if (active)
        void refresh();
    });
    return () => { active = false; };
  }, [refresh, messageRevision]);
  useEffect(() => {
    const onFocus = () => { void refresh(); };
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [refresh]);
  useEffect(() => {
    if (!conversationId || !access)
      return;
    const controller = new AbortController();
    void (async () => {
      try {
        const response = await reciprocityFetch(`/events?conversationId=${encodeURIComponent(conversationId)}`, { signal: controller.signal });
        if (!response.ok || !response.body || controller.signal.aborted)
          return;
        setConnection({ conversationId, access, connected: true });
        // Uma única conexão autenticada; não há reconexão ou consulta periódica.
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        while (!controller.signal.aborted) {
          const chunk = await reader.read();
          if (chunk.done)
            break;
          buffer += decoder.decode(chunk.value, { stream: true }).replace(/\r\n/g, "\n");
          let boundary: number;
          while ((boundary = buffer.indexOf("\n\n")) >= 0) {
            const event = buffer.slice(0, boundary);
            buffer = buffer.slice(boundary + 2);
              if (event.split("\n").some(line => ["event: change", "event: ready"].includes(line.trim())))
              void refresh();
          }
          if (buffer.length > 65536)
            throw new Error("Evento inválido.");
        }
      }
      catch { /* Atualização manual continua disponível quando a conexão cai. */ }
      finally {
        if (!controller.signal.aborted)
          setConnection({ conversationId, access, connected: false });
      }
    })();
    return () => controller.abort();
  }, [conversationId, access, refresh]);
  const request = useCallback(async (reason: "manual" | "retry" | "reevaluation" = "manual") => {
    if (!conversationId || busy)
      return;
    const requestedId = conversationId;
    setBusy(true);
    try {
      await reciprocityJson("", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ conversationId: requestedId, reason }) });
      await refresh();
    }
    catch (error) {
      if (current.current.conversationId === requestedId && current.current.access === access)
        setFailure({ conversationId: requestedId, access, message: error instanceof Error ? error.message : "Erro ao solicitar análise." });
    }
    finally {
      setBusy(false);
    }
  }, [conversationId, access, busy, refresh]);
  return { snapshot: access && entry?.conversationId === conversationId && entry.access === access ? entry.snapshot : null, error: failure?.conversationId === conversationId && failure.access === access ? failure.message : null, busy, hasAccess: Boolean(access), refresh, request, updatesConnected: connection?.conversationId === conversationId && connection.access === access && connection.connected };
}
