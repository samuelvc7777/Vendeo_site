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

if (!url || !key) {
  console.error("Missing supabase credentials in env");
  process.exit(1);
}

const supabase = createClient(url, key);

async function main() {
  const { data, error } = await supabase
    .from("chat_stages")
    .select("*");

  if (error) {
    console.error("Error fetching stages:", error);
    return;
  }

  console.log(`Found ${data.length} chat stages:\n`);
  for (const stage of data) {
    console.log(`=== STAGE: [${stage.id}] "${stage.name}" (pos: ${stage.position}) ===`);
    const goals = stage.goals || [];
    if (goals.length === 0) {
      console.log("  (Sem metas configuradas neste stage)");
    } else {
      for (const g of goals) {
        console.log(`  - Goal ID: ${g.id}`);
        console.log(`    Label: ${g.label}`);
        console.log(`    Field: ${g.memoryField}`);
        console.log(`    Kind: ${g.kind || 'fact'} | Enabled: ${g.enabled !== false} | Required: ${g.required !== false}`);
        console.log(`    Desc: ${g.description || ''}`);
      }
    }
    console.log("");
  }
}

main();
