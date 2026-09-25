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

async function test(n) {
  const start = performance.now();
  const res = await supabase.from("tinder_config").select("id").eq("id", "default").maybeSingle();
  const dur = (performance.now() - start).toFixed(2);
  console.log(`Query #${n}: ${dur}ms`);
}

async function main() {
  await test(1);
  await test(2);
  await test(3);
}

main();
