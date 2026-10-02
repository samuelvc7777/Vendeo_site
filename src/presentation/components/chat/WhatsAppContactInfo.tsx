"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { motion, useReducedMotion } from "framer-motion";
import {
  Bot,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  FileText,
  Image as ImageIcon,
  MessageCircle,
  Search,
  Sparkles,
  Target,
} from "lucide-react";
import { getSupabaseBrowserClient } from "@/infrastructure/supabase/client";
import type { ChatStage, StageObjective } from "@/domain/entities/ChatStage";
import type { ChatStageDetail } from "@/application/use-cases/ManageChatProgressUseCase";

type ContactConversation = {
  id: string;
  fullName: string;
  username: string;
  avatar: string;
  type: "instagram" | "whatsapp";
  isConverted?: boolean;
  raffleStatus?: string | null;
};

type ContactMessage = {
  id: string;
  text: string;
  mediaUrl?: string;
  mediaType?: "image" | "audio" | "video" | "sticker";
  isMine: boolean;
  timestamp?: number;
  sentDate?: string;
};

type ObjectiveProgressEntry = {
  status?: string;
  value?: string | number | boolean | null;
  evidenceMessageId?: string | null;
  completedAt?: string | null;
};

interface WhatsAppContactInfoProps {
  conversation: ContactConversation;
  messages: ContactMessage[];
  stages: ChatStage[];
  chatDetail: ChatStageDetail | null;
  aiEnabled: boolean;
  globalAiEnabled: boolean;
  onClose: () => void;
  onToggleAi: () => void | Promise<void>;
}

function formatWhatsAppPhone(raw: string): string {
  const digits = String(raw || "").replace(/\D/g, "");
  if (!digits) return "";
  if (digits.length === 12 && digits.startsWith("55")) {
    const ddd = digits.slice(2, 4);
    const number = digits.slice(4);
    return `+55 ${ddd} ${number.slice(0, 4)}-${number.slice(4)}`;
  }
  if (digits.length === 13 && digits.startsWith("55")) {
    const ddd = digits.slice(2, 4);
    const number = digits.slice(4);
    return `+55 ${ddd} ${number.slice(0, 5)}-${number.slice(5)}`;
  }
  return `+${digits}`;
}

function objectiveTitle(obj: StageObjective): string {
  return obj.title || obj.label || "Dado";
}

function cleanObjectiveEvidence(title: string, text: string): string {
  const cleaned = text
    .replace(/^\[(?:image|audio|video):[^\]]+\]\s*/, "")
    .replace(/\s+/g, " ")
    .trim();

  if (/cidade|localização|localizacao/i.test(title)) {
    const cityMatch = cleaned.match(/(?:sou|moro|fico)\s+(?:em|de|na|no)?\s*([^,!?]+?)(?:\s+e\s+(?:vc|você)\b|[!?.,]|$)/i);
    if (cityMatch?.[1]?.trim()) return cityMatch[1].trim();
  }

  if (/bairro/i.test(title)) {
    const neighborhoodMatch = cleaned.match(/moro\s+(?:em|na|no)\s+([^,!?]+?)(?:\s+e\s+(?:vc|você)\b|[!?.,]|$)/i);
    if (neighborhoodMatch?.[1]?.trim()) return neighborhoodMatch[1].trim();
  }

  if (/idade/i.test(title)) {
    const ageMatch = cleaned.match(/\b(\d{2})\s*(?:anos)?\b/i);
    if (ageMatch?.[1]) return `${ageMatch[1]} anos`;
  }

  return cleaned.replace(/\s+e\s+(?:vc|você)\b.*$/i, "").trim() || "Confirmado na conversa";
}

export function WhatsAppContactInfo({
  conversation,
  messages,
  stages,
  chatDetail,
  aiEnabled,
  globalAiEnabled,
  onClose,
  onToggleAi,
}: WhatsAppContactInfoProps) {
  const prefersReducedMotion = useReducedMotion();
  const mediaRef = useRef<HTMLDivElement | null>(null);
  const [dbRow, setDbRow] = useState<any>(null);

  useEffect(() => {
    let cancelled = false;
    const supabase = getSupabaseBrowserClient();
    if (!supabase) return;
    void supabase
      .from("instagram_conversations")
      .select("contact_id,display_name,full_name,created_at,updated_at,current_stage_id,is_converted,raffle_status,stage_completed_rules,ai_auto_respond")
      .eq("id", conversation.id)
      .maybeSingle()
      .then((result: { data: any }) => {
        if (!cancelled) setDbRow(result.data || null);
      });
    return () => {
      cancelled = true;
    };
  }, [conversation.id]);

  const phone = formatWhatsAppPhone(dbRow?.contact_id || conversation.username || conversation.id.replace(/^wa:/, ""));

  const media = useMemo(
    () =>
      messages
        .filter((m) => (m.mediaType === "image" || m.mediaType === "video") && m.mediaUrl)
        .slice(-12)
        .reverse(),
    [messages]
  );

  const stats = useMemo(() => {
    const incoming = messages.filter((m) => !m.isMine).length;
    const outgoing = messages.filter((m) => m.isMine).length;
    const voice = messages.filter((m) => m.mediaType === "audio").length;
    return { incoming, outgoing, voice };
  }, [messages]);

  const objectiveProgress = useMemo<Record<string, ObjectiveProgressEntry>>(() => {
    const rules = dbRow?.stage_completed_rules || {};
    return (
      rules.objective_progress ||
      rules.objectiveProgress ||
      rules.orchestration?.objectiveProgress ||
      {}
    );
  }, [dbRow]);

  const knownFacts = useMemo(() => {
    const all: Array<{
      id: string;
      title: string;
      value: string;
      stage: string;
      completed: boolean;
    }> = [];

    for (const stage of stages) {
      for (const obj of (stage.objectives || stage.goals || [])) {
        if (obj.enabled === false) continue;
        const progress = objectiveProgress[obj.id];
        const completed =
          progress?.status === "completed" ||
          chatDetail?.objectives?.some((current) => current.id === obj.id && current.status === "completed") ||
          false;
        if (!completed) continue;

        const evidenceId = progress?.evidenceMessageId;
        const evidence = evidenceId ? messages.find((m) => m.id === evidenceId) : undefined;
        const rawValue = progress?.value;
        const title = objectiveTitle(obj);
        const value =
          rawValue !== null && rawValue !== undefined && String(rawValue).trim()
            ? String(rawValue)
            : evidence?.text
            ? cleanObjectiveEvidence(title, evidence.text)
            : "Confirmado na conversa";

        all.push({
          id: obj.id,
          title,
          value,
          stage: stage.name,
          completed,
        });
      }
    }

    return all;
  }, [stages, objectiveProgress, chatDetail?.objectives, messages]);

  const currentStageName =
    chatDetail?.stage?.name ||
    stages.find((s) => s.id === dbRow?.current_stage_id)?.name ||
    "Sem etapa";

  return (
    <motion.div
      className="whatsapp-ios absolute inset-0 z-[90] flex flex-col overflow-hidden bg-[#f2f2f7] text-[#111b21] dark:bg-black dark:text-white"
      initial={prefersReducedMotion ? false : { x: "100%" }}
      animate={{ x: 0 }}
      exit={prefersReducedMotion ? { opacity: 0 } : { x: "100%" }}
      transition={
        prefersReducedMotion
          ? { duration: 0 }
          : { type: "spring", stiffness: 430, damping: 42, mass: 0.78 }
      }
    >
      <div className="flex h-[58px] shrink-0 items-center border-b border-black/[0.08] bg-white/68 px-2 backdrop-blur-3xl dark:border-white/[0.07] dark:bg-[#1c1c1e]/72">
        <button
          type="button"
          onClick={onClose}
          className="flex h-9 w-9 items-center justify-center text-[#007aff] transition-transform active:scale-90"
          aria-label="Voltar"
        >
          <ChevronLeft className="h-7 w-7 stroke-[2.1]" />
        </button>
        <div className="pointer-events-none absolute left-1/2 -translate-x-1/2 text-[16px] font-semibold">
          Dados do contato
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-3 pb-8 pt-5 scrollbar-none">
        <section className="flex flex-col items-center pb-5 text-center">
          <div className="relative h-[112px] w-[112px] overflow-hidden rounded-full bg-[#d1d1d6] shadow-sm dark:bg-[#3a3a3c]">
            <img
              src={conversation.avatar || "/images/default-avatar.svg"}
              alt={conversation.fullName}
              className="h-full w-full object-cover"
            />
          </div>
          <h2 className="mt-3 max-w-full truncate px-4 text-[24px] font-semibold tracking-[-0.02em]">
            {conversation.fullName}
          </h2>
          {phone && <p className="mt-0.5 text-[14px] text-[#8e8e93]">{phone}</p>}
        </section>

        <div className="mx-auto mb-4 grid max-w-md grid-cols-3 gap-2">
          <button
            type="button"
            onClick={onClose}
            className="wa-ios-glass flex min-h-[64px] flex-col items-center justify-center gap-1 rounded-[16px] text-[#007aff] transition-transform active:scale-[0.97]"
          >
            <MessageCircle className="h-5 w-5" />
            <span className="text-[11px] font-medium">Conversa</span>
          </button>
          <button
            type="button"
            onClick={() => mediaRef.current?.scrollIntoView({ behavior: prefersReducedMotion ? "auto" : "smooth", block: "start" })}
            className="wa-ios-glass flex min-h-[64px] flex-col items-center justify-center gap-1 rounded-[16px] text-[#007aff] transition-transform active:scale-[0.97]"
          >
            <ImageIcon className="h-5 w-5" />
            <span className="text-[11px] font-medium">Mídia</span>
          </button>
          <button
            type="button"
            onClick={() => void onToggleAi()}
            className={`wa-ios-glass flex min-h-[64px] flex-col items-center justify-center gap-1 rounded-[16px] transition-transform active:scale-[0.97] ${
              !globalAiEnabled ? "text-[#ff9500]" : aiEnabled ? "text-[#34c759]" : "text-[#007aff]"
            }`}
          >
            <Bot className="h-5 w-5" />
            <span className="text-[11px] font-medium">{aiEnabled ? "IA ativa" : "IA"}</span>
          </button>
        </div>

        <div className="mx-auto max-w-md space-y-4">
          <section className="overflow-hidden rounded-[16px] bg-white shadow-[0_0.5px_0_rgba(0,0,0,0.06)] dark:bg-[#1c1c1e]">
            <div className="flex items-center gap-3 px-4 py-3">
              <Target className="h-5 w-5 shrink-0 text-[#007aff]" />
              <div className="min-w-0 flex-1">
                <p className="text-[13px] text-[#8e8e93]">Etapa atual</p>
                <p className="truncate text-[15px] font-medium">{currentStageName}</p>
              </div>
              <ChevronRight className="h-4 w-4 text-[#c7c7cc]" />
            </div>
            <div className="ml-12 border-t border-black/[0.07] dark:border-white/[0.07]" />
            <div className="flex items-center gap-3 px-4 py-3">
              <Sparkles className="h-5 w-5 shrink-0 text-[#ff9500]" />
              <div className="min-w-0 flex-1">
                <p className="text-[13px] text-[#8e8e93]">Status comercial</p>
                <p className="truncate text-[15px] font-medium">
                  {dbRow?.is_converted || conversation.isConverted
                    ? dbRow?.raffle_status
                      ? String(dbRow.raffle_status).replaceAll("_", " ")
                      : "Finalizado"
                    : "Em andamento"}
                </p>
              </div>
            </div>
          </section>

          <section className="overflow-hidden rounded-[16px] bg-white shadow-[0_0.5px_0_rgba(0,0,0,0.06)] dark:bg-[#1c1c1e]">
            <div className="px-4 pb-2 pt-3">
              <p className="text-[12px] font-semibold uppercase tracking-[0.04em] text-[#8e8e93]">
                Dados conhecidos
              </p>
            </div>
            {knownFacts.length === 0 ? (
              <div className="border-t border-black/[0.07] px-4 py-4 text-[13px] text-[#8e8e93] dark:border-white/[0.07]">
                O Brain ainda não confirmou informações pessoais deste contato.
              </div>
            ) : (
              knownFacts.map((fact, index) => (
                <div
                  key={fact.id}
                  className={`px-4 py-3 ${index > 0 ? "border-t border-black/[0.07] dark:border-white/[0.07]" : ""}`}
                >
                  <div className="flex items-start gap-3">
                    <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-[#34c759]" />
                    <div className="min-w-0 flex-1">
                      <p className="text-[13px] text-[#8e8e93]">{fact.title}</p>
                      <p className="mt-0.5 break-words text-[15px] font-medium">{fact.value}</p>
                      <p className="mt-0.5 text-[10px] text-[#aeaeb2]">{fact.stage}</p>
                    </div>
                  </div>
                </div>
              ))
            )}
          </section>

          <section ref={mediaRef} className="scroll-mt-3 overflow-hidden rounded-[16px] bg-white shadow-[0_0.5px_0_rgba(0,0,0,0.06)] dark:bg-[#1c1c1e]">
            <div className="flex items-center justify-between px-4 py-3">
              <div>
                <p className="text-[15px] font-medium">Mídia, links e docs</p>
                <p className="text-[12px] text-[#8e8e93]">{media.length} item{media.length === 1 ? "" : "s"} carregado{media.length === 1 ? "" : "s"}</p>
              </div>
              <ChevronRight className="h-4 w-4 text-[#c7c7cc]" />
            </div>
            {media.length > 0 && (
              <div className="grid grid-cols-4 gap-[2px] border-t border-black/[0.07] p-[2px] dark:border-white/[0.07]">
                {media.slice(0, 8).map((item) => (
                  <div key={item.id} className="aspect-square overflow-hidden bg-[#d1d1d6] dark:bg-[#2c2c2e]">
                    {item.mediaType === "image" ? (
                      <img src={item.mediaUrl} alt="" className="h-full w-full object-cover" />
                    ) : (
                      <div className="flex h-full w-full items-center justify-center">
                        <FileText className="h-5 w-5 text-[#8e8e93]" />
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </section>

          <section className="overflow-hidden rounded-[16px] bg-white shadow-[0_0.5px_0_rgba(0,0,0,0.06)] dark:bg-[#1c1c1e]">
            <div className="px-4 pb-2 pt-3">
              <p className="text-[12px] font-semibold uppercase tracking-[0.04em] text-[#8e8e93]">
                Conversa
              </p>
            </div>
            <div className="grid grid-cols-3 border-t border-black/[0.07] dark:border-white/[0.07]">
              <div className="px-3 py-4 text-center">
                <p className="text-[20px] font-semibold">{stats.incoming}</p>
                <p className="text-[10px] text-[#8e8e93]">Recebidas</p>
              </div>
              <div className="border-x border-black/[0.07] px-3 py-4 text-center dark:border-white/[0.07]">
                <p className="text-[20px] font-semibold">{stats.outgoing}</p>
                <p className="text-[10px] text-[#8e8e93]">Enviadas</p>
              </div>
              <div className="px-3 py-4 text-center">
                <p className="text-[20px] font-semibold">{stats.voice}</p>
                <p className="text-[10px] text-[#8e8e93]">Áudios</p>
              </div>
            </div>
          </section>
        </div>
      </div>
    </motion.div>
  );
}
