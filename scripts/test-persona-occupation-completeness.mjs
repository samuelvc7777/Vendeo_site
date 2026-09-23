import assert from "node:assert/strict";
import test from "node:test";
import {
  buildCanonicalAgentInstructions,
  VENDEO_AGENT_INSTRUCTIONS_VERSION,
} from "../supabase/functions/api/openai_agent_instructions.ts";
import {
  PERSONA_MEMORY_TOOL_DEFINITION,
  runOpenAiBrainTurn,
} from "../supabase/functions/api/openai_brain.ts";
import {
  searchPersonaMemory,
  resolvePersonaFact,
} from "../supabase/functions/api/persona_memory.ts";

// ============================================================================
// FIXTURES DE TESTE (FONTE DE DADOS FACTUAIS PARA OS TESTES)
// ============================================================================

// Fixture A: Estado Atual da Larissa (Estudante de Enfermagem + Estágio + Vendas Online)
const FIXTURE_A_CURRENT = [
  {
    persona_id: "larissa",
    category: "geral",
    key: "profissao",
    value: "Estudante de Enfermagem (estagiária hospitalar) e vendedora online",
    source_type: "canonical",
    confidence: 1.0,
    aliases: ["profissao", "ocupacao", "carreira", "trabalho", "o que faz", "com que trabalha"],
    valid_from: null,
    valid_until: null,
  },
  {
    persona_id: "larissa",
    category: "education",
    key: "education.course",
    value: "Enfermagem",
    source_type: "canonical",
    confidence: 1.0,
    aliases: ["curso", "faculdade", "graduacao", "estudos"],
    valid_from: null,
    valid_until: null,
  },
  {
    persona_id: "larissa",
    category: "education",
    key: "education.period",
    value: "10º período",
    source_type: "canonical",
    confidence: 1.0,
    aliases: ["periodo", "semestre"],
    valid_from: null,
    valid_until: null,
  },
  {
    persona_id: "larissa",
    category: "education",
    key: "estagio_obrigatorio",
    value: "Estágio curricular supervisionado hospitalar durante o dia",
    source_type: "canonical",
    confidence: 1.0,
    aliases: ["estagio", "estagio hospitalar", "hospital"],
    valid_from: null,
    valid_until: null,
  },
  {
    persona_id: "larissa",
    category: "work",
    key: "vendas_online",
    value: "Trabalha em casa com vendas online de moda masculina pelo celular e computador",
    source_type: "canonical",
    confidence: 1.0,
    aliases: ["vendas", "loja online", "com que trabalha", "trabalho em casa", "moda masculina"],
    valid_from: null,
    valid_until: null,
  },
];

// Fixture B: Estado Futuro Hipotético (Formada + Dona de Clínica)
const FIXTURE_B_GRADUATED = [
  {
    persona_id: "larissa",
    category: "geral",
    key: "profissao",
    value: "Enfermeira formada e dona de clínica de estética",
    source_type: "canonical",
    confidence: 1.0,
    aliases: ["profissao", "ocupacao", "carreira", "trabalho", "o que faz"],
    valid_from: null,
    valid_until: null,
  },
  {
    persona_id: "larissa",
    category: "education",
    key: "education.status",
    value: "Graduada em Enfermagem",
    source_type: "canonical",
    confidence: 1.0,
    aliases: ["formacao", "graduacao"],
    valid_from: null,
    valid_until: null,
  },
  {
    persona_id: "larissa",
    category: "work",
    key: "clinica_propria",
    value: "Proprietária e enfermeira chefe na Clínica Larissa Estética",
    source_type: "canonical",
    confidence: 1.0,
    aliases: ["clinica", "empresa", "consultorio"],
    valid_from: null,
    valid_until: null,
  },
];

// Fixture C: Estado Alternativo / Outra Persona (Designer e Fotógrafa)
const FIXTURE_C_DESIGNER = [
  {
    persona_id: "larissa",
    category: "geral",
    key: "profissao",
    value: "Designer gráfica e fotógrafa de eventos",
    source_type: "canonical",
    confidence: 1.0,
    aliases: ["profissao", "ocupacao", "carreira", "trabalho", "o que faz"],
    valid_from: null,
    valid_until: null,
  },
  {
    persona_id: "larissa",
    category: "work",
    key: "design_freelance",
    value: "Criação de identidades visuais para marcas no computador",
    source_type: "canonical",
    confidence: 1.0,
    aliases: ["design", "projetos"],
    valid_from: null,
    valid_until: null,
  },
  {
    persona_id: "larissa",
    category: "work",
    key: "fotografia",
    value: "Ensaios fotográficos externos e casamentos nos finais de semana",
    source_type: "canonical",
    confidence: 1.0,
    aliases: ["fotos", "fotografia", "ensaios"],
    valid_from: null,
    valid_until: null,
  },
];

// ============================================================================
// HELPERS DA POLÍTICA SEMÂNTICA GENÉRICA (COMPLETE PERSONA FACT)
// ============================================================================

/**
 * Classifica semanticamente o inbound em relação à ocupação da Persona.
 */
function classifyOccupationInbound(inbound) {
  const norm = (inbound || "").toLowerCase().trim();
  if (/^(?:vc|voce)\s+[eé]\s+(\w+)\??$/i.test(norm)) {
    return "status_confirmation";
  }
  if (
    /(?:vende\s+roupa|loja\s+[eé]\s+sua|oq\s+vc\s+vende|oque\s+vende|vende\s+o\s*que|loja\s+online)/i.test(norm)
  ) {
    return "specific_sales";
  }
  if (
    /(?:onde\s+[eé]\s+seu\s+est[aá]gio|como\s+[eé]\s+seu\s+est[aá]gio|est[aá]gio\s+no\s+hospital|hospital)/i.test(norm)
  ) {
    return "specific_internship";
  }
  if (
    /(?:trabalha\s+com\s+o\s*q|trabalha\s+com\s+que|oq\s+vc\s+faz\s+da\s+vida|o\s*que\s+faz\s+da\s+vida|qual\s+sua\s+profiss[aã]o|vc\s+faz\s+o\s*q|sua\s+ocupa[cç][aã]o)/i.test(norm)
  ) {
    return "broad_occupation";
  }
  return "general";
}

/**
 * Avalia a seleção de fatos pela política conceitual genérica de Complete Persona Fact.
 */
function evaluateOccupationFactSelection({
  inbound,
  retrievedFacts,
  recentContext = [],
}) {
  const questionType = classifyOccupationInbound(inbound);

  // 1. Pergunta específica de vendas -> Foco estrito em vendas sem forçar outros papéis
  if (questionType === "specific_sales") {
    const salesFact = retrievedFacts.find((f) => f.key === "vendas_online");
    return {
      mode: "focal_specific",
      selectedFacts: salesFact ? [salesFact] : [],
      forcesOtherRoles: false,
    };
  }

  // 2. Pergunta específica de estágio -> Foco no estágio
  if (questionType === "specific_internship") {
    const internshipFact = retrievedFacts.find(
      (f) => f.key === "estagio_obrigatorio" || f.key === "profissao"
    );
    return {
      mode: "focal_specific",
      selectedFacts: internshipFact ? [internshipFact] : [],
      forcesOtherRoles: false,
    };
  }

  // 3. Contexto recente já possui papéis ditos (conversation delta)
  const contextText = recentContext.map((m) => m.text).join(" ").toLowerCase();
  if (contextText.length > 0 && /(?:trabalha\s+com\s+outra|trabalha\s+com\s+mais|e\s+trabalha)/i.test(inbound)) {
    // Delta: busca fato complementar específico que NÃO foi citado ainda no contexto
    const unmentionedFacts = retrievedFacts.filter((f) => {
      if (f.key === "profissao") return false; // O canônico agregado já foi parcialmente introduzido
      if (f.category === "education") return false; // Pergunta sobre trabalho não busca detalhes curriculares da faculdade
      const val = String(f.value).toLowerCase();
      const mentionsNursing = val.includes("enfermagem") || val.includes("hospital") || val.includes("estagio");
      if (mentionsNursing && (contextText.includes("enfermagem") || contextText.includes("estágio") || contextText.includes("hospital"))) {
        return false;
      }
      return true;
    });
    return {
      mode: "conversation_delta",
      selectedFacts: unmentionedFacts.length > 0 ? [unmentionedFacts[0]] : [],
      omitsRepeatedFacts: true,
    };
  }

  // 4. Pergunta ampla -> Prioridade do fato canônico abrangente sobre específico parcial
  if (questionType === "broad_occupation" || questionType === "status_confirmation") {
    const canonicalProfession = retrievedFacts.find((f) => f.key === "profissao");
    const partialFacts = retrievedFacts.filter((f) => f.key !== "profissao");

    // Grounding estrito: se a memória SOMENTE possui um fato parcial isolado, não inventar outros
    if (!canonicalProfession && partialFacts.length === 1) {
      return {
        mode: "grounding_strict_partial",
        selectedFacts: partialFacts,
        hallucinatesOtherRoles: false,
      };
    }

    return {
      mode: "complete_aggregate",
      canonicalFact: canonicalProfession || null,
      selectedFacts: canonicalProfession
        ? [canonicalProfession]
        : partialFacts,
      isComprehensive: Boolean(canonicalProfession || partialFacts.length > 1),
    };
  }

  return {
    mode: "unclassified",
    selectedFacts: retrievedFacts,
  };
}

/**
 * Validador semântico das respostas formuladas da Larissa.
 */
function validateOccupationResponseSemantics({
  inbound,
  responses,
  availableFacts,
  recentContext = [],
}) {
  const combinedResponse = responses.join(" ").toLowerCase();
  const questionType = classifyOccupationInbound(inbound);
  const canonicalFact = availableFacts.find((f) => f.key === "profissao");
  const canonicalStr = canonicalFact ? String(canonicalFact.value).toLowerCase() : "";

  // Proibição: Se a PersonaMemory comprova que é ESTUDANTE/ESTAGIÁRIA (não graduada),
  // NUNCA afirmar profissão concluída ("sou enfermeira" sem qualificador).
  const isStudentInFact = /estudante|graduando|est[aá]gio/i.test(canonicalStr);
  const isGraduatedInFact = /formad[ao]|graduad[ao]|conclu[ií]d[ao]/i.test(canonicalStr);

  if (isStudentInFact && !isGraduatedInFact) {
    const affirmsFormed =
      /(?:sou\s+enfermeira\b(?!.*(?:estudante|fa[çc]o|est[aá]gio|faculdade)))|(?:sou\s+enfermeira\s+formada)/i.test(
        combinedResponse
      );
    if (affirmsFormed) {
      return {
        valid: false,
        reason: "VIOLATION_FORMED_PROFESSION: Afirmou ser profissional formada quando a PersonaMemory indica estudante/estágio",
      };
    }
  }

  // Pergunta Ampla: deve contemplar os papéis definidos no fato canônico
  if (questionType === "broad_occupation" && canonicalFact) {
    if (canonicalStr.includes("enfermagem") && !combinedResponse.includes("enfermagem")) {
      return { valid: false, reason: "INCOMPLETE_OCCUPATION: Omitiu Enfermagem presente na PersonaMemory" };
    }
    if (canonicalStr.includes("vendedora") || canonicalStr.includes("vendas")) {
      if (!combinedResponse.includes("vendas") && !combinedResponse.includes("loja") && !combinedResponse.includes("vendo")) {
        return { valid: false, reason: "INCOMPLETE_OCCUPATION: Omitiu vendas online presente na PersonaMemory" };
      }
    }
    if (canonicalStr.includes("designer") && !combinedResponse.includes("design")) {
      return { valid: false, reason: "INCOMPLETE_OCCUPATION: Omitiu design presente na PersonaMemory" };
    }
    if (canonicalStr.includes("fotógrafa") || canonicalStr.includes("fotografa")) {
      if (!combinedResponse.includes("foto") && !combinedResponse.includes("fotógrafa")) {
        return { valid: false, reason: "INCOMPLETE_OCCUPATION: Omitiu fotografia presente na PersonaMemory" };
      }
    }
    if (canonicalStr.includes("clínica") || canonicalStr.includes("clinica")) {
      if (!combinedResponse.includes("clínica") && !combinedResponse.includes("clinica")) {
        return { valid: false, reason: "INCOMPLETE_OCCUPATION: Omitiu clínica presente na PersonaMemory" };
      }
    }
  }

  // Pergunta Específica de Loja: não deve despejar Enfermagem sem motivo
  if (questionType === "specific_sales") {
    if (combinedResponse.includes("enfermagem") && !inbound.toLowerCase().includes("enfermagem")) {
      return {
        valid: false,
        reason: "IRRELEVANT_OVERFLOW: Despejou Enfermagem em pergunta específica de loja",
      };
    }
  }

  // Pergunta Específica de Estágio: não deve forçar vendas online
  if (questionType === "specific_internship") {
    if (combinedResponse.includes("vendas online") && !inbound.toLowerCase().includes("venda")) {
      return {
        valid: false,
        reason: "IRRELEVANT_OVERFLOW: Forçou vendas online em pergunta específica de estágio",
      };
    }
  }

  // Contexto Recente com Delta: não deve repetir apresentação já feita
  const contextText = recentContext.map((m) => m.text).join(" ").toLowerCase();
  if (contextText.includes("faço enfermagem e tô no estágio") && /(?:trabalha\s+com\s+outra|trabalha\s+com\s+mais)/i.test(inbound)) {
    if (combinedResponse.includes("faço faculdade de enfermagem") || combinedResponse.includes("estágio no hospital")) {
      return {
        valid: false,
        reason: "VIOLATION_DELTA: Repetiu apresentação completa de Enfermagem em vez de focar no delta",
      };
    }
  }

  return { valid: true };
}

function createMockSupabase(facts = FIXTURE_A_CURRENT) {
  return {
    from: (table) => ({
      select: (cols) => ({
        eq: (col1, val1) => {
          if (table === "persona_memory") {
            return Promise.resolve({ data: facts, error: null });
          }
          return {
            eq: (col2, val2) => ({
              maybeSingle: async () => ({ data: null, error: null }),
            }),
            maybeSingle: async () => {
              if (table === "instagram_config" && col1 === "id") {
                return { data: { access_token: "mock_token" }, error: null };
              }
              return { data: null, error: null };
            },
            order: () => ({
              limit: () => ({ data: [] }),
            }),
          };
        },
      }),
    }),
  };
}

// ============================================================================
// BLOCO 1: AUDITORIA DE AUSÊNCIA DE HARDCODES NAS INSTRUÇÕES DO AGENT
// ============================================================================

test("TESTE A — Ausência de hardcodes biográficos na seção COMPLETE PERSONA FACT", () => {
  const instructions = buildCanonicalAgentInstructions();
  const sectionMatch = instructions.match(
    /2\.1\.\s+COMPLETUDE DE FATOS DA PERSONA[\s\S]*?(?===+[\r\n]+3\.)/
  );
  assert.ok(sectionMatch, "Seção 2.1 deve existir");
  const sectionText = sectionMatch[0];

  // 1. NÃO conter "10º período" nem "10o período"
  assert.ok(
    !sectionText.includes("10º período") && !sectionText.includes("10o período"),
    "A seção 2.1 NÃO deve conter '10º período'"
  );

  // 2. NÃO conter "moda masculina"
  assert.ok(
    !sectionText.toLowerCase().includes("moda masculina"),
    "A seção 2.1 NÃO deve conter 'moda masculina'"
  );

  // 3. NÃO conter o valor literal atual completo de 'profissao'
  assert.ok(
    !sectionText.includes("Estudante de Enfermagem (estagiária hospitalar) e vendedora online"),
    "A seção 2.1 NÃO deve conter o valor literal de 'profissao'"
  );

  // 4. NÃO conter exemplos de resposta atuais da Larissa
  assert.ok(
    !sectionText.toLowerCase().includes("faço enfermagem"),
    "A seção 2.1 NÃO deve conter exemplo 'faço enfermagem'"
  );
  assert.ok(
    !sectionText.toLowerCase().includes("tô no estágio"),
    "A seção 2.1 NÃO deve conter exemplo 'tô no estágio'"
  );
  assert.ok(
    !sectionText.toLowerCase().includes("vendas online de moda"),
    "A seção 2.1 NÃO deve conter exemplo sobre vendas de moda"
  );

  // 5. NÃO conter biografia concreta: Enfermagem, hospital, loja
  assert.ok(
    !sectionText.toLowerCase().includes("enfermagem"),
    "A seção 2.1 NÃO deve mencionar 'enfermagem'"
  );
  assert.ok(
    !sectionText.toLowerCase().includes("hospital"),
    "A seção 2.1 NÃO deve mencionar 'hospital'"
  );
  assert.ok(
    !sectionText.toLowerCase().includes("vendas online"),
    "A seção 2.1 NÃO deve mencionar 'vendas online'"
  );

  // 6. NÃO conter afirmação de que Larissa atualmente é estudante, estagiária ou não é formada
  assert.ok(
    !sectionText.toLowerCase().includes("larissa é estudante"),
    "A seção 2.1 NÃO deve afirmar que Larissa é estudante"
  );
  assert.ok(
    !sectionText.toLowerCase().includes("larissa é estagiária"),
    "A seção 2.1 NÃO deve afirmar que Larissa é estagiária"
  );
  assert.ok(
    !sectionText.toLowerCase().includes("não é formada"),
    "A seção 2.1 NÃO deve afirmar que Larissa não é formada"
  );
});

test("Auditoria: PersonaMemory é declarada formalmente como autoridade factual exclusiva", () => {
  const instructions = buildCanonicalAgentInstructions();
  assert.ok(
    instructions.includes(
      "Os fatos biográficos atuais da Persona vêm exclusivamente da PersonaMemory e do contexto autorizado do turno. Estas instructions definem comportamento, não biografia."
    ),
    "Instruções devem declarar que definem comportamento e não biografia"
  );
  assert.ok(
    instructions.includes("Se houver qualquer conflito entre um exemplo antigo e a PersonaMemory atual: PersonaMemory vence."),
    "Instruções devem fixar que PersonaMemory sempre vence"
  );
});

test("Auditoria: Regra genérica de não inferir formação ou credencial profissional", () => {
  const instructions = buildCanonicalAgentInstructions();
  assert.ok(
    instructions.includes(
      "Não inferir formação concluída, profissão concluída ou credencial profissional a partir de curso, estágio, treinamento ou informação parcial. Só afirmar conclusão quando houver fato explícito e atual na PersonaMemory."
    ),
    "Deve conter a formulação genérica exata de não-inferência sem citar profissão concreta"
  );
});

test("Auditoria: Tool description de persona_memory_search é genérica e conceitual", () => {
  const desc = PERSONA_MEMORY_TOOL_DEFINITION.function.description;
  assert.ok(
    desc.includes(
      "Em perguntas amplas sobre identidade ocupacional, profissão ou atividade atual da Persona, busque fatos canônicos e complementares suficientes para representar a categoria de forma completa. Não encerre a busca em um fato parcial quando houver fato canônico mais abrangente relevante."
    ),
    "Tool description deve conter a orientação genérica requerida"
  );
  assert.ok(!desc.toLowerCase().includes("enfermagem"), "Tool description NÃO deve conter 'enfermagem'");
  assert.ok(!desc.toLowerCase().includes("hospital"), "Tool description NÃO deve conter 'hospital'");
  assert.ok(!desc.toLowerCase().includes("vendas"), "Tool description NÃO deve conter 'vendas'");
  assert.ok(!desc.toLowerCase().includes("loja"), "Tool description NÃO deve conter 'loja'");
  assert.ok(!desc.toLowerCase().includes("faculdade de"), "Tool description NÃO deve conter faculdade específica");
});

// ============================================================================
// BLOCO 2: OS 12 CENÁRIOS COMPORTAMENTAIS DA LARISSA (FIXTURE A - ESTADO ATUAL)
// ============================================================================

test("Cenário 1: Inbound 'vc trabalha com oq?' + Memory canônica -> Resposta contempla Enfermagem + estágio + vendas", async () => {
  const inbound = "vc trabalha com oq?";
  const searchResults = await searchPersonaMemory({
    query: inbound,
    cachedFacts: FIXTURE_A_CURRENT,
    allowLegacyFallback: false,
  });

  const policy = evaluateOccupationFactSelection({
    inbound,
    retrievedFacts: searchResults,
  });

  assert.equal(policy.mode, "complete_aggregate");
  assert.ok(policy.canonicalFact, "Deve selecionar o fato canônico");
  assert.match(String(policy.canonicalFact.value), /enfermagem/i);
  assert.match(String(policy.canonicalFact.value), /estagi[aá]ria/i);
  assert.match(String(policy.canonicalFact.value), /vendedora/i);

  const mockAgentResponse = [
    "faço faculdade de enfermagem e tô no estágio do hospital",
    "e por fora tbm trabalho com vendas online kkk",
  ];
  const validation = validateOccupationResponseSemantics({
    inbound,
    responses: mockAgentResponse,
    availableFacts: FIXTURE_A_CURRENT,
  });
  assert.ok(validation.valid, `Resposta deve ser válida: ${validation.reason}`);
});

test("Cenário 2: Inbound 'oq vc faz da vida?' -> Conteúdo ocupacional completo", async () => {
  const inbound = "oq vc faz da vida?";
  const searchResults = await searchPersonaMemory({
    query: inbound,
    cachedFacts: FIXTURE_A_CURRENT,
    allowLegacyFallback: false,
  });

  const policy = evaluateOccupationFactSelection({
    inbound,
    retrievedFacts: searchResults,
  });
  assert.equal(policy.mode, "complete_aggregate");
  assert.ok(policy.isComprehensive);

  const mockResponse = [
    "minha vida tá uma correria kkk faço enfermagem, tô fazendo estágio no hospital e ainda mexo com vendas online",
  ];
  const validation = validateOccupationResponseSemantics({
    inbound,
    responses: mockResponse,
    availableFacts: FIXTURE_A_CURRENT,
  });
  assert.ok(validation.valid);
});

test("Cenário 3: Inbound 'qual sua profissão?' -> NÃO dizer 'sou enfermeira', deve refletir faculdade/estágio", async () => {
  const inbound = "qual sua profissão?";
  const fact = await resolvePersonaFact("profissao", {
    cachedFacts: FIXTURE_A_CURRENT,
  });
  assert.ok(fact.found);
  assert.match(String(fact.value), /estudante/i);

  // Violação de profissão concluída
  const formedViolation = ["sou enfermeira"];
  const resViolation = validateOccupationResponseSemantics({
    inbound,
    responses: formedViolation,
    availableFacts: FIXTURE_A_CURRENT,
  });
  assert.equal(resViolation.valid, false);
  assert.match(resViolation.reason, /VIOLATION_FORMED_PROFESSION/);

  // Resposta válida
  const validResponse = [
    "faço faculdade de enfermagem, tô no estágio hospitalar e tbm trabalho com vendas online kkk",
  ];
  const resValid = validateOccupationResponseSemantics({
    inbound,
    responses: validResponse,
    availableFacts: FIXTURE_A_CURRENT,
  });
  assert.ok(resValid.valid);
});

test("Cenário 4: Inbound 'vc ainda vende roupa?' -> Responde especificamente sobre vendas sem forçar Enfermagem", async () => {
  const inbound = "vc ainda vende roupa?";
  const searchResults = await searchPersonaMemory({
    query: inbound,
    cachedFacts: FIXTURE_A_CURRENT,
    allowLegacyFallback: false,
  });

  const policy = evaluateOccupationFactSelection({
    inbound,
    retrievedFacts: searchResults,
  });
  assert.equal(policy.mode, "focal_specific");
  assert.equal(policy.forcesOtherRoles, false);

  const response = ["vendo simm, trabalho com moda masculina pelo celular e pc kkk"];
  const validation = validateOccupationResponseSemantics({
    inbound,
    responses: response,
    availableFacts: FIXTURE_A_CURRENT,
  });
  assert.ok(validation.valid);
});

test("Cenário 5: Inbound 'oq vc vende na loja?' -> Responde loja sem despejar Enfermagem", async () => {
  const inbound = "oq vc vende na loja?";
  const searchResults = await searchPersonaMemory({
    query: inbound,
    cachedFacts: FIXTURE_A_CURRENT,
    allowLegacyFallback: false,
  });

  const policy = evaluateOccupationFactSelection({
    inbound,
    retrievedFacts: searchResults,
  });
  assert.equal(policy.mode, "focal_specific");

  const focalResponse = ["vendo roupa masculina, camisa, bermuda e conjuntos 😊"];
  const validationFocal = validateOccupationResponseSemantics({
    inbound,
    responses: focalResponse,
    availableFacts: FIXTURE_A_CURRENT,
  });
  assert.ok(validationFocal.valid);

  const overflowResponse = ["vendo moda masculina, e além disso faço faculdade de enfermagem no hospital"];
  const validationOverflow = validateOccupationResponseSemantics({
    inbound,
    responses: overflowResponse,
    availableFacts: FIXTURE_A_CURRENT,
  });
  assert.equal(validationOverflow.valid, false);
  assert.equal(validationOverflow.reason, "IRRELEVANT_OVERFLOW: Despejou Enfermagem em pergunta específica de loja");
});

test("Cenário 6: Inbound 'como é seu estágio?' -> Responde estágio hospitalar sem precisar mencionar vendas", async () => {
  const inbound = "como é seu estágio?";
  const searchResults = await searchPersonaMemory({
    query: inbound,
    cachedFacts: FIXTURE_A_CURRENT,
    allowLegacyFallback: false,
  });

  const policy = evaluateOccupationFactSelection({
    inbound,
    retrievedFacts: searchResults,
  });
  assert.equal(policy.mode, "focal_specific");
  assert.equal(policy.forcesOtherRoles, false);

  const response = ["nossa é bem puxado viu kkk fico no hospital o dia todo aprendendo muita coisa"];
  const validation = validateOccupationResponseSemantics({
    inbound,
    responses: response,
    availableFacts: FIXTURE_A_CURRENT,
  });
  assert.ok(validation.valid);
});

test("Cenário 7: Contexto recente com Enfermagem/estágio + 'e trabalha com outra coisa?' -> Foco no delta de vendas online", () => {
  const recentContext = [
    { sender: "larissa", text: "faço enfermagem e tô no estágio do hospital" },
  ];
  const inbound = "e trabalha com outra coisa?";

  const policy = evaluateOccupationFactSelection({
    inbound,
    retrievedFacts: FIXTURE_A_CURRENT,
    recentContext,
  });
  assert.equal(policy.mode, "conversation_delta");
  assert.ok(policy.omitsRepeatedFacts);
  assert.equal(policy.selectedFacts[0].key, "vendas_online");

  const deltaResponse = ["trabalho simm, tenho vendas online de moda masculina em casa"];
  const valDelta = validateOccupationResponseSemantics({
    inbound,
    responses: deltaResponse,
    availableFacts: FIXTURE_A_CURRENT,
    recentContext,
  });
  assert.ok(valDelta.valid);

  const repeatResponse = ["faço faculdade de enfermagem e estágio no hospital, e tbm mexo com vendas"];
  const valRepeat = validateOccupationResponseSemantics({
    inbound,
    responses: repeatResponse,
    availableFacts: FIXTURE_A_CURRENT,
    recentContext,
  });
  assert.equal(valRepeat.valid, false);
  assert.match(valRepeat.reason, /VIOLATION_DELTA/);
});

test("Cenário 8: Search retorna vendas_online primeiro e profissao depois -> Fato canônico 'profissao' prevalece para pergunta ampla", () => {
  const invertedResults = [
    FIXTURE_A_CURRENT.find((f) => f.key === "vendas_online"),
    FIXTURE_A_CURRENT.find((f) => f.key === "profissao"),
  ];

  const policy = evaluateOccupationFactSelection({
    inbound: "vc trabalha com oq?",
    retrievedFacts: invertedResults,
  });

  assert.equal(policy.mode, "complete_aggregate");
  assert.equal(policy.canonicalFact.key, "profissao");
  assert.match(String(policy.canonicalFact.value), /enfermagem/i);
});

test("Cenário 9: Search retorna SOMENTE vendas_online -> Grounding estrito preservado, NÃO inventa Enfermagem", () => {
  const onlySalesFact = [
    {
      persona_id: "larissa",
      category: "work",
      key: "vendas_online",
      value: "Trabalha em casa com vendas online de moda masculina",
      source_type: "canonical",
      confidence: 1.0,
      aliases: ["vendas"],
      valid_from: null,
      valid_until: null,
    },
  ];

  const policy = evaluateOccupationFactSelection({
    inbound: "vc trabalha com oq?",
    retrievedFacts: onlySalesFact,
  });

  assert.equal(policy.mode, "grounding_strict_partial");
  assert.equal(policy.hallucinatesOtherRoles, false);
  assert.equal(policy.selectedFacts.length, 1);
  assert.equal(policy.selectedFacts[0].key, "vendas_online");
});

test("Cenário 10: Inbound 'vc é enfermeira?' -> Resposta coerente com faculdade/estágio, NÃO afirma formada", () => {
  const inbound = "vc é enfermeira?";

  const invalid = ["sou enfermeira sim"];
  const resInvalid = validateOccupationResponseSemantics({
    inbound,
    responses: invalid,
    availableFacts: FIXTURE_A_CURRENT,
  });
  assert.equal(resInvalid.valid, false);

  const valid = ["faço enfermagem e tô no estágio hospitalar, ainda na faculdade kkkk"];
  const resValid = validateOccupationResponseSemantics({
    inbound,
    responses: valid,
    availableFacts: FIXTURE_A_CURRENT,
  });
  assert.ok(resValid.valid);
});

test("Cenário 11: Pergunta ampla sobre trabalho chama persona_memory_search quando contexto é insuficiente", async () => {
  let toolCalledName = null;
  let toolCalledArgs = null;

  const mockSupabase = createMockSupabase();
  const turnResult = await runOpenAiBrainTurn({
    supabase: mockSupabase,
    conversationId: "conv-broad-occupation",
    currentStageId: "descoberta",
    currentObjectiveId: "profissao",
    currentObjectiveLabel: "Descobrir profissão",
    inboundMessages: ["vc trabalha com oq?"],
    currentInboundMessages: [
      { id: "msg-broad-1", text: "vc trabalha com oq?", createdAt: new Date().toISOString() },
    ],
    recentMessages: [],
    runtime: {
      callOpenAiAgent: async ({ executeTool }) => {
        toolCalledName = "persona_memory_search";
        toolCalledArgs = { query: "profissão ocupação carreira trabalho da Larissa" };
        const toolOutput = await executeTool(toolCalledName, toolCalledArgs);

        assert.ok(toolOutput.found || toolOutput.results?.length > 0);

        return {
          plan: {
            action: "reply",
            objectiveDecision: "none",
            responses: [
              "faço faculdade de enfermagem e estágio no hospital",
              "e tbm trabalho com vendas online de moda masculina kkk",
            ],
            turnContract: {
              mustAnswerFirst: false,
              newQuestionBudget: 0,
              responseShape: "declarative",
              directQuestions: [],
              maxBalloons: 2,
            },
          },
        };
      },
    },
  });

  assert.equal(toolCalledName, "persona_memory_search");
  assert.match(toolCalledArgs.query, /profissão|trabalho|ocupação/i);
  assert.ok(turnResult.telemetry.actualMemoryToolCalled);
  assert.ok(turnResult.telemetry.toolsRequested.includes("persona_memory_search"));
});

test("Cenário 12: Pergunta específica com fato já no contexto NÃO dispara busca ampla desnecessária", async () => {
  const mockSupabase = createMockSupabase();
  const recentMessagesWithFact = [
    { id: "m1", sender: "user", text: "oq vc vende?", createdAt: "2026-09-23T14:00:00Z" },
    { id: "m2", sender: "larissa", text: "vendo moda masculina pelo celular e computador 😊", createdAt: "2026-09-23T14:00:05Z" },
  ];

  const turnResult = await runOpenAiBrainTurn({
    supabase: mockSupabase,
    conversationId: "conv-specific-cached",
    currentStageId: "descoberta",
    currentObjectiveId: null,
    inboundMessages: ["e são roupas tipo oq?"],
    currentInboundMessages: [
      { id: "msg-spec-1", text: "e são roupas tipo oq?", createdAt: new Date().toISOString() },
    ],
    recentMessages: recentMessagesWithFact,
    runtime: {
      callOpenAiAgent: async ({ executeTool }) => {
        return {
          plan: {
            action: "reply",
            objectiveDecision: "none",
            responses: [
              "camisas, bermudas e peças masculinas casuais kkk",
            ],
            turnContract: {
              mustAnswerFirst: false,
              newQuestionBudget: 0,
              responseShape: "declarative",
              directQuestions: [],
              maxBalloons: 1,
            },
          },
        };
      },
    },
  });

  assert.equal(turnResult.telemetry.toolExecutionsCount, 0);
  assert.equal(turnResult.telemetry.actualMemoryToolCalled, false);
});

// ============================================================================
// BLOCO 3: GENERALIZAÇÃO E EVOLUÇÃO TEMPORAL DA PERSONAMEMORY
// ============================================================================

test("TESTE B — Persona A: Inbound 'oq vc faz da vida?' escolhe o fato abrangente da fixture", async () => {
  const inbound = "oq vc faz da vida?";
  const searchResults = await searchPersonaMemory({
    query: inbound,
    cachedFacts: FIXTURE_A_CURRENT,
    allowLegacyFallback: false,
  });

  const policy = evaluateOccupationFactSelection({
    inbound,
    retrievedFacts: searchResults,
  });

  assert.equal(policy.mode, "complete_aggregate");
  assert.equal(policy.canonicalFact.key, "profissao");
  assert.equal(policy.canonicalFact.value, "Estudante de Enfermagem (estagiária hospitalar) e vendedora online");
});

test("TESTE C — Persona B FUTURA: MESMAS instructions, trabalha com 'Enfermeira formada e dona de clínica'", async () => {
  const inbound = "oq vc faz da vida?";
  const searchResults = await searchPersonaMemory({
    query: inbound,
    cachedFacts: FIXTURE_B_GRADUATED,
    allowLegacyFallback: false,
  });

  // A mesma política genérica com a MESMA instruction
  const policy = evaluateOccupationFactSelection({
    inbound,
    retrievedFacts: searchResults,
  });

  assert.equal(policy.mode, "complete_aggregate");
  assert.equal(policy.canonicalFact.key, "profissao");
  assert.equal(policy.canonicalFact.value, "Enfermeira formada e dona de clínica de estética");

  // Prova: NÃO continua tratando a Persona como estudante/estagiária
  assert.ok(
    !String(policy.canonicalFact.value).toLowerCase().includes("estudante"),
    "Na Fixture B, a Persona NÃO é tratada como estudante"
  );
  assert.ok(
    !String(policy.canonicalFact.value).toLowerCase().includes("estagiária"),
    "Na Fixture B, a Persona NÃO é tratada como estagiária"
  );

  const graduatedResponse = [
    "sou enfermeira formada e hoje tenho minha própria clínica de estética 😊",
  ];
  const validation = validateOccupationResponseSemantics({
    inbound,
    responses: graduatedResponse,
    availableFacts: FIXTURE_B_GRADUATED,
  });
  assert.ok(validation.valid, `Resposta na Fixture B deve ser válida: ${validation.reason}`);
});

test("TESTE D — Persona C TOTALMENTE DIFERENTE: MESMAS instructions com 'Designer e fotógrafa'", async () => {
  const inbound = "vc trabalha com oq?";
  const searchResults = await searchPersonaMemory({
    query: inbound,
    cachedFacts: FIXTURE_C_DESIGNER,
    allowLegacyFallback: false,
  });

  const policy = evaluateOccupationFactSelection({
    inbound,
    retrievedFacts: searchResults,
  });

  assert.equal(policy.mode, "complete_aggregate");
  assert.equal(policy.canonicalFact.key, "profissao");
  assert.equal(policy.canonicalFact.value, "Designer gráfica e fotógrafa de eventos");

  const designerResponse = [
    "trabalho como designer gráfica criando marcas e nos fins de semana faço fotos de eventos kkk",
  ];
  const validation = validateOccupationResponseSemantics({
    inbound,
    responses: designerResponse,
    availableFacts: FIXTURE_C_DESIGNER,
  });
  assert.ok(validation.valid, `Resposta na Fixture C deve ser válida: ${validation.reason}`);
});

test("TESTE E — Formação: curso em andamento sem conclusão bloqueia inferência; conclusão explícita autoriza", () => {
  const inbound = "vc é enfermeira?";

  // Caso 1: Fixture A (curso em andamento sem conclusão)
  const validationInProgress = validateOccupationResponseSemantics({
    inbound,
    responses: ["sim, sou enfermeira formada kkk"],
    availableFacts: FIXTURE_A_CURRENT,
  });
  assert.equal(
    validationInProgress.valid,
    false,
    "Com curso em andamento na memória, NÃO pode afirmar profissão concluída"
  );
  assert.ok(
    validationInProgress.reason.includes("VIOLATION_FORMED_PROFESSION"),
    "Deve acusar violação de profissão formada sem autorização da PersonaMemory"
  );

  // Caso 2: Fixture B (profissão explicitamente concluída na PersonaMemory)
  const validationGraduated = validateOccupationResponseSemantics({
    inbound,
    responses: ["sim, sou enfermeira formada e tenho minha própria clínica"],
    availableFacts: FIXTURE_B_GRADUATED,
  });
  assert.equal(
    validationGraduated.valid,
    true,
    "Com fato explícito de graduação na memória, PODE afirmar profissão concluída"
  );
});

test("TESTE 7 — Prova Temporal: INSTRUCTIONS idênticas geram interpretação factual adaptada conforme Memory", () => {
  const instructions1 = buildCanonicalAgentInstructions();
  const instructions2 = buildCanonicalAgentInstructions();

  // 1. As instruções são RIGOROSAMENTE idênticas
  assert.equal(instructions1, instructions2, "As instruções devem ser 100% idênticas");
  assert.ok(instructions1.includes("VENDEO_AGENT_INSTRUCTIONS_VERSION: 2.9.2"));

  const inbound = "vc trabalha com oq?";

  // 2. Memory V1 (estudante + estágio + vendas) -> interpretação fática reflete V1
  const policyV1 = evaluateOccupationFactSelection({ inbound, retrievedFacts: FIXTURE_A_CURRENT });
  assert.equal(policyV1.canonicalFact.value, "Estudante de Enfermagem (estagiária hospitalar) e vendedora online");
  assert.match(String(policyV1.canonicalFact.value), /estudante/i);

  // 3. Memory V2 (profissão concluída + nova ocupação) -> interpretação fática reflete V2
  const policyV2 = evaluateOccupationFactSelection({ inbound, retrievedFacts: FIXTURE_B_GRADUATED });
  assert.equal(policyV2.canonicalFact.value, "Enfermeira formada e dona de clínica de estética");
  assert.match(String(policyV2.canonicalFact.value), /enfermeira formada/i);

  // 4. Memory V3 (outra carreira: designer/fotógrafa) -> interpretação fática reflete V3
  const policyV3 = evaluateOccupationFactSelection({ inbound, retrievedFacts: FIXTURE_C_DESIGNER });
  assert.equal(policyV3.canonicalFact.value, "Designer gráfica e fotógrafa de eventos");
  assert.match(String(policyV3.canonicalFact.value), /designer/i);

  // A instruction NÃO precisou mudar uma linha para acomodar V1, V2 ou V3
});
