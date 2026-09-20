import fs from 'node:fs';
import path from 'node:path';

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

async function check() {
  const { createClient } = await import('@supabase/supabase-js');
  const supabase = createClient(supabaseUrl, supabaseServiceKey, { auth: { persistSession: false } });

  const { data } = await supabase.from('instagram_conversations').select('stage_completed_rules').eq('id', '__vault_data__').single();
  const items = data?.stage_completed_rules?.items || [];
  console.log('Total de áudios no cofre:', items.length);
  for (const item of items) {
    console.log(`- ID: ${item.id}`);
    console.log(`  title: "${item.title}"`);
    console.log(`  content: "${item.content}"`);
    console.log(`  mediaUrl: ${item.mediaUrl}`);
  }
}

check().catch(console.error);
