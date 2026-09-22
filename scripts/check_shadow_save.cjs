const fs = require('fs');
const code = fs.readFileSync('supabase/functions/api/experimental_orchestrator.ts', 'utf8');
const lines = code.split('\n');
lines.forEach((l, i) => {
  if (l.includes('shadowSimulation') || l.includes('recentCycles')) {
    console.log(`Line ${i + 1}:`, l.trim().slice(0, 120));
  }
});
