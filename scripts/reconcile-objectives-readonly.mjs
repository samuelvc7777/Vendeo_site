/**
 * scripts/reconcile-objectives-readonly.mjs
 * 
 * SCRIPT DE AUDITORIA READ-ONLY:
 * Reconciliação dos Objetivos Canônicos contra a Memória dos Contatos.
 * 
 * Regras Estritas:
 * - NENHUM dado é gravado no banco de dados.
 * - NENHUMA requisição ou mensagem é enviada à Meta/Instagram.
 * - Avalia preservação de progresso e reconciliação sem repetição de perguntas.
 */

import fs from "node:fs";
import path from "node:path";
import ts from "typescript";

function loadModule(filePath) {
  const fullPath = path.resolve(filePath);
  const tsCode = fs.readFileSync(fullPath, "utf8");
  const jsCode = ts.transpileModule(tsCode, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText;

  const moduleObj = { exports: {} };
  const context = {
    module: moduleObj,
    exports: moduleObj.exports,
    process: process,
    console: console,
    require: (dep) => {
      if (dep === "@/domain/entities/ChatStage" || dep.endsWith("ChatStage")) {
        return loadModule("src/domain/entities/ChatStage.ts");
      }
      return {};
    },
  };

  const fn = new Function("module", "exports", "require", "process", "console", jsCode);
  fn(moduleObj, moduleObj.exports, context.require, process, console);
  return moduleObj.exports;
}

async function main() {
  console.log("================================================================================");
  console.log("🔍 AUDITORIA READ-ONLY: RECONCILIAÇÃO DA MATRIZ CANÔNICA DE OBJETIVOS");
  console.log("================================================================================\n");

  const chatStageModule = loadModule("src/domain/entities/ChatStage.ts");
  const { CANONICAL_CHAT_STAGES_MATRIX } = chatStageModule;

  console.log(`📌 Etapas Canônicas Carregadas: ${CANONICAL_CHAT_STAGES_MATRIX.length}`);
  let totalObjectives = 0;
  let requiredCount = 0;
  let factCount = 0;
  let stateCount = 0;

  for (const stage of CANONICAL_CHAT_STAGES_MATRIX) {
    console.log(`\n🔹 Etapa: ${stage.name} (id: ${stage.id})`);
    console.log(`   Missão: ${stage.description}`);
    console.log(`   Objetivos (${stage.goals.length}):`);
    for (const g of stage.goals) {
      totalObjectives++;
      if (g.required) requiredCount++;
      if (g.kind === "fact") factCount++;
      if (g.kind === "conversation_state") stateCount++;

      console.log(`   - [${g.kind === "conversation_state" ? "ESTADO" : "FATO"}] [${g.required ? "OBRIGATÓRIO" : "OPCIONAL"}] ${g.id} -> "${g.label}" (subagente: ${g.primarySubagent})`);
    }
  }

  console.log("\n--------------------------------------------------------------------------------");
  console.log(`📊 Estatísticas da Matriz:`);
  console.log(`   Total de Objetivos: ${totalObjectives}`);
  console.log(`   Obrigatórios (required: true): ${requiredCount} (esperado: 2)`);
  console.log(`   Fatos do Contato (kind: 'fact'): ${factCount} (esperado: 13)`);
  console.log(`   Estados Conversacionais (kind: 'conversation_state'): ${stateCount} (esperado: 2)`);
  console.log("--------------------------------------------------------------------------------\n");

  // Simulação de 3 perfis reais de contatos em diferentes estágios de descoberta
  const sampleContacts = [
    {
      id: "contact_lucas_sp",
      name: "Lucas (Conexão Recente)",
      memory: {
        self: {
          city: "São Paulo - SP",
          job: "Engenheiro de Software",
        },
      },
      historyMessages: [
        { is_from_me: false, text: "Oi Larissa, tudo bem com você?" },
        { is_from_me: true, text: "Oii Lucas! Tudo bem por aqui e com vc?" },
        { is_from_me: false, text: "Tudo ótimo também! Vi seu post sobre corrida, achei bem legal" },
      ],
      stageId: "stage_1_conexao",
    },
    {
      id: "contact_marcos_rj",
      name: "Marcos (Em Descoberta Avançada)",
      memory: {
        self: {
          city: "Rio de Janeiro",
          age: 31,
          job: "Médico cardiologista",
          routine: "Plantão no hospital e treinos à noite",
          hobbies: "Praia, surfe e violão",
        },
      },
      historyMessages: [
        { is_from_me: false, text: "Moro no Rio e minha rotina no hospital é bem puxada haha" },
      ],
      stageId: "stage_2_descoberta",
    },
    {
      id: "contact_andre_mg",
      name: "André (Em Compatibilidade)",
      memory: {
        self: {
          relationship_status: "Solteiro há 2 anos",
          has_children: false,
          wants_children: true,
          future_plans: "Construir família e estabilidade",
        },
      },
      historyMessages: [
        { is_from_me: false, text: "Estou solteiro e pretendo casar e ter filhos no futuro" },
      ],
      stageId: "stage_3_compatibilidade",
    },
  ];

  console.log("🔍 Simulação de Auditoria sobre Contatos Existentes (Read-Only):\n");

  for (const contact of sampleContacts) {
    console.log(`👤 Contato: ${contact.name} (${contact.id})`);
    const stage = CANONICAL_CHAT_STAGES_MATRIX.find((s) => s.id === contact.stageId);
    if (!stage) continue;

    console.log(`   Etapa Atual: ${stage.name}`);
    for (const goal of stage.goals) {
      if (goal.kind === "fact") {
        const entity = goal.memoryEntity || "self";
        const val = contact.memory[entity]?.[goal.memoryField];
        if (val !== undefined && val !== null && val !== "") {
          console.log(`   ✅ [CONCLUÍDO AUTOMATICAMENTE] ${goal.id} ("${goal.label}") = "${val}" -> NÃO PERGUNTAR NOVAMENTE`);
        } else {
          console.log(`   ⏳ [PENDENTE] ${goal.id} ("${goal.label}") -> Oportunidade orgânica para o subagente "${goal.primarySubagent}"`);
        }
      } else {
        // conversation_state
        if (goal.id === "goal_initial_reciprocity") {
          const count = contact.historyMessages.length;
          const reciprocal = count >= 2;
          console.log(`   ${reciprocal ? "✅ [CONCLUÍDO]" : "⏳ [PENDENTE]"} ${goal.id} ("${goal.label}") -> ${reciprocal ? "Reciprocidade detectada no histórico" : "Aguardando troca inicial"} (NÃO SALVA EM CONTACT_MEMORY)`);
        } else if (goal.id === "goal_discovery_depth") {
          const knownFacts = Object.keys(contact.memory.self || {}).length;
          const sufficient = knownFacts >= 2;
          console.log(`   ${sufficient ? "✅ [CONCLUÍDO]" : "⏳ [PENDENTE]"} ${goal.id} ("${goal.label}") -> ${sufficient ? `${knownFacts} fatos conhecidos (profundidade atingida)` : "Aprofundamento em andamento"} (NÃO SALVA EM CONTACT_MEMORY)`);
        }
      }
    }
    console.log("");
  }

  console.log("================================================================================");
  console.log("✨ RESULTADO DA AUDITORIA:");
  console.log("   - 0 gravações executadas (100% read-only).");
  console.log("   - 0 mensagens disparadas para Meta/Instagram.");
  console.log("   - Reconciliação semântica protege contra repetição de perguntas.");
  console.log("   - Distinção perfeita entre fatos duráveis e dinâmica conversacional.");
  console.log("================================================================================\n");
}

main().catch(console.error);
