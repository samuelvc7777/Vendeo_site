"use client";
import { useWhatsApp2Client } from "@/presentation/components/chat/WhatsAppAccountContext";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ArrowDown, ArrowUp, ChevronDown, FileAudio2, FolderOpen, Image as ImageIcon, Loader2, Pencil, Plus, Send, Ticket, Trash2, X } from "lucide-react";
import { useRaffles } from "@/presentation/hooks/useRaffles";
import { Pause, Play } from "lucide-react";
import { toast } from "sonner";
import { getSupabaseBrowserClient } from "@/infrastructure/supabase/client";
import { getApiUrl } from "@/infrastructure/http/network";
import { formatMessageTime } from "@/lib/utils";
import type { DirectMessage } from "./InstagramDirect";
import { convertToWhatsAppVoiceNote } from "./audio-converter";


type FinalizationKind = "text" | "audio" | "image" | "raffle_numbers";
type ReactionContext =
  | "raffle_interest_response"
  | "raffle_refusal_empathy"
  | "raffle_insistence_soft"
  | "raffle_confirmation"
  | "raffle_ghost_reminder";

type FinalizationItem = {
  id: string;
  position: number;
  kind: FinalizationKind;
  body: string | null;
  media_url: string | null;
  file_name: string | null;
  duration_seconds: number | null;
  created_at: string;
  reaction_context: ReactionContext | null;
};

const TABLE = "whatsapp_finalization_vault_items";
const MAX_ITEMS = 30;
const label: Record<FinalizationKind, string> = { text: "Texto", audio: "Áudio", image: "Foto", raffle_numbers: "10 números livres da rifa" };
const delay: Record<FinalizationKind, number> = { text: 5, audio: 1, image: 3, raffle_numbers: 5 };

const kindColor = (kind: FinalizationKind) => {
  switch (kind) {
    case "text": return "border-blue-500/15 bg-blue-500/[0.04]";
    case "audio": return "border-violet-500/15 bg-violet-500/[0.04]";
    case "image": return "border-pink-500/15 bg-pink-500/[0.04]";
    case "raffle_numbers": return "border-emerald-500/15 bg-emerald-500/[0.04]";
  }
};

const kindBadge = (kind: FinalizationKind) => {
  switch (kind) {
    case "text": return "bg-blue-500/15 text-blue-400";
    case "audio": return "bg-violet-500/15 text-violet-400";
    case "image": return "bg-pink-500/15 text-pink-400";
    case "raffle_numbers": return "bg-emerald-500/15 text-emerald-400";
  }
};

const kindEmoji = (kind: FinalizationKind) => {
  switch (kind) {
    case "text": return "📝";
    case "audio": return "🎙️";
    case "image": return "📷";
    case "raffle_numbers": return "🎰";
  }
};

const REACTION_CONTEXT_OPTIONS: Array<{ value: ReactionContext | ""; label: string; emoji: string }> = [
  { value: "", label: "Mostrando valores e a rifa", emoji: "🎰" },
  { value: "raffle_interest_response", label: "Resposta a Interesse", emoji: "🤩" },
  { value: "raffle_refusal_empathy", label: "Empatia na Recusa", emoji: "🥺" },
  { value: "raffle_insistence_soft", label: "Insistência Leve", emoji: "🙏" },
  { value: "raffle_confirmation", label: "Confirmação de Pagamento", emoji: "✅" },
  { value: "raffle_ghost_reminder", label: "Lembrete Ghost", emoji: "👻" },
];

const reactionContextBadge = (ctx: ReactionContext | null) => {
  switch (ctx) {
    case "raffle_interest_response": return "bg-amber-500/15 text-amber-400";
    case "raffle_refusal_empathy": return "bg-rose-500/15 text-rose-400";
    case "raffle_insistence_soft": return "bg-orange-500/15 text-orange-400";
    case "raffle_confirmation": return "bg-emerald-500/15 text-emerald-400";
    case "raffle_ghost_reminder": return "bg-slate-500/15 text-slate-400";
    default: return null;
  }
};

const reactionContextLabel = (ctx: ReactionContext | null) => {
  const opt = REACTION_CONTEXT_OPTIONS.find((o) => o.value === ctx);
  return opt ? `${opt.emoji} ${opt.label}` : null;
};

function VaultAudioPlayer({ src, fileName }: { src: string; fileName?: string | null }) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [playing, setPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const [duration, setDuration] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    const onTime = () => {
      setCurrentTime(audio.currentTime);
      if (audio.duration > 0) setProgress((audio.currentTime / audio.duration) * 100);
    };
    const onLoaded = () => { if (Number.isFinite(audio.duration)) setDuration(audio.duration); };
    const onEnd = () => { setPlaying(false); setProgress(0); setCurrentTime(0); };
    audio.addEventListener("timeupdate", onTime);
    audio.addEventListener("loadedmetadata", onLoaded);
    audio.addEventListener("ended", onEnd);
    return () => {
      audio.removeEventListener("timeupdate", onTime);
      audio.removeEventListener("loadedmetadata", onLoaded);
      audio.removeEventListener("ended", onEnd);
    };
  }, []);

  const toggle = () => {
    const audio = audioRef.current;
    if (!audio) return;
    if (playing) { audio.pause(); setPlaying(false); }
    else { void audio.play().then(() => setPlaying(true)).catch(() => setPlaying(false)); }
  };

  const seek = (e: React.MouseEvent<HTMLDivElement>) => {
    const audio = audioRef.current;
    if (!audio || !audio.duration) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    audio.currentTime = pct * audio.duration;
    setProgress(pct * 100);
    setCurrentTime(audio.currentTime);
  };

  const fmt = (s: number) => {
    if (!Number.isFinite(s) || s <= 0) return "0:00";
    const m = Math.floor(s / 60);
    const sec = Math.floor(s % 60);
    return m + ":" + String(sec).padStart(2, "0");
  };

  return (
    <div className="mt-2 flex items-center gap-3 rounded-2xl border border-violet-400/15 bg-violet-500/[0.07] px-3 py-2.5">
      <audio ref={audioRef} preload="metadata" src={src} />
      <button type="button" onClick={toggle} aria-label={playing ? "Pausar" : "Reproduzir"}
        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-violet-400/20 text-violet-200 ring-1 ring-violet-300/15 hover:bg-violet-400/30 active:scale-90 transition-all">
        {playing ? <Pause size={15} fill="currentColor" /> : <Play size={15} fill="currentColor" className="ml-0.5" />}
      </button>
      <div className="min-w-0 flex-1">
        <div className="relative h-2 flex-1 cursor-pointer rounded-full bg-white/[0.10]" onClick={seek} aria-label="Progresso do áudio">
          <div className="absolute inset-y-0 left-0 rounded-full bg-violet-300/80 transition-all" style={{ width: progress + "%" }} />
          <div className="absolute top-1/2 h-3.5 w-3.5 -translate-y-1/2 rounded-full border-2 border-[#211a35] bg-violet-200 shadow-sm transition-all" style={{ left: "calc(" + progress + "% - 7px)" }} />
        </div>
        <div className="mt-1 flex items-center justify-between">
          <span className="text-[10px] font-medium text-white/55 tabular-nums">{fmt(currentTime)}</span>
          {fileName && <span title={fileName} className="mx-2 min-w-0 truncate text-[10px] text-white/45">{fileName}</span>}
          <span className="text-[10px] font-medium text-white/55 tabular-nums">{fmt(duration)}</span>
        </div>
      </div>
    </div>
  );
}

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
    .select("id,position,kind,body,media_url,file_name,duration_seconds,created_at,reaction_context")
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
  const whatsappClient = useWhatsApp2Client();
  const { queueWhatsApp2Finalization } = whatsappClient;

  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<FinalizationItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [sending, setSending] = useState(false);
  const [draft, setDraft] = useState("");
  const [draftReactionContext, setDraftReactionContext] = useState<ReactionContext | "">("");
  const [reactionDropdownOpen, setReactionDropdownOpen] = useState(false);
  const [sendReactionModalOpen, setSendReactionModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement | null>(null);
  const inputKind = useRef<"audio" | "image">("image");
  const requestRef = useRef<{ chatId: string; id: string } | null>(null);
  const sendingRef = useRef(false);
  const { activeRaffle } = useRaffles();

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
      const reactionCtx = draftReactionContext || null;
      const payload = { kind: "text", body: text, media_url: null, file_name: null, reaction_context: reactionCtx, updated_at: new Date().toISOString() };
      const result = editingId
        ? await client().from(TABLE).update(payload).eq("id", editingId)
        : await client().from(TABLE).insert({ ...payload, position: items.length ? Math.max(...items.map((i) => i.position)) + 1 : 0 });
      if (result.error) throw result.error;
      setDraft("");
      setDraftReactionContext("");
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

  const updateReactionContext = async (itemId: string, newContext: ReactionContext | "") => {
    setBusy(true);
    try {
      const { error } = await client().from(TABLE).update({ reaction_context: newContext || null }).eq("id", itemId);
      if (error) throw error;
      await reload();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Falha ao atualizar contexto.");
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
        reaction_context: draftReactionContext || null,
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

  const send = async (filterContext?: ReactionContext | "" | "all") => {
    if (sendingRef.current) return;
    sendingRef.current = true;
    setSending(true);
    try {
      let latest = await readVault();
      if (filterContext && filterContext !== "all") {
        latest = latest.filter(item => (item.reaction_context || "") === filterContext);
      }
      latest = await Promise.all(latest.map(async (item) => {
        if (item.kind !== "audio" || (Number(item.duration_seconds) > 0) || !item.media_url) return item;
        const duration_seconds = await readAudioDurationFromUrl(item.media_url);
        const { error } = await client().from(TABLE).update({ duration_seconds }).eq("id", item.id);
        if (error) throw new Error("Não consegui salvar a duração de um áudio do cofre.");
        return { ...item, duration_seconds };
      }));
      if (!latest.length) throw new Error(filterContext && filterContext !== "all"
        ? "Nenhum item encontrado para este contexto de reação."
        : "Adicione textos, áudios ou fotos ao cofre antes de enviar.");
      if (latest.length > MAX_ITEMS) throw new Error("O cofre ultrapassou 30 itens.");
      const seconds = latest.reduce((sum, item) => sum + getFinalizationDelaySeconds(item), 0);
      const contextLabel = filterContext && filterContext !== "all"
        ? REACTION_CONTEXT_OPTIONS.find(o => o.value === filterContext)?.label || filterContext
        : "todos os itens";
      if (!window.confirm(
        `Enviar ${latest.length} ${latest.length === 1 ? "mensagem" : "mensagens"} (${contextLabel}) para ${contactName}?\n\n` +
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
        context: filterContext && filterContext !== "all" ? filterContext : undefined,
        contactName,
        raffleId: activeRaffle?.id,
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
              ? ("🎰 Sorteando 10 números da sorte...")
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
      <div className="flex items-center gap-2 px-3 py-2 border-t border-white/[0.06] bg-transparent backdrop-blur-sm">
        <button type="button" onClick={() => setOpen(true)}
          className="group inline-flex items-center gap-2 rounded-2xl border border-white/[0.08] bg-white/[0.04] backdrop-blur-xl px-4 py-2 text-[13px] font-semibold text-white/80 hover:bg-white/[0.08] hover:text-white hover:border-white/[0.12] active:scale-[0.97] transition-all duration-200"
          aria-label="Abrir cofre de finalização">
          <FolderOpen size={15} className="text-emerald-400 group-hover:text-emerald-300 transition-colors" />
          Cofre
          {items.length > 0 && (
            <span className="ml-0.5 flex h-5 min-w-[20px] items-center justify-center rounded-full bg-emerald-500/20 px-1.5 text-[10px] font-bold text-emerald-400 tabular-nums">{items.length}</span>
          )}
        </button>
        <div className="relative group/send">
          <button type="button" disabled={sending || !items.length} onClick={(e) => { e.stopPropagation(); const el = e.currentTarget.nextElementSibling as HTMLElement; if (el) el.classList.toggle("hidden"); }}
            className="inline-flex items-center gap-2 rounded-2xl bg-gradient-to-r from-emerald-500 to-teal-500 px-4 py-2 text-[13px] font-bold text-white shadow-lg shadow-emerald-500/20 hover:shadow-emerald-500/30 hover:from-emerald-400 hover:to-teal-400 active:scale-[0.97] disabled:opacity-40 disabled:shadow-none transition-all duration-200"
            aria-label="Enviar mensagens de finalização">
            {sending ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
            Enviar
          </button>
          <div className="hidden absolute bottom-full left-0 mb-2 z-50 w-56 rounded-xl border border-white/10 bg-[#111b21] p-1.5 shadow-2xl shadow-black/50">
            <p className="px-2.5 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-white/30">Filtrar por reação</p>
            <button type="button" onClick={(e) => { e.stopPropagation(); void send("all"); const el = e.currentTarget.closest(".group\\/send")?.querySelector("div:last-child"); if (el) el.classList.add("hidden"); }}
              className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-[12px] text-white/80 hover:bg-white/10 transition-colors">
              <span>📦</span><span>Todos os itens</span>
            </button>
            {REACTION_CONTEXT_OPTIONS.filter(o => o.value !== "").map((opt) => (
              <button key={opt.value} type="button" onClick={(e) => { e.stopPropagation(); void send(opt.value as ReactionContext); const el = e.currentTarget.closest(".group\\/send")?.querySelector("div:last-child"); if (el) el.classList.add("hidden"); }}
                className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-[12px] text-white/70 hover:bg-white/10 transition-colors">
                <span>{opt.emoji}</span><span>{opt.label}</span>
              </button>
            ))}
          </div>
        </div>
      </div>
      {open && createPortal(
        <div className="fixed inset-0 z-[13000] flex items-end sm:items-center justify-center bg-black/60 backdrop-blur-sm p-0 sm:p-4" role="presentation" onClick={() => setOpen(false)}>
          <section role="dialog" aria-modal="true" aria-label="Cofre de finalização"
            onClick={(e) => e.stopPropagation()}
            className="flex h-[92dvh] sm:h-[min(90dvh,820px)] w-full sm:max-w-xl flex-col overflow-hidden rounded-t-3xl sm:rounded-3xl bg-[#0b1118]/[0.98] backdrop-blur-2xl text-white shadow-2xl shadow-black/50 border border-white/[0.08]">
            <header className="relative flex items-center justify-between px-4 sm:px-5 pt-4 sm:pt-5 pb-4 shrink-0">
              <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-white/10 to-transparent" />
              <div className="flex items-center gap-3">
                <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-gradient-to-br from-emerald-400/20 to-teal-500/10 border border-emerald-300/20 shadow-inner shadow-emerald-300/5">
                  <FolderOpen size={19} className="text-emerald-300" />
                </div>
                <div>
                  <h2 className="text-[17px] font-bold tracking-tight">Cofre de finalização</h2>
                  <p className="mt-0.5 text-[12px] text-white/45">Monte e revise a sequência antes de enviar</p>
                </div>
              </div>
              <button type="button" aria-label="Fechar cofre" onClick={() => setOpen(false)}
                className="flex h-8 w-8 items-center justify-center rounded-full bg-white/[0.06] hover:bg-white/[0.12] active:scale-90 transition-all">
                <X size={16} className="text-white/60" />
              </button>
            </header>
            <div className="flex-1 overflow-y-auto px-4 sm:px-5 pb-4">
              <div className="mb-2 flex items-center justify-between gap-3">
                <h3 className="text-[13px] font-semibold text-white/85">Adicionar à sequência</h3>
                <span className="rounded-full border border-white/[0.08] bg-white/[0.04] px-2.5 py-1 text-[10px] font-medium text-white/45 tabular-nums">{items.length}/{MAX_ITEMS} itens</span>
              </div>
              <div className="mb-5 grid grid-cols-3 gap-2">
                <button disabled={busy} type="button" onClick={() => startUpload("audio")}
                  aria-label="Adicionar áudio à sequência"
                  className="group flex flex-col items-center gap-2 rounded-2xl border border-violet-400/15 bg-gradient-to-b from-violet-400/[0.08] to-white/[0.02] py-3.5 text-[11px] font-semibold text-white/75 hover:border-violet-300/30 hover:from-violet-400/[0.13] hover:text-white active:scale-[0.98] disabled:opacity-30 transition-all">
                  <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-violet-400/15 ring-1 ring-violet-300/10 group-hover:bg-violet-400/20"><FileAudio2 size={16} className="text-violet-300" /></div>
                  Adicionar áudio
                </button>
                <button disabled={busy} type="button" onClick={() => startUpload("image")}
                  aria-label="Adicionar foto à sequência"
                  className="group flex flex-col items-center gap-2 rounded-2xl border border-pink-400/15 bg-gradient-to-b from-pink-400/[0.08] to-white/[0.02] py-3.5 text-[11px] font-semibold text-white/75 hover:border-pink-300/30 hover:from-pink-400/[0.13] hover:text-white active:scale-[0.98] disabled:opacity-30 transition-all">
                  <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-pink-400/15 ring-1 ring-pink-300/10 group-hover:bg-pink-400/20"><ImageIcon size={16} className="text-pink-300" /></div>
                  Adicionar foto
                </button>
                <button disabled={busy || items.some((item) => item.kind === "raffle_numbers")} type="button" onClick={() => void addRaffleNumbers()}
                  aria-label={items.some((item) => item.kind === "raffle_numbers") ? "Rifa já adicionada" : "Adicionar números da rifa à sequência"}
                  className="group flex flex-col items-center gap-2 rounded-2xl border border-emerald-400/15 bg-gradient-to-b from-emerald-400/[0.07] to-white/[0.02] py-3.5 text-[11px] font-semibold text-emerald-200/80 hover:border-emerald-300/30 hover:from-emerald-400/[0.12] hover:text-emerald-100 active:scale-[0.98] disabled:opacity-60 transition-all">
                  <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-emerald-400/15 ring-1 ring-emerald-300/10 group-hover:bg-emerald-400/20"><Ticket size={16} className="text-emerald-300" /></div>
                  {items.some((item) => item.kind === "raffle_numbers") ? "Rifa adicionada" : "Adicionar rifa"}
                </button>
              </div>
              <input ref={fileInput} type="file" className="hidden" onChange={(event) => {
                const file = event.target.files?.[0] || null;
                event.currentTarget.value = "";
                void uploadMedia(file);
              }} />
              <div className="mb-6 rounded-2xl border border-white/[0.08] bg-gradient-to-br from-white/[0.045] to-white/[0.015] p-3.5 sm:p-4 shadow-sm shadow-black/20">
                <div className="mb-2.5 flex items-center justify-between gap-3">
                  <label htmlFor="finalization-text" className="block text-[13px] font-semibold text-white/85">Mensagem escrita</label>
                  <span className="text-[10px] text-white/35">Opcional</span>
                </div>
                <textarea id="finalization-text" rows={3} maxLength={4000} value={draft} onChange={(e) => setDraft(e.target.value)}
                  placeholder="Escreva uma mensagem para incluir na sequência..."
                  className="w-full resize-none rounded-xl border border-white/[0.08] bg-[#070c12]/60 p-3.5 text-[13px] leading-relaxed text-white/90 placeholder:text-white/30 outline-none focus:border-emerald-400/40 focus:bg-[#070c12]/80 transition-all" />
                {activeRaffle && (
                  <div className="mt-2.5 rounded-xl border border-emerald-500/20 bg-emerald-500/[0.04] p-3">
                    <div className="mb-2 flex items-center gap-2">
                      <Ticket size={13} className="text-emerald-400" />
                      <span className="text-[11px] font-semibold text-emerald-300">{activeRaffle.title}</span>
                    </div>
                    <div className="grid grid-cols-2 gap-2 text-[11px]">
                      <div className="rounded-lg bg-white/[0.04] px-2.5 py-1.5">
                        <span className="block text-white/40">Valor/número</span>
                        <span className="font-semibold text-white/90">R$ {activeRaffle.pricePerNumber.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}</span>
                      </div>
                      <div className="rounded-lg bg-white/[0.04] px-2.5 py-1.5">
                        <span className="block text-white/40">Total números</span>
                        <span className="font-semibold text-white/90">{activeRaffle.totalNumbers}</span>
                      </div>
                    </div>
                    {activeRaffle.description && (
                      <p className="mt-2 line-clamp-2 text-[10px] text-white/50">{activeRaffle.description}</p>
                    )}
                  </div>
                )}
                <div className="mt-2.5">
                  <label className="mb-1 block text-[11px] font-medium text-white/40">Contexto de reação (para IA)</label>
                  <div className="relative">
                    <button type="button" onClick={() => setReactionDropdownOpen(!reactionDropdownOpen)}
                      className="flex w-full items-center justify-between rounded-xl border border-white/[0.06] bg-white/[0.03] px-3 py-2 text-[12px] text-white/80 outline-none hover:bg-white/[0.05] focus:border-emerald-500/30 transition-all cursor-pointer">
                      <span>{REACTION_CONTEXT_OPTIONS.find(o => o.value === draftReactionContext)?.emoji} {REACTION_CONTEXT_OPTIONS.find(o => o.value === draftReactionContext)?.label || "Selecionar..."}</span>
                      <ChevronDown size={14} className={`text-white/40 transition-transform ${reactionDropdownOpen ? 'rotate-180' : ''}`} />
                    </button>
                    {reactionDropdownOpen && (
                      <>
                        <div className="fixed inset-0 z-40" onClick={() => setReactionDropdownOpen(false)} />
                        <div className="absolute left-0 right-0 top-full mt-1 z-50 max-h-60 overflow-auto rounded-xl border border-white/10 bg-[#111b21] p-1 shadow-2xl shadow-black/50">
                          {REACTION_CONTEXT_OPTIONS.map((opt) => (
                            <button key={opt.value} type="button"
                              onClick={() => { setDraftReactionContext(opt.value as ReactionContext | ""); setReactionDropdownOpen(false); }}
                              className={`flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-[12px] transition-colors ${
                                draftReactionContext === opt.value
                                  ? "bg-emerald-500/20 text-emerald-300"
                                  : "text-white/80 hover:bg-white/10"
                              }`}>
                              <span>{opt.emoji}</span>
                              <span>{opt.label}</span>
                            </button>
                          ))}
                        </div>
                      </>
                    )}
                  </div>
                </div>
                <div className="mt-2.5 flex items-center gap-2">
                  <button disabled={busy || !draft.trim()} type="button" onClick={() => void saveText()}
                    className="inline-flex items-center gap-1.5 rounded-xl bg-emerald-500/15 border border-emerald-500/20 px-3.5 py-2 text-[12px] font-semibold text-emerald-400 hover:bg-emerald-500/20 active:scale-[0.97] disabled:opacity-30 transition-all">
                    <Plus size={13} /> {editingId ? "Salvar alteração" : "Adicionar texto"}
                  </button>
                  {editingId && (
                    <button type="button" onClick={() => { setEditingId(null); setDraft(""); setDraftReactionContext(""); }}
                      className="text-[12px] text-white/35 hover:text-white/60 transition-colors">Cancelar</button>
                  )}
                  <span className="ml-auto text-[11px] text-white/20 tabular-nums">{draft.length}/4000</span>
                </div>
              </div>
              <div className="mb-2 flex items-center justify-between gap-3">
                <h3 className="text-[14px] font-bold text-white/90">Sua sequência</h3>
                <span className="text-[11px] font-medium text-white/40">{items.length} {items.length === 1 ? "item" : "itens"}</span>
              </div>
              <p className="mb-4 text-[11px] leading-relaxed text-white/45">
                Use as setas para mudar a ordem. Textos aguardam 5s, fotos 3s e áudios são enviados como mensagem de voz.
              </p>
              {loading && (
                <div className="flex items-center justify-center py-12">
                  <Loader2 className="animate-spin text-white/20" size={24} />
                </div>
              )}
              {!loading && items.length === 0 && (
                <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-white/[0.08] py-12 text-center">
                  <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-white/[0.03]">
                    <FolderOpen size={20} className="text-white/15" />
                  </div>
                  <p className="text-[13px] font-semibold text-white/60">Sua sequência está vazia</p>
                  <p className="mt-1 max-w-[230px] text-[11px] leading-relaxed text-white/40">Adicione um áudio, uma foto, uma mensagem escrita ou os números da rifa.</p>
                </div>
              )}
              <ol className="space-y-2.5">
                {items.map((item, index) => (
                  <li key={item.id}
                    className={"group relative grid grid-cols-[2rem_minmax(0,1fr)] items-start gap-2.5 rounded-2xl border p-3 transition-all duration-200 hover:brightness-110 " + kindColor(item.kind)}>
                    <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-black/20 text-[11px] font-bold text-white/75 tabular-nums ring-1 ring-white/[0.08]">
                      {index + 1}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex min-w-0 items-start justify-between gap-2">
                        <div className="flex min-w-0 flex-wrap items-center gap-1.5">
                          <span aria-hidden="true" className="mr-0.5 text-sm">{kindEmoji(item.kind)}</span>
                          <span className={"rounded-full px-2 py-1 text-[10px] font-semibold " + kindBadge(item.kind)}>{label[item.kind]}</span>
                          <div className="relative group/ctx">
                            <button type="button" disabled={busy}
                              onClick={(e) => { e.stopPropagation(); const el = e.currentTarget.nextElementSibling as HTMLElement; if (el) el.classList.toggle("hidden"); }}
                              className={"max-w-[155px] truncate rounded-full px-2 py-1 text-[10px] font-semibold cursor-pointer hover:brightness-125 transition-all " + (reactionContextBadge(item.reaction_context) || "bg-white/[0.10] text-white/65")}>
                              {reactionContextLabel(item.reaction_context) || "Sem contexto"}
                            </button>
                            <div className="hidden absolute left-0 top-full mt-1 z-50 w-48 rounded-xl border border-white/10 bg-[#111b21] p-1 shadow-2xl shadow-black/50">
                              {REACTION_CONTEXT_OPTIONS.map((opt) => (
                                <button key={opt.value} type="button"
                                  onClick={(e) => { e.stopPropagation(); void updateReactionContext(item.id, opt.value as ReactionContext | ""); const el = e.currentTarget.closest(".group\\/ctx")?.querySelector("div:last-child"); if (el) el.classList.add("hidden"); }}
                                  className={`flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-[11px] transition-colors ${
                                    (item.reaction_context || "") === opt.value
                                      ? "bg-emerald-500/20 text-emerald-300"
                                      : "text-white/70 hover:bg-white/10"
                                  }`}>
                                  <span>{opt.emoji}</span>
                                  <span>{opt.label}</span>
                                </button>
                              ))}
                            </div>
                          </div>
                          <span className="rounded-full bg-white/[0.08] px-2 py-1 text-[10px] font-semibold text-white/55 tabular-nums">{getFinalizationDelaySeconds(item)}s</span>
                        </div>
                        <div className="flex shrink-0 items-center gap-1">
                          <button disabled={busy || index === 0} type="button" aria-label="Mover para cima" title="Mover para cima" onClick={() => void move(index, -1)}
                            className="flex h-8 w-8 items-center justify-center rounded-xl border border-white/[0.07] bg-black/15 text-white/60 hover:border-white/15 hover:bg-white/[0.08] hover:text-white disabled:opacity-25 transition-all">
                            <ArrowUp size={14} />
                          </button>
                          <button disabled={busy || index === items.length - 1} type="button" aria-label="Mover para baixo" title="Mover para baixo" onClick={() => void move(index, 1)}
                            className="flex h-8 w-8 items-center justify-center rounded-xl border border-white/[0.07] bg-black/15 text-white/60 hover:border-white/15 hover:bg-white/[0.08] hover:text-white disabled:opacity-25 transition-all">
                            <ArrowDown size={14} />
                          </button>
                          {item.kind === "text" && (
                            <button disabled={busy} type="button" title="Editar texto" aria-label="Editar texto" onClick={() => { setEditingId(item.id); setDraft(item.body || ""); setDraftReactionContext(item.reaction_context || ""); }}
                              className="flex h-8 w-8 items-center justify-center rounded-xl border border-white/[0.07] bg-black/15 text-white/60 hover:border-blue-300/25 hover:bg-blue-400/10 hover:text-blue-200 disabled:opacity-30 transition-all">
                              <Pencil size={14} />
                            </button>
                          )}
                          <button disabled={busy} type="button" title="Excluir item" aria-label="Excluir item" onClick={() => void remove(item.id)}
                            className="flex h-8 w-8 items-center justify-center rounded-xl border border-white/[0.07] bg-black/15 text-white/60 hover:border-red-300/25 hover:bg-red-400/10 hover:text-red-200 disabled:opacity-30 transition-all">
                            <Trash2 size={14} />
                          </button>
                        </div>
                      </div>
                      {item.kind === "text"
                        ? <p className="mt-2 rounded-xl border border-white/[0.05] bg-black/15 px-3 py-2 break-words text-[12px] leading-relaxed text-white/70 line-clamp-2">{item.body}</p>
                        : item.kind === "raffle_numbers"
                          ? <p className="mt-2 rounded-xl border border-emerald-400/10 bg-emerald-400/[0.04] px-3 py-2 text-[11px] leading-relaxed text-emerald-200/70">10 números sorteados entre os disponíveis na rifa ativa.</p>
                          : <div className="min-w-0">
                            {item.kind === "image" && item.media_url
                              // eslint-disable-next-line @next/next/no-img-element
                                ? <div className="mt-2 inline-flex overflow-hidden rounded-xl border border-white/[0.10] bg-black/20 p-1.5"><img src={item.media_url} alt="Foto da finalização" className="max-h-24 max-w-32 rounded-lg object-contain" /></div>
                                : item.media_url ? <VaultAudioPlayer src={item.media_url} fileName={item.file_name} /> : null}
                          </div>}
                    </div>
                  </li>
                ))}
              </ol>
            </div>
            <footer className="relative border-t border-white/[0.08] bg-[#0b1118]/95 px-4 sm:px-5 py-3.5 sm:py-4 shrink-0 backdrop-blur-xl">
              <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-white/[0.06] to-transparent" />
              {busy && (
                <p className="mb-3 flex items-center gap-2 text-[12px] text-white/35">
                  <Loader2 className="animate-spin" size={13} /> Salvando ou preparando arquivo...
                </p>
              )}
              <button disabled={busy || sending || !items.length} type="button" onClick={() => void send()}
                className="flex w-full items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-emerald-500 to-teal-500 px-4 py-3.5 text-[14px] font-bold text-white shadow-lg shadow-emerald-500/20 hover:shadow-emerald-500/30 hover:from-emerald-400 hover:to-teal-400 active:scale-[0.98] disabled:opacity-30 disabled:shadow-none transition-all duration-200">
                {sending ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}
                Enviar {items.length} {items.length === 1 ? "mensagem" : "mensagens"} para {contactName}
              </button>
            </footer>
          </section>
        </div>, document.body
      )}
    </>
  );
}
