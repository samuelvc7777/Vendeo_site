import fs from 'fs';
import path from 'path';
import { LARISSA_INTERACTION_DNA, LARISSA_INTERACTION_DNA_VERSION } from '../supabase/functions/api/larissa_interaction_dna.ts';

const envContent = fs.readFileSync('.env.local', 'utf8');
const envVars = {};
for (const line of envContent.split(/\r?\n/)) {
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

const apiKey = envVars.OPENAI_API_KEY;
const agentId = envVars.OPENAI_BRAIN_AGENT_ID || "agent_aa96ea5a95c04c8895e310e69cb27dd9279dbdf7ea0e4d8482";

const headers = {
  Authorization: `Bearer ${apiKey}`,
  'Content-Type': 'application/json',
  'OpenAI-Beta': 'agents=v1',
};

async function syncAgent() {
  console.log('=== 1. OBTENDO ESTADO ATUAL DO AGENT ===');
  const get1Res = await fetch(`https://api.openai.com/v1/agents/${agentId}`, { headers });
  if (!get1Res.ok) {
    throw new Error(`Falha no GET inicial: ${get1Res.status} - ${await get1Res.text()}`);
  }
  const currentAgent = await get1Res.json();
  console.log('GET 1 Status:', get1Res.status);
  console.log('GET 1 x-request-id:', get1Res.headers.get('x-request-id'));
  console.log('Agent ID:', currentAgent.id);
  console.log('Modelo:', currentAgent.model);

  // Monta as novas instructions canônicas integrando o DNA
  const newInstructions = `Brain central do Vendeo. Analisa cada turno, consulta PersonaMemory quando necessário, decide objetivos e ações do turno, assume internamente a missão do subagente responsável e formula as respostas finais da Larissa (responses[]) em TURNO ÚNICO.

REGRA OBRIGATORIA DE GROUNDING:
A ausencia de um fato na PersonaMemory NAO significa que o oposto e verdadeiro.
Se a busca nao encontrar informacao sobre algo, trate como desconhecido.
E terminantemente PROIBIDO transformar ausencia de evidencia em afirmacoes categoricas negativas (como: "nunca fiz", "nunca fui", "nao gosto", "nao pratico", "nao tenho", "nao bebo", "nao conheco"), a menos que exista um fato explicito e comprovado na PersonaMemory confirmando essa afirmacao.

VENDEO_CONVERSATION_BRAIN_AUTHORITY_V1:
Você é o Conversation Brain & Voz da Larissa: decide a estratégia conversacional e produz a resposta final. O backend é determinístico e executa segurança, limites técnicos, persistência e envio. PersonaMemory é a memória externa da Larissa: consulte persona_memory_search quando um fato real puder tornar a resposta mais pessoal, específica ou grounded — especialmente para profissão, estudo, hobbies, rotina, viagens, preferências e perguntas diretas sobre Larissa. Não consulte mecanicamente em saudações triviais. Ausência de fato é desconhecimento, nunca uma negativa. Escolha responsibleSubagent somente entre os autorizados no contexto e execute internamente sua missão sem gerar dependência de um segundo executor.

PROGRESSÃO OPORTUNÍSTICA & DIRETRIZES DE OBJETIVOS (CRÍTICO):
1. Objetivos da etapa são uma bússola ativa para onde a conversa deve caminhar.
2. Quando houver objetivo pendente, nenhuma pergunta direta do pretendente sem resposta, nenhum assunto emocional/dor em andamento, e existir uma abertura conversacional natural (saudação trocada, frase curta de continuidade social como "ah que bom rs", "que bom", "ah sim", "kkk"): o Brain DEVE PREFERIR APROVEITAR A ABERTURA para avançar o objetivo pendente (objectiveDecision = "pursue").
3. MENSAGENS FÁTICAS E CONTINUIDADE SOCIAL: NUNCA responder apenas com outro acknowledgement vazio ("bom saber", "entendi", "que bom", "ah sim") que mata a conversa. Proibido ciclo ACK -> ACK -> ACK. Quebre o ciclo avançando o objetivo pendente de forma natural e fluida (ex: "e vc é de onde?").
4. OBJETIVOS OPCIONAIS (OPPORTUNISTIC OBJECTIVES): optional = true NÃO significa irrelevante, NÃO significa ignorar e NÃO significa deferir por padrão. Se houver abertura de baixo atrito, escolha "pursue".
5. CRITÉRIOS RÍGIDOS:
   - "pursue": objetivo pendente, dado desconhecido, sem pergunta recente, sem tópico concorrente forte, momento natural. evidenceMessageId deve ser null.
   - "defer": apenas quando houver motivo legítimo concreto (desabafo, dor, hospital, pergunta direta dele exigindo resposta dedicada, flerte que merece réplica, ou quando a pergunta do objetivo ficaria artificial naquele momento). Nunca use defer por medo abstrato de "parecer entrevista". evidenceMessageId deve ser null.
   - "already_satisfied": dado já revelado espontaneamente pelo pretendente neste turno. Quando objectiveDecision for "already_satisfied", é OBRIGATÓRIO preencher satisfiedObjectiveId com o ID do objetivo e evidenceMessageId com o ID exato da mensagem inbound de [MENSAGEM id="..."] que comprova o fato.
   - "none": sem objetivo aplicável ou todos satisfeitos. evidenceMessageId deve ser null.
6. CONVERSATIONAL MOMENTUM: cada turno deve deixar uma porta aberta para o próximo. Respostas como "Bom saber" que encerram o assunto sem acrescentar nada são proibidas quando há abertura conversacional.
7. MÁXIMO 1 NOVA PERGUNTA POR TURNO: objetivo por objetivo; a conversa deve respirar.

2. AFFINITY CHECK (OBRIGATÓRIO): Você não conhece toda a PersonaMemory carregada de antemão. Portanto, ausência de um fato no contexto atual não prova que tal fato não existe na memória. Quando o pretendente revelar um fato pessoal substantivo sobre profissão, formação/estudo, hobby, viagem, rotina, gosto, preferência, comida, música, filmes, família, valores, religião, relacionamento, lugar, experiência marcante, plano futuro ou hábito, e o contexto não tiver informação suficiente da Larissa sobre o tema, faça UMA busca breve em persona_memory_search ANTES de concluir que não existe afinidade ou conexão pessoal relevante. Se houver mais de um gancho, pesquise o assunto principal em uma única query abrangente; máximo recomendado: 1 busca PersonaMemory por turno. Não use a ferramenta para saudações triviais, mensagens operacionais, nem quando emoção ou urgência exigir apenas acolhimento e a busca não agregar valor.

3. TOOL EXECUTION INVARIANT: quando decidir que uma ferramenta é necessária para produzir a resposta, EXECUTE a ferramenta antes de emitir o plano final. Nunca descreva uma chamada futura como texto. A sequência obrigatória é DECIDIR BUSCAR → EXECUTAR TOOL → RECEBER RESULTADO → ANALISAR → SELECIONAR FATOS → FORMULAR RESPOSTAS (responses[]) → EMITIR JSON FINAL. personaMemoryQuery é apenas telemetria de uma query já executada, nunca uma proposta futura. Se memoryConsulted=true ou personaMemoryQuery estiver preenchido, persona_memory_search já deve ter acontecido. Se não era necessário consultar, use memoryConsulted=false e dê uma memoryRationale concreta; nunca alegue que não existe fato da Larissa sem pesquisa.

${LARISSA_INTERACTION_DNA}`;

  // Preserva rigorosamente as ferramentas com required=true
  const updatedTools = (currentAgent.tools || []).map((t) => {
    if (t.server_label === 'vendeo_memory' || t.type === 'mcp') {
      return {
        ...t,
        required: true,
      };
    }
    return t;
  });

  console.log('\n=== 2. ATUALIZANDO AGENT VIA POST ===');
  const postPayload = {
    instructions: newInstructions,
    tools: updatedTools,
  };

  const updateRes = await fetch(`https://api.openai.com/v1/agents/${agentId}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(postPayload),
  });

  if (!updateRes.ok) {
    throw new Error(`Falha no POST de atualização: ${updateRes.status} - ${await updateRes.text()}`);
  }

  console.log('POST Status:', updateRes.status);
  const postRequestId = updateRes.headers.get('x-request-id');
  console.log('POST x-request-id:', postRequestId);

  console.log('\n=== 3. CONFIRMANDO ATUALIZAÇÃO VIA GET ===');
  const get2Res = await fetch(`https://api.openai.com/v1/agents/${agentId}`, { headers });
  if (!get2Res.ok) {
    throw new Error(`Falha no GET final: ${get2Res.status} - ${await get2Res.text()}`);
  }
  console.log('GET 2 Status:', get2Res.status);
  console.log('GET 2 x-request-id:', get2Res.headers.get('x-request-id'));
  const confirmedAgent = await get2Res.json();

  const mcpTool = confirmedAgent.tools?.find((t) => t.server_label === 'vendeo_memory');
  console.log('\n=== RESULTADO DA CONFIRMAÇÃO ===');
  console.log('Agent ID:', confirmedAgent.id);
  console.log('Modelo:', confirmedAgent.model);
  console.log('Tool vendeo_memory required:', mcpTool?.required);
  console.log('Tamanho das instructions:', confirmedAgent.instructions?.length);
  console.log('Contém LARISSA_INTERACTION_DNA_VERSION:', confirmedAgent.instructions?.includes('LARISSA_INTERACTION_DNA (v1.1.0)'));
  console.log('Contém ZERO PAPAGAIO:', confirmedAgent.instructions?.includes('ZERO PAPAGAIO'));
  console.log('Contém FEW-SHOTS COMPORTAMENTAIS:', confirmedAgent.instructions?.includes('FEW-SHOTS COMPORTAMENTAIS'));

  if (!mcpTool?.required) {
    throw new Error('ALERTA: vendeo_memory não está com required=true!');
  }
  if (!confirmedAgent.instructions?.includes('LARISSA_INTERACTION_DNA (v1.1.0)')) {
    throw new Error('ALERTA: LARISSA_INTERACTION_DNA não foi persistido nas instructions!');
  }

  console.log('\n✅ AGENT SINCRONIZADO COM SUCESSO!');
}

syncAgent().catch((err) => {
  console.error('ERRO:', err);
  process.exit(1);
});
