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

async function timeQuery(label, fn) {
  const start = performance.now();
  try {
    const res = await fn();
    const duration = (performance.now() - start).toFixed(2);
    const count = Array.isArray(res.data) ? res.data.length : (res.data ? 1 : 0);
    console.log(`[${duration}ms] ${label} -> ${res.error ? `ERRO: ${res.error.message}` : `${count} registros`}`);
    return { duration, error: res.error, count, data: res.data };
  } catch (err) {
    const duration = (performance.now() - start).toFixed(2);
    console.log(`[${duration}ms] ${label} -> EXCEPTION: ${err.message}`);
    return { duration, error: err, count: 0 };
  }
}

async function main() {
  console.log("=== DIAGNÓSTICO DE PERFORMANCE DE QUERIES SUPABASE ===\n");

  // 1. Contagem total de conversas
  await timeQuery("instagram_conversations count", () =>
    supabase.from("instagram_conversations").select("id", { count: "exact", head: true })
  );

  // 2. Query de lista de conversas do InstagramDirect (exatamente como o frontend faz)
  await timeQuery("InstagramDirect: loadInstagramConversations (limit 300)", () =>
    supabase
      .from("instagram_conversations")
      .select("id, username, full_name, avatar, last_message, last_message_at, last_direction, last_status, seen_at, unread, status, is_restricted, created_at, updated_at")
      .order("last_message_at", { ascending: false, nullsFirst: false })
      .limit(300)
  );

  // 3. Contagem total de mensagens
  await timeQuery("instagram_messages count", () =>
    supabase.from("instagram_messages").select("id", { count: "exact", head: true })
  );

  // 4. Query de mensagens recentes de uma conversa (como o frontend faz ao abrir conversa)
  // Pegamos a primeira conversa real
  const { data: convs } = await supabase.from("instagram_conversations").select("id").limit(1);
  const sampleConvId = convs?.[0]?.id || "sample";
  console.log(`\nConversa de teste: ${sampleConvId}`);

  const cutoff = new Date(Date.now() - 48 * 3600_000).toISOString();
  await timeQuery("InstagramDirect: enriquecimento de mensagens (.or com gte created_at)", () =>
    supabase
      .from("instagram_messages")
      .select("id, reply_to_message_id, audio_transcript, timestamp")
      .or(`conversation_id.eq.${sampleConvId},contact_id.eq.${sampleConvId}`)
      .gte("created_at", cutoff)
      .limit(150)
  );

  // 5. Query do repositório getMessages (sem filtro de tempo)
  await timeQuery("SupabaseInstagramRepository: getMessages (limit 150)", () =>
    supabase
      .from("instagram_messages")
      .select("*")
      .or(`conversation_id.eq.${sampleConvId},contact_id.eq.${sampleConvId}`)
      .order("created_at", { ascending: true })
      .limit(150)
  );

  // 6. Autopilot state query
  await timeQuery("Autopilot: __autopilot_states__", () =>
    supabase
      .from("instagram_conversations")
      .select("stage_completed_rules")
      .eq("id", "__autopilot_states__")
      .maybeSingle()
  );

  // 7. Chat Stages query
  await timeQuery("ChatStages: select *", () =>
    supabase.from("chat_stages").select("*")
  );

  // 8. Persona Audios query
  await timeQuery("Persona Audios: select *", () =>
    supabase.from("persona_audios").select("id, title, duration, enabled").limit(100)
  );

  console.log("\n=== FIM DO DIAGNÓSTICO ===");
}

main();
