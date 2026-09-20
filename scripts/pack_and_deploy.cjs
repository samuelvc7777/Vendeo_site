const fs = require('fs');
const path = require('path');

const API_DIR = path.resolve(__dirname, '../supabase/functions/api');
const filenames = fs.readdirSync(API_DIR).filter(f => f.endsWith('.ts'));

console.log(`Arquivos encontrados em ${API_DIR}:`, filenames);

const files = filenames.map(name => {
  const content = fs.readFileSync(path.join(API_DIR, name), 'utf8');
  return { name, content };
});

const output = {
  entrypoint_path: 'index.ts',
  verify_jwt: false,
  files,
};

const outPath = path.resolve(__dirname, '../scratch/deploy_files.json');
fs.writeFileSync(outPath, JSON.stringify(output), 'utf8');
console.log(`Payload gerado com sucesso em ${outPath} (${(fs.statSync(outPath).size / 1024).toFixed(1)} KB).`);
