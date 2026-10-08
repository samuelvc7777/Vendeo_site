import fs from "node:fs";

const sqlPath = "scripts/consolidated-multichannel-migration.sql";
const content = fs.readFileSync(sqlPath, "utf8");

console.log(`[SQL Audit] Verificando ${sqlPath} (${content.length} bytes)...`);
console.log("[SQL Audit] As verificações deste script são textuais e não substituem um parser PostgreSQL, execução em banco de teste ou revisão de segurança.");

let errors = 0;

// 1. Checa BEGIN e COMMIT
if (!content.includes("BEGIN;") || !content.includes("COMMIT;")) {
  console.error("❌ ERRO: Faltando BEGIN; ou COMMIT;");
  errors++;
} else {
  console.log("✅ Bloco transacional BEGIN/COMMIT detectado.");
}

// 2. Checa balanceamento de parênteses básicos
const openParen = (content.match(/\(/g) || []).length;
const closeParen = (content.match(/\)/g) || []).length;
if (openParen !== closeParen) {
  console.error(`❌ ERRO: Parênteses desbalanceados: (=${openParen}, )=${closeParen}`);
  errors++;
} else {
  console.log(`✅ Parênteses balanceados: ${openParen} abertos e fechados.`);
}

// 3. Checa tags de dólar do plpgsql ($$ ... $$)
const dollarTags = (content.match(/\$\$/g) || []).length;
if (dollarTags % 2 !== 0) {
  console.error(`❌ ERRO: Delimitadores $$ desbalanceados: ${dollarTags}`);
  errors++;
} else {
  console.log(`✅ Delimitadores $$ balanceados: ${dollarTags / 2} funções plpgsql.`);
}

// 4. Checa tabelas fundamentais criadas
const requiredTables = [
  "conversation_channel_identities",
  "conversation_channel_transfers",
  "tinder_sync_state"
];
for (const tbl of requiredTables) {
  if (content.includes(`CREATE TABLE IF NOT EXISTS public.${tbl}`)) {
    console.log(`✅ Tabela public.${tbl} declarada.`);
  } else {
    console.error(`❌ ERRO: Tabela public.${tbl} ausente!`);
    errors++;
  }
}

// 5. Checa RPCs declaradas
const requiredFunctions = [
  "link_conversation_channel_identity_atomic",
  "claim_tinder_sync_lease",
  "set_tinder_sync_cursor",
  "release_tinder_sync_lease"
];
for (const fn of requiredFunctions) {
  if (content.includes(`FUNCTION public.${fn}`)) {
    console.log(`✅ Função public.${fn} declarada.`);
  } else {
    console.error(`❌ ERRO: Função public.${fn} ausente!`);
    errors++;
  }
}

// 6. Checa RLS hardening
const rlsTables = [
  "whatsapp2_delivery_queue",
  "whatsapp2_gateway_config",
  "openai_conversation_links",
  "openai_message_receipts"
];
for (const tbl of rlsTables) {
  if (content.includes(`ALTER TABLE IF EXISTS public.${tbl} ENABLE ROW LEVEL SECURITY;`)) {
    console.log(`✅ RLS ativado para ${tbl}.`);
  } else {
    console.error(`❌ ERRO: RLS ausente para ${tbl}!`);
    errors++;
  }
}

if (errors === 0) {
  console.log("\n✅ Verificações textuais básicas passaram. A sintaxe e a segurança ainda precisam de validação em PostgreSQL antes da execução.");
  process.exit(0);
} else {
  console.error(`\n❌ Falha na auditoria com ${errors} erros.`);
  process.exit(1);
}
