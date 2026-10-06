"use client";

import React, { useMemo, useRef, useState } from "react";
import {
  Image as ImageIcon,
  Mic,
  MessageCircle,
  Pencil,
  Plus,
  Sparkles,
  Trash2,
  Upload,
  Volume2,
} from "lucide-react";
import { toast } from "sonner";
import {
  ARSENAL_ITEM_TYPES,
  ARSENAL_SOCIAL_FUNCTIONS,
  ArsenalItemType,
  ArsenalValidityType,
  ConversationArsenalItem,
} from "@/domain/entities/ConversationArsenal";
import {
  ConversationSchedule,
  ScheduleFinalAction,
  ScheduleTemporalPhase,
} from "@/domain/entities/ConversationSchedule";
import { useConversationArsenal } from "@/presentation/hooks/useConversationArsenal";
import { usePersonaAudios } from "@/presentation/hooks/usePersonaAudios";
import { ResponsiveModal } from "@/presentation/components/ui/ResponsiveModal";
import { getApiUrl } from "@/infrastructure/http/network";

interface Props {
  schedule: ConversationSchedule;
  onUpdateSchedule: (
    id: string,
    data: Partial<Omit<ConversationSchedule, "id" | "createdAt" | "updatedAt">>,
  ) => Promise<any>;
}

type ArsenalForm = {
  type: ArsenalItemType;
  title: string;
  description: string;
  semanticContent: string;
  usageInstruction: string;
  socialFunction: string;
  assetId: string;
  mediaUrl: string;
  transcript: string;
  visualDescription: string;
  validityType: ArsenalValidityType;
  validFrom: string;
  validUntil: string;
  maxUses: string;
  cooldownMinutes: number;
  priority: number;
  enabled: boolean;
  recurringWeekdays: number[];
  recurringStart: string;
  recurringEnd: string;
};

const DEFAULT_PHASES: ScheduleTemporalPhase[] = [
  {
    id: "opening",
    label: "Início",
    fromPercent: 0,
    toPercent: 30,
    guidance: "Retomar proximidade e conversa leve sem forçar recursos.",
  },
  {
    id: "middle",
    label: "Meio",
    fromPercent: 30,
    toPercent: 75,
    guidance: "Manter conexão, aprofundar assuntos e usar o arsenal apenas quando encaixar naturalmente.",
  },
  {
    id: "closing",
    label: "Fechamento",
    fromPercent: 75,
    toPercent: 100,
    guidance: "Preservar naturalidade e procurar oportunidade real para a ação final.",
  },
];

const emptyForm = (): ArsenalForm => ({
  type: "topic",
  title: "",
  description: "",
  semanticContent: "",
  usageInstruction: "",
  socialFunction: "open_topic",
  assetId: "",
  mediaUrl: "",
  transcript: "",
  visualDescription: "",
  validityType: "evergreen",
  validFrom: "",
  validUntil: "",
  maxUses: "1",
  cooldownMinutes: 0,
  priority: 50,
  enabled: true,
  recurringWeekdays: [1, 2, 3, 4, 5],
  recurringStart: "09:00",
  recurringEnd: "22:00",
});

function toLocalInput(value?: string | null) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function itemTypeIcon(type: ArsenalItemType) {
  if (type === "audio") return Mic;
  if (type === "photo") return ImageIcon;
  if (type === "story") return Sparkles;
  return MessageCircle;
}

const WEEKDAYS = [
  { value: 0, label: "D" },
  { value: 1, label: "S" },
  { value: 2, label: "T" },
  { value: 3, label: "Q" },
  { value: 4, label: "Q" },
  { value: 5, label: "S" },
  { value: 6, label: "S" },
];

export function ConnectionWindowManager({ schedule, onUpdateSchedule }: Props) {
  const { items, isLoading, addItem, updateItem, deleteItem } = useConversationArsenal(schedule.id);
  const { audios } = usePersonaAudios();

  const [modalOpen, setModalOpen] = useState(false);
  const [editingItem, setEditingItem] = useState<ConversationArsenalItem | null>(null);
  const [form, setForm] = useState<ArsenalForm>(emptyForm());
  const [saving, setSaving] = useState(false);
  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  const photoInputRef = useRef<HTMLInputElement | null>(null);

  const [intent, setIntent] = useState(schedule.connectionIntent || "");
  const [phases, setPhases] = useState<ScheduleTemporalPhase[]>(
    schedule.temporalPhases?.length ? schedule.temporalPhases : DEFAULT_PHASES,
  );
  const [finalAudioId, setFinalAudioId] = useState(schedule.finalAction?.assetId || "");
  const [finalThreshold, setFinalThreshold] = useState(
    Number(schedule.finalAction?.activationThresholdPercent ?? 75),
  );
  const [savingRules, setSavingRules] = useState(false);

  React.useEffect(() => {
    setIntent(schedule.connectionIntent || "");
    setPhases(schedule.temporalPhases?.length ? schedule.temporalPhases : DEFAULT_PHASES);
    setFinalAudioId(schedule.finalAction?.assetId || "");
    setFinalThreshold(Number(schedule.finalAction?.activationThresholdPercent ?? 75));
  }, [schedule]);

  const grouped = useMemo(() => {
    const groups: Record<string, ConversationArsenalItem[]> = {
      text: [],
      audio: [],
      photo: [],
      moment: [],
    };
    for (const item of items) {
      if (item.validityType === "moment") groups.moment.push(item);
      else if (item.type === "audio") groups.audio.push(item);
      else if (item.type === "photo") groups.photo.push(item);
      else groups.text.push(item);
    }
    return groups;
  }, [items]);

  const openCreate = () => {
    setEditingItem(null);
    setForm(emptyForm());
    setModalOpen(true);
  };

  const openEdit = (item: ConversationArsenalItem) => {
    const recurring = item.recurringRules || {};
    setEditingItem(item);
    setForm({
      type: item.type,
      title: item.title,
      description: item.description || "",
      semanticContent: item.semanticContent || "",
      usageInstruction: item.usageInstruction || "",
      socialFunction: item.socialFunction || "open_topic",
      assetId: item.assetId || "",
      mediaUrl: item.mediaUrl || "",
      transcript: item.transcript || "",
      visualDescription: item.visualDescription || "",
      validityType: item.validityType,
      validFrom: toLocalInput(item.validFrom),
      validUntil: toLocalInput(item.validUntil),
      maxUses: item.maxUsesPerConversation == null ? "" : String(item.maxUsesPerConversation),
      cooldownMinutes: item.cooldownMinutes || 0,
      priority: item.priority ?? 50,
      enabled: item.enabled,
      recurringWeekdays: Array.isArray((recurring as any).weekdays)
        ? (recurring as any).weekdays.map(Number)
        : [1, 2, 3, 4, 5],
      recurringStart: String((recurring as any).startTime || "09:00"),
      recurringEnd: String((recurring as any).endTime || "22:00"),
    });
    setModalOpen(true);
  };

  const selectAudio = (audioId: string) => {
    const audio = audios.find((item) => item.id === audioId);
    setForm((prev) => ({
      ...prev,
      assetId: audioId,
      title: prev.title || audio?.title || "",
      transcript: audio?.transcript || "",
      semanticContent: prev.semanticContent || audio?.transcript || "",
      usageInstruction: prev.usageInstruction || audio?.usageInstruction || "",
      mediaUrl: audio?.audioUrl || "",
    }));
  };

  const uploadPhoto = async (file: File) => {
    if (!file.type.startsWith("image/")) {
      toast.error("Selecione uma imagem válida.");
      return;
    }
    setUploadingPhoto(true);
    try {
      const data = new FormData();
      data.append("file", file, file.name);
      data.append("type", "image");
      const response = await fetch(getApiUrl("/api/instagram/upload"), {
        method: "POST",
        body: data,
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok || !result?.url) {
        throw new Error(result?.error || "Falha ao hospedar imagem.");
      }
      setForm((prev) => ({
        ...prev,
        mediaUrl: String(result.url),
        title: prev.title || file.name.replace(/\.[^/.]+$/, "").replace(/[-_]/g, " "),
      }));
      toast.success("Foto adicionada.");
    } catch (error: any) {
      toast.error(error?.message || "Falha no upload da foto.");
    } finally {
      setUploadingPhoto(false);
    }
  };

  const saveItem = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!form.title.trim()) return;
    if (form.type === "audio" && !form.assetId) {
      toast.error("Selecione um áudio do Cofre.");
      return;
    }
    if (form.type === "photo" && !form.mediaUrl) {
      toast.error("Envie uma foto para este recurso.");
      return;
    }
    if (form.validityType === "moment" && (!form.validFrom || !form.validUntil)) {
      toast.error("Conteúdo do momento precisa de início e expiração.");
      return;
    }

    const payload = {
      type: form.type,
      title: form.title.trim(),
      description: form.description.trim() || undefined,
      semanticContent: form.semanticContent.trim() || undefined,
      usageInstruction: form.usageInstruction.trim() || undefined,
      socialFunction: form.socialFunction || undefined,
      assetId: form.assetId || undefined,
      mediaUrl: form.mediaUrl || undefined,
      transcript: form.transcript.trim() || undefined,
      visualDescription: form.visualDescription.trim() || undefined,
      validityType: form.validityType,
      validFrom: form.validityType === "moment" && form.validFrom
        ? new Date(form.validFrom).toISOString()
        : null,
      validUntil: form.validityType === "moment" && form.validUntil
        ? new Date(form.validUntil).toISOString()
        : null,
      recurringRules: form.validityType === "recurring"
        ? {
            weekdays: form.recurringWeekdays,
            startTime: form.recurringStart,
            endTime: form.recurringEnd,
            timezone: "America/Sao_Paulo",
          }
        : {},
      maxUsesPerConversation: form.maxUses.trim() ? Math.max(1, Number(form.maxUses)) : null,
      cooldownMinutes: Math.max(0, Number(form.cooldownMinutes) || 0),
      priority: Math.max(0, Math.min(100, Number(form.priority) || 0)),
      enabled: form.enabled,
    } as const;

    setSaving(true);
    try {
      if (editingItem) await updateItem(editingItem.id, payload);
      else await addItem(payload);
      setModalOpen(false);
    } finally {
      setSaving(false);
    }
  };

  const saveConnectionRules = async () => {
    const selectedAudio = audios.find((audio) => audio.id === finalAudioId);
    const finalAction: ScheduleFinalAction | null = finalAudioId
      ? {
          type: "send_audio",
          assetId: finalAudioId,
          title: selectedAudio?.title || finalAudioId,
          required: true,
          opportunityRequired: true,
          activationThresholdPercent: Math.max(0, Math.min(100, Number(finalThreshold) || 75)),
        }
      : null;

    setSavingRules(true);
    try {
      await onUpdateSchedule(schedule.id, {
        connectionIntent: intent.trim() || undefined,
        temporalPhases: phases,
        finalAction,
      });
      toast.success("Janela de conexão atualizada.");
    } finally {
      setSavingRules(false);
    }
  };

  const renderGroup = (title: string, groupItems: ConversationArsenalItem[]) => {
    if (!groupItems.length) return null;
    return (
      <div className="space-y-2">
        <p className="px-1 text-[10px] font-black uppercase tracking-[0.14em] text-zinc-400">{title}</p>
        {groupItems.map((item) => {
          const Icon = itemTypeIcon(item.type);
          return (
            <div key={item.id} className="rounded-2xl border border-zinc-200 bg-white p-3 dark:border-white/10 dark:bg-white/[0.035]">
              <div className="flex items-start gap-2.5">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-violet-50 text-violet-600 dark:bg-violet-500/10 dark:text-violet-300">
                  <Icon className="h-4 w-4" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <h5 className="text-xs font-black text-zinc-950 dark:text-white">{item.title}</h5>
                    {!item.enabled && <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-[9px] font-bold text-zinc-500 dark:bg-white/5">Inativo</span>}
                    <span className="rounded-full bg-sky-50 px-2 py-0.5 text-[9px] font-bold text-sky-700 dark:bg-sky-500/10 dark:text-sky-300">
                      {item.validityType === "evergreen" ? "Permanente" : item.validityType === "moment" ? "Momento" : "Recorrente"}
                    </span>
                  </div>
                  {(item.semanticContent || item.description) && (
                    <p className="mt-1 line-clamp-2 text-[10.5px] leading-relaxed text-zinc-500 dark:text-zinc-400">
                      {item.semanticContent || item.description}
                    </p>
                  )}
                  <div className="mt-2 flex flex-wrap gap-1">
                    {item.socialFunction && <span className="rounded-lg bg-zinc-100 px-2 py-1 text-[9px] font-semibold text-zinc-600 dark:bg-white/[0.06] dark:text-zinc-300">{item.socialFunction}</span>}
                    <span className="rounded-lg bg-zinc-100 px-2 py-1 text-[9px] font-semibold text-zinc-600 dark:bg-white/[0.06] dark:text-zinc-300">prioridade {item.priority}</span>
                    <span className="rounded-lg bg-zinc-100 px-2 py-1 text-[9px] font-semibold text-zinc-600 dark:bg-white/[0.06] dark:text-zinc-300">
                      {item.maxUsesPerConversation ? `máx. ${item.maxUsesPerConversation} uso(s)` : "sem limite"}
                    </span>
                  </div>
                </div>
                <button type="button" onClick={() => openEdit(item)} className="flex h-8 w-8 items-center justify-center rounded-lg text-zinc-500 hover:bg-zinc-100 dark:hover:bg-white/[0.06]">
                  <Pencil className="h-3.5 w-3.5" />
                </button>
                <button type="button" onClick={() => void deleteItem(item.id)} className="flex h-8 w-8 items-center justify-center rounded-lg text-zinc-500 hover:bg-red-50 hover:text-red-500 dark:hover:bg-red-500/10">
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
          );
        })}
      </div>
    );
  };

  return (
    <div className="space-y-4">
      <div className="rounded-[22px] border border-violet-200/70 bg-white p-3.5 dark:border-violet-500/15 dark:bg-white/[0.025]">
        <div className="flex items-start gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-violet-100 text-violet-700 dark:bg-violet-500/10 dark:text-violet-300">
            <Sparkles className="h-4.5 w-4.5" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-xs font-black text-zinc-950 dark:text-white">Janela de conexão</p>
            <p className="mt-0.5 text-[10.5px] leading-relaxed text-zinc-500 dark:text-zinc-400">
              O arsenal é opcional: o Brain escolhe o que usar conforme a conversa. Nada aqui vira checkpoint.
            </p>
          </div>
        </div>

        <label className="mt-3 block space-y-1">
          <span className="text-[10px] font-bold text-zinc-600 dark:text-zinc-300">Intenção geral</span>
          <textarea
            rows={3}
            value={intent}
            onChange={(e) => setIntent(e.target.value)}
            className="w-full resize-none rounded-xl border border-zinc-200 bg-zinc-50 px-3 py-2 text-[16px] md:text-xs text-zinc-950 outline-none dark:border-white/10 dark:bg-black/20 dark:text-white"
            placeholder="Ex: manter proximidade natural e criar oportunidade para uma nova oferta."
          />
        </label>

        <div className="mt-3 grid gap-2 sm:grid-cols-3">
          {phases.map((phase, index) => (
            <div key={phase.id} className="rounded-xl border border-zinc-200 p-2.5 dark:border-white/10">
              <p className="text-[10px] font-black text-zinc-900 dark:text-white">
                {phase.label} · {phase.fromPercent}–{phase.toPercent}%
              </p>
              <textarea
                rows={3}
                value={phase.guidance}
                onChange={(e) => setPhases((current) => current.map((item, idx) => idx === index ? { ...item, guidance: e.target.value } : item))}
                className="mt-1 w-full resize-none bg-transparent text-[10px] leading-relaxed text-zinc-500 outline-none dark:text-zinc-400"
              />
            </div>
          ))}
        </div>

        <div className="mt-3 rounded-2xl border border-amber-200 bg-amber-50/60 p-3 dark:border-amber-500/20 dark:bg-amber-500/[0.06]">
          <div className="flex items-center gap-2">
            <Volume2 className="h-4 w-4 text-amber-600" />
            <p className="text-xs font-black text-zinc-950 dark:text-white">Ação final obrigatória</p>
          </div>
          <p className="mt-1 text-[10px] text-zinc-500 dark:text-zinc-400">
            Separada do arsenal. O Brain procura oportunidade natural na janela final; se não houver resposta até expirar, vira ação manual.
          </p>
          <div className="mt-2 grid gap-2 sm:grid-cols-[1fr_150px]">
            <select
              value={finalAudioId}
              onChange={(e) => setFinalAudioId(e.target.value)}
              className="rounded-xl border border-zinc-200 bg-white px-3 py-2 text-[16px] md:text-xs text-zinc-950 dark:border-white/10 dark:bg-zinc-900 dark:text-white"
            >
              <option value="">Sem ação final configurada</option>
              {audios.filter((audio) => audio.enabled).map((audio) => (
                <option key={audio.id} value={audio.id}>{audio.title}</option>
              ))}
            </select>
            <label className="flex items-center gap-2 rounded-xl border border-zinc-200 bg-white px-3 py-2 dark:border-white/10 dark:bg-zinc-900">
              <span className="text-[10px] font-bold text-zinc-500">Ativar em</span>
              <input
                type="number"
                min={0}
                max={100}
                value={finalThreshold}
                onChange={(e) => setFinalThreshold(Number(e.target.value))}
                className="w-12 bg-transparent text-right text-xs font-black outline-none"
              />
              <span className="text-[10px] font-bold text-zinc-500">%</span>
            </label>
          </div>
        </div>

        <div className="mt-3 flex justify-end">
          <button type="button" disabled={savingRules} onClick={() => void saveConnectionRules()} className="min-h-10 rounded-xl bg-violet-600 px-4 text-xs font-bold text-white disabled:opacity-50">
            {savingRules ? "Salvando..." : "Salvar regras da janela"}
          </button>
        </div>
      </div>

      <div className="rounded-[22px] border border-zinc-200 bg-zinc-50/60 p-3.5 dark:border-white/10 dark:bg-black/20">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-xs font-black text-zinc-950 dark:text-white">Arsenal de conversa</p>
            <p className="text-[10px] text-zinc-500">{items.length} recurso(s) · não é checklist</p>
          </div>
          <button type="button" onClick={openCreate} className="inline-flex min-h-10 items-center gap-1.5 rounded-xl bg-zinc-950 px-3 text-xs font-bold text-white dark:bg-white dark:text-black">
            <Plus className="h-3.5 w-3.5" /> Adicionar
          </button>
        </div>

        <div className="mt-3 space-y-4">
          {isLoading && <p className="text-[10px] text-zinc-500">Carregando arsenal...</p>}
          {!isLoading && items.length === 0 && (
            <div className="rounded-2xl border border-dashed border-zinc-300 p-5 text-center dark:border-white/15">
              <p className="text-xs font-bold text-zinc-700 dark:text-zinc-300">Arsenal vazio</p>
              <p className="mt-1 text-[10px] text-zinc-500">A conversa continua funcionando normalmente; recursos são apenas possibilidades extras.</p>
            </div>
          )}
          {renderGroup("Assuntos, perguntas e histórias", grouped.text)}
          {renderGroup("Áudios", grouped.audio)}
          {renderGroup("Fotos", grouped.photo)}
          {renderGroup("Conteúdos do momento", grouped.moment)}
        </div>
      </div>

      <ResponsiveModal
        isOpen={modalOpen}
        onClose={() => setModalOpen(false)}
        maxWidth="lg"
        title={editingItem ? "Editar recurso" : "Novo recurso do arsenal"}
        description="Descreva o significado do recurso e quando ele pode ajudar a conversa."
      >
        <form onSubmit={saveItem} className="space-y-3 pt-1">
          <div className="grid gap-2 sm:grid-cols-2">
            <label className="space-y-1 text-xs font-semibold">
              <span>Tipo</span>
              <select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value as ArsenalItemType, assetId: "", mediaUrl: "", transcript: "" })} className="w-full rounded-xl border border-zinc-200 bg-zinc-50 px-3 py-2.5 text-[16px] md:text-xs dark:border-white/10 dark:bg-zinc-900">
                {ARSENAL_ITEM_TYPES.map((type) => <option key={type.value} value={type.value}>{type.label}</option>)}
              </select>
            </label>
            <label className="space-y-1 text-xs font-semibold">
              <span>Título *</span>
              <input required value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} className="w-full rounded-xl border border-zinc-200 bg-zinc-50 px-3 py-2.5 text-[16px] md:text-xs dark:border-white/10 dark:bg-zinc-900" />
            </label>
          </div>

          {form.type === "audio" && (
            <label className="block space-y-1 text-xs font-semibold">
              <span>Áudio do Cofre *</span>
              <select value={form.assetId} onChange={(e) => selectAudio(e.target.value)} className="w-full rounded-xl border border-sky-200 bg-sky-50 px-3 py-2.5 text-[16px] md:text-xs dark:border-sky-500/20 dark:bg-sky-500/[0.06]">
                <option value="">Selecione...</option>
                {audios.filter((audio) => audio.enabled).map((audio) => <option key={audio.id} value={audio.id}>{audio.title}</option>)}
              </select>
            </label>
          )}

          {form.type === "photo" && (
            <div className="rounded-xl border border-zinc-200 p-3 dark:border-white/10">
              <input ref={photoInputRef} type="file" accept="image/*" className="hidden" onChange={(e) => e.target.files?.[0] && void uploadPhoto(e.target.files[0])} />
              <button type="button" disabled={uploadingPhoto} onClick={() => photoInputRef.current?.click()} className="inline-flex min-h-10 items-center gap-2 rounded-xl bg-sky-500 px-3 text-xs font-bold text-white">
                <Upload className="h-4 w-4" /> {uploadingPhoto ? "Enviando..." : form.mediaUrl ? "Trocar foto" : "Enviar foto"}
              </button>
              {form.mediaUrl && <p className="mt-2 break-all text-[9px] text-zinc-500">{form.mediaUrl}</p>}
            </div>
          )}

          <label className="block space-y-1 text-xs font-semibold">
            <span>O que este recurso significa na conversa?</span>
            <textarea rows={3} value={form.semanticContent} onChange={(e) => setForm({ ...form, semanticContent: e.target.value })} placeholder="Ex: Larissa conta uma situação engraçada que aconteceu no estágio." className="w-full resize-none rounded-xl border border-zinc-200 bg-zinc-50 px-3 py-2.5 text-[16px] md:text-xs dark:border-white/10 dark:bg-zinc-900" />
          </label>

          {form.type === "photo" && (
            <label className="block space-y-1 text-xs font-semibold">
              <span>Descrição visual</span>
              <textarea rows={2} value={form.visualDescription} onChange={(e) => setForm({ ...form, visualDescription: e.target.value })} placeholder="O que aparece na foto e que contexto ela representa." className="w-full resize-none rounded-xl border border-zinc-200 bg-zinc-50 px-3 py-2.5 text-[16px] md:text-xs dark:border-white/10 dark:bg-zinc-900" />
            </label>
          )}

          <label className="block space-y-1 text-xs font-semibold">
            <span>Quando usar / quando não usar</span>
            <textarea rows={3} value={form.usageInstruction} onChange={(e) => setForm({ ...form, usageInstruction: e.target.value })} placeholder="Ex: usar quando falarem de trabalho ou ele perguntar do dia; não interromper assunto sério." className="w-full resize-none rounded-xl border border-zinc-200 bg-zinc-50 px-3 py-2.5 text-[16px] md:text-xs dark:border-white/10 dark:bg-zinc-900" />
          </label>

          <div className="grid gap-2 sm:grid-cols-2">
            <label className="space-y-1 text-xs font-semibold">
              <span>Função social</span>
              <select value={form.socialFunction} onChange={(e) => setForm({ ...form, socialFunction: e.target.value })} className="w-full rounded-xl border border-zinc-200 bg-zinc-50 px-3 py-2.5 text-[16px] md:text-xs dark:border-white/10 dark:bg-zinc-900">
                {ARSENAL_SOCIAL_FUNCTIONS.map((fn) => <option key={fn.value} value={fn.value}>{fn.label}</option>)}
              </select>
            </label>
            <label className="space-y-1 text-xs font-semibold">
              <span>Validade</span>
              <select value={form.validityType} onChange={(e) => setForm({ ...form, validityType: e.target.value as ArsenalValidityType })} className="w-full rounded-xl border border-zinc-200 bg-zinc-50 px-3 py-2.5 text-[16px] md:text-xs dark:border-white/10 dark:bg-zinc-900">
                <option value="evergreen">Permanente</option>
                <option value="recurring">Recorrente</option>
                <option value="moment">Momento / temporário</option>
              </select>
            </label>
          </div>

          {form.validityType === "moment" && (
            <div className="grid gap-2 sm:grid-cols-2">
              <label className="space-y-1 text-xs font-semibold"><span>Disponível a partir de</span><input type="datetime-local" value={form.validFrom} onChange={(e) => setForm({ ...form, validFrom: e.target.value })} className="w-full rounded-xl border border-zinc-200 bg-zinc-50 px-3 py-2 text-[16px] md:text-xs dark:border-white/10 dark:bg-zinc-900" /></label>
              <label className="space-y-1 text-xs font-semibold"><span>Expira em</span><input type="datetime-local" value={form.validUntil} onChange={(e) => setForm({ ...form, validUntil: e.target.value })} className="w-full rounded-xl border border-zinc-200 bg-zinc-50 px-3 py-2 text-[16px] md:text-xs dark:border-white/10 dark:bg-zinc-900" /></label>
            </div>
          )}

          {form.validityType === "recurring" && (
            <div className="rounded-xl border border-zinc-200 p-3 dark:border-white/10">
              <p className="text-[10px] font-bold text-zinc-600 dark:text-zinc-300">Dias e horário recorrentes</p>
              <div className="mt-2 flex gap-1">
                {WEEKDAYS.map((day) => {
                  const selected = form.recurringWeekdays.includes(day.value);
                  return (
                    <button key={day.value} type="button" onClick={() => setForm((prev) => ({ ...prev, recurringWeekdays: selected ? prev.recurringWeekdays.filter((x) => x !== day.value) : [...prev.recurringWeekdays, day.value] }))} className={`flex h-8 w-8 items-center justify-center rounded-lg text-[10px] font-black ${selected ? "bg-violet-600 text-white" : "bg-zinc-100 text-zinc-500 dark:bg-white/5"}`}>{day.label}</button>
                  );
                })}
              </div>
              <div className="mt-2 grid grid-cols-2 gap-2">
                <input type="time" value={form.recurringStart} onChange={(e) => setForm({ ...form, recurringStart: e.target.value })} className="rounded-xl border border-zinc-200 bg-zinc-50 px-3 py-2 text-[16px] md:text-xs dark:border-white/10 dark:bg-zinc-900" />
                <input type="time" value={form.recurringEnd} onChange={(e) => setForm({ ...form, recurringEnd: e.target.value })} className="rounded-xl border border-zinc-200 bg-zinc-50 px-3 py-2 text-[16px] md:text-xs dark:border-white/10 dark:bg-zinc-900" />
              </div>
            </div>
          )}

          <div className="grid gap-2 sm:grid-cols-3">
            <label className="space-y-1 text-xs font-semibold"><span>Máx. usos/conversa</span><input type="number" min={1} value={form.maxUses} onChange={(e) => setForm({ ...form, maxUses: e.target.value })} placeholder="Sem limite" className="w-full rounded-xl border border-zinc-200 bg-zinc-50 px-3 py-2 text-[16px] md:text-xs dark:border-white/10 dark:bg-zinc-900" /></label>
            <label className="space-y-1 text-xs font-semibold"><span>Cooldown (min)</span><input type="number" min={0} value={form.cooldownMinutes} onChange={(e) => setForm({ ...form, cooldownMinutes: Number(e.target.value) })} className="w-full rounded-xl border border-zinc-200 bg-zinc-50 px-3 py-2 text-[16px] md:text-xs dark:border-white/10 dark:bg-zinc-900" /></label>
            <label className="space-y-1 text-xs font-semibold"><span>Prioridade 0–100</span><input type="number" min={0} max={100} value={form.priority} onChange={(e) => setForm({ ...form, priority: Number(e.target.value) })} className="w-full rounded-xl border border-zinc-200 bg-zinc-50 px-3 py-2 text-[16px] md:text-xs dark:border-white/10 dark:bg-zinc-900" /></label>
          </div>

          <label className="flex items-center justify-between rounded-xl border border-zinc-200 p-3 text-xs font-semibold dark:border-white/10">
            <span>Recurso habilitado</span>
            <input type="checkbox" checked={form.enabled} onChange={(e) => setForm({ ...form, enabled: e.target.checked })} className="h-5 w-5" />
          </label>

          <div className="flex justify-end gap-2 pt-1">
            <button type="button" onClick={() => setModalOpen(false)} className="min-h-10 rounded-xl border border-zinc-200 px-4 text-xs font-bold dark:border-white/10">Cancelar</button>
            <button type="submit" disabled={saving} className="min-h-10 rounded-xl bg-violet-600 px-4 text-xs font-bold text-white disabled:opacity-50">{saving ? "Salvando..." : "Salvar recurso"}</button>
          </div>
        </form>
      </ResponsiveModal>
    </div>
  );
}
