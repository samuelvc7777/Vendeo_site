/**
 * src/presentation/components/config/SubagentsManager.tsx
 * Gerenciador Visual do Catálogo de Subagentes da Persona.
 * Permite listar, criar, editar, alternar ativação e excluir com segurança.
 */

"use client";

import React, { useState } from "react";
import {
  Bot,
  Plus,
  Edit2,
  Trash2,
  ShieldCheck,
  Sparkles,
  Power,
  Check,
  X,
  AlertTriangle,
  Loader2,
  HelpCircle,
} from "lucide-react";
import { SubagentDefinition, generateSubagentId } from "@/domain/entities/Subagent";
import { useSubagents } from "@/presentation/hooks/useSubagents";
import { toast } from "sonner";

export function SubagentsManager() {
  const {
    subagents,
    isLoading,
    createSubagent,
    updateSubagent,
    toggleSubagent,
    deleteSubagent,
    checkLinkedObjectives,
  } = useSubagents();

  // Estados de Modal de Criação / Edição
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingSubagent, setEditingSubagent] = useState<SubagentDefinition | null>(null);
  const [name, setName] = useState("");
  const [mission, setMission] = useState("");
  const [enabled, setEnabled] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Estados de Exclusão Segura
  const [deleteConfirmAgent, setDeleteConfirmAgent] = useState<SubagentDefinition | null>(null);
  const [linkedCount, setLinkedCount] = useState<number>(0);
  const [isCheckingDelete, setIsCheckingDelete] = useState(false);

  const openCreateModal = () => {
    setEditingSubagent(null);
    setName("");
    setMission("");
    setEnabled(true);
    setIsModalOpen(true);
  };

  const openEditModal = (agent: SubagentDefinition) => {
    setEditingSubagent(agent);
    setName(agent.name);
    setMission(agent.mission);
    setEnabled(agent.enabled !== false);
    setIsModalOpen(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !mission.trim()) {
      toast.error("Nome e Missão são obrigatórios.");
      return;
    }

    try {
      setIsSubmitting(true);
      if (editingSubagent) {
        await updateSubagent(editingSubagent.id, {
          name: name.trim(),
          mission: mission.trim(),
          enabled,
        });
      } else {
        await createSubagent({
          name: name.trim(),
          mission: mission.trim(),
          enabled,
        });
      }
      setIsModalOpen(false);
    } catch {
      // Erros já tratados com toast
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleInitiateDelete = async (agent: SubagentDefinition) => {
    if (agent.isSystem) {
      toast.error("Subagentes canônicos do sistema não podem ser excluídos.");
      return;
    }

    setIsCheckingDelete(true);
    try {
      const count = await checkLinkedObjectives(agent.id);
      setLinkedCount(count);
      setDeleteConfirmAgent(agent);
    } catch {
      toast.error("Falha ao verificar vínculos do subagente.");
    } finally {
      setIsCheckingDelete(false);
    }
  };

  const handleConfirmDelete = async () => {
    if (!deleteConfirmAgent) return;
    const res = await deleteSubagent(deleteConfirmAgent.id);
    if (res.success) {
      setDeleteConfirmAgent(null);
    }
  };

  const handleDeactivateInstead = async () => {
    if (!deleteConfirmAgent) return;
    await toggleSubagent(deleteConfirmAgent.id, false);
    setDeleteConfirmAgent(null);
  };

  return (
    <div className="space-y-4">
      {/* Cabeçalho da Seção */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-full bg-[#0095f6]/10 border border-[#0095f6]/30 flex items-center justify-center shrink-0">
            <Bot className="w-4 h-4 text-[#0095f6]" />
          </div>
          <div>
            <h3 className="text-sm font-bold text-white flex items-center gap-2 flex-wrap">
              Subagentes & Missões
              <span className="text-[10px] bg-[#262626] text-[#a8a8a8] font-normal px-2 py-0.5 rounded-full">
                {subagents.length} cadastrados
              </span>
            </h3>
            <p className="text-[11px] text-[#a8a8a8]">
              Especialistas com missões conversacionais para conduzir o diálogo
            </p>
          </div>
        </div>

        <button
          onClick={openCreateModal}
          className="w-full sm:w-auto py-2 sm:py-1.5 px-3.5 rounded-xl bg-gradient-to-r from-[#0095f6] to-[#10b981] text-white text-xs font-bold hover:opacity-90 active:scale-95 transition-all flex items-center justify-center gap-1.5 shadow-sm cursor-pointer min-h-[38px] sm:min-h-0"
        >
          <Plus className="w-3.5 h-3.5" />
          Novo subagente
        </button>
      </div>

      {/* Lista de Subagentes */}
      {isLoading ? (
        <div className="py-8 flex items-center justify-center gap-2 text-xs text-[#a8a8a8]">
          <Loader2 className="w-4 h-4 animate-spin text-[#0095f6]" />
          Carregando catálogo de subagentes...
        </div>
      ) : subagents.length === 0 ? (
        <div className="p-4 rounded-xl bg-[#1a1a1a] border border-[#262626] text-center text-xs text-[#a8a8a8]">
          Nenhum subagente configurado.
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-2.5">
          {subagents.map((agent) => (
            <div
              key={agent.id}
              className={`p-3 sm:p-3.5 rounded-xl border transition-all ${
                agent.enabled !== false
                  ? "bg-[#181818] border-[#2c2c2c] hover:border-[#3a3a3a]"
                  : "bg-[#121212] border-[#222] opacity-60"
              }`}
            >
              <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
                <div className="space-y-2 flex-1 min-w-0">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <h4 className="text-xs font-bold text-white break-words">
                      {agent.name}
                    </h4>

                    {/* Badge de Sistema vs Personalizado */}
                    {agent.isSystem ? (
                      <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-md bg-[#0095f6]/15 text-[#0095f6] border border-[#0095f6]/30 flex items-center gap-1 shrink-0">
                        <ShieldCheck className="w-2.5 h-2.5" />
                        Sistema
                      </span>
                    ) : (
                      <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-md bg-[#8b5cf6]/15 text-[#a78bfa] border border-[#8b5cf6]/30 flex items-center gap-1 shrink-0">
                        <Sparkles className="w-2.5 h-2.5" />
                        Personalizado
                      </span>
                    )}

                    {/* ID Estável */}
                    <span className="font-mono text-[10px] text-[#737373] bg-[#222] px-1.5 py-0.5 rounded shrink-0">
                      id: {agent.id}
                    </span>

                    {/* Status Ativo/Inativo */}
                    <span
                      className={`text-[9px] font-bold px-1.5 py-0.5 rounded-md border shrink-0 ${
                        agent.enabled !== false
                          ? "bg-[#10b981]/15 text-[#10b981] border-[#10b981]/30"
                          : "bg-red-950/30 text-[#f87171] border-red-900/40"
                      }`}
                    >
                      {agent.enabled !== false ? "Ativo" : "Inativo"}
                    </span>
                  </div>

                  {/* Missão Conversacional */}
                  <p className="text-xs sm:text-[11px] text-[#cccccc] leading-relaxed break-words">
                    <span className="font-semibold text-[#8e8e8e]">Missão:</span> {agent.mission}
                  </p>
                </div>

                {/* Ações: barra dedicada no mobile e alinhada no desktop */}
                <div className="flex items-center justify-end gap-2 pt-2 border-t border-[#262626] sm:border-t-0 sm:pt-0 shrink-0">
                  {/* Toggle Ativar / Desativar */}
                  <button
                    onClick={() => toggleSubagent(agent.id, agent.enabled === false)}
                    title={agent.enabled !== false ? "Desativar subagente" : "Ativar subagente"}
                    aria-label={agent.enabled !== false ? "Desativar subagente" : "Ativar subagente"}
                    className={`p-2 sm:p-1.5 min-w-[36px] min-h-[36px] sm:min-w-0 sm:min-h-0 flex items-center justify-center rounded-lg border active:scale-95 transition-all cursor-pointer ${
                      agent.enabled !== false
                        ? "bg-[#10b981]/10 border-[#10b981]/30 text-[#10b981] hover:bg-[#10b981]/20"
                        : "bg-[#262626] border-[#333] text-[#737373] hover:text-white"
                    }`}
                  >
                    <Power className="w-3.5 h-3.5" />
                  </button>

                  {/* Editar */}
                  <button
                    onClick={() => openEditModal(agent)}
                    title="Editar nome e missão"
                    aria-label="Editar subagente"
                    className="p-2 sm:p-1.5 min-w-[36px] min-h-[36px] sm:min-w-0 sm:min-h-0 flex items-center justify-center rounded-lg bg-[#262626] border border-[#333] text-[#a8a8a8] hover:text-white hover:bg-[#333] active:scale-95 transition-all cursor-pointer"
                  >
                    <Edit2 className="w-3.5 h-3.5" />
                  </button>

                  {/* Excluir (somente personalizados) */}
                  {!agent.isSystem && (
                    <button
                      onClick={() => handleInitiateDelete(agent)}
                      disabled={isCheckingDelete}
                      title="Excluir subagente"
                      aria-label="Excluir subagente"
                      className="p-2 sm:p-1.5 min-w-[36px] min-h-[36px] sm:min-w-0 sm:min-h-0 flex items-center justify-center rounded-lg bg-red-950/30 border border-red-900/40 text-[#f87171] hover:bg-red-900/40 hover:text-white active:scale-95 transition-all cursor-pointer"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* MODAL DE CRIAÇÃO / EDIÇÃO */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/80 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="w-full max-w-lg max-h-[92vh] overflow-y-auto bg-[#141414] border border-[#2a2a2a] rounded-2xl p-4 sm:p-5 space-y-4 shadow-2xl overscroll-contain">
            <div className="flex items-center justify-between border-b border-[#222] pb-3">
              <div className="flex items-center gap-2">
                <div className="w-7 h-7 rounded-lg bg-[#0095f6]/15 text-[#0095f6] flex items-center justify-center shrink-0">
                  <Bot className="w-4 h-4" />
                </div>
                <h3 className="text-sm font-bold text-white">
                  {editingSubagent ? "Editar Subagente" : "Novo Subagente"}
                </h3>
              </div>
              <button
                onClick={() => setIsModalOpen(false)}
                className="text-[#737373] hover:text-white p-2 sm:p-1 rounded-lg cursor-pointer transition-colors"
                aria-label="Fechar"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleSubmit} className="space-y-3.5">
              {/* Nome */}
              <div className="space-y-1">
                <label className="text-xs font-semibold text-white">Nome do Subagente</label>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Ex: Conhecendo valores"
                  required
                  className="w-full px-3 py-2.5 sm:py-2 rounded-xl bg-[#1c1c1c] border border-[#333] text-xs text-white placeholder-[#666] focus:border-[#0095f6] focus:outline-none"
                />
              </div>

              {/* ID gerado */}
              <div className="space-y-1">
                <label className="text-[11px] font-semibold text-[#8e8e8e] flex items-center justify-between">
                  <span>Identificador Estável (ID)</span>
                  <span className="text-[10px] text-[#666]">Automático</span>
                </label>
                <input
                  type="text"
                  disabled
                  value={editingSubagent ? editingSubagent.id : generateSubagentId(name)}
                  className="w-full px-3 py-2 sm:py-1.5 rounded-xl bg-[#181818] border border-[#262626] font-mono text-[11px] text-[#737373] cursor-not-allowed"
                />
              </div>

              {/* Missão Conversacional */}
              <div className="space-y-1">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-semibold text-white">
                    Missão Conversacional
                  </label>
                  <span className="text-[10px] text-[#737373]">
                    {mission.length}/300 carac.
                  </span>
                </div>
                <textarea
                  value={mission}
                  onChange={(e) => setMission(e.target.value)}
                  placeholder="Defina com clareza o que este especialista busca ou faz na conversa. Ex: Conhecer os objetivos profissionais e planos futuros do pretendente quando o assunto surgir naturalmente."
                  rows={4}
                  required
                  className="w-full px-3 py-2.5 sm:py-2 rounded-xl bg-[#1c1c1c] border border-[#333] text-xs text-white placeholder-[#666] focus:border-[#0095f6] focus:outline-none resize-none leading-relaxed"
                />
                <p className="text-[10px] text-[#8e8e8e] flex items-center gap-1">
                  <HelpCircle className="w-3 h-3 text-[#0095f6] shrink-0" />
                  Não escreva system prompt técnico. Defina apenas o objetivo conversacional.
                </p>
              </div>

              {/* Toggle Ativo */}
              <div className="flex items-center justify-between p-3 rounded-xl bg-[#1c1c1c] border border-[#2a2a2a]">
                <div>
                  <h5 className="text-xs font-bold text-white">Subagente Ativo</h5>
                  <p className="text-[10px] text-[#8e8e8e]">
                    Disponível para seleção pelo Router
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setEnabled(!enabled)}
                  className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors cursor-pointer ${
                    enabled ? "bg-[#10b981]" : "bg-[#333]"
                  }`}
                >
                  <span
                    className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                      enabled ? "translate-x-6" : "translate-x-1"
                    }`}
                  />
                </button>
              </div>

              {/* Botões */}
              <div className="flex flex-col-reverse sm:flex-row sm:items-center sm:justify-end gap-2 pt-3 border-t border-[#222]">
                <button
                  type="button"
                  onClick={() => setIsModalOpen(false)}
                  disabled={isSubmitting}
                  className="w-full sm:w-auto px-4 py-2.5 sm:py-2 rounded-xl bg-[#222] text-xs font-semibold text-[#a8a8a8] hover:text-white cursor-pointer active:scale-95 transition-all text-center"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="w-full sm:w-auto px-4 py-2.5 sm:py-2 rounded-xl bg-gradient-to-r from-[#0095f6] to-[#10b981] text-xs font-bold text-white hover:opacity-90 active:scale-95 transition-all flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-50"
                >
                  {isSubmitting ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <Check className="w-3.5 h-3.5" />
                  )}
                  {editingSubagent ? "Salvar Alterações" : "Criar Subagente"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL DE SEGURANÇA NA EXCLUSÃO */}
      {deleteConfirmAgent && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/85 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="w-full max-w-md max-h-[92vh] overflow-y-auto bg-[#141414] border border-red-900/50 rounded-2xl p-4 sm:p-5 space-y-4 shadow-2xl overscroll-contain">
            <div className="flex items-center gap-2.5 text-[#ef4444]">
              <div className="w-8 h-8 rounded-full bg-red-950/50 border border-red-900/60 flex items-center justify-center shrink-0">
                <AlertTriangle className="w-4 h-4 text-[#ef4444]" />
              </div>
              <div className="min-w-0">
                <h4 className="text-xs font-bold text-white">Excluir Subagente?</h4>
                <p className="text-[10px] text-[#f87171] truncate">{deleteConfirmAgent.name}</p>
              </div>
            </div>

            {linkedCount > 0 ? (
              <div className="space-y-2 p-3 rounded-xl bg-amber-950/20 border border-amber-900/40 text-xs text-amber-200">
                <p className="font-semibold text-[11px] text-amber-300">
                  ⚠️ Este subagente está vinculado a {linkedCount} objetivo(s) nas etapas.
                </p>
                <p className="text-[10px] text-amber-400/90 leading-relaxed">
                  Para evitar perda de coerência nas etapas, recomendamos desativar o subagente em vez de excluí-lo permanentemente.
                </p>
              </div>
            ) : (
              <p className="text-xs text-[#a8a8a8] leading-relaxed">
                Tem certeza que deseja excluir permanentemente o subagente{" "}
                <strong className="text-white">"{deleteConfirmAgent.name}"</strong>? Esta ação não pode ser desfeita.
              </p>
            )}

            <div className="flex flex-col gap-2 pt-2 border-t border-[#222]">
              {linkedCount > 0 && (
                <button
                  onClick={handleDeactivateInstead}
                  className="w-full py-2.5 px-3 rounded-xl bg-[#262626] border border-[#333] text-white text-xs font-bold hover:bg-[#333] active:scale-95 transition-all cursor-pointer text-center"
                >
                  Desativar em vez de excluir (Recomendado)
                </button>
              )}
              <div className="flex flex-col-reverse sm:flex-row sm:items-center sm:justify-end gap-2">
                <button
                  onClick={() => setDeleteConfirmAgent(null)}
                  className="w-full sm:w-auto px-4 py-2 rounded-xl bg-[#222] text-xs font-semibold text-[#a8a8a8] hover:text-white cursor-pointer active:scale-95 transition-all text-center"
                >
                  Cancelar
                </button>
                {linkedCount === 0 && (
                  <button
                    onClick={handleConfirmDelete}
                    className="w-full sm:w-auto px-4 py-2 rounded-xl bg-red-600 hover:bg-red-700 text-white text-xs font-bold active:scale-95 transition-all cursor-pointer text-center"
                  >
                    Excluir Definitivamente
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
