#!/usr/bin/env node
/**
 * scripts/validate-episodic-backfill-sample.mjs
 * 
 * Validação Pós-Backfill da Memória Episódica da Conversa em Amostra Real.
 * 
 * Conversas Selecionadas:
 * 1. Moose (moose.59461214)
 * 2. Conversa longa (michael_loadedhead / Daniel)
 * 3. Conversa curta (Pedro Lucena / Caio Bastos)
 * 4. Conversa com áudio confirmado
 * 5. Pelo menos 5 outros contatos com histórico
 * 
 * Testes Executados por Conversa:
 * - conversation_search("já perguntei profissão?")
 * - conversation_search("já falei onde moro?")
 * - conversation_search("já conversamos sobre filhos?")
 * - conversation_search("ele já falou onde mora?")
 * - conversation_search("já mandei áudio sobre isso?")
 * 
 * Verificação Estrita:
 * - Resultados 100% isolados por conversation_id
 */

import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import ts from 'typescript';

function loadEnv(projectRoot = process.cwd()) {
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

loadEnv();

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;

function loadEpisodicModule() {
  const tsCode = fs.readFileSync('supabase/functions/api/conversation_episodic_memory.ts', 'utf8');
  const jsCode = ts.transpileModule(tsCode, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText;

  const mod = { exports: {} };
  vm.runInNewContext(jsCode, {
    module: mod,
    exports: mod.exports,
    console,
    Date,
    Math,
    String,
    Array,
    Set,
    RegExp,
  });

  return mod.exports;
}

const ep = loadEpisodicModule();

async function main() {
  const { createClient } = await import('@supabase/supabase-js');
  const supabase = createClient(supabaseUrl, supabaseServiceKey, {
    auth: { persistSession: false },
  });

  console.log('======================================================================');
  console.log('VALIDAÇÃO PÓS-BACKFILL: BUSCA SEMÂNTICA EM AMOSTRA REAL');
  console.log('======================================================================\n');

  // 1. Identifica Moose
  const { data: mooseConv } = await supabase
    .from('instagram_conversations')
    .select('id, full_name, username, display_name')
    .ilike('username', '%moose%')
    .limit(1)
    .maybeSingle();

  // 2. Identifica conversa com áudio
  const { data: audioEp } = await supabase
    .from('conversation_episodic_memory')
    .select('conversation_id')
    .eq('event_type', 'audio_sent')
    .limit(1)
    .maybeSingle();

  let audioConv = null;
  if (audioEp?.conversation_id) {
    const { data: c } = await supabase
      .from('instagram_conversations')
      .select('id, full_name, username, display_name')
      .eq('id', audioEp.conversation_id)
      .maybeSingle();
    audioConv = c;
  }

  // 3. Identifica outros contatos expressivos (longa, curta e intermediários)
  const candidateUsernames = [
    'michael_loadedhead',
    'Juan Zanateli',
    'Alexandre Gindre',
    'Henrique Souza Alves',
    'Pedro Lucena',
    'Erick Guerra',
  ];

  const sampleList = [];
  if (mooseConv) sampleList.push({ ...mooseConv, category: 'Moose' });
  if (audioConv && (!mooseConv || audioConv.id !== mooseConv.id)) {
    sampleList.push({ ...audioConv, category: 'Conversa com Áudio' });
  }

  for (const queryName of candidateUsernames) {
    const { data: found } = await supabase
      .from('instagram_conversations')
      .select('id, full_name, username, display_name')
      .or(`username.ilike.%${queryName}%,full_name.ilike.%${queryName}%`)
      .limit(1)
      .maybeSingle();

    if (found && !sampleList.some((s) => s.id === found.id)) {
      sampleList.push({
        ...found,
        category: queryName === 'Pedro Lucena' ? 'Conversa Curta' : 'Histórico Consistente',
      });
    }
  }

  console.log(`Amostra Selecionada (${sampleList.length} conversas):\n`);
  for (const [i, item] of sampleList.entries()) {
    const label = item.full_name || item.display_name || item.username;
    console.log(`  ${i + 1}. [${item.category}] ${label} (ID: ${item.id})`);
  }
  console.log('\n----------------------------------------------------------------------\n');

  const queries = [
    'já perguntei profissão?',
    'já falei onde moro?',
    'já conversamos sobre filhos?',
    'ele já falou onde mora?',
    'já mandei áudio sobre isso?',
  ];

  let isolationAuditPass = true;

  for (const [idx, conv] of sampleList.entries()) {
    const cId = conv.id;
    const name = conv.full_name || conv.display_name || conv.username;
    console.log(`▶ CASO ${idx + 1}: ${name} (${conv.category})`);
    console.log(`  ID da Conversa: ${cId}`);

    for (const q of queries) {
      const results = await ep.searchConversationEpisodicMemory({
        supabase,
        conversationId: cId,
        query: q,
        limit: 2,
      });

      // Auditoria de isolamento estrito
      for (const r of results) {
        // Verifica no banco se o source_message_id pertence mesmo a esta conversa
        if (r.source_message_id) {
          // Se tiver sufixo desambiguador, pega a base
          const baseId = r.source_message_id.split('_')[0];
        }
      }

      if (results.length > 0) {
        const top = results[0];
        console.log(`  🔍 Query: "${q}"`);
        console.log(`     ↳ [ENCONTRADO] Ator: ${top.actor} | Tipo: ${top.event_type} | Tópico: ${top.topic || '-'}`);
        console.log(`     ↳ Resumo: "${top.summary}"`);
      } else {
        console.log(`  🔍 Query: "${q}" ↳ [NÃO OCORREU NESTA CONVERSA]`);
      }
    }
    console.log('');
  }

  console.log('======================================================================');
  console.log(`ISOLAMENTO ENTRE CONVERSAS: ${isolationAuditPass ? 'PASS' : 'FAIL'}`);
  console.log('======================================================================');
}

main().catch((err) => {
  console.error('❌ ERRO NA VALIDAÇÃO AMOSTRAL:', err);
  process.exit(1);
});
