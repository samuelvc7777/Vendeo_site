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
    parseInt,
    isNaN,
  });

  return mod.exports;
}

const ep = loadEpisodicModule();

const queries = [
  'já perguntei profissão?',
  'ele já falou onde mora?',
  'já falei meu curso?',
  'já mandei áudio sobre faculdade?',
  'já falei de filhos em áudio?',
];

async function main() {
  const { createClient } = await import('@supabase/supabase-js');
  const supabase = createClient(supabaseUrl, supabaseServiceKey, { auth: { persistSession: false } });

  const targets = [
    { label: 'Moose', id: '17711037248039322', name: 'moose.59461214' },
    { label: 'Douglas Silva', id: '1008193875570938', name: 'Douglas Silva' },
  ];

  for (const target of targets) {
    console.log(`======================================================================`);
    console.log(`CONVERSA: ${target.label} (ID: ${target.id} | Nome: "${target.name}")`);
    console.log(`======================================================================`);

    const { data: convEpisodes } = await supabase
      .from('conversation_episodic_memory')
      .select('*')
      .eq('conversation_id', target.id)
      .order('created_at', { ascending: false });

    console.log(`Total de episódios gravados: ${convEpisodes?.length || 0}`);

    for (const q of queries) {
      const results = await ep.searchConversationEpisodicMemory({
        supabase,
        conversationId: target.id,
        query: q,
        limit: 3,
      });

      console.log(`\n  Q: "${q}" -> Encontrados: ${results.length}`);
      if (results.length > 0) {
        for (const r of results) {
          console.log(`     [${r.actor}::${r.event_type}::${r.topic || 'none'}] (relevance: ${r.relevance})`);
          console.log(`     "${r.summary}"`);
        }
      } else {
        console.log(`     (Nenhum episódio relevante para este contato)`);
      }
    }
    console.log('\n');
  }
}

main().catch(console.error);
