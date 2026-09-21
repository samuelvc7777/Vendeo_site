/**
 * supabase/functions/api/conversation_episodic_memory.ts
 * 
 * Módulo de Memória Episódica da Conversa (Conversation Episodic Memory).
 * 
 * Responsabilidades:
 * 1. Definir tipos e estruturas de eventos episódicos.
 * 2. Extrair representações semânticas compactas de atos de fala:
 *    - Larissa: perguntas feitas, revelações pessoais (self_disclosure), áudios enviados.
 *    - Pretendente: respostas, revelações de fatos (cidade, idade, profissão, etc.).
 * 3. ConversationEpisodeWriter: persistência assíncrona, idempotente e fail-safe no Supabase.
 * 4. searchConversationEpisodicMemory / conversation_search: busca semântica sob demanda com isolamento estrito por conversation_id.
 * 
 * Regras Invioláveis:
 * - NÃO substitui PersonaMemory (quem é Larissa) nem ContactMemory (fatos dele).
 * - Mensagens canceladas/preempitadas NUNCA viram episódios.
 * - Idempotente por (conversation_id, source_message_id, event_type).
 * - Erros no writer NUNCA quebram a conversa nem reenviam mensagens à Meta.
 */

export type EpisodeActor = "larissa" | "pretendente";

export type EpisodeMemoryClass = "landmark" | "speech_act";

export type EpisodeEventType =
  | "question"
  | "answer"
  | "statement"
  | "self_disclosure"
  | "fact_reveal"
  | "topic"
  | "audio_sent"
  | "reaction"
  | "plan"
  | "preference_reveal";

export interface ConversationEpisode {
  id?: string;
  conversation_id: string;
  actor: EpisodeActor;
  event_type: EpisodeEventType;
  topic?: string | null;
  summary: string;
  source_message_id?: string | null;
  source_message_ids?: string[] | null;
  original_text?: string | null;
  semantic_keys?: string[];
  created_at?: string;
  metadata?: Record<string, any>;
  episode_fingerprint?: string | null;
  memory_class?: EpisodeMemoryClass;
}

/**
 * Gera fingerprint determinístico único por evento sem alterar o source_message_id.
 * Permite que múltiplos fatos de uma mesma mensagem coexistam sem colisão no banco.
 */
export function generateEpisodeFingerprint(ep: {
  conversation_id: string;
  source_message_id?: string | null;
  actor: string;
  event_type: string;
  topic?: string | null;
  semantic_keys?: string[] | null;
}): string {
  const cId = (ep.conversation_id || "").trim();
  const mId = (ep.source_message_id || "no_msg").trim();
  const actor = (ep.actor || "").trim();
  const evt = (ep.event_type || "").trim();
  const topic = (ep.topic || "general").trim().toLowerCase();
  const sortedKeys = Array.isArray(ep.semantic_keys) ? [...ep.semantic_keys].sort().join(",") : "";
  return `${cId}::${mId}::${actor}::${evt}::${topic}::${sortedKeys}`;
}

export interface EpisodicSearchResult {
  actor: EpisodeActor;
  event_type: EpisodeEventType;
  topic: string | null;
  summary: string;
  content?: string;
  source_message_id?: string | null;
  original_text?: string | null;
  created_at: string;
  relevance: number;
  relevanceScore?: number;
}

function stripAccents(s: string): string {
  return (s || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

/**
 * Filtro de ruído trivial: palavras e mensagens sem valor semântico para episódio
 */
export function isTrivialChatter(text: string): boolean {
  const clean = stripAccents(text).replace(/[^\w\s]/gi, "").trim();
  if (clean.length < 2) return true;
  
  // Risadas puras
  if (/^(k{2,}|ha{2,}|he{2,}|rs{1,})$/i.test(clean)) return true;
  
  // Saudações ou confirmações monossilábicas isoladas
  const trivialTokens = new Set([
    "sim", "nao", "ok", "blz", "beleza", "ata", "ah sim", "entendi",
    "top", "show", "massa", "legal", "valeu", "flw", "tbm", "tb",
    "oi", "ola", "oie", "bom dia", "boa tarde", "boa noite",
    "kkk", "kkkk", "kkkkk", "uai", "eita", "credo", "nossa"
  ]);
  
  return trivialTokens.has(clean);
}

/**
 * Extrai episódios semânticos a partir de uma mensagem outbound confirmada da Larissa.
 */
export function extractEpisodesFromLarissaMessage(
  text: string,
  messageId?: string
): ConversationEpisode[] {
  const clean = (text || "").trim();
  if (!clean || isTrivialChatter(clean)) return [];

  const cleanNorm = stripAccents(clean);
  const episodes: ConversationEpisode[] = [];

  const isQuestion = clean.includes("?") || 
    /^(e\s+)?(vc|voce)\s+(trabalha|mora|faz|gosta|tem|estuda|ja|e\s+de)\b/i.test(cleanNorm) ||
    /\b(qual|onde|como|quando|quanto|quantos|por que|pq)\b/i.test(cleanNorm);

  // 1. Perguntas feitas pela Larissa ao pretendente
  if (isQuestion) {
    if (/\b(trabalh\w*|profiss\w*|ocupac\w*|faz da vida|trampo\w*|area de atuacao|empresa\w*)\b/i.test(cleanNorm)) {
      episodes.push({
        conversation_id: "",
        actor: "larissa",
        event_type: "question",
        topic: "work",
        summary: "Larissa perguntou qual é o trabalho ou ocupação do pretendente.",
        original_text: clean,
        source_message_id: messageId,
        semantic_keys: ["pretendente.work", "pretendente.profession"],
      });
    } else if (/\b(mor\w*|cidad\w*|onde c\b|onde vc\b|de onde|vive\w*|resid\w*|regia\w*|bairr\w*)\b/i.test(cleanNorm)) {
      episodes.push({
        conversation_id: "",
        actor: "larissa",
        event_type: "question",
        topic: "location",
        summary: "Larissa perguntou onde o pretendente mora ou de onde ele é.",
        original_text: clean,
        source_message_id: messageId,
        semantic_keys: ["pretendente.city", "pretendente.location"],
      });
    } else if (/\b(quantos anos|idade|qual sua idade)\b/i.test(cleanNorm)) {
      episodes.push({
        conversation_id: "",
        actor: "larissa",
        event_type: "question",
        topic: "age",
        summary: "Larissa perguntou a idade do pretendente.",
        original_text: clean,
        source_message_id: messageId,
        semantic_keys: ["pretendente.age"],
      });
    } else if (/\b(filh\w*|crianc\w*|tem filho)\b/i.test(cleanNorm)) {
      episodes.push({
        conversation_id: "",
        actor: "larissa",
        event_type: "question",
        topic: "children",
        summary: "Larissa perguntou se o pretendente tem filhos.",
        original_text: clean,
        source_message_id: messageId,
        semantic_keys: ["pretendente.children"],
      });
    } else if (/\b(solteir\w*|namor\w*|casad\w*|relacionament\w*)\b/i.test(cleanNorm)) {
      episodes.push({
        conversation_id: "",
        actor: "larissa",
        event_type: "question",
        topic: "relationship",
        summary: "Larissa perguntou sobre o status de relacionamento do pretendente.",
        original_text: clean,
        source_message_id: messageId,
        semantic_keys: ["pretendente.relationship_status"],
      });
    } else if (/\b(music\w*|sertanej\w*|cantor\w*|banda\w*|ouve\w*)\b/i.test(cleanNorm)) {
      episodes.push({
        conversation_id: "",
        actor: "larissa",
        event_type: "question",
        topic: "music",
        summary: "Larissa perguntou sobre o gosto musical do pretendente.",
        original_text: clean,
        source_message_id: messageId,
        semantic_keys: ["pretendente.music"],
      });
    } else if (/\b(prai\w*|mar\b|litoral|viaj\w*|viag\w*)\b/i.test(cleanNorm)) {
      episodes.push({
        conversation_id: "",
        actor: "larissa",
        event_type: "question",
        topic: "travel",
        summary: "Larissa perguntou se o pretendente gosta de praia ou viagens.",
        original_text: clean,
        source_message_id: messageId,
        semantic_keys: ["pretendente.travel", "pretendente.beach"],
      });
    } else if (/\b(academi\w*|trein\w*|esport\w*|exercici\w*|malh\w*)\b/i.test(cleanNorm)) {
      episodes.push({
        conversation_id: "",
        actor: "larissa",
        event_type: "question",
        topic: "sports",
        summary: "Larissa perguntou se o pretendente faz academia ou esportes.",
        original_text: clean,
        source_message_id: messageId,
        semantic_keys: ["pretendente.sports", "pretendente.fitness"],
      });
    } else {
      episodes.push({
        conversation_id: "",
        actor: "larissa",
        event_type: "question",
        topic: "general",
        summary: `Larissa fez uma pergunta ao pretendente: "${clean}".`,
        original_text: clean,
        source_message_id: messageId,
        semantic_keys: ["conversation.question"],
      });
    }
  }

  // 2. Autorevelações da Larissa (Self-disclosure)
  if (/\b(enfermagem|decimo periodo|10o periodo|estagio no hospital|santa casa|hospital)\b/i.test(cleanNorm)) {
    episodes.push({
      conversation_id: "",
      actor: "larissa",
      event_type: "self_disclosure",
      topic: "education",
      summary: "Larissa contou que cursa Enfermagem e está em fase de estágio hospitalar.",
      original_text: clean,
      source_message_id: messageId,
      semantic_keys: ["larissa.education.course", "larissa.education.current_period", "larissa.education.internship"],
    });
  }

  if (/\b(sao joao del[- ]rei|sjdr|matosinhos)\b/i.test(cleanNorm)) {
    episodes.push({
      conversation_id: "",
      actor: "larissa",
      event_type: "self_disclosure",
      topic: "location",
      summary: "Larissa contou que mora em São João del-Rei.",
      original_text: clean,
      source_message_id: messageId,
      semantic_keys: ["larissa.identity.city", "larissa.address.city"],
    });
  }

  if (/\b(vendas online|trabalho em casa|vendo roupa|minha loja|clientes)\b/i.test(cleanNorm) && !isQuestion) {
    episodes.push({
      conversation_id: "",
      actor: "larissa",
      event_type: "self_disclosure",
      topic: "work",
      summary: "Larissa contou que trabalha em casa com vendas online.",
      original_text: clean,
      source_message_id: messageId,
      semantic_keys: ["larissa.work.digital_sales"],
    });
  }

  if (/\b(23 anos|tenho 23)\b/i.test(cleanNorm)) {
    episodes.push({
      conversation_id: "",
      actor: "larissa",
      event_type: "self_disclosure",
      topic: "age",
      summary: "Larissa contou que tem 23 anos.",
      original_text: clean,
      source_message_id: messageId,
      semantic_keys: ["larissa.identity.age"],
    });
  }

  if (/\b(odeio cafe|nao tomo cafe|cafe puro)\b/i.test(cleanNorm)) {
    episodes.push({
      conversation_id: "",
      actor: "larissa",
      event_type: "self_disclosure",
      topic: "routine",
      summary: "Larissa revelou que odeia café preto puro e toma leite com pão.",
      original_text: clean,
      source_message_id: messageId,
      semantic_keys: ["larissa.drinks.likes_coffee"],
    });
  }

  if (/\b(bife com batata|strogonoff)\b/i.test(cleanNorm)) {
    episodes.push({
      conversation_id: "",
      actor: "larissa",
      event_type: "self_disclosure",
      topic: "food",
      summary: "Larissa revelou que sua comida favorita é bife com batata frita e strogonoff.",
      original_text: clean,
      source_message_id: messageId,
      semantic_keys: ["larissa.food.favorite_food"],
    });
  }

  if (/\b(filme de terror|bruxa de blair)\b/i.test(cleanNorm)) {
    episodes.push({
      conversation_id: "",
      actor: "larissa",
      event_type: "self_disclosure",
      topic: "movies",
      summary: "Larissa contou que gosta de filmes de terror e suspense psicológico.",
      original_text: clean,
      source_message_id: messageId,
      semantic_keys: ["larissa.movies.likes_horror"],
    });
  }

  if (/\b(amo praia|gosto de praia|sao miguel dos milagres)\b/i.test(cleanNorm) && !isQuestion) {
    episodes.push({
      conversation_id: "",
      actor: "larissa",
      event_type: "self_disclosure",
      topic: "travel",
      summary: "Larissa contou que ama viajar para praias tranquilas.",
      original_text: clean,
      source_message_id: messageId,
      semantic_keys: ["larissa.travel.loves_beach"],
    });
  }

  for (const ep of episodes) {
    if (ep.event_type === "self_disclosure") {
      ep.memory_class = "landmark";
      ep.metadata = { ...(ep.metadata || {}), memory_class: "landmark", importance: 0.85 };
    } else {
      ep.memory_class = "speech_act";
      ep.metadata = { ...(ep.metadata || {}), memory_class: "speech_act", importance: 0.5 };
    }
  }

  return episodes;
}

/**
 * Extrai episódios semânticos a partir de uma mensagem inbound do pretendente.
 */
export function extractEpisodesFromPretendenteMessage(
  text: string,
  messageId?: string
): ConversationEpisode[] {
  const clean = (text || "").trim();
  if (!clean || isTrivialChatter(clean)) return [];

  const cleanNorm = stripAccents(clean);
  const episodes: ConversationEpisode[] = [];

  // 1. Fatos sobre Esportes / Hobbies / Atividades Físicas
  const sportsMatch = clean.match(
    /\b(?:sou\s+)?(corredor(?:\s+amador|\s+de\s+rua)?|ciclista|atleta(?:\s+amador)?|maratonista|pratico\s+\w+|faço\s+corrida|faço\s+academia|faço\s+musculacao|treino\s+crossfit|treino\s+musculacao|jogo\s+futebol|jogo\s+bola)\b/i
  );
  if (sportsMatch || /\b(corredor amador|pratico corrida|treino corrida)\b/i.test(cleanNorm)) {
    const sportName = sportsMatch ? sportsMatch[1].trim() : "corrida amadora";
    episodes.push({
      conversation_id: "",
      actor: "pretendente",
      event_type: "fact_reveal",
      topic: "sports",
      summary: `O pretendente contou que pratica esportes/é ${sportName}.`,
      original_text: clean,
      source_message_id: messageId,
      semantic_keys: ["pretendente.sports", "pretendente.fitness"],
    });
  }

  // 2. Fatos sobre Trabalho / Profissão
  // Exclui expressamente termos de esportes, estado civil, preposição de cidades ("de ...") e trivialidades
  const isExcludedFromJob = (term: string) => {
    const tNorm = stripAccents(term).toLowerCase().trim();
    return (
      /^(de\s+|aqui|ali|la|muito|pouco|bem|mal|assim|de|do|da|solteir\w*|casad\w*|divorciad\w*|calm\w*|tranquil\w*|gente boa|timid\w*|romantico\w*)/i.test(tNorm) ||
      /\b(corredor|atleta|ciclista|jogador|esportista)\b/i.test(tNorm)
    );
  };

  let jobCaptured: string | null = null;

  // A. Padrão direto: "trabalho como/com/na área de..."
  const profMatch = clean.match(
    /(?:trabalho como|trabalho com|trabalho na [aá]rea de|trabalho de|trabalho no|trabalho na|atuo como|atuo com)\s+([a-zA-ZáàâãéèêíïóôõöúçñÁÀÂÃÉÈÊÍÏÓÔÕÖÚÇÑ0-9\s\/\-]{2,60})(?=[,\.!\?]|(?:\s+e\s+(?:sou|voc[eê]|vc)\b)|\s*$)/i
  );
  if (profMatch) {
    let candidate = profMatch[1].trim();
    candidate = candidate.replace(/\s+(?:em\s+home\s+office|home\s+office|remoto|presencial).*$/i, "").trim();
    if (!isExcludedFromJob(candidate)) {
      jobCaptured = candidate;
    }
  }

  // B. Padrão declarativo: "sou designer", "sou engenheiro", "sou motorista"
  if (!jobCaptured) {
    const souMatch = clean.match(
      /(?:^|[,\.!\?]\s*|\be\s+)(?:eu\s+)?sou\s+(?:um\s+|uma\s+)?([a-zA-ZáàâãéèêíïóôõöúçñÁÀÂÃÉÈÊÍÏÓÔÕÖÚÇÑ0-9\s\/\-]{2,50}?)(?=[,\.!\?]|(?:\s+e\s+(?:sou|voc[eê]|vc)\b)|\s*$)/i
    );
    if (souMatch) {
      const candidate = souMatch[1].trim();
      if (!isExcludedFromJob(candidate)) {
        if (
          /\b(desenvolvedor|programador|engenheiro|designer|m[eé]dico|advogado|professor|aut[oô]nomo|empres[aá]rio|dentista|enfermeiro|ti|software|desenvolvimento|analista|consultor|vendedor|motorista|arquiteto|banc[aá]rio|policial|bombeiro|veterin[aá]rio|contador|psic[oó]logo|fisioterapeuta|administrador|t[eé]cnico|minerador|mineracao|operador|mecanico|eletricista|pedreiro|cozinheiro|barbeiro|cabeleireiro)\b/i.test(candidate)
        ) {
          jobCaptured = candidate;
        }
      }
    }
  }

  // C. Fallback para palavras-chave de profissões expressas
  if (!jobCaptured && /\b(desenvolvedor|programador|engenheiro|designer|m[eé]dico|advogado|professor|aut[oô]nomo|empres[aá]rio|dentista|enfermeiro|ti|software|desenvolvimento|analista|consultor|motorista|arquiteto|banc[aá]rio|contador|minerador|mineracao)\b/i.test(cleanNorm)) {
    const jobTermMatch = clean.match(/\b(desenvolvimento\s+de\s+software|desenvolvedor(?:\s+de\s+software|\s+web)?|programador|engenheiro(?:\s+civil|\s+de\s+software|\s+mecânico)?|designer(?:\s+gráfico)?|médico|advogado|professor|autônomo|empresário|dentista|enfermeiro|motorista|arquiteto|contador|minerador|mineração)\b/i);
    if (jobTermMatch) {
      jobCaptured = jobTermMatch[1].trim();
    }
  }

  if (jobCaptured) {
    episodes.push({
      conversation_id: "",
      actor: "pretendente",
      event_type: "fact_reveal",
      topic: "work",
      summary: `O pretendente contou que trabalha com ${jobCaptured}.`,
      original_text: clean,
      source_message_id: messageId,
      semantic_keys: ["pretendente.work", "pretendente.profession"],
    });
  }

  // 2. Fatos sobre Cidade / Residência
  const cityMatch = clean.match(
    /(?:moro em|sou de|vivo em|resido em|fico em|estou em|aqui em)\s+([a-zA-ZáàâãéèêíïóôõöúçñÁÀÂÃÉÈÊÍÏÓÔÕÖÚÇÑ\s]{2,60}?)(?=(?:\s+e\s+(?:voc[eê]|vc)\b|[,\.!\?]|(?:\s+mas\b)|\s*$))/i
  );
  if (cityMatch) {
    const city = cityMatch[1].trim();
    if (!/^(um|uma|aqui|ali|casa|apartamento|hotel)$/i.test(city)) {
      episodes.push({
        conversation_id: "",
        actor: "pretendente",
        event_type: "fact_reveal",
        topic: "location",
        summary: `O pretendente respondeu que mora em ${city}.`,
        original_text: clean,
        source_message_id: messageId,
        semantic_keys: ["pretendente.city", "pretendente.location"],
      });
    }
  }

  // 3. Fatos sobre Idade
  const ageMatch = clean.match(/(?:(?:eu\s+)?tenho|complet(?:ei|ando)|faço|fiz|estou com|tô com|minha idade [eé])\s+(\d{1,2})\s*(?:anos)?/i);
  if (ageMatch) {
    const ageVal = parseInt(ageMatch[1], 10);
    if (!isNaN(ageVal) && ageVal >= 16 && ageVal <= 110) {
      episodes.push({
        conversation_id: "",
        actor: "pretendente",
        event_type: "fact_reveal",
        topic: "age",
        summary: `O pretendente contou que tem ${ageVal} anos.`,
        original_text: clean,
        source_message_id: messageId,
        semantic_keys: ["pretendente.age"],
      });
    }
  }

  // 4. Filhos
  if (/\b(nao tenho filhos?|tenho (\d+) filhos?|tenho um filho|tenho uma filha)\b/i.test(cleanNorm)) {
    const hasNone = /\bnao tenho filhos?\b/i.test(cleanNorm);
    episodes.push({
      conversation_id: "",
      actor: "pretendente",
      event_type: "fact_reveal",
      topic: "children",
      summary: hasNone ? "O pretendente contou que não tem filhos." : "O pretendente contou que tem filhos.",
      original_text: clean,
      source_message_id: messageId,
      semantic_keys: ["pretendente.children"],
    });
  }

  // 5. Veículos, Bens e Detalhes Marcantes (ex: carro, moto, fusca, amarok)
  if (/\b(carro|ve[ií]culo|moto|motocicleta|fusca|amarok|caminhonete|gol|civic|corolla)\b/i.test(cleanNorm)) {
    episodes.push({
      conversation_id: "",
      actor: "pretendente",
      event_type: "fact_reveal",
      topic: "vehicle",
      summary: `O pretendente revelou detalhe sobre veículo/carro: "${clean}".`,
      original_text: clean,
      source_message_id: messageId,
      semantic_keys: ["pretendente.vehicle", "pretendente.property"],
    });
  }

  // 6. Família e Histórias Pessoais (pai, mãe, irmão, família)
  if (/\b(pai|m[aã]e|irm[aã]o?|fam[ií]lia|pais)\b/i.test(cleanNorm)) {
    episodes.push({
      conversation_id: "",
      actor: "pretendente",
      event_type: "fact_reveal",
      topic: "family",
      summary: `O pretendente compartilhou menção familiar: "${clean}".`,
      original_text: clean,
      source_message_id: messageId,
      semantic_keys: ["pretendente.family"],
    });
  }

  // 7. Perguntas feitas pelo pretendente à Larissa
  if (clean.includes("?")) {
    episodes.push({
      conversation_id: "",
      actor: "pretendente",
      event_type: "question",
      topic: "inquiry",
      summary: `O pretendente perguntou à Larissa: "${clean}".`,
      original_text: clean,
      source_message_id: messageId,
      semantic_keys: ["pretendente.question"],
    });
  }

  for (const ep of episodes) {
    if (ep.event_type === "fact_reveal") {
      const narrativeEvidence = /\b(?:quando eu|foi (?:especial|inesquecível|marcante)|nunca vou esquecer|por causa (?:dele|dela|disso)|me ensinou|quase |primeir[oa]|perrengue|história|lembro até hoje)\b/i.test(clean)
        && clean.split(/\s+/).length >= 10;
      ep.memory_class = narrativeEvidence ? "landmark" : "speech_act";
      ep.metadata = {
        ...(ep.metadata || {}),
        memory_class: ep.memory_class,
        importance: narrativeEvidence ? 0.9 : 0.5,
      };
    } else {
      ep.memory_class = "speech_act";
      ep.metadata = { ...(ep.metadata || {}), memory_class: "speech_act", importance: 0.5 };
    }
  }

  return episodes;
}

/**
 * Cria evento episódico para entrega confirmada de áudio do Cofre.
 * Enriquece com identificação semântica do tema real a partir do transcript e metadados.
 */
export function createAudioDeliveredEpisode(params: {
  conversationId: string;
  audioId: string;
  transcript?: string | null;
  theme?: string | null;
  providerMessageId?: string | null;
}): ConversationEpisode {
  const tr = (params.transcript || "").trim();
  const trNorm = stripAccents(tr);
  const audioIdLower = (params.audioId || "").toLowerCase();
  const rawTheme = (params.theme || "").toLowerCase().trim();

  // Inferência semântica de tema e tópico
  let topic = "audio";
  let detectedTheme = rawTheme || "audio";

  if (
    rawTheme.includes("faculdade") ||
    rawTheme.includes("curso") ||
    rawTheme.includes("enfermagem") ||
    rawTheme.includes("educacao") ||
    audioIdLower.includes("faculdade") ||
    audioIdLower.includes("curso") ||
    audioIdLower.includes("enfermagem") ||
    /\b(faculdade|curso|enfermagem|estagio|hospital|periodo)\b/i.test(trNorm)
  ) {
    topic = "education";
    detectedTheme = "faculdade e enfermagem";
  } else if (
    rawTheme.includes("rifa") ||
    audioIdLower.includes("rifa") ||
    /\b(rifa|sorteio|bilhete|premio)\b/i.test(trNorm)
  ) {
    topic = "raffle";
    detectedTheme = "rifa";
  } else if (
    rawTheme.includes("rotina") ||
    audioIdLower.includes("rotina") ||
    /\b(rotina|acordar|dia a dia|correria)\b/i.test(trNorm)
  ) {
    topic = "routine";
    detectedTheme = "rotina";
  } else if (
    rawTheme.includes("filho") ||
    /\b(filhos?|crianca)\b/i.test(trNorm)
  ) {
    topic = "children";
    detectedTheme = "filhos";
  } else if (rawTheme) {
    topic = rawTheme;
  }

  const summarySnippet = tr.slice(0, 160);
  const summary = summarySnippet
    ? `Larissa enviou um áudio gravado falando sobre ${detectedTheme}: "${summarySnippet}..."`
    : `Larissa enviou um áudio gravado do Cofre sobre ${detectedTheme}.`;

  const semanticKeys = [
    "larissa.audio_sent",
    `larissa.audio.${params.audioId}`,
    `audio.topic.${topic}`,
  ];
  if (topic === "education") {
    semanticKeys.push("larissa.education", "larissa.course", "larissa.nursing");
  } else if (topic === "raffle") {
    semanticKeys.push("larissa.raffle");
  } else if (topic === "routine") {
    semanticKeys.push("larissa.routine");
  } else if (topic === "children") {
    semanticKeys.push("larissa.children");
  }

  return {
    conversation_id: params.conversationId,
    actor: "larissa",
    event_type: "audio_sent",
    topic,
    summary,
    original_text: params.transcript || null,
    source_message_id: params.providerMessageId || null,
    semantic_keys: semanticKeys,
    memory_class: "landmark",
    metadata: {
      audio_id: params.audioId,
      theme: detectedTheme,
      transcript_used: Boolean(params.transcript),
      memory_class: "landmark",
      importance: 0.85,
    },
  };
}

/**
 * Persiste episódios no Supabase de forma idempotente e segura via episode_fingerprint.
 * PRESERVA rigorosamente o source_message_id original intacto, sem qualquer adulteração.
 */
export async function saveConversationEpisodes(params: {
  supabase: any;
  conversationId: string;
  episodes: ConversationEpisode[];
}): Promise<{ saved: number; skipped: number }> {
  const { supabase, conversationId, episodes } = params;
  if (!supabase || !conversationId || !episodes || episodes.length === 0) {
    return { saved: 0, skipped: 0 };
  }

  const payloads = episodes.map((ep) => {
    const fingerprint =
      ep.episode_fingerprint ||
      generateEpisodeFingerprint({
        conversation_id: conversationId,
        source_message_id: ep.source_message_id,
        actor: ep.actor,
        event_type: ep.event_type,
        topic: ep.topic,
        semantic_keys: ep.semantic_keys,
      });

    return {
      conversation_id: conversationId,
      actor: ep.actor,
      event_type: ep.event_type,
      topic: ep.topic || null,
      summary: ep.summary,
      source_message_id: ep.source_message_id || null,
      source_message_ids: ep.source_message_ids || null,
      original_text: ep.original_text || null,
      semantic_keys: ep.semantic_keys || [],
      metadata: {
        ...(ep.metadata || {}),
        memory_class:
          ep.memory_class ||
          ep.metadata?.memory_class ||
          (ep.event_type === "audio_sent" ? "landmark" : "speech_act"),
      },
      created_at: ep.created_at || new Date().toISOString(),
      episode_fingerprint: fingerprint,
    };
  });

  try {
    const { data, error } = await supabase
      .from("conversation_episodic_memory")
      .upsert(payloads, {
        onConflict: "conversation_id,episode_fingerprint",
        ignoreDuplicates: true,
      })
      .select("id");

    if (error) {
      console.warn("[EpisodicMemory] Erro ao gravar episódios (fail-safe):", error.message);
      return { saved: 0, skipped: payloads.length };
    }

    const saved = Array.isArray(data) ? data.length : payloads.length;
    return { saved, skipped: Math.max(0, payloads.length - saved) };
  } catch (err: any) {
    console.warn("[EpisodicMemory] Exceção fail-safe no salvamento de episódios:", err.message || String(err));
    return { saved: 0, skipped: payloads.length };
  }
}

/**
 * ConversationEpisodeWriter:
 * Executado assincronamente pós-despacho de balões quando o ciclo for confirmado com sucesso (SENT).
 * NUNCA interrompe a comunicação, nunca retenta Meta nem aciona fallback.
 */
export async function executeEpisodeWriter(params: {
  conversationId: string;
  claimedMessages: Array<{ id: string; text?: string; sender?: string; direction?: string }>;
  sentBalloons?: string[];
  sentMessageIds?: string[];
  audioPayload?: { id: string; theme?: string; transcript?: string } | null;
  supabase: any;
  trace: string[];
}): Promise<{ episodesCreated: number; trace: string[] }> {
  const { conversationId, claimedMessages, sentBalloons = [], sentMessageIds = [], audioPayload, supabase, trace } = params;
  trace.push("episode_writer_started");
  let episodesCount = 0;

  try {
    const episodesToSave: ConversationEpisode[] = [];

    // 1. Extrai episódios das mensagens outbound confirmadas da Larissa
    for (let i = 0; i < sentBalloons.length; i++) {
      const bText = sentBalloons[i];
      const mId = sentMessageIds[i] || `out_${Date.now()}_${i}`;
      const larissaEps = extractEpisodesFromLarissaMessage(bText, mId);
      for (const ep of larissaEps) {
        ep.conversation_id = conversationId;
        episodesToSave.push(ep);
      }
    }

    // 2. Se áudio confirmado entregue, registra o episódio do áudio
    if (audioPayload && audioPayload.id) {
      const audioEp = createAudioDeliveredEpisode({
        conversationId,
        audioId: audioPayload.id,
        transcript: audioPayload.transcript,
        theme: audioPayload.theme,
        providerMessageId: sentMessageIds[0] || null,
      });
      episodesToSave.push(audioEp);
    }

    // 3. Extrai episódios das mensagens inbound do pretendente
    for (const msg of claimedMessages) {
      if (msg.sender !== "pretendente" && msg.direction !== "inbound") continue;
      const text = (msg.text || "").trim();
      if (!text || text.length < 3) continue;

      const pretEps = extractEpisodesFromPretendenteMessage(text, msg.id);
      for (const ep of pretEps) {
        ep.conversation_id = conversationId;
        episodesToSave.push(ep);
      }
    }

    if (episodesToSave.length > 0) {
      const { saved } = await saveConversationEpisodes({
        supabase,
        conversationId,
        episodes: episodesToSave,
      });
      episodesCount = saved;
      trace.push(`episodes_saved_count: ${saved}`);
    } else {
      trace.push("no_episodes_to_save");
    }
  } catch (err: any) {
    trace.push(`episode_writer_error: ${err.message || String(err)}`);
    console.warn("[EpisodicMemory] Falha no episode writer (isolada):", err.message || err);
  }

  trace.push("episode_writer_completed");
  return { episodesCreated: episodesCount, trace };
}

/**
 * Busca semântica sob demanda na Memória Episódica da Conversa.
 * Garante segurança estrita de tenant via conversation_id injetado pelo backend.
 * Suporta busca condicional de áudio:
 * - Busca com tema específico só retorna áudio se o tema coincidir.
 * - Busca genérica sobre áudios pode retornar qualquer áudio.
 */
export async function searchConversationEpisodicMemory(params: {
  supabase?: any;
  conversationId: string;
  query: string;
  limit?: number;
  now?: Date | string;
  cachedEpisodes?: ConversationEpisode[];
  memoryClass?: EpisodeMemoryClass | "all";
}): Promise<EpisodicSearchResult[]> {
  const { supabase, conversationId, query, cachedEpisodes, memoryClass } = params;
  const limit = Math.min(Math.max(typeof params.limit === "number" ? params.limit : 5, 1), 10);
  const cleanQuery = (query || "").trim();
  if (!cleanQuery || !conversationId) return [];

  const normQuery = stripAccents(cleanQuery);
  const queryWords = normQuery
    .replace(/[^\w\s]/gi, " ")
    .split(/\s+/)
    .filter((w) => w.length >= 2);

  // Stopwords a serem ignoradas na pontuação avulsa
  const STOPWORDS = new Set([
    "ja", "que", "ele", "ela", "vc", "voce", "de", "da", "do", "das", "dos",
    "em", "no", "na", "nos", "nas", "um", "uma", "uns", "umas", "para", "pra",
    "por", "com", "se", "sobre", "qual", "quais", "como", "quando", "onde"
  ]);

  const meaningfulTerms = queryWords.filter((w) => !STOPWORDS.has(w));

  // Mapa semântico de intenções para tópicos e semantic_keys
  const INTENT_MAP: Record<string, { topics: string[]; keys: string[] }> = {
    trabalho: { topics: ["work"], keys: ["work", "profession"] },
    profissao: { topics: ["work"], keys: ["work", "profession"] },
    ocupacao: { topics: ["work"], keys: ["work", "profession"] },
    trampo: { topics: ["work"], keys: ["work", "profession"] },
    cidade: { topics: ["location"], keys: ["city", "location"] },
    mora: { topics: ["location"], keys: ["city", "location"] },
    reside: { topics: ["location"], keys: ["city", "location"] },
    bairro: { topics: ["location"], keys: ["neighborhood", "city"] },
    idade: { topics: ["age"], keys: ["age"] },
    anos: { topics: ["age"], keys: ["age"] },
    filho: { topics: ["children"], keys: ["children"] },
    filhos: { topics: ["children"], keys: ["children"] },
    curso: { topics: ["education"], keys: ["education.course", "course"] },
    faculdade: { topics: ["education"], keys: ["education", "course", "current_period"] },
    enfermagem: { topics: ["education"], keys: ["education.course"] },
    estagio: { topics: ["education"], keys: ["education.internship"] },
    periodo: { topics: ["education"], keys: ["education.current_period"] },
    musica: { topics: ["music"], keys: ["music"] },
    sertanejo: { topics: ["music"], keys: ["music"] },
    praia: { topics: ["travel", "beach"], keys: ["beach", "travel"] },
    viagem: { topics: ["travel"], keys: ["travel"] },
    academia: { topics: ["sports", "fitness"], keys: ["sports", "fitness"] },
    esporte: { topics: ["sports"], keys: ["sports"] },
    namoro: { topics: ["relationship"], keys: ["relationship_status"] },
    casamento: { topics: ["relationship"], keys: ["relationship_status", "marriage"] },
    solteiro: { topics: ["relationship"], keys: ["relationship_status"] },
    audio: { topics: ["audio"], keys: ["audio_sent"] },
    historia: { topics: ["stories", "education"], keys: ["stories", "education"] },
    cafe: { topics: ["routine"], keys: ["routine", "drinks.likes_coffee"] },
    medo: { topics: ["fears"], keys: ["fears"] },
    veiculo: { topics: ["vehicle"], keys: ["car", "vehicle"] },
    carro: { topics: ["vehicle"], keys: ["car", "vehicle"] },
    moto: { topics: ["vehicle"], keys: ["motorcycle", "vehicle"] },
    pai: { topics: ["family"], keys: ["family", "father"] },
    mae: { topics: ["family"], keys: ["family", "mother"] },
    familia: { topics: ["family"], keys: ["family"] },
  };

  const targetTopics = new Set<string>();
  const targetKeys = new Set<string>();

  for (const term of queryWords) {
    if (INTENT_MAP[term]) {
      for (const top of INTENT_MAP[term].topics) targetTopics.add(top);
      for (const k of INTENT_MAP[term].keys) targetKeys.add(k);
    }
  }

  // Se "onde ele mora" ou "onde mora": ativa location
  if (normQuery.includes("onde mora") || normQuery.includes("onde ele mora") || normQuery.includes("de onde")) {
    targetTopics.add("location");
    targetKeys.add("city");
    targetKeys.add("location");
  }

  // Se "o que ele faz" ou "trabalha com o que": ativa work
  if (normQuery.includes("o que ele faz") || normQuery.includes("trabalha com o que") || normQuery.includes("qual o trabalho")) {
    targetTopics.add("work");
    targetKeys.add("work");
    targetKeys.add("profession");
  }

  // Identificação de busca temática específica combinada com áudio
  const substantiveTopics = Array.from(targetTopics).filter((t) => t !== "audio");
  const hasSubstantiveTopic = substantiveTopics.length > 0;
  const isAskingAboutAudio = queryWords.includes("audio") || targetTopics.has("audio");

  // Carrega episódios
  let rawEpisodes: ConversationEpisode[] = cachedEpisodes || [];
  if (!cachedEpisodes && supabase) {
    try {
      const { data, error } = await supabase
        .from("conversation_episodic_memory")
        .select("*")
        .eq("conversation_id", conversationId)
        .order("created_at", { ascending: false })
        .limit(100);

      if (!error && Array.isArray(data)) {
        rawEpisodes = data;
      }
    } catch (err) {
      console.warn("[EpisodicMemory] Erro ao carregar episódios do banco:", err);
    }
  }

  if (rawEpisodes.length === 0) return [];

  // Avaliação e scoring de relevância
  const scored: Array<{ ep: ConversationEpisode; score: number }> = [];

  const askingAboutLarissa = /\b(ja contei|ja falei|ja revelei|ela ja disse|ela ja falou)\b/i.test(normQuery);
  const askingAboutPretendente = /\b(ja perguntei|ja sei|ele ja disse|ele ja falou|ele ja respondeu)\b/i.test(normQuery);

  for (const ep of rawEpisodes) {
    let score = 0;
    const epTopic = (ep.topic || "").toLowerCase();
    const epSummaryNorm = stripAccents(ep.summary || "");
    const epKeys = (ep.semantic_keys || []).map((k) => k.toLowerCase());

    const epClass: EpisodeMemoryClass =
      ep.memory_class ||
      ep.metadata?.memory_class ||
      (ep.event_type === "audio_sent" ? "landmark" : "speech_act");

    if (memoryClass && memoryClass !== "all" && epClass !== memoryClass) {
      continue;
    }

    if (epClass === "landmark") {
      score += 5;
    }

    // Regra de Isolamento de Áudio Semântico:
    // Se a query busca um tema substantivo específico (ex: "filhos", "curso"),
    // um episódio de áudio cujo tema NÃO coincida é expressamente descartado.
    if (ep.event_type === "audio_sent") {
      if (hasSubstantiveTopic) {
        const matchesSubstantive =
          substantiveTopics.includes(epTopic) ||
          epKeys.some((k) => substantiveTopics.some((st) => k.includes(st))) ||
          substantiveTopics.some((st) => epSummaryNorm.includes(st));

        if (!matchesSubstantive) {
          continue; // Pula este áudio: ele não é sobre o tema perguntado
        }
      }
    }

    // 1. Correspondência de Tópico Alvo
    if (epTopic && targetTopics.has(epTopic)) {
      score += 15;
    }

    // 2. Correspondência de Semantic Keys
    for (const tk of targetKeys) {
      if (epKeys.some((k) => k.includes(tk))) {
        score += 12;
      }
    }

    // 3. Correspondência de Termos Relevantes no Resumo e Texto Original
    const epOriginalNorm = stripAccents(ep.original_text || "");
    for (const term of meaningfulTerms) {
      if (epSummaryNorm.includes(term)) {
        score += 8;
      } else if (epOriginalNorm.includes(term)) {
        score += 6;
      }
    }

    // 4. Boost de Ator / Intenção
    if (askingAboutLarissa && ep.actor === "larissa" && (ep.event_type === "self_disclosure" || ep.event_type === "audio_sent")) {
      score += 10;
    }
    if (askingAboutPretendente && ep.actor === "larissa" && ep.event_type === "question") {
      score += 10;
    }
    if (askingAboutPretendente && ep.actor === "pretendente" && (ep.event_type === "fact_reveal" || ep.event_type === "answer")) {
      score += 10;
    }

    // 5. Frase quase idêntica
    if (epSummaryNorm.includes(normQuery) || normQuery.includes(epSummaryNorm)) {
      score += 25;
    }

    // 6. Boost de áudio genérico quando a query é expressamente sobre áudio
    if (isAskingAboutAudio && ep.event_type === "audio_sent") {
      score += 15;
    }

    if (score > 0) {
      scored.push({ ep, score });
    }
  }

  scored.sort((a, b) => b.score - a.score);

  return scored.slice(0, limit).map(({ ep, score }) => {
    const rel = Number(Math.min(score / 35, 0.99).toFixed(2));
    return {
      actor: ep.actor,
      event_type: ep.event_type,
      topic: ep.topic || null,
      summary: ep.summary,
      content: ep.original_text || ep.summary,
      source_message_id: ep.source_message_id || null,
      original_text: ep.original_text || null,
      created_at: ep.created_at || new Date().toISOString(),
      relevance: rel,
      relevanceScore: rel,
    };
  });
}

// ============================================================================
// ANTI-REPEAT GATE DETERMINÍSTICO PRÉ-OUTBOX
// ============================================================================

export interface PrimitiveQuestionRule {
  topic: string;
  primitivePattern: RegExp;
  deepeningIndicators: RegExp;
}

export const PRIMITIVE_QUESTION_RULES: PrimitiveQuestionRule[] = [
  {
    topic: "location",
    primitivePattern: /^(?:e\s+)?(?:onde\s+(?:c|vc|voce|você)\s+mora|de\s+onde\s+(?:c|vc|voce|você)\s+[eé]|mora\s+onde|(?:c|vc|voce|você)\s+mora\s+onde)\s*[\?!.]*$/i,
    deepeningIndicators: /\b(perto|centro|bairro|zona|longe|regi[aã]o|gosta de morar|mora com|quanto tempo mora)\b/i,
  },
  {
    topic: "work",
    primitivePattern: /^(?:e\s+)?(?:com\s+o\s+que\s+(?:c|vc|voce|você)\s+trabalha|(?:c|vc|voce|você)\s+trabalha\s+com\s+(?:o\s+que|oq|qu[eê])|o\s+que\s+(?:c|vc|voce|você)\s+faz\s+da\s+vida|trabalha\s+com\s+(?:o\s+qu[eê]|oq)|qual\s+(?:a\s+)?sua\s+profissa?o|qual\s+seu\s+trabalho|qual\s+seu\s+trampo)\s*[\?!.]*$/i,
    deepeningIndicators: /\b(empresa|gosta de|escala|quanto tempo|rotina|faz tempo que|trabalha de home|presencial)\b/i,
  },
  {
    topic: "age",
    primitivePattern: /^(?:e\s+)?(?:quantos\s+anos\s+(?:c|vc|voce|você)\s+tem|qual\s+(?:a\s+)?sua\s+idade)\s*[\?!.]*$/i,
    deepeningIndicators: /\b(anivers[aá]rio|signo|m[eê]s que vem)\b/i,
  },
  {
    topic: "children",
    primitivePattern: /^(?:e\s+)?(?:(?:c|vc|voce|você)\s+tem\s+filhos?|tem\s+filhos?)\s*[\?!.]*$/i,
    deepeningIndicators: /\b(quantos|idade dele|idade dela|mora com|menino ou menina)\b/i,
  },
];

export interface AntiRepeatGateFilterResult {
  allowedBalloons: string[];
  blockedBalloons: string[];
  isBlocked: boolean;
  logs: string[];
}

/**
 * Filtro Determinístico Anti-Repetição Pré-Outbox.
 * Intercepta balões gerados pela IA antes do envio à Meta:
 * - Bloqueia perguntas primitivas repetidas cujo tópico já foi perguntado ou respondido no histórico episódico.
 * - Permite e preserva perguntas de aprofundamento válido (que mencionam fatos conhecidos ou adicionam nuances).
 */
export async function validateAntiRepeatGate(params: {
  conversationId: string;
  candidateBalloons: string[];
  cachedEpisodes?: ConversationEpisode[];
  supabase?: any;
}): Promise<AntiRepeatGateFilterResult> {
  const { conversationId, candidateBalloons, cachedEpisodes, supabase } = params;
  const logs: string[] = [];

  if (!candidateBalloons || candidateBalloons.length === 0) {
    return { allowedBalloons: [], blockedBalloons: [], isBlocked: false, logs };
  }

  // 1. Carrega histórico episódico da conversa
  let episodes = cachedEpisodes || [];
  if (!cachedEpisodes && supabase && conversationId) {
    try {
      const { data, error } = await supabase
        .from("conversation_episodic_memory")
        .select("actor, event_type, topic, summary, original_text")
        .eq("conversation_id", conversationId);
      if (!error && Array.isArray(data)) {
        episodes = data;
      }
    } catch (err: any) {
      console.warn("[EpisodicGate] Falha ao carregar episódios para validação de gate:", err.message || err);
    }
  }

  // Mapeia tópicos já perguntados pela Larissa ou já respondidos pelo pretendente
  const exploredTopics = new Set<string>();
  const knownEntitiesByTopic: Record<string, string[]> = {};

  for (const ep of episodes) {
    const top = (ep.topic || "").toLowerCase();
    if (!top) continue;

    if (ep.actor === "larissa" && ep.event_type === "question") {
      exploredTopics.add(top);
    } else if (ep.actor === "pretendente" && (ep.event_type === "fact_reveal" || ep.event_type === "answer")) {
      exploredTopics.add(top);
      // Extrai palavras-chave da resposta para reconhecimento de aprofundamento
      const snippet = stripAccents(ep.summary || ep.original_text || "");
      if (!knownEntitiesByTopic[top]) knownEntitiesByTopic[top] = [];
      knownEntitiesByTopic[top].push(snippet);
    }
  }

  const allowedBalloons: string[] = [];
  const blockedBalloons: string[] = [];

  // 2. Analisa cada balão individualmente
  for (const balloon of candidateBalloons) {
    const trimmed = (balloon || "").trim();
    if (!trimmed) continue;

    const normBalloon = stripAccents(trimmed);
    let isPrimitiveRepeat = false;
    let blockedReason = "";

    for (const rule of PRIMITIVE_QUESTION_RULES) {
      if (rule.primitivePattern.test(normBalloon)) {
        // Balão casa com a pergunta primitiva (ex: "onde você mora?")
        if (exploredTopics.has(rule.topic)) {
          // Checa se há algum indicador explícito de aprofundamento na frase
          const hasDeepeningWord = rule.deepeningIndicators.test(normBalloon);

          // Checa se a frase menciona entidades previamente reveladas pelo pretendente (ex: "Barbacena")
          let mentionsKnownEntity = false;
          const knownSnippets = knownEntitiesByTopic[rule.topic] || [];
          for (const snip of knownSnippets) {
            const words = snip.split(/\s+/).filter((w) => w.length >= 4);
            if (words.some((w) => normBalloon.includes(w))) {
              mentionsKnownEntity = true;
              break;
            }
          }

          if (!hasDeepeningWord && !mentionsKnownEntity) {
            isPrimitiveRepeat = true;
            blockedReason = `tópico '${rule.topic}' já explorado na conversa episódica`;
            break;
          }
        }
      }
    }

    if (isPrimitiveRepeat) {
      blockedBalloons.push(trimmed);
      const logMsg = `[EpisodicGate] blocked repeated question: "${trimmed}" (${blockedReason})`;
      console.warn(logMsg);
      logs.push(logMsg);
    } else {
      allowedBalloons.push(trimmed);
    }
  }

  return {
    allowedBalloons,
    blockedBalloons,
    isBlocked: blockedBalloons.length > 0,
    logs,
  };
}

// ============================================================================
// BUSCA NO HISTÓRICO BRUTO DA CONVERSA (RAW CONVERSATION HISTORY SEARCH)
// ============================================================================

export interface RawConversationHistoryContextMessage {
  messageId: string;
  sender: "larissa" | "pretendente";
  text: string;
  createdAt: string;
}

export interface RawConversationHistorySearchResult {
  messageId: string;
  sender: "larissa" | "pretendente";
  text: string;
  audioTranscript?: string | null;
  createdAt: string;
  contextWindow: RawConversationHistoryContextMessage[];
  matchScore: number;
  highlight?: string;
}

/**
 * Busca textual e semântica no histórico bruto de mensagens da conversa (Nível 6).
 * Escopo estrito e intransponível por conversation_id.
 * Recupera contexto local de até 3 mensagens (anterior, hit, seguinte) por resultado.
 */
export async function searchRawConversationHistory(params: {
  supabase: any;
  conversationId: string;
  query: string;
  keywords?: string[];
  limit?: number;
}): Promise<RawConversationHistorySearchResult[]> {
  const { supabase, conversationId, query, keywords = [] } = params;
  const limit = Math.min(Math.max(typeof params.limit === "number" ? params.limit : 3, 1), 6);

  if (!supabase || !conversationId) return [];

  const cleanQuery = (query || "").trim();
  const allTerms = [
    cleanQuery,
    ...keywords.map((k) => (k || "").trim()).filter(Boolean),
  ].filter(Boolean);

  if (allTerms.length === 0) return [];

  const normQuery = stripAccents(cleanQuery);
  const queryTokens = normQuery
    .replace(/[^\w\s]/gi, " ")
    .split(/\s+/)
    .filter((w) => w.length >= 2);

  const normalizedKeywords = keywords
    .map((k) => stripAccents(k || "").replace(/[^\w\s]/gi, " ").trim())
    .filter((k) => k.length >= 2);

  try {
    // 1. Varre toda a conversa em páginas no backend. Somente os hits compactos
    // seguem para o modelo; nunca existe um teto invisível nas primeiras 500 mensagens.
    const rows: any[] = [];
    const pageSize = 500;
    for (let offset = 0; ; offset += pageSize) {
      let queryBuilder = supabase
        .from("instagram_messages")
        .select("id, conversation_id, sender_id, is_mine, is_from_me, text, message, audio_transcript, created_at, timestamp, direction")
        .eq("conversation_id", conversationId)
        .order("created_at", { ascending: true });
      const pageResult = typeof queryBuilder.range === "function"
        ? await queryBuilder.range(offset, offset + pageSize - 1)
        : await queryBuilder.limit(pageSize);
      const pageRows = pageResult?.data;
      if (pageResult?.error || !Array.isArray(pageRows)) return [];
      rows.push(...pageRows);
      if (pageRows.length < pageSize || typeof queryBuilder.range !== "function") break;
    }

    if (rows.length === 0) {
      return [];
    }

    // 2. Avalia e pontua cada mensagem
    interface ScoredHit {
      index: number;
      row: any;
      score: number;
      highlight: string;
    }

    const scoredHits: ScoredHit[] = [];

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const rawText = (row.text || row.message || "").trim();
      const rawTranscript = (row.audio_transcript || "").trim();
      const combinedText = `${rawText} ${rawTranscript}`.trim();
      if (!combinedText) continue;

      const normCombined = stripAccents(combinedText);
      let score = 0;
      let matchedTerm = "";

      // Frase exata da query
      if (normQuery.length >= 3 && normCombined.includes(normQuery)) {
        score += 50;
        matchedTerm = cleanQuery;
      }

      // Keywords
      for (const kw of normalizedKeywords) {
        if (normCombined.includes(kw)) {
          score += 25;
          if (!matchedTerm) matchedTerm = kw;
        }
      }

      // Tokens individuais
      for (const token of queryTokens) {
        if (normCombined.includes(token)) {
          score += 10;
          if (!matchedTerm) matchedTerm = token;
        }
      }

      // Boost especial se estiver no audio_transcript
      if (rawTranscript && stripAccents(rawTranscript).includes(normQuery)) {
        score += 20;
      }

      if (score > 0) {
        scoredHits.push({
          index: i,
          row,
          score,
          highlight: matchedTerm || cleanQuery,
        });
      }
    }

    if (scoredHits.length === 0) return [];

    // Ordena hits por score decrescente (maior relevância primeiro)
    scoredHits.sort((a, b) => b.score - a.score);

    // 3. Monta janelas contextuais (3 mensagens: anterior, encontrada, seguinte) com deduplicação
    const selectedHits: RawConversationHistorySearchResult[] = [];
    const usedIndices = new Set<number>();

    const resolveSender = (r: any): "larissa" | "pretendente" => {
      const isMine = Boolean(
        r.is_mine ||
        r.is_from_me ||
        r.sender_id === "me" ||
        r.sender_id === "larissa" ||
        r.direction === "outbound"
      );
      return isMine ? "larissa" : "pretendente";
    };

    for (const hit of scoredHits) {
      if (selectedHits.length >= limit) break;

      // Se a mensagem encontrada já estiver no miolo de uma janela usada, evita repetição duplicada exata
      if (usedIndices.has(hit.index)) {
        continue;
      }

      const hitRow = hit.row;
      const hitSender = resolveSender(hitRow);
      const hitText = (hitRow.text || hitRow.message || "").trim();
      const hitTranscript = hitRow.audio_transcript ? String(hitRow.audio_transcript).trim() : null;

      const contextWindow: RawConversationHistoryContextMessage[] = [];

      // Mensagem anterior
      if (hit.index > 0) {
        const prevRow = rows[hit.index - 1];
        contextWindow.push({
          messageId: String(prevRow.id),
          sender: resolveSender(prevRow),
          text: (prevRow.text || prevRow.message || prevRow.audio_transcript || "").trim(),
          createdAt: prevRow.created_at || prevRow.timestamp || "",
        });
      }

      // Mensagem encontrada
      contextWindow.push({
        messageId: String(hitRow.id),
        sender: hitSender,
        text: (hitText || hitTranscript || "").trim(),
        createdAt: hitRow.created_at || hitRow.timestamp || "",
      });

      // Mensagem seguinte
      if (hit.index < rows.length - 1) {
        const nextRow = rows[hit.index + 1];
        contextWindow.push({
          messageId: String(nextRow.id),
          sender: resolveSender(nextRow),
          text: (nextRow.text || nextRow.message || nextRow.audio_transcript || "").trim(),
          createdAt: nextRow.created_at || nextRow.timestamp || "",
        });
      }

      // Marca índices como usados para deduplicação
      usedIndices.add(hit.index);
      if (hit.index > 0) usedIndices.add(hit.index - 1);
      if (hit.index < rows.length - 1) usedIndices.add(hit.index + 1);

      selectedHits.push({
        messageId: String(hitRow.id),
        sender: hitSender,
        text: hitText,
        audioTranscript: hitTranscript,
        createdAt: hitRow.created_at || hitRow.timestamp || "",
        contextWindow,
        matchScore: Number((hit.score / 50).toFixed(2)),
        highlight: hit.highlight,
      });
    }

    return selectedHits;
  } catch (err: any) {
    console.warn(`[searchRawConversationHistory] Falha na busca bruta (${conversationId}):`, err.message || err);
    return [];
  }
}
