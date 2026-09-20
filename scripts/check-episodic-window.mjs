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

  const { count: total } = await supabase.from('conversation_episodic_memory').select('id', { count: 'exact', head: true });
  const { count: insideWindow } = await supabase.from('conversation_episodic_memory').select('id', { count: 'exact', head: true })
    .gte('created_at', '2026-09-12T00:00:00.000Z')
    .lte('created_at', '2026-09-19T00:00:00.000Z');
  const { count: outsideWindow } = await supabase.from('conversation_episodic_memory').select('id', { count: 'exact', head: true })
    .lt('created_at', '2026-09-12T00:00:00.000Z');
  const { count: afterWindow } = await supabase.from('conversation_episodic_memory').select('id', { count: 'exact', head: true })
    .gt('created_at', '2026-09-19T00:00:00.000Z');

  console.log('Total no banco:', total);
  console.log('Dentro da janela (12/09 00:00 a 19/09 00:00):', insideWindow);
  console.log('Antes de 12/09:', outsideWindow);
  console.log('Depois de 19/09:', afterWindow);
}

check().catch(console.error);
