/**
 * src/domain/entities/Subagent.ts
 * Definição de Domínio de Subagentes da Persona (Clean Architecture).
 * Suporta subagentes canônicos de sistema e subagentes personalizados configuráveis pelo usuário.
 */

export interface SubagentDefinition {
  /** Identificador único estável (ex: 'conexao_inicial', 'descoberta', 'compatibilidade', 'valores_vida') */
  id: string;
  /** Nome visual amigável exibido na interface */
  name: string;
  /** Missão conversacional semântica que norteia o subagente e o router */
  mission: string;
  /** Status de ativação: se false, o router não pode selecioná-lo */
  enabled: boolean;
  /** Se true, é um agente canônico essencial do sistema (não pode ser excluído) */
  isSystem: boolean;
  /** Etapas opcionais associadas ao subagente */
  stageIds?: string[];
  /** Descrição complementar opcional */
  description?: string;
  createdAt: string;
  updatedAt: string;
}

/**
 * Catálogo Canônico Inicial com os 3 Subagentes Padrão do Sistema
 */
export const CANONICAL_SUBAGENTS_LIST: SubagentDefinition[] = [
  {
    id: "conexao_inicial",
    name: "Conexão Inicial",
    mission: "Criar conforto, reciprocidade e um começo natural de conversa, sem transformar o contato em entrevista nem antecipar assuntos profundos.",
    enabled: true,
    isSystem: true,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  },
  {
    id: "descoberta",
    name: "Descoberta",
    mission: "Conhecer organicamente quem o pretendente é, sua rotina, vida, trabalho, gostos e contexto pessoal, aproveitando naturalmente os assuntos que surgem.",
    enabled: true,
    isSystem: true,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  },
  {
    id: "compatibilidade",
    name: "Compatibilidade",
    mission: "Entender valores, momento de vida, visão de relacionamento, família, planos e compatibilidade com Larissa, somente quando houver abertura natural para assuntos mais pessoais.",
    enabled: true,
    isSystem: true,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  },
];

/**
 * Utilitário para gerar slug estável de identificador para subagentes customizados
 */
export function generateSubagentId(name: string): string {
  const clean = name
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");

  return clean || `agent_${Date.now().toString(36)}`;
}
