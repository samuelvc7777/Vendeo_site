"use client";

import React, { useState, useEffect, useRef } from "react";
import {
  Bot,
  Check,
  Edit3,
  Trash2,
  Play,
  Pause,
  Plus,
  Send,
  Volume2,
  X,
  Loader2,
} from "lucide-react";
import { AutoPilotPendingAction } from "@/domain/entities/AutoPilot";

interface AutoPilotApprovalCardProps {
  pendingAction: AutoPilotPendingAction;
  onApprove: (customResponses?: string[]) => Promise<void> | void;
  onReject: () => Promise<void> | void;
  onUpdateResponses?: (responses: string[]) => void;
  isSending?: boolean;
}

export function AutoPilotApprovalCard({
  pendingAction,
  onApprove,
  onReject,
  onUpdateResponses,
  isSending = false,
}: AutoPilotApprovalCardProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [editableResponses, setEditableResponses] = useState<string[]>(pendingAction.responses || []);
  const [playingAudioUrl, setPlayingAudioUrl] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  // Sincroniza estado quando a pendingAction mudar externamente
  useEffect(() => {
    setEditableResponses(pendingAction.responses || []);
  }, [pendingAction.responses]);

  // Controle de áudio player interno
  const handleToggleAudio = (url: string) => {
    if (playingAudioUrl === url) {
      audioRef.current?.pause();
      setPlayingAudioUrl(null);
    } else {
      if (audioRef.current) {
        audioRef.current.pause();
      }
      const audio = new Audio(url);
      audioRef.current = audio;
      audio.play().catch((err) => console.warn("Erro ao reproduzir áudio:", err));
      setPlayingAudioUrl(url);

      audio.onended = () => {
        setPlayingAudioUrl(null);
      };
      audio.onerror = () => {
        setPlayingAudioUrl(null);
      };
    }
  };

  useEffect(() => {
    return () => {
      if (audioRef.current) {
        audioRef.current.pause();
      }
    };
  }, []);

  const handleResponseChange = (index: number, newText: string) => {
    const updated = [...editableResponses];
    updated[index] = newText;
    setEditableResponses(updated);
    if (onUpdateResponses) {
      onUpdateResponses(updated);
    }
  };

  const handleRemoveBalloon = (index: number) => {
    const updated = editableResponses.filter((_, i) => i !== index);
    setEditableResponses(updated);
    if (onUpdateResponses) {
      onUpdateResponses(updated);
    }
  };

  const handleAddBalloon = () => {
    const updated = [...editableResponses, ""];
    setEditableResponses(updated);
    if (onUpdateResponses) {
      onUpdateResponses(updated);
    }
  };

  const handleConfirmApproval = () => {
    if (audioRef.current) {
      audioRef.current.pause();
      setPlayingAudioUrl(null);
    }
    const cleanResponses = editableResponses.map((r) => r.trim()).filter(Boolean);
    onApprove(cleanResponses);
  };

  const handleDiscard = () => {
    if (audioRef.current) {
      audioRef.current.pause();
      setPlayingAudioUrl(null);
    }
    onReject();
  };

  return (
    <div className="mx-1.5 my-2 p-3.5 sm:p-4 rounded-2xl bg-[#161619] border border-purple-500/40 shadow-xl shadow-purple-950/20 animate-in fade-in slide-in-from-top-3 duration-250 transition-all">
      {/* Cabeçalho do Card */}
      <div className="flex items-center justify-between pb-3 border-b border-white/5">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-xl bg-gradient-to-tr from-purple-600 to-indigo-600 flex items-center justify-center text-white shadow-md shrink-0">
            <Bot className="w-4 h-4" />
          </div>
          <div>
            <div className="flex items-center gap-1.5">
              <h4 className="text-xs sm:text-sm font-bold text-white leading-tight">
                Sugestão da IA para Envio
              </h4>
              <span className="px-1.5 py-0.5 rounded-full bg-purple-500/20 border border-purple-500/30 text-purple-300 text-[9px] font-semibold">
                Semiautomático
              </span>
            </div>
            <p className="text-[10.5px] text-zinc-400">
              Revise a mensagem gerada e aprove com 1 clique ou edite antes de disparar.
            </p>
          </div>
        </div>

        {/* Botão de alternar Edição */}
        <button
          type="button"
          onClick={() => setIsEditing(!isEditing)}
          className={`px-2.5 py-1.5 rounded-xl border text-xs font-semibold flex items-center gap-1.5 transition-all cursor-pointer ${
            isEditing
              ? "bg-purple-600 text-white border-purple-400 shadow-sm"
              : "bg-[#202024] hover:bg-[#28282d] text-zinc-300 border-white/10"
          }`}
          title={isEditing ? "Concluir edição dos balões" : "Editar o texto dos balões"}
        >
          <Edit3 className="w-3.5 h-3.5" />
          <span className="hidden xs:inline">{isEditing ? "Concluir" : "Editar"}</span>
        </button>
      </div>

      {/* Lista de Balões Propostos */}
      <div className="py-3 space-y-2.5 max-h-[300px] overflow-y-auto pr-1">
        {editableResponses.map((balloon, index) => {
          const isAudio = balloon.startsWith("[audio:");
          const audioUrl = isAudio
            ? balloon.match(/^\[audio:(https?:\/\/[^\]]+)\]/)?.[1] ||
              balloon.replace("[audio:", "").replace("]", "").trim()
            : null;

          if (isAudio && audioUrl) {
            const isPlaying = playingAudioUrl === audioUrl;
            return (
              <div
                key={index}
                className="flex items-center justify-between p-2.5 rounded-xl bg-purple-950/25 border border-purple-500/30 gap-2 text-zinc-200"
              >
                <div className="flex items-center gap-2.5 min-w-0">
                  <button
                    type="button"
                    onClick={() => handleToggleAudio(audioUrl)}
                    className="w-8 h-8 rounded-full bg-purple-600 hover:bg-purple-500 text-white flex items-center justify-center shrink-0 shadow-sm active:scale-90 transition-transform cursor-pointer"
                    title={isPlaying ? "Pausar áudio" : "Ouvir áudio antes de aprovar"}
                  >
                    {isPlaying ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4 ml-0.5" />}
                  </button>
                  <div className="min-w-0">
                    <div className="flex items-center gap-1 text-xs font-semibold text-purple-200 truncate">
                      <Volume2 className="w-3.5 h-3.5 text-purple-400 shrink-0" />
                      <span>Mensagem de Voz (Áudio do Cofre)</span>
                    </div>
                    <span className="text-[10px] text-zinc-400 truncate block">
                      Balão {index + 1} de {editableResponses.length} • Pronto para disparo
                    </span>
                  </div>
                </div>

                {isEditing && (
                  <button
                    type="button"
                    onClick={() => handleRemoveBalloon(index)}
                    className="p-1.5 rounded-lg text-rose-400 hover:bg-rose-500/20 transition-colors cursor-pointer shrink-0"
                    title="Remover este áudio"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
            );
          }

          // Balão de Texto
          return (
            <div key={index} className="space-y-1">
              <div className="flex items-center justify-between text-[10px] text-zinc-400 px-1 font-medium">
                <span>Balão {index + 1} de {editableResponses.length}</span>
                {isEditing && editableResponses.length > 1 && (
                  <button
                    type="button"
                    onClick={() => handleRemoveBalloon(index)}
                    className="text-rose-400 hover:text-rose-300 flex items-center gap-1 cursor-pointer"
                  >
                    <Trash2 className="w-3 h-3" />
                    <span>Excluir</span>
                  </button>
                )}
              </div>

              {isEditing ? (
                <textarea
                  value={balloon}
                  onChange={(e) => handleResponseChange(index, e.target.value)}
                  rows={2}
                  placeholder="Digite ou edite o que a IA deve enviar..."
                  className="w-full p-2.5 rounded-xl bg-[#0f0f11] border border-purple-500/40 focus:border-purple-400 text-xs text-white placeholder-zinc-500 focus:outline-none resize-none leading-relaxed transition-colors"
                />
              ) : (
                <div className="p-3 rounded-2xl bg-gradient-to-r from-purple-950/40 to-indigo-950/30 border border-purple-500/20 text-xs text-zinc-100 leading-relaxed break-words whitespace-pre-wrap">
                  {balloon}
                </div>
              )}
            </div>
          );
        })}

        {/* Adicionar novo balão em modo edição */}
        {isEditing && (
          <button
            type="button"
            onClick={handleAddBalloon}
            className="w-full py-2 px-3 rounded-xl border border-dashed border-purple-500/40 hover:border-purple-400 bg-purple-500/5 hover:bg-purple-500/10 text-purple-300 text-xs font-semibold flex items-center justify-center gap-1.5 transition-all cursor-pointer"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>Adicionar Outro Balão</span>
          </button>
        )}
      </div>

      {/* Barra de Ações: Aprovar, Editar e Descartar */}
      <div className="pt-3 border-t border-white/5 flex items-center justify-between gap-2.5">
        <button
          type="button"
          onClick={handleDiscard}
          disabled={isSending}
          className="min-h-[44px] px-3 py-2 rounded-xl bg-[#202024] hover:bg-rose-950/30 hover:text-rose-300 hover:border-rose-500/40 border border-white/10 text-zinc-400 text-xs font-semibold flex items-center justify-center gap-1.5 transition-all cursor-pointer disabled:opacity-50 active:scale-95 shrink-0"
          title="Descartar esta sugestão e responder manualmente"
        >
          <X className="w-4 h-4" />
          <span>Descartar</span>
        </button>

        <div className="flex items-center gap-2">
          {isEditing && (
            <button
              type="button"
              onClick={() => setIsEditing(false)}
              className="min-h-[44px] px-3.5 py-2 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-zinc-200 text-xs font-semibold flex items-center justify-center gap-1.5 transition-all cursor-pointer active:scale-95"
            >
              <Check className="w-4 h-4" />
              <span>Salvar</span>
            </button>
          )}

          <button
            type="button"
            onClick={handleConfirmApproval}
            disabled={isSending || editableResponses.every((r) => !r.trim())}
            className="min-h-[44px] px-4 py-2 rounded-xl bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white text-xs sm:text-sm font-bold flex items-center justify-center gap-2 shadow-lg shadow-emerald-950/30 active:scale-95 transition-all cursor-pointer disabled:opacity-50"
          >
            {isSending ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                <span>Enviando...</span>
              </>
            ) : (
              <>
                <Send className="w-4 h-4" />
                <span>Aprovar & Enviar Agora</span>
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
