/**
 * src/domain/repositories/ISubagentRepository.ts
 * Contrato da Camada de Domínio para Gerenciamento do Catálogo de Subagentes.
 * Fonte de verdade persistente única: Supabase (public.subagent_definitions).
 */

import { SubagentDefinition } from "../entities/Subagent";

export interface ISubagentRepository {
  /**
   * Lista todos os subagentes cadastrados no Supabase (ordenados por sistema e nome).
   */
  list(): Promise<SubagentDefinition[]>;
  listSubagents(): Promise<SubagentDefinition[]>; // Alias de compatibilidade

  /**
   * Obtém um subagente específico por ID diretamente do Supabase.
   */
  getById(id: string): Promise<SubagentDefinition | null>;
  getSubagent(id: string): Promise<SubagentDefinition | null>; // Alias de compatibilidade

  /**
   * Cria um novo subagente customizado no Supabase.
   */
  create(subagent: SubagentDefinition): Promise<SubagentDefinition>;

  /**
   * Atualiza nome, missão e configurações de um subagente existente no Supabase.
   */
  update(id: string, updates: Partial<SubagentDefinition>): Promise<SubagentDefinition>;
  saveSubagent(subagent: SubagentDefinition): Promise<SubagentDefinition>; // Alias de compatibilidade

  /**
   * Ativa ou desativa um subagente no Supabase.
   */
  setEnabled(id: string, enabled: boolean): Promise<SubagentDefinition>;
  toggleSubagent(id: string, enabled: boolean): Promise<SubagentDefinition>; // Alias de compatibilidade

  /**
   * Exclui com segurança um subagente customizado do Supabase.
   * Regra estrita: subagentes com is_system=true são protegidos e não podem ser excluídos.
   */
  deleteCustom(id: string): Promise<boolean>;
  deleteSubagent(id: string): Promise<boolean>; // Alias de compatibilidade

  /**
   * Conta quantos objetivos de etapa estão vinculados ao subagente especificado.
   * Usado para travas de segurança e confirmação antes de exclusão.
   */
  countLinkedObjectives(subagentId: string): Promise<number>;
}
