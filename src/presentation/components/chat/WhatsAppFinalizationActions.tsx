"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ArrowDown, ArrowUp, FileAudio2, FolderOpen, Image as ImageIcon, Loader2, Plus, Send, Ticket, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import { getSupabaseBrowserClient } from "@/infrastructure/supabase/client";
import { getApiUrl } from "@/infrastructure/http/network";
import { formatMessageTime } from "@/lib/utils";
import type { DirectMessage } from "./InstagramDirect";
import { convertToWhatsAppVoiceNote } from "./audio-converter";
import { queueWhatsApp2Finalization } from "./whatsapp2-client";

type FinalizationKind = "text" | "audio" | "image" | "raffle_numbers";
type FinalizationItem = {
  id: string;
  position: number;
  kind: FinalizationKind;
  body: string | null;
  media_url: string | null;
  file_name: string | null;
  duration_seconds: number | null;
  created_at: string;
};

const TABLE = "whatsapp_finalization_vault_items";
const MAX_ITEMS = 30;
const label: Record<FinalizationKind, string> = { text: "Texto", audio: "Áudio", image: "Foto", raffle_numbers: "10 números livres da rifa" };
const delay: Record<FinalizationKind, number> = { text: 5, audio: 1, image: 3, raffle_numbers: 5 };

function getFinalizationDelaySeconds(item: Pick<FinalizationItem, "kind" | "duration_seconds">): number {
  if (item.kind === "audio") {
    const duration = Number(item.duration_seconds);
    return Number.isFinite(duration) && duration > 0 ? Math.max(1, Math.ceil(duration)) : 1;
  }
  return delay[item.kind];
}

function readAudioDurationSeconds(file: File): Promise<number> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const audio = new Audio();
    audio.preload = "metadata";
    let timeout: number;
    const finish = (error?: Error, duration?: number) => {
      window.clearTimeout(timeout);
      audio.onloadedmetadata = null;
      audio.onerror = null;
      audio.src = "";
      URL.revokeObjectURL(url);
      if (error) reject(error);
      else resolve(Math.max(1, Math.ceil(duration || 0)));
    };
    timeout = window.setTimeout(() => finish(new Error("Não consegui ler a duração deste áudio. Tente outro arquivo.")), 15000);
    audio.onloadedmetadata = () => {
      if (!Number.isFinite(audio.duration) || audio.duration <= 0) {
        finish(new Error("Não consegui identificar a duração do áudio."));
        return;
      }
      finish(undefined, audio.duration);
    };
    audio.onerror = () => finish(new Error("Não consegui ler a duração deste áudio. Tente outro arquivo."));
    audio.src = url;
  });
}

function readAudioDurationFromUrl(src: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const audio = new Audio();
    audio.preload = "metadata";
    let timeout: number;
    const finish = (error?: Error, duration?: number) => {
      window.clearTimeout(timeout);
      audio.onloadedmetadata = null;
      audio.onerror = null;
      audio.src = "";
      if (error) reject(error);
      else resolve(Math.max(1, Math.ceil(duration || 0)));
    };
    timeout = window.setTimeout(() => finish(new Error("Não consegui identificar a duração de um áudio já salvo. Reenvie o arquivo e tente novamente.")), 15000);
    audio.onloadedmetadata = () => {
      if (!Number.isFinite(audio.duration) || audio.duration <= 0) {
        finish(new Error("Não consegui identificar a duração de um áudio já salvo. Reenvie o arquivo e tente novamente."));
        return;
      }
      finish(undefined, audio.duration);
    };
    audio.onerror = () => finish(new Error("Não consegui ler a duração de um áudio já salvo. Reenvie o arquivo e tente novamente."));
    audio.src = src;
  });
}

function client() {
  const supabase = getSupabaseBrowserClient();
  if (!supabase) throw new Error("Banco de dados indisponível.");
  return supabase;
}

async function readVault(): Promise<FinalizationItem[]> {
  const { data, error } = await client().from(TABLE)
    .select("id,position,kind,body,media_url,file_name,duration_seconds,created_at")
    .order("position", { ascending: true })
    .order("created_at", { ascending: true });
  if (error) throw new Error(error.message);
  return (data || []) as FinalizationItem[];
}

export function WhatsAppFinalizationActions({
  conversationId, providerId, contactName, onQueueFinalization,
}: {
  conversationId: string;
  providerId: string;
  contactName: string;
  onQueueFinalization?: (messages: DirectMessage[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<FinalizationItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [sending, setSending] = useState(false);
  const [draft, setDraft] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement | null>(null);
  const inputKind = useRef<"audio" | "image">("image");
  const requestRef = useRef<{ chatId: string; id: string } | null>(null);
  const sendingRef = useRef(false);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      setItems(await readVault());
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Erro ao carregar cofre.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    void Promise.resolve().then(() => { if (!cancelled) void reload(); });
    return () => { cancelled = true; };
  }, [open, reload]);

  useEffect(() => {
    if (!open) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = previous; };
  }, [open]);

  const saveText = async () => {
    const text = draft.trim();
    if (!text) return toast.error("Digite o texto da mensagem.");
    if (text.length > 4000) return toast.error("Máximo de 4.000 caracteres por mensagem.");
    if (!editingId && items.length >= MAX_ITEMS) return toast.error("Limite de 30 itens no cofre.");
    setBusy(true);
    try {
      const payload = { kind: "text", body: text, media_url: null, file_name: null, updated_at: new Date().toISOString() };
      const result = editingId
        ? await client().from(TABLE).update(payload).eq("id", editingId)
        : await client().from(TABLE).insert({ ...payload, position: items.length ? Math.max(...items.map((i) => i.position)) + 1 : 0 });
      if (result.error) throw result.error;
      setDraft("");
      setEditingId(null);
      await reload();
      toast.success(editingId ? "Texto atualizado." : "Texto salvo no cofre.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Erro ao salvar texto.");
    } finally {
      setBusy(false);
    }
  };

  const addRaffleNumbers = async () => {
    if (items.some((item) => item.kind === "raffle_numbers")) {
      toast.info("Os 10 números livres já estão no cofre.");
      return;
    }
    if (items.length >= MAX_ITEMS) return toast.error("Limite de 30 itens no cofre.");
    setBusy(true);
    try {
      const { error } = await client().from(TABLE).insert({
        kind: "raffle_numbers",
        body: null,
        media_url: null,
        file_name: null,
        position: items.length ? Math.max(...items.map((item) => item.position)) + 1 : 0,
      });
      if (error) throw error;
      await reload();
      toast.success("10 números livres adicionados. Os números serão sorteados na hora de enviar.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Não foi possível adicionar os números da rifa.");
    } finally {
      setBusy(false);
    }
  };

  const uploadMedia = async (file: File | null) => {
    if (!file) return;
    if (items.length >= MAX_ITEMS) return toast.error("Limite de 30 itens no cofre.");
    const kind = inputKind.current;
    if (kind === "audio" && !(file.type.startsWith("audio/") || /\.(mp3|wav|m4a|ogg|opus|webm)$/i.test(file.name))) {
      return toast.error("Selecione um arquivo de áudio.");
    }
    if (kind === "image" && !["image/jpeg", "image/png", "image/webp"].includes(file.type)) {
      return toast.error("Escolha uma foto JPG, PNG ou WebP.");
    }
    if (file.size > 30 * 1024 * 1024) return toast.error("Limite de 30 MB por arquivo.");
    setBusy(true);
    try {
      const uploadFile = kind === "audio" ? await convertToWhatsAppVoiceNote(file) : file;
      const durationSeconds = kind === "audio" ? await readAudioDurationSeconds(uploadFile) : null;
      const form = new FormData();
      form.append("file", uploadFile);
      form.append("type", kind);
      const response = await fetch(getApiUrl("/api/instagram/upload"), { method: "POST", body: form });
      const result = await response.json().catch(() => ({}));
      if (!response.ok || !result.url || !/^https:\/\//.test(result.url)) {
        throw new Error(result.error || "Não foi possível hospedar a mídia.");
      }
      const { error } = await client().from(TABLE).insert({
        kind,
        position: items.length ? Math.max(...items.map((i) => i.position)) + 1 : 0,
        body: null,
        file_name: uploadFile.name,
        media_url: result.url,
        duration_seconds: durationSeconds,
      });
      if (error) throw error;
      await reload();
      toast.success(`${label[kind]} adicionado ao cofre.`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Falha ao adicionar mídia.");
    } finally {
      setBusy(false);
    }
  };

  const remove = async (id: string) => {
    if (!window.confirm("Excluir este item do cofre de finalização?")) return;
    setBusy(true);
    try {
      const { error } = await client().from(TABLE).delete().eq("id", id);
      if (error) throw error;
      await reload();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Não foi possível excluir.");
    } finally { setBusy(false); }
  };

  const move = async (index: number, change: -1 | 1) => {
    const otherIndex = index + change;
    if (otherIndex < 0 || otherIndex >= items.length) return;
    const reordered = [...items];
    [reordered[index], reordered[otherIndex]] = [reordered[otherIndex], reordered[index]];
    setBusy(true);
    try {
      // Positions are deliberately non-unique; use a fresh sequential order.
      for (const [position, item] of reordered.entries()) {
        const { error } = await client().from(TABLE).update({ position }).eq("id", item.id);
        if (error) throw error;
      }
      await reload();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Falha ao ordenar.");
      await reload();
    } finally { setBusy(false); }
  };

  const send = async () => {
    if (sendingRef.current) return;
    sendingRef.current = true;
    setSending(true);
    try {
      let latest = await readVault();
      latest = await Promise.all(latest.map(async (item) => {
        if (item.kind !== "audio" || (Number(item.duration_seconds) > 0) || !item.media_url) return item;
        const duration_seconds = await readAudioDurationFromUrl(item.media_url);
        const { error } = await client().from(TABLE).update({ duration_seconds }).eq("id", item.id);
        if (error) throw new Error("Não consegui salvar a duração de um áudio do cofre.");
        return { ...item, duration_seconds };
      }));
      if (!latest.length) throw new Error("Adicione textos, áudios ou fotos ao cofre antes de enviar.");
      if (latest.length > MAX_ITEMS) throw new Error("O cofre ultrapassou 30 itens.");
      const seconds = latest.reduce((sum, item) => sum + getFinalizationDelaySeconds(item), 0);
      if (!window.confirm(
        `Enviar ${latest.length} ${latest.length === 1 ? "mensagem" : "mensagens"} de finalização para ${contactName}?\n\n` +
        `A sequência levará pelo menos ${seconds}s: 5s por texto, a duração real de cada áudio e 3s por foto. Depois de confirmar, a fila continua mesmo se fechar esta tela.`
      )) return;
      const request = requestRef.current?.chatId === conversationId
        ? requestRef.current.id
        : crypto.randomUUID();
      requestRef.current = { chatId: conversationId, id: request };
      const queued = await queueWhatsApp2Finalization({
        to: providerId,
        conversationId,
        requestId: request,
      });

      if (onQueueFinalization) {
        let messagesToShow: DirectMessage[] = [];
        if (Array.isArray(queued.items) && queued.items.length > 0) {
          messagesToShow = queued.items.map((item) => {
            const scheduledMs = Date.parse(item.scheduled_at) || Date.now();
            const isAudio = item.kind === "audio" || Boolean(item.voice_note);
            const isImage = item.kind === "image";
            const text = isAudio
              ? "🎙️ Mensagem de voz"
              : isImage
              ? (item.text_content ? `📷 Foto: ${item.text_content}` : "📷 Foto")
              : (item.text_content || "");
            return {
              id: item.id,
              senderId: "me",
              text,
              mediaType: isAudio ? "audio" : isImage ? "image" : undefined,
              mediaUrl: item.media_url || undefined,
              audioTranscript: isAudio ? "🎙️ Mensagem de voz" : undefined,
              createdAt: formatMessageTime(scheduledMs),
              timestamp: scheduledMs,
              sentDate: item.scheduled_at,
              isMine: true,
              status: "sending" as const,
              deliverAt: scheduledMs,
              deliveryQueueStatus: (item.status === "sending" ? "sending" : "pending") as "sending" | "pending",
            };
          });
        } else {
          let currentDeliverAt = Date.now();
          messagesToShow = latest.map((item, index) => {
            const delayItem = index === 0 ? item : latest[index - 1];
            currentDeliverAt += getFinalizationDelaySeconds(delayItem) * 1000;
            const isAudio = item.kind === "audio";
            const isImage = item.kind === "image";
            const isRaffle = item.kind === "raffle_numbers";
            const text = isAudio
              ? "🎙️ Mensagem de voz"
              : isImage
              ? "📷 Foto"
              : isRaffle
              ? (item.body || "10 números livres da rifa")
              : (item.body || "");
            return {
              id: `fin-${request}-${String(index + 1).padStart(2, "0")}`,
              senderId: "me",
              text,
              mediaType: isAudio ? "audio" : isImage ? "image" : undefined,
              mediaUrl: item.media_url || undefined,
              audioTranscript: isAudio ? "🎙️ Mensagem de voz" : undefined,
              createdAt: formatMessageTime(currentDeliverAt),
              timestamp: currentDeliverAt,
              sentDate: new Date(currentDeliverAt).toISOString(),
              isMine: true,
              status: "sending" as const,
              deliverAt: currentDeliverAt,
              deliveryQueueStatus: "pending" as const,
            };
          });
        }
        onQueueFinalization(messagesToShow);
      }

      toast.success(queued.alreadyQueued
        ? "Essa finalização já estava programada; nenhum envio foi duplicado."
        : `${queued.count} mensagens de finalização agendadas em ordem.`);
      setOpen(false);
      requestRef.current = null;
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Não foi possível programar a finalização.");
    } finally {
      sendingRef.current = false;
      setSending(false);
    }
  };

  const startUpload = (kind: "audio" | "image") => {
    inputKind.current = kind;
    if (fileInput.current) {
      fileInput.current.accept = kind === "audio" ? "audio/*,.mp3,.m4a,.ogg,.opus,.wav" : "image/jpeg,image/png,image/webp";
      fileInput.current.click();
    }
  };

  return (
    <>
      <div className="flex items-center gap-2 px-3 py-1.5 border-t border-white/5 bg-transparent dark:bg-transparent backdrop-blur-sm">
        <button type="button" onClick={() => setOpen(true)}
          className="inline-flex items-center gap-1.5 rounded-xl border border-[#3b5355] bg-[#172a2c] px-3 py-1.5 text-xs font-semibold text-[#c0e7dc] hover:bg-[#23393a]"
          aria-label="Abrir cofre de finalização"><FolderOpen size={16} /> Cofre de finalização</button>
        <button type="button" disabled={sending} onClick={() => void send()}
          className="inline-flex items-center gap-1.5 rounded-xl bg-[#008c72] px-3 py-1.5 text-xs font-semibold text-white hover:bg-[#00a884] disabled:opacity-50"
          aria-label="Enviar mensagens de finalização para esta conversa">
          {sending ? <Loader2 size={15} className="animate-spin" /> : <Send size={15} />} Enviar finalização
        </button>
      </div>
      {open && createPortal(
        <div className="fixed inset-0 z-[13000] flex items-center justify-center bg-black/75 p-3" role="presentation">
          <section role="dialog" aria-modal="true" aria-label="Cofre de finalização"
            className="flex h-[min(92dvh,780px)] w-full max-w-xl flex-col overflow-hidden rounded-2xl bg-[#111b21] text-white shadow-2xl">
            <header className="flex items-center justify-between border-b border-white/10 px-4 py-4">
              <div><h2 className="text-base font-bold">Cofre de finalização</h2>
                <p className="text-xs text-[#98aeb5]">Biblioteca compartilhada · {items.length} de 30 itens</p></div>
              <button type="button" aria-label="Fechar cofre" onClick={() => setOpen(false)} className="rounded-full p-2 hover:bg-white/10"><X size={20} /></button>
            </header>
            <div className="flex-1 overflow-y-auto px-4 py-3">
              <div className="mb-3 flex flex-wrap gap-2">
                <button disabled={busy} type="button" onClick={() => startUpload("audio")}
                  className="flex items-center gap-1.5 rounded-lg border border-white/15 px-3 py-2 text-xs"><FileAudio2 size={16} /> Adicionar áudio</button>
                <button disabled={busy} type="button" onClick={() => startUpload("image")}
                  className="flex items-center gap-1.5 rounded-lg border border-white/15 px-3 py-2 text-xs"><ImageIcon size={16} /> Adicionar foto</button>
                <button disabled={busy || items.some((item) => item.kind === "raffle_numbers")} type="button" onClick={() => void addRaffleNumbers()}
                  className="flex items-center gap-1.5 rounded-lg border border-[#2c6d56] px-3 py-2 text-xs text-[#8ee4c2] disabled:opacity-40"><Ticket size={16} /> 10 números livres</button>
              </div>
              <input ref={fileInput} type="file" className="hidden" onChange={(event) => {
                const file = event.target.files?.[0] || null;
                event.currentTarget.value = "";
                void uploadMedia(file);
              }} />
              <div className="mb-4 space-y-2">
                <label htmlFor="finalization-text" className="text-sm font-semibold">Mensagem de texto</label>
                <textarea id="finalization-text" rows={3} maxLength={4000} value={draft} onChange={(e) => setDraft(e.target.value)}
                  placeholder="Digite uma mensagem para salvar na sequência..."
                  className="w-full resize-y rounded-xl border border-white/15 bg-[#1c2b33] p-3 text-sm outline-none focus:border-[#00a884]" />
                <div className="flex gap-2">
                  <button disabled={busy || !draft.trim()} type="button" onClick={() => void saveText()}
                    className="flex items-center gap-1.5 rounded-lg bg-[#008c72] px-3 py-2 text-xs font-semibold disabled:opacity-40">
                    <Plus size={15} /> {editingId ? "Salvar alteração" : "Adicionar texto"}
                  </button>
                  {editingId && <button type="button" onClick={() => { setEditingId(null); setDraft(""); }} className="text-xs text-[#a1b4ba]">Cancelar edição</button>}
                </div>
              </div>
              <h3 className="mb-2 text-sm font-bold">Ordem de envio</h3>
              <p className="mb-3 text-xs text-[#99aeb4]">Cada texto, áudio e lista de números aguarda 10s; cada foto, 3s. Áudios saem como voz gravada. Os 10 números livres são escolhidos da rifa ativa somente ao confirmar o envio.</p>
              {loading && <p className="text-xs text-[#99aeb4]">Carregando...</p>}
              {!loading && items.length === 0 && <p className="rounded-xl border border-dashed border-white/20 p-5 text-center text-xs text-[#99aeb4]">Cofre vazio. Adicione o primeiro item acima.</p>}
              <ol className="space-y-2">
                {items.map((item, index) => (
                  <li key={item.id} className="flex items-start gap-2 rounded-xl border border-white/10 bg-[#1a2a31] p-2.5">
                    <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[#294941] text-xs font-bold">{index + 1}</div>
                    <div className="min-w-0 flex-1">
                      <strong className="text-xs">{label[item.kind]} · {delay[item.kind]}s</strong>
                      {item.kind === "text"
                        ? <p className="mt-1 break-words text-xs text-[#cad5d8]">{item.body}</p>
                        : item.kind === "raffle_numbers"
                        ? <p className="mt-1 text-xs text-[#8ee4c2]">Exemplo: 05, 15, 19, 29, 53, 56, 73, 87, 92, 99. Os números reais serão selecionados entre os disponíveis no envio.</p>
                        : <div className="mt-1">
                            {item.kind === "image" && item.media_url
                              // eslint-disable-next-line @next/next/no-img-element
                              ? <img src={item.media_url} alt="Foto da finalização" className="max-h-28 rounded-lg object-contain" />
                              : <audio controls preload="none" src={item.media_url || undefined} className="h-9 max-w-full" />}
                            <p className="mt-1 truncate text-[10px] text-[#91a9ae]">{item.file_name}</p>
                          </div>}
                    </div>
                    <div className="flex flex-col gap-1">
                      <button disabled={busy || index === 0} type="button" aria-label="Mover para cima" onClick={() => void move(index,-1)} className="p-1 disabled:opacity-30"><ArrowUp size={15} /></button>
                      <button disabled={busy || index === items.length - 1} type="button" aria-label="Mover para baixo" onClick={() => void move(index,1)} className="p-1 disabled:opacity-30"><ArrowDown size={15} /></button>
                      {item.kind === "text" && <button disabled={busy} type="button" title="Editar texto" onClick={() => { setEditingId(item.id);setDraft(item.body || ""); }} className="text-xs text-[#79d9bb]">Editar</button>}
                      <button disabled={busy} type="button" title="Excluir" aria-label="Excluir item" onClick={() => void remove(item.id)} className="p-1 text-rose-400"><Trash2 size={15} /></button>
                    </div>
                  </li>
                ))}
              </ol>
            </div>
            <footer className="border-t border-white/10 px-4 py-3">
              {busy && <p className="mb-2 flex items-center gap-2 text-xs text-[#90b9af]"><Loader2 className="animate-spin" size={15} /> Salvando ou preparando arquivo...</p>}
              <button disabled={busy || sending || !items.length} type="button" onClick={() => void send()}
                className="flex w-full items-center justify-center gap-2 rounded-xl bg-[#00a884] px-3 py-3 font-bold disabled:opacity-40">
                <Send size={17} /> Enviar {items.length} {items.length === 1 ? "mensagem" : "mensagens"} para {contactName}
              </button>
            </footer>
          </section>
        </div>, document.body
      )}
    </>
  );
}
