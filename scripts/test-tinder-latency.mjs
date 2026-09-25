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
  const start = performance.now();
  const { data, error } = await supabase.from("tinder_config").select("*").eq("id", "default").maybeSingle();
  const duration = (performance.now() - start).toFixed(2);
  console.log(`tinder_config query: ${duration}ms`);
  if (error) {
    console.error("Error:", error);
  } else {
    console.log("Result:", data ? { id: data.id, has_token: Boolean(data.auth_token) } : "Nenhum registro");
  }
}

main();
