import fs from 'fs';
import path from 'path';
import { createClient } from '@supabase/supabase-js';

const envPath = path.resolve('.env.local');
const envVars = {};
for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith('#')) continue;
  const eq = trimmed.indexOf('=');
  if (eq > 0) {
    let val = trimmed.slice(eq + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    envVars[trimmed.slice(0, eq).trim()] = val;
  }
}

const supabaseUrl = envVars.NEXT_PUBLIC_SUPABASE_URL || 'https://wsdualhvopidgqcumonr.supabase.co';
const supabaseKey = envVars.SUPABASE_SERVICE_ROLE_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

async function inspectChatStages() {
  const { data: stages } = await supabase
    .from('chat_stages')
    .select('*')
    .order('stage_order', { ascending: true });

  console.log(`Total stages: ${stages?.length}`);
  for (const s of stages || []) {
    console.log(`\nStage ID: ${s.id} | Name: ${s.name} | Order: ${s.stage_order}`);
    console.log(`Goals (${s.goals?.length || 0}):`, JSON.stringify(s.goals, null, 2));
    console.log(`Checklist (${s.checklist?.length || 0}):`, JSON.stringify(s.checklist, null, 2));
  }
}

inspectChatStages().catch(console.error);
