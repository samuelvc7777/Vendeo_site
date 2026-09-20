import { VaultItemType } from "./Vault";

/**
 * Objetivo Semântico da Etapa (Canônico).
 * Define um resultado desejado que a persona deve alcançar/descobrir de forma natural.
 */
export interface StageObjective {
  id: string;
  stageId: string;
  title?: string;
  label?: string; // Compatibilidade com v231 (alias para title)
  description?: string;
  kind?: "fact" | "conversation_state"; // "fact": biográfico durável | "conversation_state": checkpoint de evolução
  required: boolean;
  enabled: boolean;
  order: number;
  memoryEntity?: string; // Ex: "self", "familia"
  memoryField?: string;  // Ex: "age", "city", "occupation"
  /** Subagentes autorizados a perseguir ou interagir com este objetivo */
  allowedSubagents?: string[];
  /** Subagente prioritário de referência (opcional) */
  primarySubagent?: string;
  createdAt?: string;
  updatedAt?: string;
}

// Type alias para compatibilidade com código existente
export type ConversationGoal = StageObjective;

/**
 * Progresso de um Objetivo em uma Conversa específica.
 */
export interface ConversationObjectiveProgress {
  conversationId: string;
  stageId: string;
  objectiveId: string;
  status: "pending" | "completed" | "skipped";
  value?: string | number | boolean | null;
  evidenceMessageId?: string;
  completedAt?: string;
}

/**
 * Áudio da Persona (Biblioteca de Voz da Larissa no Cofre).
 */
export interface PersonaAudioAsset {
  id: string;
  stageId?: string; // Etapa associada (opcional)
  title: string;
  audioUrl: string;
  duration?: number; // Duração em segundos
  transcript: string; // Conteúdo persistido para busca semântica
  usageInstruction: string; // Quando usar este áudio
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

/**
 * Histórico de Entrega de Áudio na Conversa.
 */
export interface AudioDeliveryHistory {
  id: string;
  conversationId: string;
  audioId: string;
  sentAt: string;
  providerMessageId?: string;
}

/**
 * Etapa da Conversa (Canônica).
 * Representa o momento macro da conversa, totalmente independente de pastas do Cofre.
 */
export interface ChatStage {
  id: string;
  name: string;
  order: number;
  folderId?: string; // @deprecated: mantido opcional para compatibilidade transitória
  color?: string; // Cor de identificação da etapa (ex: #3b82f6, #10b981, #f59e0b)
  icon?: string;
  description?: string;
  objectives?: StageObjective[]; // Coleção canônica de objetivos
  goals?: StageObjective[]; // Alias para compatibilidade
  createdAt: string;
  updatedAt: string;
}

/**
 * @deprecated: Estrutura antiga de checklist baseada em arquivos do Cofre.
 */
export interface StageChecklistItem {
  id: string; // ID do VaultItem
  folderId: string;
  type: VaultItemType;
  title: string;
  content?: string;
  mediaUrl?: string;
  duration?: number;
  linkedItemId?: string;
  isCompleted: boolean;
}

export interface ChatProgress {
  conversationId: string;
  currentStageId: string;
  completedItemIds?: string[]; // @deprecated: lista de VaultItems legados
  completedGoalIds?: string[]; // Lista de IDs de objetivos concluídos
  objectiveProgress?: Record<string, ConversationObjectiveProgress>; // Progresso detalhado
  isConverted: boolean; // Se atingiu o Objetivo Final
  updatedAt: string;
}

export interface ChatStageWithStats extends ChatStage {
  totalItems: number;
  folderName?: string;
}

/**
 * MATRIZ OFICIAL DE ETAPAS E OBJETIVOS CANÔNICOS (3 Subagentes).
 * 
 * Regras Estritas de Negócio:
 * - Somente 2 objetivos são required em todo o sistema:
 *   1. goal_initial_reciprocity (na Conexão Inicial)
 *   2. goal_discovery_depth (na Descoberta)
 * - Fatos pessoais (fact) NUNCA bloqueiam progressão de etapa.
 * - goal_relationship é restrito exclusivamente ao status de relacionamento (solteiro, separado, etc.).
 * - Sem roteiros fixos ou ordem obrigatória entre objetivos.
 */
export const CANONICAL_CHAT_STAGES_MATRIX: ChatStage[] = [
  {
    id: "stage_1_conexao",
    name: "Conexão Inicial",
    order: 0,
    color: "#3b82f6",
    description: "Criar conforto, reciprocidade e um começo natural de conversa sem entrevista.",
    createdAt: "2026-09-20T00:00:00.000Z",
    updatedAt: "2026-09-20T00:00:00.000Z",
    goals: [
      {
        id: "goal_initial_reciprocity",
        stageId: "stage_1_conexao",
        title: "Reciprocidade inicial",
        label: "Reciprocidade inicial",
        description: "Reconhecer que a conversa deixou de ser apenas uma saudação e houve pelo menos uma troca minimamente recíproca entre os dois.",
        kind: "conversation_state",
        required: true,
        enabled: true,
        order: 1,
        allowedSubagents: ["conexao_inicial"],
        primarySubagent: "conexao_inicial",
      },
      {
        id: "goal_city",
        stageId: "stage_1_conexao",
        title: "Cidade",
        label: "Cidade",
        description: "Descobrir onde ele mora ou contexto geográfico",
        kind: "fact",
        required: false,
        enabled: true,
        order: 2,
        memoryEntity: "self",
        memoryField: "city",
        allowedSubagents: ["conexao_inicial", "descoberta"],
        primarySubagent: "conexao_inicial",
      },
      {
        id: "goal_job",
        stageId: "stage_1_conexao",
        title: "Profissão / trabalho",
        label: "Profissão / trabalho",
        description: "Descobrir profissão, ocupação ou trabalho atual",
        kind: "fact",
        required: false,
        enabled: true,
        order: 3,
        memoryEntity: "self",
        memoryField: "job",
        allowedSubagents: ["conexao_inicial", "descoberta"],
        primarySubagent: "conexao_inicial",
      },
    ],
  },
  {
    id: "stage_2_descoberta",
    name: "Descoberta",
    order: 1,
    color: "#10b981",
    description: "Conhecer organicamente quem o pretendente é no cotidiano, sua rotina, trabalho, gostos e contexto pessoal.",
    createdAt: "2026-09-20T00:00:00.000Z",
    updatedAt: "2026-09-20T00:00:00.000Z",
    goals: [
      {
        id: "goal_age",
        stageId: "stage_2_descoberta",
        title: "Idade",
        label: "Idade",
        description: "Descobrir a idade ou faixa etária",
        kind: "fact",
        required: false,
        enabled: true,
        order: 1,
        memoryEntity: "self",
        memoryField: "age",
        allowedSubagents: ["descoberta"],
        primarySubagent: "descoberta",
      },
      {
        id: "goal_routine",
        stageId: "stage_2_descoberta",
        title: "Rotina",
        label: "Rotina",
        description: "Conhecer alguma informação útil sobre como é o cotidiano dele (horário de trabalho, dia/noite, rotina corrida/tranquila, estudos, academia)",
        kind: "fact",
        required: false,
        enabled: true,
        order: 2,
        memoryEntity: "self",
        memoryField: "routine",
        allowedSubagents: ["descoberta"],
        primarySubagent: "descoberta",
      },
      {
        id: "goal_hobbies",
        stageId: "stage_2_descoberta",
        title: "Hobbies e interesses",
        label: "Hobbies e interesses",
        description: "Conhecer pelo menos um gosto, hobby ou atividade que ele realmente curta",
        kind: "fact",
        required: false,
        enabled: true,
        order: 3,
        memoryEntity: "self",
        memoryField: "hobbies",
        allowedSubagents: ["descoberta"],
        primarySubagent: "descoberta",
      },
      {
        id: "goal_social_style",
        stageId: "stage_2_descoberta",
        title: "Estilo de lazer / rolê",
        label: "Estilo de lazer / rolê",
        description: "Entender de forma natural que tipo de programa costuma gostar (caseiro, restaurante, bar, festa, viagem, natureza, passeios)",
        kind: "fact",
        required: false,
        enabled: true,
        order: 4,
        memoryEntity: "self",
        memoryField: "social_style",
        allowedSubagents: ["descoberta", "compatibilidade"],
        primarySubagent: "descoberta",
      },
      {
        id: "goal_discovery_depth",
        stageId: "stage_2_descoberta",
        title: "Contexto suficiente de descoberta",
        label: "Contexto suficiente de descoberta",
        description: "Reconhecer que já existe contexto pessoal suficiente (pelo menos 2 fatos duráveis de categorias distintas ou revelação mais rica acompanhada de reciprocidade) para avançar naturalmente para compatibilidade.",
        kind: "conversation_state",
        required: true,
        enabled: true,
        order: 5,
        allowedSubagents: ["descoberta"],
        primarySubagent: "descoberta",
      },
    ],
  },
  {
    id: "stage_3_compatibilidade",
    name: "Compatibilidade",
    order: 2,
    color: "#8b5cf6",
    description: "Entender valores, momento de vida, visão de relacionamento, família, planos e compatibilidade somente quando houver abertura natural.",
    createdAt: "2026-09-20T00:00:00.000Z",
    updatedAt: "2026-09-20T00:00:00.000Z",
    goals: [
      {
        id: "goal_relationship",
        stageId: "stage_3_compatibilidade",
        title: "Status de relacionamento",
        label: "Status de relacionamento",
        description: "Descobrir o status atual de relacionamento dele (solteiro, separado, divorciado, etc.). Não usar para filhos nem intenção.",
        kind: "fact",
        required: false,
        enabled: true,
        order: 1,
        memoryEntity: "self",
        memoryField: "relationship_status",
        allowedSubagents: ["compatibilidade"],
        primarySubagent: "compatibilidade",
      },
      {
        id: "goal_relationship_intent",
        stageId: "stage_3_compatibilidade",
        title: "O que procura atualmente",
        label: "O que procura atualmente",
        description: "Entender a intenção atual dele em relação a conhecer alguém (algo sério, conhecer sem pressa, relacionamento, não sabe ainda)",
        kind: "fact",
        required: false,
        enabled: true,
        order: 2,
        memoryEntity: "self",
        memoryField: "relationship_intent",
        allowedSubagents: ["compatibilidade"],
        primarySubagent: "compatibilidade",
      },
      {
        id: "goal_has_children",
        stageId: "stage_3_compatibilidade",
        title: "Tem filhos",
        label: "Tem filhos",
        description: "Registrar se ele possui ou não filhos (fato presente). Não misturar com desejo futuro de filhos.",
        kind: "fact",
        required: false,
        enabled: true,
        order: 3,
        memoryEntity: "self",
        memoryField: "has_children",
        allowedSubagents: ["compatibilidade"],
        primarySubagent: "compatibilidade",
      },
      {
        id: "goal_wants_children",
        stageId: "stage_3_compatibilidade",
        title: "Quer ter filhos",
        label: "Quer ter filhos",
        description: "Registrar a visão dele sobre ter filhos no futuro. Só concluir com evidência clara. Não inferir de ter filhos.",
        kind: "fact",
        required: false,
        enabled: true,
        order: 4,
        memoryEntity: "self",
        memoryField: "wants_children",
        allowedSubagents: ["compatibilidade"],
        primarySubagent: "compatibilidade",
      },
      {
        id: "goal_family_values",
        stageId: "stage_3_compatibilidade",
        title: "Família e valores",
        label: "Família e valores",
        description: "Conhecer algum aspecto relevante sobre como ele enxerga família, vínculo, respeito, estabilidade ou relações pessoais",
        kind: "fact",
        required: false,
        enabled: true,
        order: 5,
        memoryEntity: "self",
        memoryField: "family_values",
        allowedSubagents: ["compatibilidade"],
        primarySubagent: "compatibilidade",
      },
      {
        id: "goal_future_plans",
        stageId: "stage_3_compatibilidade",
        title: "Planos futuros",
        label: "Planos futuros",
        description: "Conhecer algum plano relevante de médio/longo prazo (carreira, moradia, viagens, família, projetos pessoais)",
        kind: "fact",
        required: false,
        enabled: true,
        order: 6,
        memoryEntity: "self",
        memoryField: "future_plans",
        allowedSubagents: ["compatibilidade"],
        primarySubagent: "compatibilidade",
      },
      {
        id: "goal_faith_values",
        stageId: "stage_3_compatibilidade",
        title: "Fé / espiritualidade",
        label: "Fé / espiritualidade",
        description: "Conhecer esse aspecto SOMENTE quando surgir naturalmente. Nunca forçar pergunta religiosa.",
        kind: "fact",
        required: false,
        enabled: true,
        order: 7,
        memoryEntity: "self",
        memoryField: "faith_values",
        allowedSubagents: ["compatibilidade"],
        primarySubagent: "compatibilidade",
      },
    ],
  },
];
