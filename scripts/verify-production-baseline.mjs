import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'docs/deployments/production-baseline-manifest.json'), 'utf8'));
const digest = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const failures = [];
for (const entry of manifest.entries) {
  const filename = path.join(root, entry.path);
  if (!fs.existsSync(filename) || digest(fs.readFileSync(filename)) !== entry.sha256) failures.push(entry.path);
}
for (const migration of manifest.migrations) {
  const found = fs.readdirSync(path.join(root, 'supabase/migrations')).some(name => name.startsWith(migration.version + '_'));
  if (!found) failures.push(`migration:${migration.version}`);
}
let site = null;
if (process.argv.includes('--live')) {
  let matched = 0;
  for (const asset of manifest.siteAssets) {
    const response = await fetch(new URL(asset.path, manifest.siteUrl), { signal: AbortSignal.timeout(20000) });
    if (response.ok && digest(Buffer.from(await response.arrayBuffer())) === asset.sha256) matched++;
    else failures.push(`production:${asset.path}`);
  }
  site = { matched, total: manifest.siteAssets.length };
}
console.log(JSON.stringify({ files: manifest.entries.length, apiVersion: manifest.api.version, mcpVersion: manifest.mcp.version, site, failures }));
if (failures.length) process.exitCode = 1;
