#!/usr/bin/env node
// Deploy vendeo-brain-mcp via Supabase Management API diretamente
// Usa o SUPABASE_ACCESS_TOKEN do MCP Supabase ou variável de ambiente

import fs from "node:fs";
import path from "node:path";

const envPath = path.resolve(import.meta.dirname, "../.env.local");
if (fs.existsSync(envPath)) {
  const lines = fs.readFileSync(envPath, "utf8").split("\n");
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIdx = trimmed.indexOf("=");
    if (eqIdx <= 0) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    let val = trimmed.slice(eqIdx + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    if (!process.env[key]) process.env[key] = val;
  }
}

const PROJECT_REF = "wsdualhvopidgqcumonr";
const FUNCTION_SLUG = "vendeo-brain-mcp";

// Ler os 3 arquivos
const indexTs = fs.readFileSync(path.resolve(import.meta.dirname, "../supabase/functions/vendeo-brain-mcp/index.ts"), "utf8");
const personaTs = fs.readFileSync(path.resolve(import.meta.dirname, "../supabase/functions/vendeo-brain-mcp/_shared/persona_memory.ts"), "utf8");
const telemetryTs = fs.readFileSync(path.resolve(import.meta.dirname, "../supabase/functions/vendeo-brain-mcp/_shared/telemetry.ts"), "utf8");

console.log(`Arquivos lidos:`);
console.log(`  index.ts: ${indexTs.length} bytes`);
console.log(`  _shared/persona_memory.ts: ${personaTs.length} bytes`);
console.log(`  _shared/telemetry.ts: ${telemetryTs.length} bytes`);

// Obter token do SUPABASE_ACCESS_TOKEN (mesmo usado pelo MCP server)
const accessToken = process.env.SUPABASE_ACCESS_TOKEN;
if (!accessToken) {
  console.error("ERRO: SUPABASE_ACCESS_TOKEN não configurado.");
  console.error("Configure via: set SUPABASE_ACCESS_TOKEN=<seu_token>");
  process.exit(1);
}

const payload = {
  slug: FUNCTION_SLUG,
  name: FUNCTION_SLUG,
  verify_jwt: false,
  entrypoint_path: "index.ts",
  import_map: false,
};

// A Supabase Management API espera um multipart form com os arquivos
// Vamos usar a API REST v1
const API_URL = `https://api.supabase.com/v1/projects/${PROJECT_REF}/functions/${FUNCTION_SLUG}`;

const body = JSON.stringify({
  verify_jwt: false,
  entrypoint_path: "index.ts",
  import_map: false,
});

console.log(`\nDeployando ${FUNCTION_SLUG} para ${PROJECT_REF}...`);

try {
  const res = await fetch(API_URL, {
    method: "PATCH",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body,
  });
  const text = await res.text();
  console.log(`Status: ${res.status}`);
  console.log(`Response: ${text}`);
} catch (err) {
  console.error("Erro no deploy:", err);
}
