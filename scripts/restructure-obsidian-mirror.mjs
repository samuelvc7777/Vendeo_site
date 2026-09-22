#!/usr/bin/env node
/**
 * restructure-obsidian-mirror.mjs
 * 
 * Reestruturação Completa do Espelho Obsidian do Vendeo
 * Foco: Navegação Humana por Pretendente / Conversa e Eliminação de Nós Globais Genéricos
 * 
 * Modos de Execução:
 *   node scripts/restructure-obsidian-mirror.mjs --dry-run
 *   node scripts/restructure-obsidian-mirror.mjs --execute
 *   node scripts/restructure-obsidian-mirror.mjs --contact <id> [--dry-run|--execute]
 */

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {
  loadEnv,
  resolveVaultPath,
  sanitizePathSegment,
  computeSha256,
  isVendeoManaged,
  atomicWriteFileIfChanged,
  fetchRemoteMemories,
  fetchRemotePersona,
  fetchRemoteConversationHistory,
  fetchRemoteConversationEpisodes
} from './obsidian-memory-sync.mjs';

export {
  loadEnv,
  resolveVaultPath,
  sanitizePathSegment,
  computeSha256,
  isVendeoManaged,
  atomicWriteFileIfChanged,
  fetchRemoteMemories,
  fetchRemotePersona,
  fetchRemoteConversationHistory,
  fetchRemoteConversationEpisodes
};

loadEnv();

/**
 * Sanitiza identificador para uso em links do Obsidian e nomes de pastas
 */
export function formatPretendenteFolderName(contact) {
  const cId = contact.contactId || contact.id || 'sem_id';
  let rawName = contact.fullName || contact.username || cId;
  // Limpeza de prefixos ou sufixos desnecessários
  const safeName = sanitizePathSegment(rawName);
  const safeId = sanitizePathSegment(cId);
  return `${safeName}__${safeId}`;
}

export function getCleanName(contact) {
  const cId = contact.contactId || contact.id || 'sem_id';
  return contact.fullName || (contact.username ? `@${contact.username}` : cId);
}

export function getSafeName(contact) {
  const clean = getCleanName(contact);
  return sanitizePathSegment(clean);
}

/**
 * Formata: 00 - <Nome>.md (Hub Central do Pretendente)
 */
export function generateHubMarkdown(contact) {
  const cId = contact.contactId || contact.id;
  const name = getCleanName(contact);
  const safeName = sanitizePathSegment(name);
  const username = contact.username ? `@${contact.username}` : 'Não informado';
  const phase = contact.currentPhase || 'conexao_inicial';
  const checkpoint = contact.checkpoint || 'Nenhum';
  const updatedAt = contact.updatedAt || '2026-09-18T00:00:00.000Z';

  const selfFacts = contact.memory?.entities?.self || {};
  const age = selfFacts.age?.value || selfFacts.age || 'Não informado';
  const city = selfFacts.city?.value || selfFacts.city || 'Não informada';
  const job = selfFacts.job?.value || selfFacts.job || selfFacts.profession?.value || selfFacts.profession || 'Não informada';
  const rel = selfFacts.relationship_status?.value || selfFacts.relationship_status || 'Não informado';

  return `---
vendeo_managed: true
vendeo_contact_id: "${cId}"
vendeo_type: "pretendente_hub"
full_name: "${name.replace(/"/g, '\\"')}"
username: "${contact.username || ''}"
current_phase: "${phase}"
checkpoint: "${checkpoint}"
updated_at: "${updatedAt}"
---

# 🧭 Hub: ${name}

> [[INDEX|⬅️ Voltar ao Índice Geral de Pretendentes]]

---

## 👤 Ficha Resumida
- **ID da Conversa:** \`${cId}\`
- **Nome:** **${name}**
- **Instagram:** ${username}
- **Etapa Atual:** \`${phase}\`
- **Idade:** ${age}
- **Cidade:** ${city}
- **Profissão:** ${job}
- **Status:** ${rel}
- **Última Atualização:** ${new Date(updatedAt).toLocaleString('pt-BR')}

---

## 🗺️ Navegação do Pretendente

| Documento | Descrição |
| :--- | :--- |
| [[01 - Sobre ${safeName}]] | 🧠 **Fatos Conhecidos** da ContactMemory (idade, trabalho, gostos, pessoas) |
| [[02 - Conversa com ${safeName}]] | 💬 **Histórico & Dinâmica** (mensagens recentes, ritmo e tom) |
| [[03 - Objetivos de ${safeName}]] | 🎯 **Bússola & Metas** (checklist da etapa e critérios cumpridos) |
| [[04 - Episódios de ${safeName}]] | 📜 **Memória Episódica** (perguntas feitas, respostas e autorevelações) |
| [[05 - Metadados de ${safeName}]] | ⚙️ **Dados Técnicos** (payload de orquestração e checkpoints) |

---
*Gerado automaticamente pelo Vendeo Memory Sync (Espelho Humano do Obsidian)*
`;
}

/**
 * Formata: 01 - Sobre <Nome>.md (ContactMemory)
 */
export function generateAboutMarkdown(contact) {
  const cId = contact.contactId || contact.id;
  const name = getCleanName(contact);
  const safeName = sanitizePathSegment(name);
  const updatedAt = contact.updatedAt || '2026-09-18T00:00:00.000Z';

  const selfFacts = contact.memory?.entities?.self || {};
  const selfFields = Object.keys(selfFacts);
  const dbFacts = Array.isArray(contact.contactMemoryFacts) ? contact.contactMemoryFacts : [];
  const dbQuotes = Array.isArray(contact.contactMemoryQuotes) ? contact.contactMemoryQuotes : [];

  let selfSection = '_Nenhum fato durável registrado ainda sobre o pretendente._';
  if (dbFacts.length > 0) {
    const selfDbFacts = dbFacts.filter((f) => !f.entity || f.entity === 'self');
    if (selfDbFacts.length > 0) {
      selfSection = selfDbFacts
        .map((f) => {
          const val = typeof f.value === 'object' ? JSON.stringify(f.value) : String(f.value);
          const prov = f.source_message_ids?.[0] ? ` *(origem: \`${f.source_message_ids[0]}\`)*` : '';
          const status = f.temporal_status && f.temporal_status !== 'durable' ? ` [${f.temporal_status}]` : '';
          return `- **${f.field}:** ${val}${status}${prov}`;
        })
        .join('\n');
    }
  } else if (selfFields.length > 0) {
    selfSection = selfFields
      .map((field) => {
        const item = selfFacts[field];
        const val = item?.value !== undefined ? item.value : item;
        const prov = item?.sourceMessageId ? ` *(origem: \`${item.sourceMessageId}\`)*` : '';
        return `- **${field}:** ${val}${prov}`;
      })
      .join('\n');
  }

  // Outras entidades (família, amigos, pet, etc.)
  const entities = contact.memory?.entities || {};
  const otherEntities = Object.keys(entities).filter((k) => k !== 'self');
  let othersSection = '_Nenhuma outra entidade citada até o momento._';
  if (dbFacts.length > 0) {
    const otherDbFacts = dbFacts.filter((f) => f.entity && f.entity !== 'self');
    if (otherDbFacts.length > 0) {
      const byEntity = {};
      for (const f of otherDbFacts) {
        if (!byEntity[f.entity]) byEntity[f.entity] = [];
        byEntity[f.entity].push(f);
      }
      othersSection = Object.keys(byEntity)
        .map((entKey) => {
          const factLines = byEntity[entKey]
            .map((f) => `  - **${f.field}:** ${typeof f.value === 'object' ? JSON.stringify(f.value) : f.value}`)
            .join('\n');
          return `### Entidade: ${entKey}\n${factLines}`;
        })
        .join('\n\n');
    }
  } else if (otherEntities.length > 0) {
    othersSection = otherEntities
      .map((entKey) => {
        const entFacts = entities[entKey] || {};
        const factLines = Object.keys(entFacts)
          .map((k) => {
            const v = entFacts[k]?.value !== undefined ? entFacts[k].value : entFacts[k];
            return `  - **${k}:** ${v}`;
          })
          .join('\n');
        return `### Entidade: ${entKey}\n${factLines || '  - Sem detalhes'}`;
      })
      .join('\n\n');
  }

  // Snippets/trechos literais e Quotes
  const snippets = Array.isArray(contact.memory?.snippets) ? contact.memory.snippets : [];
  let snippetsSection = '_Nenhum trecho textual relevante destacado._';
  if (dbQuotes.length > 0) {
    snippetsSection = dbQuotes
      .map((q) => {
        const reason = q.context_or_reason ? ` *(${q.context_or_reason})*` : '';
        const prov = q.source_message_id ? ` *(origem: \`${q.source_message_id}\`)*` : '';
        return `- > "${q.quote_text}"${reason}${prov}`;
      })
      .join('\n');
  } else if (snippets.length > 0) {
    snippetsSection = snippets
      .map((s) => {
        const text = typeof s === 'string' ? s : s?.text || JSON.stringify(s);
        const source = s?.sourceMessageId ? ` *(origem: \`${s.sourceMessageId}\`)*` : '';
        return `- > "${text}"${source}`;
      })
      .join('\n');
  }

  return `---
vendeo_managed: true
vendeo_contact_id: "${cId}"
vendeo_type: "contact_facts"
full_name: "${name.replace(/"/g, '\\"')}"
updated_at: "${updatedAt}"
---

# 🧠 Fatos Conhecidos: ${name}

> [[00 - ${safeName}|⬅️ Voltar ao Hub de ${name}]] | [[INDEX|Índice Geral]]

---

## 📌 Fatos Pessoais (Sobre Ele)
${selfSection}

---

## 👥 Outras Pessoas / Entidades Mencionadas
${othersSection}

---

## 💬 Trechos e Frases Marcantes
${snippetsSection}
`;
}

/**
 * Formata: 02 - Conversa com <Nome>.md (Histórico e Dinâmica)
 */
export function generateConversationMarkdown(contact, recentMessages = []) {
  const cId = contact.contactId || contact.id;
  const name = getCleanName(contact);
  const safeName = sanitizePathSegment(name);
  const updatedAt = contact.updatedAt || '2026-09-18T00:00:00.000Z';

  let messagesSection = '_Histórico de mensagens recentes não sincronizado ou conversa iniciada diretamente via webhook._';
  if (Array.isArray(recentMessages) && recentMessages.length > 0) {
    messagesSection = recentMessages
      .map((m) => {
        const isMine = Boolean(m.is_mine || m.isFromMe || m.sender === 'larissa' || m.direction === 'outbound');
        const sender = isMine ? '🌸 Larissa' : `👤 ${name}`;
        const time = m.created_at || m.createdAt || m.timestamp ? new Date(m.created_at || m.createdAt || m.timestamp).toLocaleString('pt-BR') : '';
        const transcript = m.audioTranscript || m.audio_transcript;
        const isAudio = m.type === 'audio' || Boolean(transcript || m.audioUrl || m.audio_url);
        
        let text = m.text || m.message || '';
        if (transcript) {
          text = `🎙️ *(Áudio)*: "${transcript}"`;
        } else if (isAudio && !text) {
          text = '🎙️ *(Áudio enviado)*';
        } else if (!text) {
          text = '[Mensagem sem texto]';
        }
        return `> **${sender}** (${time}):\n> ${text}\n`;
      })
      .join('\n');
  }

  return `---
vendeo_managed: true
vendeo_contact_id: "${cId}"
vendeo_type: "conversation_history"
full_name: "${name.replace(/"/g, '\\"')}"
updated_at: "${updatedAt}"
---

# 💬 Conversa com ${name}

> [[00 - ${safeName}|⬅️ Voltar ao Hub de ${name}]] | [[INDEX|Índice Geral]]

---

## 📊 Dinâmica da Conversa
- **Interlocutor:** **${name}** (\`${contact.username ? '@' + contact.username : cId}\`)
- **Status da Fase:** \`${contact.currentStageId || contact.currentPhase || 'conexao_inicial'}\`
- **Último Registro:** ${new Date(updatedAt).toLocaleString('pt-BR')}

---

## 📝 Mensagens Recentes

${messagesSection}
`;
}

/**
 * Formata: 03 - Objetivos de <Nome>.md (StageObjectives)
 */
export function generateObjectivesMarkdown(contact) {
  const cId = contact.contactId || contact.id;
  const name = getCleanName(contact);
  const safeName = sanitizePathSegment(name);
  const phase = contact.currentStageId || contact.currentPhase || 'conexao_inicial';
  const stageName = phase === 'conexao_inicial' ? 'Conexão Inicial' : phase === 'descoberta' ? 'Descoberta' : phase;
  const responsibleSubagent = contact.responsibleSubagent || (phase === 'descoberta' ? 'descoberta' : 'conexao_inicial');
  const updatedAt = contact.updatedAt || '2026-09-18T00:00:00.000Z';

  const goals = Array.isArray(contact.objectives) && contact.objectives.length > 0
    ? contact.objectives
    : Array.isArray(contact.checklist?.goals)
    ? contact.checklist.goals
    : [];

  let goalsSection = '';
  if (goals.length > 0) {
    goalsSection = goals
      .map((g) => {
        const isDone = g.status === 'completed';
        const isCurrent = Boolean(g.isCurrent || g.status === 'in_progress');
        const box = isDone ? '[x]' : '[ ]';
        const prefix = isCurrent ? '➡️ ' : '';
        const suffix = isCurrent ? ' *(Em andamento pelo Brain)*' : '';
        const valStr = isDone && g.value !== undefined && g.value !== null && g.value !== true
          ? `: **${g.value}**`
          : '';
        return `- ${box} ${prefix}**${g.label || g.title || g.id}**${valStr}${suffix}`;
      })
      .join('\n');
  } else {
    goalsSection = `
- [ ] **Acolhimento Inicial**
- [ ] **Identificar Abertura**
`;
  }

  const currentObjLine = contact.currentObjective
    ? `- **Objetivo Atual em Foco:** ➡️ **${contact.currentObjective.label || contact.currentObjective.title || contact.currentObjective.id}**\n`
    : '';

  return `---
vendeo_managed: true
vendeo_contact_id: "${cId}"
vendeo_type: "stage_objectives"
full_name: "${name.replace(/"/g, '\\"')}"
current_phase: "${phase}"
updated_at: "${updatedAt}"
---

# 🎯 Objetivos de ${name}

> [[00 - ${safeName}|⬅️ Voltar ao Hub de ${name}]] | [[INDEX|Índice Geral]]

---

## 🧭 Bússola da Etapa: ${stageName}
- **Subagente Responsável:** \`${responsibleSubagent}\`
${currentObjLine}
*Os objetivos servem como orientação temática para a Larissa e **não** devem ser usados como roteiro mecânico de interrogatório.*

${goalsSection}

---

## 💡 Diretrizes de Transição
- A transição de fase só ocorre quando os objetivos essenciais forem validados organicamente.
- O checkpoint atual registrado pela orquestração é: \`${contact.checkpoint || 'nenhum'}\`.
`;
}

/**
 * Formata: 04 - Episódios de <Nome>.md (EpisodicMemory)
 */
export function generateEpisodesMarkdown(contact, episodesInput = []) {
  const cId = contact.contactId || contact.id;
  const name = getCleanName(contact);
  const safeName = sanitizePathSegment(name);
  const updatedAt = contact.updatedAt || '2026-09-18T00:00:00.000Z';

  let rawList = [];
  let landmarks = [];
  let speechActs = [];
  let openLoops = [];

  if (episodesInput && typeof episodesInput === 'object' && !Array.isArray(episodesInput)) {
    landmarks = Array.isArray(episodesInput.landmarks) ? episodesInput.landmarks : [];
    speechActs = Array.isArray(episodesInput.speechActs) ? episodesInput.speechActs : [];
    openLoops = Array.isArray(episodesInput.openLoops) ? episodesInput.openLoops : [];
    rawList = Array.isArray(episodesInput.episodes) ? episodesInput.episodes : [...landmarks, ...speechActs, ...openLoops];
  } else if (Array.isArray(episodesInput)) {
    rawList = episodesInput;
    for (const ep of rawList) {
      const isLandmark = ep.memoryClass === 'landmark' || ep.memory_class === 'landmark' ||
        ['life_event', 'preference', 'boundary', 'landmark'].includes(ep.event_type || ep.eventType);
      const isOpenLoop = ep.loop_status === 'open' || ep.loopStatus === 'open' || ep.loop_status === 'resolved' || ep.loopStatus === 'resolved' || ep.event_type === 'plan' || ep.eventType === 'plan';
      
      if (isOpenLoop) {
        openLoops.push(ep);
      } else if (isLandmark) {
        landmarks.push(ep);
      } else {
        speechActs.push(ep);
      }
    }
  }

  const formatEpisodeItem = (ep) => {
    const actorLabel = (ep.actor === 'larissa' || ep.is_from_me) ? '🌸 Larissa' : `👤 ${name}`;
    const time = ep.created_at || ep.createdAt ? new Date(ep.created_at || ep.createdAt).toLocaleString('pt-BR') : '';
    const eventType = ep.event_type || ep.eventType || 'message';
    const scoreStr = typeof ep.relevance_score === 'number' ? ` \`score: ${ep.relevance_score}\`` : '';
    return `- **${actorLabel}** (${eventType}${scoreStr}) — ${time}:\n  - *${ep.summary || ep.details || ''}*`;
  };

  const formatOpenLoopItem = (ep) => {
    const isResolved = ep.loop_status === 'resolved' || ep.loopStatus === 'resolved';
    const check = isResolved ? '[x]' : '[ ]';
    const actorLabel = (ep.actor === 'larissa' || ep.is_from_me) ? '🌸 Larissa' : `👤 ${name}`;
    const time = ep.created_at || ep.createdAt ? new Date(ep.created_at || ep.createdAt).toLocaleDateString('pt-BR') : '';
    const resNote = isResolved && (ep.resolved_at || ep.resolvedAt)
      ? ` *(resolvido em ${new Date(ep.resolved_at || ep.resolvedAt).toLocaleDateString('pt-BR')})*`
      : '';
    return `- ${check} **${actorLabel}:** ${ep.summary || ep.details || ''}${resNote} *(iniciado: ${time})*`;
  };

  const landmarksSection = landmarks.length > 0
    ? landmarks.map(formatEpisodeItem).join('\n')
    : '_Nenhum marco narrativo (landmark) registrado ainda._';

  const openLoopsSection = openLoops.length > 0
    ? openLoops.map(formatOpenLoopItem).join('\n')
    : '_Nenhum combinado ou promessa em aberto no momento._';

  const speechActsSection = speechActs.length > 0
    ? speechActs.map(formatEpisodeItem).join('\n')
    : '_Nenhum ato de fala recente registrado ainda._';

  return `---
vendeo_managed: true
vendeo_contact_id: "${cId}"
vendeo_type: "episodic_memory"
full_name: "${name.replace(/"/g, '\\"')}"
updated_at: "${updatedAt}"
---

# 📜 Episódios Marcantes: ${name}

> [[00 - ${safeName}|⬅️ Voltar ao Hub de ${name}]] | [[INDEX|Índice Geral]]

---

## 🏛️ Marcos Narrativos (Landmarks)
*Fatos estruturantes da história de vida, preferências marcantes e limites declarados.*

${landmarksSection}

---

## 🔄 Combinados e Promessas em Aberto (Open Loops)
*Pendências, promessas mútuas e tópicos aguardando retorno.*

${openLoopsSection}

---

## ⚡ Atos de Fala Recentes (Speech Acts)
*Perguntas feitas, reações imediatas e saudações dos turnos recentes.*

${speechActsSection}
`;
}

/**
 * Formata: 05 - Metadados de <Nome>.md (Orquestração Técnica & LiveState)
 */
export function generateMetadataMarkdown(contact) {
  const cId = contact.contactId || contact.id;
  const name = getCleanName(contact);
  const safeName = sanitizePathSegment(name);
  const updatedAt = contact.updatedAt || '2026-09-18T00:00:00.000Z';

  const ls = contact.liveState;
  let liveStateVisual = '';
  if (ls && typeof ls === 'object') {
    const secTopics = Array.isArray(ls.secondaryTopics) && ls.secondaryTopics.length > 0
      ? ls.secondaryTopics.join(', ')
      : 'Nenhum';
    const openLoops = Array.isArray(ls.openLoops) && ls.openLoops.length > 0
      ? ls.openLoops.join(', ')
      : 'Nenhum';
    const avoid = Array.isArray(ls.avoidRepeating) && ls.avoidRepeating.length > 0
      ? ls.avoidRepeating.join(', ')
      : 'Nenhum';

    liveStateVisual = `
- **Tom Emocional do Pretendente:** \`${ls.lastUserEmotionalTone || 'neutro'}\`
- **Tópico Atual da Interação:** \`${ls.currentTopic || 'geral'}\`
- **Pergunta Pendente dele a Responder:** ${ls.unresolvedQuestion ? `"${ls.unresolvedQuestion}"` : '_Nenhuma_'}
- **Último Ato de Fala da Larissa:** ${ls.lastLarissaSpeechAct ? `\`${ls.lastLarissaSpeechAct}\`` : '_Nenhum_'}
- **Marcos Recentes (Resumo):** ${ls.recentLandmarksSummary ? `_${ls.recentLandmarksSummary}_` : '_Nenhum_'}
- **Tópicos Secundários Abertos:** ${secTopics}
- **Open Loops:** ${openLoops}
- **Evitar Repetir Agora:** ${avoid}
- **Contador de Turnos:** \`#${ls.turnCount || 0}\`
- **Última Atualização do LiveState:** ${ls.updatedAt ? new Date(ls.updatedAt).toLocaleString('pt-BR') : 'Recente'}
`;
  } else {
    liveStateVisual = `\n_Nenhum snapshot operacional de LiveState gravado ainda (será persistido atomicamente no primeiro turno ativo pelo Conversation Brain)._\n`;
  }

  const metaPayload = {
    id: cId,
    fullName: contact.fullName,
    username: contact.username,
    currentPhase: contact.currentPhase,
    currentStageId: contact.currentStageId,
    responsibleSubagent: contact.responsibleSubagent,
    checkpoint: contact.checkpoint,
    updatedAt: contact.updatedAt,
    liveState: contact.liveState || null,
    currentObjective: contact.currentObjective || null,
    objectives: contact.objectives || contact.checklist?.goals || [],
    memory: contact.memory,
  };

  return `---
vendeo_managed: true
vendeo_contact_id: "${cId}"
vendeo_type: "technical_metadata"
full_name: "${name.replace(/"/g, '\\"')}"
updated_at: "${updatedAt}"
---

# ⚙️ Metadados Técnicos: ${name}

> [[00 - ${safeName}|⬅️ Voltar ao Hub de ${name}]] | [[INDEX|Índice Geral]]

---

## 🟢 Estado Vivo da Conversa
${liveStateVisual}
---

## ⚙️ Dados Técnicos de Orquestração

\`\`\`json
${JSON.stringify(metaPayload, null, 2)}
\`\`\`
`;
}

/**
 * Formata: Pretendentes/INDEX.md (Tabela Geral de Navegação)
 */
export function generateIndexMarkdown(contacts) {
  const total = contacts.length;
  const maxContactDate = contacts.reduce((max, c) => (c.updatedAt && c.updatedAt > max ? c.updatedAt : max), '2026-09-18T00:00:00.000Z');
  const rows = contacts
    .map((c) => {
      const name = getCleanName(c);
      const safeName = sanitizePathSegment(name);
      const folderName = formatPretendenteFolderName(c);
      const link = `[[Pretendentes/${folderName}/00 - ${safeName}|${name}]]`;
      const user = c.username ? `@${c.username}` : '-';
      const phase = c.currentPhase || 'conexao_inicial';
      const date = c.updatedAt ? new Date(c.updatedAt).toLocaleDateString('pt-BR') : '-';
      return `| ${link} | \`${c.contactId || c.id}\` | ${user} | \`${phase}\` | ${date} |`;
    })
    .join('\n');

  return `---
vendeo_managed: true
vendeo_type: "pretendentes_index"
total_pretendentes: ${total}
updated_at: "${maxContactDate}"
---

# 📋 Índice de Pretendentes (${total})

> Navegação visual humana de todos os pretendentes registrados no Vendeo.  
> Clique no nome para abrir o **Hub individual** de cada pretendente.

---

| Pretendente | ID da Conversa | Instagram | Fase Atual | Última Interação |
| :--- | :--- | :--- | :--- | :--- |
${rows}

---
*Atualizado automaticamente pelo Vendeo Obsidian Sync*
`;
}

/**
 * Formata o Hub Central da Persona: Persona/Larissa/00 - Larissa.md
 */
export function generatePersonaHubMarkdown(categories, totalFacts, updatedAt = '2026-09-18T00:00:00.000Z') {
  const catLinks = categories
    .map((cat) => {
      const title = cat.charAt(0).toUpperCase() + cat.slice(1);
      return `- [[${title}]]`;
    })
    .join('\n');

  return `---
vendeo_managed: true
vendeo_type: "persona_hub"
persona_id: "larissa"
total_facts: ${totalFacts}
updated_at: "${updatedAt}"
---

# 🌸 Persona Larissa — Hub Central

> [[../../Pretendentes/INDEX|⬅️ Ver Índice de Pretendentes]]

---

## 📖 Visão Geral da Persona
- **Nome:** Larissa
- **Idade Canônica:** 24 anos (nascida em 1999)
- **Origem / Cidade:** São João del-Rei - MG
- **Formação:** Formada em Enfermagem pela UFSJ
- **Trabalho:** Hospital Nossa Senhora das Mercês (escala 12x36)
- **Total de Fatos Registrados:** **${totalFacts}** fatos canônicos, gerados e temporais.

---

## 📂 Categorias Temáticas de Memória

${catLinks}

---
*Fonte da Verdade: Tabela \`persona_memory\` no Supabase*
`;
}

/**
 * Executa a auditoria / simulação (DRY RUN) ou aplicação real
 */
export async function runRestructure(options = {}) {
  const isDryRun = !!options.dryRun;
  const targetContactId = options.contactId || null;

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
  const token = process.env.OBSIDIAN_SYNC_TOKEN;
  const vaultRoot = resolveVaultPath(options.vault);

  console.log(`=======================================================`);
  console.log(` REESTRUTURAÇÃO DO ESPELHO OBSIDIAN — VENDEO`);
  console.log(` Modo: ${isDryRun ? '🔍 SIMULAÇÃO (DRY RUN)' : '🚀 EXECUÇÃO REAL'}`);
  console.log(` Vault Alvo: ${vaultRoot}`);
  console.log(`=======================================================\n`);

  // 1. Coleta de contatos
  console.log(`[1/4] Consultando contatos no Supabase...`);
  const contacts = await fetchRemoteMemories(supabaseUrl, token, targetContactId);
  console.log(`      ${contacts.length} contato(s) identificado(s).\n`);

  // 2. Coleta de fatos da Persona
  console.log(`[2/4] Consultando fatos da Persona Larissa...`);
  let personaFacts = await fetchRemotePersona(supabaseUrl, token, 'larissa');
  if (!personaFacts || personaFacts.length === 0) {
    const { LARISSA_CANONICAL_FACTS } = await import('./import-larissa-persona-memory.mjs').catch(() => ({ LARISSA_CANONICAL_FACTS: [] }));
    personaFacts = LARISSA_CANONICAL_FACTS || [];
  }
  console.log(`      ${personaFacts.length} fatos da Persona identificados.\n`);

  // 3. Auditoria do Vault atual e pastas antigas
  console.log(`[3/4] Auditando sistema de arquivos local...`);
  const oldContatosDir = path.join(vaultRoot, 'Vendeo Memory', 'Contatos');
  const archiveDir = path.join(vaultRoot, '_archive', 'Vendeo_Memory_Contatos_antigo');
  const pretendentesDir = path.join(vaultRoot, 'Pretendentes');
  const personaDir = path.join(vaultRoot, 'Persona', 'Larissa');

  let oldFoldersCount = 0;
  let oldFilesCount = 0;
  if (fs.existsSync(oldContatosDir)) {
    const oldFolders = fs.readdirSync(oldContatosDir);
    oldFoldersCount = oldFolders.length;
    for (const f of oldFolders) {
      const full = path.join(oldContatosDir, f);
      if (fs.statSync(full).isDirectory()) {
        oldFilesCount += fs.readdirSync(full).length;
      }
    }
  }
  console.log(`      Estrutura antiga detectada: ${oldFoldersCount} pastas, ${oldFilesCount} arquivos em Vendeo Memory/Contatos`);

  // 4. Cálculo de Impacto
  const plannedOperations = {
    archiveFoldersToMove: oldFoldersCount > 0 ? 1 : 0,
    pretendentesFoldersToCreate: contacts.length,
    pretendentesFilesToGenerate: contacts.length * 6, // 00 a 05
    indexFilesToGenerate: 1, // INDEX.md
    personaFilesToGenerate: 1, // 00 - Larissa.md + categorias
    unchangedFiles: 0,
    writtenFiles: 0,
  };

  // Agrupa fatos da persona por categoria
  const personaByCategory = {};
  for (const f of personaFacts) {
    const cat = f.category || 'geral';
    if (!personaByCategory[cat]) personaByCategory[cat] = [];
    personaByCategory[cat].push(f);
  }
  const personaCategories = Object.keys(personaByCategory);
  plannedOperations.personaFilesToGenerate += personaCategories.length;

  console.log(`\n=======================================================`);
  console.log(` RELATÓRIO DE IMPACTO PROJETADO`);
  console.log(`=======================================================`);
  console.log(`📦 Arquivamento seguro:`);
  console.log(`   - Mover '${path.relative(vaultRoot, oldContatosDir)}' -> '${path.relative(vaultRoot, archiveDir)}'`);
  console.log(`   - Pastas arquivadas: ${oldFoldersCount}`);
  console.log(`   - Arquivos preservados no arquivo: ${oldFilesCount}`);
  console.log(`\n📁 Estrutura de Pretendentes:`);
  console.log(`   - Diretório: '${path.relative(vaultRoot, pretendentesDir)}/'`);
  console.log(`   - Pastas individuais: ${contacts.length}`);
  console.log(`   - Arquivos por pretendente (6 cada):`);
  console.log(`       * 00 - <Nome>.md (Hub Central)`);
  console.log(`       * 01 - Sobre <Nome>.md (ContactMemory)`);
  console.log(`       * 02 - Conversa com <Nome>.md (Histórico)`);
  console.log(`       * 03 - Objetivos de <Nome>.md (Bússola)`);
  console.log(`       * 04 - Episódios de <Nome>.md (Memória Episódica)`);
  console.log(`       * 05 - Metadados de <Nome>.md (JSON Técnico)`);
  console.log(`   - Total de arquivos de pretendentes: ${contacts.length * 6}`);
  console.log(`   - Índice geral: 'Pretendentes/INDEX.md'`);
  console.log(`\n🌸 Estrutura da Persona:`);
  console.log(`   - Diretório: '${path.relative(vaultRoot, personaDir)}/'`);
  console.log(`   - Hub Central: '00 - Larissa.md'`);
  console.log(`   - Categorias temáticas: ${personaCategories.length} arquivos (${personaCategories.join(', ')})`);
  console.log(`   - Total de arquivos da Persona: ${plannedOperations.personaFilesToGenerate}`);
  console.log(`\nTotal Geral de Arquivos Novos Planejados: ${plannedOperations.pretendentesFilesToGenerate + 1 + plannedOperations.personaFilesToGenerate}`);
  console.log(`=======================================================\n`);

  if (isDryRun) {
    console.log(`✅ SIMULAÇÃO CONCLUÍDA COM SUCESSO. NENHUM ARQUIVO FOI ALTERADO.`);
    console.log(`   Para aplicar as modificações, execute com a flag --execute.\n`);
    return {
      success: true,
      mode: 'dry-run',
      contactsCount: contacts.length,
      personaFactsCount: personaFacts.length,
      plannedOperations,
    };
  }

  // EXECUÇÃO REAL
  console.log(`[4/4] Aplicando reestruturação no disco...`);

  // A. Arquivamento da estrutura antiga
  if (fs.existsSync(oldContatosDir)) {
    fs.mkdirSync(path.dirname(archiveDir), { recursive: true });
    if (!fs.existsSync(archiveDir)) {
      fs.renameSync(oldContatosDir, archiveDir);
      console.log(`      Pasta legada movida com segurança para: ${archiveDir}`);
    } else {
      console.log(`      Pasta de arquivo já existia. Movendo conteúdo interno com segurança...`);
      const files = fs.readdirSync(oldContatosDir);
      for (const f of files) {
        const src = path.join(oldContatosDir, f);
        const dest = path.join(archiveDir, f);
        if (!fs.existsSync(dest)) {
          fs.renameSync(src, dest);
        }
      }
      try { fs.rmdirSync(oldContatosDir); } catch {}
    }
  }

  let totalWritten = 0;
  let totalUnchanged = 0;
  let totalPreserved = 0;

  // B. Criação dos pretendentes
  for (const c of contacts) {
    const name = getCleanName(c);
    const safeName = sanitizePathSegment(name);
    const folderName = formatPretendenteFolderName(c);
    const contactDir = path.join(pretendentesDir, folderName);

    // Carrega mensagens reais e episódios classificados se disponíveis
    let recentMessages = c.recentMessages || [];
    let episodes = c.episodes || { landmarks: [], speechActs: [] };
    if (supabaseUrl && token) {
      try {
        const [msgs, eps] = await Promise.all([
          fetchRemoteConversationHistory(supabaseUrl, token, c.id),
          fetchRemoteConversationEpisodes(supabaseUrl, token, c.id),
        ]);
        if (Array.isArray(msgs) && msgs.length > 0) recentMessages = msgs;
        if (eps && (eps.landmarks?.length > 0 || eps.speechActs?.length > 0 || eps.episodes?.length > 0)) episodes = eps;
      } catch {}
    }

    const filesToWrite = [
      { file: `00 - ${safeName}.md`, content: generateHubMarkdown(c) },
      { file: `01 - Sobre ${safeName}.md`, content: generateAboutMarkdown(c) },
      { file: `02 - Conversa com ${safeName}.md`, content: generateConversationMarkdown(c, recentMessages) },
      { file: `03 - Objetivos de ${safeName}.md`, content: generateObjectivesMarkdown(c) },
      { file: `04 - Episódios de ${safeName}.md`, content: generateEpisodesMarkdown(c, episodes) },
      { file: `05 - Metadados de ${safeName}.md`, content: generateMetadataMarkdown(c) },
    ];

    for (const item of filesToWrite) {
      const p = path.join(contactDir, item.file);
      const res = atomicWriteFileIfChanged(p, item.content);
      if (res.written) totalWritten++;
      else if (res.skippedUnchanged) totalUnchanged++;
      else if (res.skippedManual) totalPreserved++;
    }
  }

  // C. Criação do INDEX.md
  const indexPath = path.join(pretendentesDir, 'INDEX.md');
  const indexContent = generateIndexMarkdown(contacts);
  const idxRes = atomicWriteFileIfChanged(indexPath, indexContent);
  if (idxRes.written) totalWritten++;
  else if (idxRes.skippedUnchanged) totalUnchanged++;

  // D. Criação da Persona Larissa
  const maxPersonaDate = personaFacts.reduce((max, f) => (f.updated_at && f.updated_at > max ? f.updated_at : max), '2026-09-18T00:00:00.000Z');
  const personaHubPath = path.join(personaDir, '00 - Larissa.md');
  const personaHubContent = generatePersonaHubMarkdown(personaCategories, personaFacts.length, maxPersonaDate);
  const pHubRes = atomicWriteFileIfChanged(personaHubPath, personaHubContent);
  if (pHubRes.written) totalWritten++;
  else if (pHubRes.skippedUnchanged) totalUnchanged++;

  for (const [cat, facts] of Object.entries(personaByCategory)) {
    const title = cat.charAt(0).toUpperCase() + cat.slice(1);
    const pCatPath = path.join(personaDir, `${title}.md`);
    const maxCatDate = facts.reduce((max, f) => (f.updated_at && f.updated_at > max ? f.updated_at : max), '2026-09-18T00:00:00.000Z');
    
    let catContent = `---
vendeo_managed: true
vendeo_type: "persona_category"
persona_id: "larissa"
category: "${cat}"
updated_at: "${maxCatDate}"
---

# 🌸 Larissa — ${title}

> [[00 - Larissa|⬅️ Voltar ao Hub da Larissa]] | [[../../Pretendentes/INDEX|Índice de Pretendentes]]

---

`;
    for (const f of facts) {
      const kFormatted = (f.key || '').replace(/_/g, ' ').replace(/\b\w/g, (x) => x.toUpperCase());
      const valStr = typeof f.value === 'object' ? JSON.stringify(f.value) : String(f.value);
      let tag = '';
      if (f.source_type === 'canonical') tag = ' *(canônico)*';
      else if (f.source_type === 'temporal') tag = ' *(temporal)*';
      const aliasStr = Array.isArray(f.aliases) && f.aliases.length > 0 ? `\n  - *Aliases:* \`${f.aliases.join('`, `')}\`` : '';
      catContent += `- **${kFormatted}:** ${valStr}${tag}${aliasStr}\n`;
    }

    const cRes = atomicWriteFileIfChanged(pCatPath, catContent);
    if (cRes.written) totalWritten++;
    else if (cRes.skippedUnchanged) totalUnchanged++;
  }

  console.log(`\n=======================================================`);
  console.log(` REESTRUTURAÇÃO CONCLUÍDA COM SUCESSO!`);
  console.log(` Arquivos criados/atualizados: ${totalWritten}`);
  console.log(` Arquivos inalterados: ${totalUnchanged}`);
  console.log(` Arquivos manuais preservados: ${totalPreserved}`);
  console.log(`=======================================================\n`);

  return {
    success: true,
    mode: 'execute',
    totalWritten,
    totalUnchanged,
    totalPreserved,
  };
}

// Execução direta via CLI
const isDirectRun = process.argv[1] && (process.argv[1].endsWith('restructure-obsidian-mirror.mjs') || process.argv[1].endsWith('restructure-obsidian-mirror'));
if (isDirectRun) {
  const args = process.argv.slice(2);
  const isExecute = args.includes('--execute');
  const isDryRun = args.includes('--dry-run') || !isExecute;

  let contactId = null;
  const cIdx = args.indexOf('--contact');
  if (cIdx >= 0 && args[cIdx + 1]) {
    contactId = args[cIdx + 1];
  }

  let vault = null;
  const vIdx = args.indexOf('--vault');
  if (vIdx >= 0 && args[vIdx + 1]) {
    vault = args[vIdx + 1];
  }

  runRestructure({ dryRun: isDryRun, contactId, vault })
    .then((res) => {
      process.exit(0);
    })
    .catch((err) => {
      console.error('\n❌ Erro durante reestruturação:', err);
      process.exit(1);
    });
}
