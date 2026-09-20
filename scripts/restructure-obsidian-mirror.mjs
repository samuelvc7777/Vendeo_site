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
  fetchRemotePersona
} from './obsidian-memory-sync.mjs';

export {
  loadEnv,
  resolveVaultPath,
  sanitizePathSegment,
  computeSha256,
  isVendeoManaged,
  atomicWriteFileIfChanged,
  fetchRemoteMemories,
  fetchRemotePersona
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

  let selfSection = '_Nenhum fato durável registrado ainda sobre o pretendente._';
  if (selfFields.length > 0) {
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
  if (otherEntities.length > 0) {
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

  // Snippets/trechos literais
  const snippets = Array.isArray(contact.memory?.snippets) ? contact.memory.snippets : [];
  let snippetsSection = '_Nenhum trecho textual relevante destacado._';
  if (snippets.length > 0) {
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
        const isMine = m.is_mine || m.direction === 'outbound';
        const sender = isMine ? '🌸 Larissa' : `👤 ${name}`;
        const time = m.created_at || m.timestamp ? new Date(m.created_at || m.timestamp).toLocaleString('pt-BR') : '';
        const isAudio = m.type === 'audio' || !!m.audio_transcript;
        const text = m.text || m.audio_transcript || (isAudio ? '[Áudio enviado]' : '[Mensagem sem texto]');
        const audioBadge = isAudio ? ' 🎙️ *(Áudio)*' : '';
        return `> **${sender}** (${time})${audioBadge}:\n> ${text}\n`;
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
- **Status da Fase:** \`${contact.currentPhase || 'conexao_inicial'}\`
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
  const phase = contact.currentPhase || 'conexao_inicial';
  const stageName = phase === 'conexao_inicial' ? 'Conexão Inicial' : 'Descoberta';
  const updatedAt = contact.updatedAt || '2026-09-18T00:00:00.000Z';

  const goals = Array.isArray(contact.checklist?.goals) ? contact.checklist.goals : [];
  let goalsSection = '';
  if (goals.length > 0) {
    goalsSection = goals
      .map((g) => {
        const isDone = g.status === 'completed';
        const box = isDone ? '[x]' : '[ ]';
        const valStr = isDone && g.value !== undefined && g.value !== null && g.value !== true
          ? `: **${g.value}**`
          : '';
        return `- ${box} **${g.label}**${valStr}`;
      })
      .join('\n');
  } else {
    goalsSection = `
- [ ] **Idade**
- [ ] **Cidade**
- [ ] **Profissão**
- [ ] **Relacionamento / Filhos**
`;
  }

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
export function generateEpisodesMarkdown(contact, episodes = []) {
  const cId = contact.contactId || contact.id;
  const name = getCleanName(contact);
  const safeName = sanitizePathSegment(name);
  const updatedAt = contact.updatedAt || '2026-09-18T00:00:00.000Z';

  let episodesSection = '';
  if (Array.isArray(episodes) && episodes.length > 0) {
    episodesSection = episodes
      .map((ep) => {
        const actorLabel = ep.actor === 'larissa' ? '🌸 Larissa' : `👤 ${name}`;
        const time = ep.created_at ? new Date(ep.created_at).toLocaleString('pt-BR') : '';
        const topic = ep.topic ? ` \`#${ep.topic}\`` : '';
        return `- **${actorLabel}** (${ep.event_type}${topic}) — ${time}:\n  - *${ep.summary}*`;
      })
      .join('\n');
  } else {
    episodesSection = `
_Nenhum episódio estruturado registrado na tabela de memória episódica ainda._

> **Nota Arquitetural:** Os próximos turnos confirmados registrarão automaticamente perguntas da Larissa, respostas do pretendente e áudios enviados para garantir **anti-repetição sob demanda**.
`;
  }

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

## ⚡ Atos de Fala & Memória Episódica (Anti-Repetição)

${episodesSection}
`;
}

/**
 * Formata: 05 - Metadados de <Nome>.md (Orquestração Técnica)
 */
export function generateMetadataMarkdown(contact) {
  const cId = contact.contactId || contact.id;
  const name = getCleanName(contact);
  const safeName = sanitizePathSegment(name);
  const updatedAt = contact.updatedAt || '2026-09-18T00:00:00.000Z';

  const metaPayload = {
    id: cId,
    fullName: contact.fullName,
    username: contact.username,
    currentPhase: contact.currentPhase,
    checkpoint: contact.checkpoint,
    updatedAt: contact.updatedAt,
    checklist: contact.checklist,
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

    const filesToWrite = [
      { file: `00 - ${safeName}.md`, content: generateHubMarkdown(c) },
      { file: `01 - Sobre ${safeName}.md`, content: generateAboutMarkdown(c) },
      { file: `02 - Conversa com ${safeName}.md`, content: generateConversationMarkdown(c) },
      { file: `03 - Objetivos de ${safeName}.md`, content: generateObjectivesMarkdown(c) },
      { file: `04 - Episódios de ${safeName}.md`, content: generateEpisodesMarkdown(c) },
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
