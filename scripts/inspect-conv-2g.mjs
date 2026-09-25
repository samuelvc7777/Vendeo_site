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
  console.log("=== BUSCANDO CONVERSAS COM '2g' ===");
  const { data: convs, error } = await supabase
    .from("instagram_conversations")
    .select("id, username, full_name, last_message, last_message_at, updated_at")
    .or("username.ilike.%2g%,full_name.ilike.%2g%,id.ilike.%2g%")
    .limit(20);

  if (error) {
    console.error("Erro ao buscar conversas:", error);
    return;
  }

  console.log(`Encontradas ${convs?.length || 0} conversas:`);
  for (const c of convs || []) {
    console.log(`ID: ${c.id} | User: ${c.username} | Name: ${c.full_name}`);
    console.log(`  Last msg: ${c.last_message} (${c.last_message_at})`);
  }

  // Se encontrar alguma, vamos pegar as últimas mensagens dessa conversa
  if (convs && convs.length > 0) {
    for (const c of convs) {
      console.log(`\n--- ÚLTIMAS 10 MENSAGENS DE ${c.username} (${c.id}) ---`);
      const { data: msgs } = await supabase
        .from("instagram_messages")
        .select("id, sender_id, text, is_mine, timestamp, created_at")
        .or(`conversation_id.eq.${c.id},contact_id.eq.${c.id}`)
        .order("created_at", { ascending: false })
        .limit(10);

      if (msgs) {
        for (const m of msgs.reverse()) {
          console.log(`[${m.is_mine ? "LARISSA" : "ELE"}] (${m.created_at || m.timestamp}): ${m.text}`);
        }
      }
    }
  } else {
    // Se não encontrou por '2g', vamos buscar as últimas 5 conversas ativas no geral
    console.log("\nNenhuma conversa com '2g' no nome. Buscando as 5 conversas mais recentes atualizadas:");
    const { data: recentConvs } = await supabase
      .from("instagram_conversations")
      .select("id, username, full_name, last_message, last_message_at")
      .order("last_message_at", { ascending: false, nullsFirst: false })
      .limit(5);

    for (const rc of recentConvs || []) {
      console.log(`ID: ${rc.id} | User: ${rc.username} | Name: ${rc.full_name} | Last: ${rc.last_message}`);
    }
  }
}

main();
