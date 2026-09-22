/**
 * Valida a função detectsWorkProfessionQuestionIntent isoladamente.
 * Inclui casos reais descobertos durante execução do Caso B.
 */

function detectsWorkProfessionQuestionIntent(text) {
  const t = text.toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .trim();

  // Expansão de abreviações antes de rodar os padrões
  const tExpanded = t
    .replace(/\boq\b/g, 'o que')
    .replace(/\boqe\b/g, 'o que')
    .replace(/\boq\?/g, 'o que?')
    .replace(/\bpq\b/g, 'por que');

  const SEMANTIC_PATTERNS = [
    /trabalha\s+(com\s+(o\s+)?qu[eê]|em\s+qu[eê]|em\s+qual)/,
    /trabalha\s+de\s+qu[eê]/,
    /trabalha\s+(onde|em\s+qual\s+(empresa|lugar|local))/,
    /trabalha\s+em\s+que\b/,
    /qual\s+\S*\s*(a\s+)?(sua\s+)?profiss[ao]o/,
    /qual\s+(\S+\s+)*(area|[aá]rea)\b(?!\s+(vc|voce)\s+(gost|curt|ach))/,
    /faz\s+(o\s*qu[eê]\s+da\s+vida|da\s+vida)/,
    /o\s+que\s+voc[eê]?\s+faz\b(?!\s+(quando|depois|no\s+tempo|nas\s+horas|no\s+fim))/,
    /o\s+que\s+(vc|voce)\s+faz\b(?!\s+(quando|depois|no\s+tempo|nas\s+horas|no\s+fim))/,
    /qual\s+\S*\s*(o\s+)?(seu|teu)?\s*trampo/,
    /qual\s+\S*\s*(a\s+)?(sua\s+)?ocupa[co][ao]o/,
    /[eé]\s+da\s+[aá]rea\s+de\s+qu[eê]/,
    /trabalha\s+como\b/,
  ];

  const matched = SEMANTIC_PATTERNS.find(p => p.test(tExpanded));
  return { detected: !!matched, pattern: matched?.toString() };
}

const DEVEM_DETECTAR = [
  // Casos originais
  "vc trabalha com o quê?",
  "qual sua profissão?",
  "vc trabalha em qual área?",
  "oq vc faz da vida?",
  "trabalha com o que?",
  "qual é a sua área?",
  "é da área de quê?",
  "qual seu trampo?",
  "o que você faz?",
  "trabalha como quê?",
  "trabalha em que área?",
  "qual a sua ocupação?",
  "trabalha em qual empresa?",
  "vc trabalha em que?",
  // Casos reais descobertos em produção (Caso B)
  "vc trabalha com oq?",          // ← CASO REAL do Terra — 'oq' = abreviação de 'o quê'
  "trabalha com oq",              // variação sem '?'
  "oq vc faz",                    // abreviação de "o que vc faz"
  "trabalha com oqe?",            // 'oqe' = 'o que'
];

const NAO_DEVEM_DETECTAR = [
  "vc gosta dessa área?",
  "é estressante esse tipo de trabalho?",
  "tem folga pelo menos?",
  "tadinho, vai descansar agr então",
  "nossa que puxado né rs",
  "trabalho tranquilo pelo menos hoje?",
  "boa que deu pra descansar um pouco",
  "uai tá melhor que ontem então",
  "ainda bemm kkkkk",              // acolhimento — não detecta
  "espero que sua tia esteja bem", // empatia — não detecta
  "vc gosta do que faz?",          // aprofundamento legítimo (quando/depois contexto NÃO entra aqui, mas semanticamente diferente)
];

console.log("=== DEVE DETECTAR (esperado: true) ===");
let failDet = 0;
for (const t of DEVEM_DETECTAR) {
  const { detected, pattern } = detectsWorkProfessionQuestionIntent(t);
  const ok = detected === true;
  if (!ok) failDet++;
  console.log(`  ${ok ? '✅' : '❌'} "${t}"`);
  if (!ok) console.log(`      → NÃO detectado — padrão ausente`);
}

console.log("\n=== NÃO DEVE DETECTAR (esperado: false) ===");
let failNon = 0;
for (const t of NAO_DEVEM_DETECTAR) {
  const { detected, pattern } = detectsWorkProfessionQuestionIntent(t);
  const ok = detected === false;
  if (!ok) failNon++;
  console.log(`  ${ok ? '✅' : '❌'} "${t}"`);
  if (!ok) console.log(`      → FALSO POSITIVO — padrão: ${pattern}`);
}

const total = DEVEM_DETECTAR.length + NAO_DEVEM_DETECTAR.length;
const falhas = failDet + failNon;
console.log(`\n=== RESULTADO: ${total - falhas}/${total} PASS${falhas > 0 ? ` — ${falhas} FAIL` : ''} ===`);
process.exit(falhas > 0 ? 1 : 0);
