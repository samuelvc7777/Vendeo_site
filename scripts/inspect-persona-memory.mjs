import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "fs";

let envContent = "";
try {
  envContent = readFileSync(".env.local", "utf8");
} catch {
  try {
    envContent = readFileSync(".env", "utf8");
  } catch {}
}

function getEnv(key) {
  const match = envContent.match(new RegExp(`${key}=(.*)`));
  return match ? match[1].trim().replace(/^['"]|['"]$/g, "") : process.env[key];
}

const url = getEnv("NEXT_PUBLIC_SUPABASE_URL") || getEnv("SUPABASE_URL");
const key = getEnv("SUPABASE_SERVICE_ROLE_KEY") || getEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY");

const supabase = createClient(url, key);

async function main() {
  console.log("=== INSPECIONANDO TABELA PERSONA_MEMORY ===");
  const { data, error } = await supabase.from("persona_memory").select("*");
  if (error) {
    console.error("Erro ao buscar persona_memory:", error);
    return;
  }
  console.log(`Encontrados ${data?.length || 0} registros em persona_memory:`);
  for (const r of data || []) {
    console.log(`[${r.category}] ${r.key} (${r.entity}): ${typeof r.value === 'object' ? JSON.stringify(r.value) : r.value}`);
  }
}

main();
