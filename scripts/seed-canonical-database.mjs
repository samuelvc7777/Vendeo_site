import { createClient } from '@supabase/supabase-js';
import fs from 'node:fs';

const envContent = fs.readFileSync('.env.local', 'utf8');
const env = {};
for (const line of envContent.split('\n')) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith('#')) continue;
  const eq = trimmed.indexOf('=');
  if (eq > 0) env[trimmed.slice(0, eq).trim()] = trimmed.slice(eq + 1).trim();
}

const supabaseUrl = env.NEXT_PUBLIC_SUPABASE_URL || 'https://wsdualhvopidgqcumonr.supabase.co';
const supabaseKey = env.SUPABASE_SERVICE_ROLE_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

// Cliente para pdhtgzwfbqygflzbwdkt também se necessário
const client2 = createClient('https://pdhtgzwfbqygflzbwdkt.supabase.co', supabaseKey);

const CANONICAL_SUBAGENTS = [
  {
    id: "conexao_inicial",
    name: "Conexão inicial",
    mission: "Construir conforto, rapport e conexão recíproca através de conversa leve, empática e acolhedora, sem parecer interrogatório policial.",
    enabled: true,
    is_system: true,
    description: "Subagente especialista em primeiros contatos, quebra de gelo e reciprocidade mútua.",
    stage_ids: ["stage_1_conexao"],
  },
  {
    id: "descoberta",
    name: "Descoberta",
    mission: "Descobrir o perfil, rotina, gostos e estilo de vida do pretendente de maneira natural, compartilhando detalhes da vida da Larissa e incentivando abertura mútua.",
    enabled: true,
    is_system: true,
    description: "Subagente focado em aprofundamento mútuo e assimilação de fatos da vida do pretendente.",
    stage_ids: ["stage_2_descoberta"],
  },
  {
    id: "compatibilidade",
    name: "Compatibilidade",
    mission: "Alinhar expectativas de futuro, valores, visão de relacionamento e planos de vida com carinho e maturidade emocional.",
    enabled: true,
    is_system: true,
    description: "Subagente especialista na fase de alinhamento afetivo e conexão profunda.",
    stage_ids: ["stage_3_compatibilidade"],
  },
];

const CANONICAL_STAGES = [
  {
    id: "stage_1_conexao",
    name: "Conexão Inicial",
    stage_order: 0,
    color: "#3b82f6",
    icon: "message-circle",
    description: "Criar conforto, reciprocidade e um começo natural de conversa sem entrevista.",
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
        description: "Descobrir ou confirmar a cidade/região onde o pretendente mora ou está no momento.",
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
        id: "goal_audio_exchange",
        stageId: "stage_1_conexao",
        title: "Troca de áudios",
        label: "Troca de áudios",
        description: "Estimular o envio ou troca espontânea de mensagens de voz/áudio para humanizar a relação.",
        kind: "conversation_state",
        required: false,
        enabled: true,
        order: 3,
        allowedSubagents: ["conexao_inicial"],
        primarySubagent: "conexao_inicial",
      },
    ],
  },
  {
    id: "stage_2_descoberta",
    name: "Descoberta",
    stage_order: 1,
    color: "#10b981",
    icon: "compass",
    description: "Aprofundar interesses mútuos, rotina, trabalho e estilo de vida com trocas ricas.",
    goals: [
      {
        id: "goal_discovery_depth",
        stageId: "stage_2_descoberta",
        title: "Profundidade de descoberta",
        label: "Profundidade de descoberta",
        description: "Validar que a conversa desenvolveu pelo menos um assunto substantivo sobre rotina, gostos, trabalho ou histórias pessoais.",
        kind: "conversation_state",
        required: true,
        enabled: true,
        order: 1,
        allowedSubagents: ["descoberta"],
        primarySubagent: "descoberta",
      },
      {
        id: "goal_age",
        stageId: "stage_2_descoberta",
        title: "Idade",
        label: "Idade",
        description: "Descobrir a idade aproximada ou exata do pretendente.",
        kind: "fact",
        required: false,
        enabled: true,
        order: 2,
        memoryEntity: "self",
        memoryField: "age",
        allowedSubagents: ["descoberta"],
        primarySubagent: "descoberta",
      },
      {
        id: "goal_work",
        stageId: "stage_2_descoberta",
        title: "Trabalho / Profissão",
        label: "Trabalho / Profissão",
        description: "Compreender no que ele trabalha ou a que se dedica no dia a dia.",
        kind: "fact",
        required: false,
        enabled: true,
        order: 3,
        memoryEntity: "self",
        memoryField: "occupation",
        allowedSubagents: ["descoberta"],
        primarySubagent: "descoberta",
      },
      {
        id: "goal_hobbies",
        stageId: "stage_2_descoberta",
        title: "Gostos e Hobbies",
        label: "Gostos e Hobbies",
        description: "Mapear o que ele curte fazer nas horas vagas (música, esportes, passeios, etc.).",
        kind: "fact",
        required: false,
        enabled: true,
        order: 4,
        memoryEntity: "self",
        memoryField: "hobbies",
        allowedSubagents: ["descoberta"],
        primarySubagent: "descoberta",
      },
      {
        id: "goal_humor",
        stageId: "stage_2_descoberta",
        title: "Sintonia de humor",
        label: "Sintonia de humor",
        description: "Constatar brincadeiras, risadas leves e quebra de rigidez formal.",
        kind: "conversation_state",
        required: false,
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
    stage_order: 2,
    color: "#f59e0b",
    icon: "heart",
    description: "Alinhamento de valores, visão de futuro, planos e intenções com maturidade.",
    goals: [
      {
        id: "goal_relationship",
        stageId: "stage_3_compatibilidade",
        title: "Status de Relacionamento",
        label: "Status de Relacionamento",
        description: "Conhecer exclusivamente se ele é solteiro, divorciado ou o momento de vida amorosa.",
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
        id: "goal_children",
        stageId: "stage_3_compatibilidade",
        title: "Filhos (Tem ou quer ter)",
        label: "Filhos (Tem ou quer ter)",
        description: "Saber se tem filhos ou se tem vontade de ter filhos no futuro.",
        kind: "fact",
        required: false,
        enabled: true,
        order: 2,
        memoryEntity: "self",
        memoryField: "children",
        allowedSubagents: ["compatibilidade"],
        primarySubagent: "compatibilidade",
      },
      {
        id: "goal_values",
        stageId: "stage_3_compatibilidade",
        title: "Valores e Família",
        label: "Valores e Família",
        description: "Compartilhar visão sobre fé, Deus, família e princípios de vida.",
        kind: "fact",
        required: false,
        enabled: true,
        order: 3,
        memoryEntity: "self",
        memoryField: "values",
        allowedSubagents: ["compatibilidade"],
        primarySubagent: "compatibilidade",
      },
      {
        id: "goal_future_plans",
        stageId: "stage_3_compatibilidade",
        title: "Planos de futuro",
        label: "Planos de futuro",
        description: "Descobrir o que ele busca a médio/longo prazo e se há compatibilidade de caminhos.",
        kind: "fact",
        required: false,
        enabled: true,
        order: 4,
        memoryEntity: "self",
        memoryField: "future_plans",
        allowedSubagents: ["compatibilidade"],
        primarySubagent: "compatibilidade",
      },
    ],
  },
];

const CANONICAL_VAULT_FOLDERS = [
  { id: "folder_apresentacao", name: "Apresentação e Conexão", color: "#3b82f6", icon: "user" },
  { id: "folder_rotina", name: "Rotina e Enfermagem", color: "#10b981", icon: "activity" },
  { id: "folder_historias", name: "Histórias e Perrengues", color: "#f59e0b", icon: "book-open" },
  { id: "folder_afeto", name: "Carinho e Afeto", color: "#ec4899", icon: "heart" },
];

const CANONICAL_VAULT_AUDIOS = [
  {
    id: "aud_rotina_enfermagem",
    stage_id: "stage_2_descoberta",
    title: "Rotina e Faculdade de Enfermagem",
    audio_url: "https://wsdualhvopidgqcumonr.supabase.co/storage/v1/object/public/vendeo_vault/aud_rotina_enfermagem.mp3",
    duration: 25,
    transcript: "Menino, correria danada viu, tô no décimo período de enfermagem, fazendo estágio no hospital e preparando TCC... mas graças a Deus fazendo o que gosto né",
    usage_instruction: "Usar quando ele perguntar sobre a rotina da Larissa, faculdade ou trabalho.",
    enabled: true,
  },
  {
    id: "aud_apresentacao_sao_joao",
    stage_id: "stage_1_conexao",
    title: "Apresentação e São João del-Rei",
    audio_url: "https://wsdualhvopidgqcumonr.supabase.co/storage/v1/object/public/vendeo_vault/aud_apresentacao_sao_joao.mp3",
    duration: 20,
    transcript: "Oie, sou daqui de São João del-Rei mesmo, nascida e criada aqui nas Minas Gerais uai kkk, cidade tranquila demais da conta",
    usage_instruction: "Usar quando ele perguntar de onde a Larissa é ou pedir pra falar um pouco sobre ela.",
    enabled: true,
  },
  {
    id: "aud_musica_sertanejo",
    stage_id: "stage_2_descoberta",
    title: "Gosto Musical e Sertanejo",
    audio_url: "https://wsdualhvopidgqcumonr.supabase.co/storage/v1/object/public/vendeo_vault/aud_musica_sertanejo.mp3",
    duration: 18,
    transcript: "Ah eu gosto demais de um sertanejo antigo, modão de viola, um acústico... sou bem caseira pra essas coisas sabe",
    usage_instruction: "Usar quando o assunto for música, hobbies ou momentos de folga.",
    enabled: true,
  },
];

async function seed() {
  console.log("==================================================================");
  console.log("🌱 POVOANDO TABELAS DEDICADAS CANÔNICAS (ZERO PSEUDO-CONVERSAS)");
  console.log("==================================================================\n");

  for (const [name, client] of [["wsdualhvopidgqcumonr", supabase], ["pdhtgzwfbqygflzbwdkt", client2]]) {
    console.log(`--- Populando ${name} ---`);

    // 1. Subagentes
    const { error: subErr } = await client.from("subagent_definitions").upsert(CANONICAL_SUBAGENTS);
    if (subErr) console.error(`[${name}] Erro ao salvar subagentes:`, subErr.message);
    else console.log(`[${name}] ✔ 3 Subagentes canônicos salvos com sucesso.`);

    // 2. Etapas
    const { error: stgErr } = await client.from("chat_stages").upsert(CANONICAL_STAGES);
    if (stgErr) console.error(`[${name}] Erro ao salvar etapas:`, stgErr.message);
    else console.log(`[${name}] ✔ 3 Etapas canônicas com 12 objetivos salvas com sucesso.`);

    // 3. Pastas do Cofre
    const { error: fldErr } = await client.from("vault_folders").upsert(CANONICAL_VAULT_FOLDERS);
    if (fldErr) console.error(`[${name}] Erro ao salvar pastas do cofre:`, fldErr.message);
    else console.log(`[${name}] ✔ 4 Pastas de cofre salvas com sucesso.`);

    // 4. Áudios da Persona
    const { error: audErr } = await client.from("persona_audios").upsert(CANONICAL_VAULT_AUDIOS);
    if (audErr) console.error(`[${name}] Erro ao salvar áudios da persona:`, audErr.message);
    else console.log(`[${name}] ✔ 3 Áudios do cofre salvos com sucesso.`);

    // 5. Itens do Cofre sincronizados
    const vaultItems = CANONICAL_VAULT_AUDIOS.map(a => ({
      id: a.id,
      folder_id: a.id === "aud_apresentacao_sao_joao" ? "folder_apresentacao" : "folder_rotina",
      type: "audio",
      title: a.title,
      content: a.transcript,
      media_url: a.audio_url,
      duration: a.duration,
      created_at: new Date().toISOString(),
    }));
    const { error: itmErr } = await client.from("vault_items").upsert(vaultItems);
    if (itmErr) console.error(`[${name}] Erro ao salvar vault_items:`, itmErr.message);
    else console.log(`[${name}] ✔ 3 Itens do cofre (vault_items) salvos com sucesso.`);
  }

  console.log("\n✔ POVOAMENTO CANÔNICO CONCLUÍDO COM 100% DE SUCESSO!");
}

seed().catch(console.error);
