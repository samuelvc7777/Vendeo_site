const fs = require('fs');
const path = require('path');

const rootDir = path.resolve(__dirname, '..');
const mcpIndexPath = path.join(rootDir, 'supabase/functions/vendeo-brain-mcp/index.ts');
const sharedPersonaMemoryPath = path.join(rootDir, 'supabase/functions/_shared/persona_memory.ts');

const indexContent = fs.readFileSync(mcpIndexPath, 'utf8');
const sharedPersonaMemoryContent = fs.readFileSync(sharedPersonaMemoryPath, 'utf8');

const payload = {
  entrypoint_path: 'index.ts',
  name: 'vendeo-brain-mcp',
  project_id: 'wsdualhvopidgqcumonr',
  verify_jwt: false,
  files: [
    {
      name: 'index.ts',
      content: indexContent,
    },
    {
      name: '_shared/persona_memory.ts',
      content: sharedPersonaMemoryContent,
    }
  ]
};

const outPath = path.join(rootDir, 'scratch/deploy_mcp_payload.json');
fs.writeFileSync(outPath, JSON.stringify(payload, null, 2), 'utf8');

console.log(`[PACK_MCP] Sucesso! Gerado ${outPath} com ${payload.files.length} arquivos.`);
console.log(`- index.ts: ${indexContent.length} bytes`);
console.log(`- _shared/persona_memory.ts: ${sharedPersonaMemoryContent.length} bytes`);
