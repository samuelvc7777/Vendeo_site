#!/usr/bin/env node
/**
 * obsidian-memory-sync.mjs
 * 
 * Sincronizador Unidirecional: Supabase (Fonte Oficial) -> Obsidian (Espelho Visual Local)
 * 
 * Regras Estritas:
 * 1. O Supabase é a ÚNICA fonte de verdade de produção.
 * 2. O Obsidian é estritamente de leitura para humanos. ZERO sincronização reversa.
 * 3. Escrita atômica via .tmp + renameSync.
 * 4. Preservação de arquivos manuais: arquivos sem "vendeo_managed: true" JAMAIS são alterados.
 * 5. Detecção de mudança por hash SHA-256 (não reescreve arquivos idênticos).
 * 
 * Modos:
 *   node scripts/obsidian-memory-sync.mjs --once
 *   node scripts/obsidian-memory-sync.mjs --watch [intervalo_segundos]
 *   node scripts/obsidian-memory-sync.mjs --contact <contact_id>
 *   node scripts/obsidian-memory-sync.mjs --vault <caminho_do_vault>
 */

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

let envLoaded = false;

/**
 * Lê arquivos .env ou .env.local sem dependências externas
 */
export function loadEnv(projectRoot = process.cwd(), force = false) {
  if (envLoaded && !force) return;
  envLoaded = true;
  const envFiles = ['.env.local', '.env'];
  for (const file of envFiles) {
    const fullPath = path.resolve(projectRoot, file);
    if (fs.existsSync(fullPath)) {
      try {
        const content = fs.readFileSync(fullPath, 'utf8');
        for (const line of content.split('\n')) {
          const trimmed = line.trim();
          if (!trimmed || trimmed.startsWith('#')) continue;
          const eqIdx = trimmed.indexOf('=');
          if (eqIdx > 0) {
            const key = trimmed.slice(0, eqIdx).trim();
            let val = trimmed.slice(eqIdx + 1).trim();
            if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
              val = val.slice(1, -1);
            }
            if (!process.env[key]) {
              process.env[key] = val;
            }
          }
        }
      } catch {}
    }
  }
}

// Carrega variáveis no carregamento inicial do módulo
loadEnv();

/**
 * Detecta o caminho do vault do Obsidian com regras estritas:
 * A) Se explicitPath fornecido (--vault): usa exclusivamente ele se existir, senão lança erro.
 * B) Senão, se OBSIDIAN_VAULT_PATH existe no ambiente: usa exclusivamente ele se existir, senão lança erro.
 * C) Senão, lê a configuração oficial/local do Obsidian:
 *    - Se existir exatamente 1 vault válido: usa ele.
 *    - Se existirem 0 vaults válidos: FALHA com erro claro.
 *    - Se existirem 2 ou mais vaults válidos: FALHA listando todos eles e exigindo configuração explícita.
 *    - NUNCA escolhe o primeiro, nunca filtra por nome ("memoria"/"vendeo"), NUNCA cria pasta de falso vault.
 */
export function resolveVaultPath(explicitPath = null, customObsidianConfigPath = null) {
  // A) Se --vault foi fornecido via CLI
  if (explicitPath) {
    const resolved = path.resolve(explicitPath);
    if (!fs.existsSync(resolved) || !fs.statSync(resolved).isDirectory()) {
      throw new Error(`Caminho de vault fornecido via --vault não existe ou não é um diretório: ${resolved}`);
    }
    return resolved;
  }

  // B) Senão, se OBSIDIAN_VAULT_PATH existe no ambiente
  if (process.env.OBSIDIAN_VAULT_PATH) {
    const resolved = path.resolve(process.env.OBSIDIAN_VAULT_PATH);
    if (!fs.existsSync(resolved) || !fs.statSync(resolved).isDirectory()) {
      throw new Error(`Caminho em OBSIDIAN_VAULT_PATH não existe ou não é um diretório: ${resolved}`);
    }
    return resolved;
  }

  // C) Senão, descobre a configuração do Obsidian no sistema operacional
  let obsConfigPath = customObsidianConfigPath;
  if (!obsConfigPath) {
    const appData = process.env.APPDATA; // Windows
    const home = process.env.USERPROFILE || process.env.HOME || '';
    if (appData) {
      obsConfigPath = path.join(appData, 'obsidian', 'obsidian.json');
    } else if (process.platform === 'darwin' && home) {
      obsConfigPath = path.join(home, 'Library', 'Application Support', 'obsidian', 'obsidian.json');
    } else if (home) {
      obsConfigPath = path.join(home, '.config', 'obsidian', 'obsidian.json');
    }
  }

  const configuredVaults = [];
  if (obsConfigPath && fs.existsSync(obsConfigPath)) {
    try {
      const obsData = JSON.parse(fs.readFileSync(obsConfigPath, 'utf8'));
      if (obsData.vaults && typeof obsData.vaults === 'object') {
        for (const key of Object.keys(obsData.vaults)) {
          const v = obsData.vaults[key];
          if (v && v.path && typeof v.path === 'string') {
            const resolved = path.resolve(v.path);
            if (fs.existsSync(resolved) && fs.statSync(resolved).isDirectory()) {
              if (!configuredVaults.includes(resolved)) {
                configuredVaults.push(resolved);
              }
            }
          }
        }
      }
    } catch {}
  }

  // Regra C:
  // Se existir exatamente 1 vault válido
  if (configuredVaults.length === 1) {
    return configuredVaults[0];
  }

  // Se existirem 0 vaults válidos
  if (configuredVaults.length === 0) {
    throw new Error(
      'Nenhum vault do Obsidian foi encontrado no sistema. Especifique o diretório do vault usando o argumento --vault <caminho> ou a variável de ambiente OBSIDIAN_VAULT_PATH.'
    );
  }

  // Se existirem 2 ou mais vaults válidos: FALHA e lista os caminhos encontrados
  const vaultList = configuredVaults.map((vp) => `  - ${vp}`).join('\n');
  throw new Error(
    `Múltiplos vaults do Obsidian foram encontrados (${configuredVaults.length} vaults):\n${vaultList}\nDefina explicitamente qual vault deseja usar através da variável de ambiente OBSIDIAN_VAULT_PATH ou do argumento --vault <caminho>.`
  );
}

/**
 * Sanitiza nomes de arquivos e pastas para o sistema de arquivos
 */
export function sanitizePathSegment(name) {
  if (!name || typeof name !== 'string') return 'sem_nome';
  // Remove caracteres inválidos no Windows: \ / : * ? " < > | e caracteres de controle
  const sanitized = name.replace(/[\s_]*[\\/:*?"<>|\r\n\t]+[\s_]*/g, '_').trim();
  return sanitized.replace(/_+/g, '_').replace(/^_+|_+$/g, '') || 'sem_nome';
}

/**
 * Gera hash SHA-256 do conteúdo para verificação de mudanças
 */
export function computeSha256(content) {
  return crypto.createHash('sha256').update(content, 'utf8').digest('hex');
}

/**
 * Verifica se o arquivo é gerenciado pelo Vendeo
 * Se o arquivo não existir, retorna true (novo arquivo).
 * Se existir, exige que contenha 'vendeo_managed: true' no frontmatter.
 */
export function isVendeoManaged(filePath) {
  if (!fs.existsSync(filePath)) return true;
  try {
    const content = fs.readFileSync(filePath, 'utf8');
    // Checa o cabeçalho frontmatter
    const frontmatterMatch = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
    if (!frontmatterMatch) return false;
    const yamlBody = frontmatterMatch[1];
    return /vendeo_managed\s*:\s*true/i.test(yamlBody);
  } catch {
    return false;
  }
}

/**
 * Escrita Atômica e Segura no Disco
 * - Não sobrescreve arquivos manuais do usuário (sem vendeo_managed: true).
 * - Não regrava arquivos idênticos (mesmo hash SHA-256).
 * - Escreve em arquivo temporário antes de substituir.
 */
export function atomicWriteFileIfChanged(filePath, newContent) {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  if (fs.existsSync(filePath)) {
    // 1. Preservação estrita de arquivos do usuário
    if (!isVendeoManaged(filePath)) {
      console.warn(`[PRESERVADO] Arquivo manual do usuário mantido intacto: ${filePath}`);
      return { written: false, skippedManual: true };
    }

    // 2. Detecção de mudança de conteúdo por hash
    const existingContent = fs.readFileSync(filePath, 'utf8');
    if (computeSha256(existingContent) === computeSha256(newContent)) {
      return { written: false, skippedUnchanged: true };
    }
  }

  // 3. Escrita atômica via arquivo temporário
  const tempPath = `${filePath}.tmp.${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
  try {
    fs.writeFileSync(tempPath, newContent, 'utf8');
    fs.renameSync(tempPath, filePath);
    return { written: true, skippedManual: false, skippedUnchanged: false };
  } catch (err) {
    if (fs.existsSync(tempPath)) {
      try { fs.unlinkSync(tempPath); } catch {}
    }
    throw err;
  }
}

/**
 * Formata o arquivo principal do contato: 'Sobre ele.md'
 */
export function formatProfileMarkdown(contact) {
  const cId = contact.contactId || contact.id;
  const name = contact.fullName || cId;
  const username = contact.username ? `@${contact.username}` : 'Não informado';
  const phase = contact.currentPhase || 'conexao_inicial';
  const checkpoint = contact.checkpoint || 'Nenhum';
  const updatedAt = contact.updatedAt || new Date().toISOString();

  const selfFacts = contact.memory?.entities?.self || {};
  const selfFields = Object.keys(selfFacts);

  let selfSection = 'Nenhum fato específico registrado ainda sobre o pretendente.';
  if (selfFields.length > 0) {
    selfSection = selfFields
      .map((field) => {
        const item = selfFacts[field];
        const val = item?.value !== undefined ? item.value : item;
        const prov = item?.sourceMessageId ? ` *(origem: ${item.sourceMessageId})*` : '';
        return `- **${field}:** ${val}${prov}`;
      })
      .join('\n');
  }

  // Checklist Semântico da Fase (Goals)
  const checklistGoals = Array.isArray(contact.checklist?.goals) ? contact.checklist.goals : [];
  let checklistSection = '';
  if (checklistGoals.length > 0) {
    checklistSection = checklistGoals
      .map((g) => {
        const isDone = g.status === 'completed';
        const box = isDone ? '[x]' : '[ ]';
        const valStr = isDone && g.value !== undefined && g.value !== null && g.value !== true
          ? `: ${g.value}`
          : '';
        return `- ${box} **${g.label}**${valStr}`;
      })
      .join('\n');
  } else {
    // Derivação automática resiliente a partir de selfFacts
    const ageVal = selfFacts.age?.value !== undefined ? selfFacts.age.value : selfFacts.age;
    const cityVal = selfFacts.city?.value !== undefined ? selfFacts.city.value : selfFacts.city;
    const jobVal = selfFacts.job?.value !== undefined ? selfFacts.job.value : selfFacts.job;
    const relVal = selfFacts.relationship_status?.value !== undefined ? selfFacts.relationship_status.value : selfFacts.relationship_status;

    checklistSection = [
      `- [${ageVal ? 'x' : ' '}] **Idade**${ageVal ? `: ${ageVal}` : ''}`,
      `- [${cityVal ? 'x' : ' '}] **Cidade**${cityVal ? `: ${cityVal}` : ''}`,
      `- [${jobVal ? 'x' : ' '}] **Profissão**${jobVal ? `: ${jobVal}` : ''}`,
      `- [${relVal ? 'x' : ' '}] **Relacionamento / Filhos**${relVal ? `: ${relVal}` : ''}`,
    ].join('\n');
  }

  const snippets = Array.isArray(contact.memory?.snippets) ? contact.memory.snippets : [];
  let snippetsSection = 'Nenhum trecho registrado.';
  if (snippets.length > 0) {
    snippetsSection = snippets
      .map((s) => {
        const text = typeof s === 'string' ? s : s?.text || JSON.stringify(s);
        const source = s?.sourceMessageId ? ` *(origem: ${s.sourceMessageId})*` : '';
        return `- > "${text}"${source}`;
      })
      .join('\n');
  }

  return `---
vendeo_managed: true
vendeo_contact_id: "${cId}"
vendeo_type: "profile"
full_name: "${name.replace(/"/g, '\\"')}"
username: "${contact.username || ''}"
current_phase: "${phase}"
checkpoint: "${checkpoint}"
updated_at: "${updatedAt}"
---

# Perfil: ${name}

- **ID do Contato:** \`${cId}\`
- **Nome Completo:** ${name}
- **Instagram Username:** ${username}
- **Fase da Conversa:** \`${phase}\`
- **Último Checkpoint:** \`${checkpoint}\`
- **Última Atualização:** ${updatedAt}

---

## Fatos Conhecidos (Sobre Ele)

${selfSection}

---

## Checklist — Descoberta

${checklistSection}

---

## Trechos e Observações Relevantes

${snippetsSection}
`;
}

/**
 * Formata arquivos de entidades secundárias em 'Pessoas/<Entidade>.md'
 */
export function formatEntityMarkdown(contact, entityName, facts) {
  const cId = contact.contactId || contact.id;
  const fields = Object.keys(facts || {});
  let factsSection = 'Nenhum fato detalhado.';
  if (fields.length > 0) {
    factsSection = fields
      .map((f) => {
        const item = facts[f];
        const val = item?.value !== undefined ? item.value : item;
        const prov = item?.sourceMessageId ? ` *(origem: ${item.sourceMessageId})*` : '';
        return `- **${f}:** ${val}${prov}`;
      })
      .join('\n');
  }

  return `---
vendeo_managed: true
vendeo_contact_id: "${cId}"
vendeo_type: "entity"
entity_name: "${entityName}"
updated_at: "${contact.updatedAt || new Date(0).toISOString()}"
---

# Entidade Relacionada: ${entityName}

- **Pretendente Associado:** ${contact.fullName || cId} (\`${cId}\`)
- **Identificador da Entidade:** \`${entityName}\`

---

## Fatos Registrados

${factsSection}
`;
}

/**
 * Formata o arquivo 'Metadados.md'
 */
export function formatMetadataMarkdown(contact) {
  const cId = contact.contactId || contact.id;
  const orchData = {
    id: cId,
    fullName: contact.fullName,
    username: contact.username,
    currentPhase: contact.currentPhase,
    checkpoint: contact.checkpoint,
    updatedAt: contact.updatedAt,
    memorySnapshot: contact.memory,
  };

  return `---
vendeo_managed: true
vendeo_contact_id: "${cId}"
vendeo_type: "metadata"
updated_at: "${contact.updatedAt || new Date(0).toISOString()}"
---

# Metadados de Orquestração: ${contact.fullName || cId}

\`\`\`json
${JSON.stringify(orchData, null, 2)}
\`\`\`
`;
}

/**
 * Sincroniza um contato específico no vault local
 */
export function syncContactToVault(vaultRoot, contact) {
  const baseDir = path.join(vaultRoot, 'Vendeo Memory', 'Contatos');
  const cId = contact.contactId || contact.id;
  const folderName = sanitizePathSegment(contact.fullName ? `${contact.fullName} (${cId})` : cId);
  const contactDir = path.join(baseDir, folderName);

  let createdCount = 0;
  let updatedCount = 0;
  let unchangedCount = 0;
  let preservedCount = 0;

  // 1. 'Sobre ele.md'
  const profilePath = path.join(contactDir, 'Sobre ele.md');
  const profileContent = formatProfileMarkdown(contact);
  const profileRes = atomicWriteFileIfChanged(profilePath, profileContent);
  if (profileRes.written) updatedCount++;
  else if (profileRes.skippedUnchanged) unchangedCount++;
  else if (profileRes.skippedManual) preservedCount++;

  // 2. 'Metadados.md'
  const metaPath = path.join(contactDir, 'Metadados.md');
  const metaContent = formatMetadataMarkdown(contact);
  const metaRes = atomicWriteFileIfChanged(metaPath, metaContent);
  if (metaRes.written) updatedCount++;
  else if (metaRes.skippedUnchanged) unchangedCount++;
  else if (metaRes.skippedManual) preservedCount++;

  // 3. Entidades em 'Pessoas/<Entidade>.md'
  const entities = contact.memory?.entities || {};
  for (const entityKey of Object.keys(entities)) {
    if (entityKey === 'self') continue; // self já está no Sobre ele.md
    const entityFacts = entities[entityKey];
    const safeEntityName = sanitizePathSegment(entityKey);
    const entityPath = path.join(contactDir, 'Pessoas', `${safeEntityName}.md`);
    const entityContent = formatEntityMarkdown(contact, entityKey, entityFacts);
    const entityRes = atomicWriteFileIfChanged(entityPath, entityContent);
    if (entityRes.written) updatedCount++;
    else if (entityRes.skippedUnchanged) unchangedCount++;
    else if (entityRes.skippedManual) preservedCount++;
  }

  return { contactDir, updatedCount, unchangedCount, preservedCount };
}

/**
 * Busca dados da Edge Function do Supabase com paginação determinística
 */
export async function fetchRemoteMemories(supabaseUrl, token, contactId = null) {
  const baseUrl = supabaseUrl.replace(/\/$/, '');

  if (contactId) {
    const endpoint = `${baseUrl}/functions/v1/api/internal/memory-export?contact_id=${encodeURIComponent(contactId)}`;
    const res = await fetch(endpoint, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Accept': 'application/json',
      },
    });

    if (!res.ok) {
      const errorBody = await res.text().catch(() => '');
      throw new Error(`Falha ao exportar memórias do Supabase (HTTP ${res.status}): ${errorBody}`);
    }

    const data = await res.json();
    if (!data.success || !Array.isArray(data.contacts)) {
      throw new Error('Resposta do Supabase inválida ou sem contatos.');
    }
    return data.contacts;
  }

  // Exportação em massa paginada para garantir que nenhum contato seja truncado
  const allContacts = [];
  const pageSize = 100;
  let offset = 0;
  let hasMore = true;

  while (hasMore) {
    const endpoint = `${baseUrl}/functions/v1/api/internal/memory-export?limit=${pageSize}&offset=${offset}`;
    const res = await fetch(endpoint, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Accept': 'application/json',
      },
    });

    if (!res.ok) {
      const errorBody = await res.text().catch(() => '');
      throw new Error(`Falha ao exportar memórias do Supabase (HTTP ${res.status}): ${errorBody}`);
    }

    const data = await res.json();
    if (!data.success || !Array.isArray(data.contacts)) {
      throw new Error('Resposta do Supabase inválida ou sem contatos.');
    }

    allContacts.push(...data.contacts);
    if (data.contacts.length < pageSize || data.hasMore === false) {
      hasMore = false;
    } else {
      offset += pageSize;
    }
  }

  return allContacts;
}

/**
 * Execução Principal do Sincronizador
 */
export async function runSync(options = {}) {
  loadEnv();

  const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const token = process.env.OBSIDIAN_SYNC_TOKEN;

  if (!supabaseUrl) {
    throw new Error('Configuração ausente: SUPABASE_URL não foi encontrada nas variáveis de ambiente.');
  }
  if (!token) {
    throw new Error('Configuração ausente: OBSIDIAN_SYNC_TOKEN não configurado.');
  }

  const vaultPath = resolveVaultPath(options.vault);
  console.log(`[Obsidian Sync] Vault alvo: ${vaultPath}`);

  if (!fs.existsSync(vaultPath)) {
    throw new Error(`Vault do Obsidian não encontrado: ${vaultPath}`);
  }

  console.log(`[Obsidian Sync] Buscando memórias no Supabase...`);
  const contacts = await fetchRemoteMemories(supabaseUrl, token, options.contactId);
  console.log(`[Obsidian Sync] ${contacts.length} contato(s) retornado(s) pelo Supabase.`);

  let totalUpdated = 0;
  let totalUnchanged = 0;
  let totalPreserved = 0;

  for (const c of contacts) {
    const res = syncContactToVault(vaultPath, c);
    totalUpdated += res.updatedCount;
    totalUnchanged += res.unchangedCount;
    totalPreserved += res.preservedCount;
  }

  console.log(`[Obsidian Sync] Concluído: ${totalUpdated} arquivo(s) gravado(s)/atualizado(s), ${totalUnchanged} inalterado(s), ${totalPreserved} manual(is) preservado(s).`);
  return { totalUpdated, totalUnchanged, totalPreserved, contactsCount: contacts.length, vaultPath };
}

// Execução CLI caso seja chamado diretamente
const isDirectRun = process.argv[1] && (process.argv[1].endsWith('obsidian-memory-sync.mjs') || process.argv[1].endsWith('obsidian-memory-sync'));
if (isDirectRun) {
  const args = process.argv.slice(2);
  const isWatch = args.includes('--watch');
  const isOnce = args.includes('--once') || !isWatch;

  let contactId = null;
  const contactIdx = args.indexOf('--contact');
  if (contactIdx >= 0 && args[contactIdx + 1]) {
    contactId = args[contactIdx + 1];
  }

  let vault = null;
  const vaultIdx = args.indexOf('--vault');
  if (vaultIdx >= 0 && args[vaultIdx + 1]) {
    vault = args[vaultIdx + 1];
  }

  let watchIntervalSec = 15;
  const watchIdx = args.indexOf('--watch');
  if (watchIdx >= 0 && args[watchIdx + 1] && !args[watchIdx + 1].startsWith('--')) {
    const parsed = parseInt(args[watchIdx + 1], 10);
    if (!isNaN(parsed) && parsed > 0) watchIntervalSec = parsed;
  }

  (async () => {
    try {
      if (isWatch) {
        console.log(`[Obsidian Sync] Modo WATCH ativado (intervalo: ${watchIntervalSec}s). Pressione Ctrl+C para encerrar.`);
        const loop = async () => {
          try {
            await runSync({ contactId, vault });
          } catch (err) {
            console.error(`[Obsidian Sync] Erro na iteração do watch:`, err.message);
          }
          setTimeout(loop, watchIntervalSec * 1000);
        };
        await loop();
      } else {
        await runSync({ contactId, vault });
      }
    } catch (err) {
      console.error(`[Obsidian Sync] Erro fatal:`, err.message);
      process.exit(1);
    }
  })();
}
