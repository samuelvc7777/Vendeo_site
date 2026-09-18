import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';

const INPUT_FILE = path.resolve(process.cwd(), 'Conversa do WhatsApp com Amor ❤️.txt');
const OUTPUT_GEMINI = path.resolve(process.cwd(), 'dataset_larissa_gemini.jsonl');
const OUTPUT_OPENAI = path.resolve(process.cwd(), 'dataset_larissa_openai.jsonl');
const OUTPUT_STATS = path.resolve(process.cwd(), 'dataset_stats.json');

const SYSTEM_INSTRUCTION =
  'Você é a Larissa, uma jovem brasileira de 23 anos, meiga, simpática, doce e autêntica. Você conversa no celular pelo WhatsApp/Direct de forma natural e espontânea, sem formalidades, com pontuação solta de celular, risadas leves (kkk) e dividindo o pensamento em frases naturais, sem clichês de IA ou assistente.';

// Padrões indesejados / descartáveis
const JUNK_PHRASES = [
  '<mídia oculta>',
  '<mensagem de voz de reprodução única omitida>',
  '<mensagem de voz omitida>',
  'chamada de voz perdida',
  'chamada de vídeo perdida',
  'mensagem apagada',
  'você apagou esta mensagem',
  'este recado foi apagado',
  'as mensagens e ligações são protegidas',
];

// Expressões regulares para higienização e privacidade
const REGEX_PHONE = /\b(?:\+?55\s?)?(?:\(?\d{2}\)?\s?)?(?:9\d{4}[-\s]?\d{4}|\d{4,5}[-\s]?\d{4})\b/g;
const REGEX_CPF = /\b\d{3}\.?\d{3}\.?\d{3}-?\d{2}\b/g;
const REGEX_EMAIL = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g;

// Remove termos de intimidade precoce para adaptar para o contexto de "conhecer o rapaz"
function sanitizeText(text, isModel = false) {
  if (!text) return '';
  let cleaned = text.trim();

  // Remove dados privados sensíveis
  cleaned = cleaned.replace(REGEX_PHONE, '[contato]');
  cleaned = cleaned.replace(REGEX_CPF, '[documento]');
  cleaned = cleaned.replace(REGEX_EMAIL, '[email]');

  // Remove menções diretas ao nome Samuel / Samuca
  cleaned = cleaned.replace(/\b(?:Samuel\s+Vitor|Samuel|Samuca)\b/gi, '');

  // Se for a IA (Larissa), evitar que ela chame um pretendente novo de "amor" logo de cara
  if (isModel) {
    cleaned = cleaned.replace(/\b(?:meu\s+amor|o\s+amor|ô\s+amor|amorzinho)\b/gi, '');
    cleaned = cleaned.replace(/^(?:oi|olá|bom\s+dia|boa\s+tarde|boa\s+noite)\s+amor\b/gi, (match) =>
      match.replace(/\s+amor/i, '')
    );
    cleaned = cleaned.replace(/\s+amor\b(?=[,!?.]|$)/gi, '');
  }

  // Limpa espaços duplos
  cleaned = cleaned.replace(/[ \t]{2,}/g, ' ').replace(/\n{3,}/g, '\n\n').trim();

  return cleaned;
}

// Verifica se a mensagem deve ser descartada
function isJunkMessage(text) {
  if (!text || text.length < 2) return true;
  const lower = text.toLowerCase();
  if (JUNK_PHRASES.some((j) => lower.includes(j))) return true;

  // Se for apenas link isolado
  if (/^https?:\/\/\S+$/i.test(text)) return true;

  return false;
}

async function processDataset() {
  console.log('🚀 Iniciando processamento do histórico do WhatsApp...');
  if (!fs.existsSync(INPUT_FILE)) {
    console.error(`❌ Arquivo não encontrado: ${INPUT_FILE}`);
    process.exit(1);
  }

  const fileStream = fs.createReadStream(INPUT_FILE);
  const rl = readline.createInterface({ input: fileStream, crlfDelay: Infinity });

  // Exemplo de formato: 10/04/2026 09:56 - Samuel Vitor: mensagem
  const lineRegex = /^(\d{2})\/(\d{2})\/(\d{4}) (\d{2}):(\d{2}) - ([^:]+): (.*)$/;

  const rawMessages = [];
  let skippedJunk = 0;

  for await (const line of rl) {
    const match = line.match(lineRegex);
    if (match) {
      const [_, day, month, year, hour, minute, senderRaw, textRaw] = match;
      const cleanText = textRaw.trim();

      if (isJunkMessage(cleanText)) {
        skippedJunk++;
        continue;
      }

      const senderName = senderRaw.trim();
      const isUser = senderName.includes('Samuel');
      const senderRole = isUser ? 'user' : 'model';

      const date = new Date(
        Number(year),
        Number(month) - 1,
        Number(day),
        Number(hour),
        Number(minute)
      );

      rawMessages.push({
        date,
        senderRole,
        text: cleanText,
      });
    } else if (rawMessages.length > 0) {
      // Mensagem multi-linha do WhatsApp que quebrou linha
      const lastMsg = rawMessages[rawMessages.length - 1];
      if (!isJunkMessage(line)) {
        lastMsg.text += '\n' + line.trim();
      }
    }
  }

  console.log(`✅ Total de mensagens válidas lidas: ${rawMessages.length} (Descartadas/mídia: ${skippedJunk})`);

  // 1. Agrupamento de rajadas consecutivas do mesmo remetente em até 3 minutos
  const clusteredTurns = [];
  for (const msg of rawMessages) {
    const last = clusteredTurns[clusteredTurns.length - 1];
    const isModel = msg.senderRole === 'model';
    const sanitized = sanitizeText(msg.text, isModel);

    if (!sanitized) continue;

    if (
      last &&
      last.senderRole === msg.senderRole &&
      msg.date - last.date < 3 * 60 * 1000
    ) {
      last.text += '\n' + sanitized;
      last.date = msg.date;
    } else {
      clusteredTurns.push({
        date: msg.date,
        senderRole: msg.senderRole,
        text: sanitized,
      });
    }
  }

  console.log(`✅ Turnos agrupados após clusterização contínua: ${clusteredTurns.length}`);

  // 2. Divisão em sessões de diálogo (início de sessão se intervalo > 2 horas)
  const sessions = [];
  let currentSession = [];

  for (let i = 0; i < clusteredTurns.length; i++) {
    const turn = clusteredTurns[i];
    const prev = clusteredTurns[i - 1];

    if (prev && turn.date - prev.date > 2 * 60 * 60 * 1000) {
      if (currentSession.length > 0) {
        sessions.push(currentSession);
        currentSession = [];
      }
    }
    currentSession.push(turn);
  }
  if (currentSession.length > 0) sessions.push(currentSession);

  console.log(`✅ Total de sessões conversacionais identificadas: ${sessions.length}`);

  // 3. Montagem dos pares/diálogos válidos para Fine-Tuning
  // Requisito estrito de diálogo: Começar com 'user', alternar 'model', terminar com 'model'
  const validGeminiExamples = [];
  const validOpenAiExamples = [];

  let totalUserMessages = 0;
  let totalModelMessages = 0;

  for (const session of sessions) {
    // Normalizar para garantir que começa com 'user'
    let startIndex = 0;
    while (startIndex < session.length && session[startIndex].senderRole !== 'user') {
      startIndex++;
    }

    if (startIndex >= session.length) continue;

    // Constrói fatias de conversa (de 2 a 6 turnos cada) para capturar contexto rico
    const cleanSession = session.slice(startIndex);
    let currentSlice = [];

    for (let i = 0; i < cleanSession.length; i++) {
      const turn = cleanSession[i];
      const prevInSlice = currentSlice[currentSlice.length - 1];

      // Garante alternância estrita User -> Model -> User -> Model
      if (prevInSlice && prevInSlice.senderRole === turn.senderRole) {
        continue;
      }

      currentSlice.push(turn);

      // Quando o turno for do 'model' e tivermos pelo menos 1 par completo (user + model)
      if (turn.senderRole === 'model' && currentSlice.length >= 2) {
        // Criar exemplo com os últimos N turnos (até 4 turnos: user -> model -> user -> model)
        const turnsToInclude = currentSlice.slice(-4);

        // Verifica se o primeiro é 'user' e o último é 'model'
        if (
          turnsToInclude[0].senderRole === 'user' &&
          turnsToInclude[turnsToInclude.length - 1].senderRole === 'model'
        ) {
          // Filtra respostas do model que sejam monossílabas pobres (ex: "ok", "sim", "não")
          const lastModelResponse = turnsToInclude[turnsToInclude.length - 1].text.trim();
          if (
            lastModelResponse.length >= 4 &&
            !['sim', 'não', 'nao', 'tbm', 'tá', 'ta', 'ok', 'blz'].includes(
              lastModelResponse.toLowerCase()
            )
          ) {
            // Formato oficial Google AI Studio / Vertex AI Gemini 1.5 Flash
            const geminiContents = turnsToInclude.map((t) => ({
              role: t.senderRole === 'user' ? 'user' : 'model',
              parts: [{ text: t.text }],
            }));

            const geminiEntry = {
              systemInstruction: {
                role: 'system',
                parts: [{ text: SYSTEM_INSTRUCTION }],
              },
              contents: geminiContents,
            };

            // Formato oficial OpenAI / Unsloth / Llama 3
            const openAiMessages = [
              { role: 'system', content: SYSTEM_INSTRUCTION },
              ...turnsToInclude.map((t) => ({
                role: t.senderRole === 'user' ? 'user' : 'assistant',
                content: t.text,
              })),
            ];

            validGeminiExamples.push(geminiEntry);
            validOpenAiExamples.push({ messages: openAiMessages });

            totalUserMessages++;
            totalModelMessages++;
          }
        }
      }
    }
  }

  console.log(`\n🎉 Exemplos de alta qualidade gerados: ${validGeminiExamples.length}`);

  // Seleciona uma versão CURADA com os melhores ~1.000 a 1.500 exemplos mais expressivos
  // (Ideal para o Google AI Studio treinar em 10 a 15 minutos sem estourar limites de cota)
  const curatedGeminiExamples = [];
  const curatedOpenAiExamples = [];

  for (let i = 0; i < validGeminiExamples.length; i++) {
    const gEx = validGeminiExamples[i];
    const oEx = validOpenAiExamples[i];
    const lastContent = gEx.contents[gEx.contents.length - 1];
    const modelText = lastContent.parts[0].text;

    // Critérios de riqueza: tem mais de 20 caracteres, contém traços expressivos ou risadas
    const isExpressive =
      modelText.length >= 25 &&
      modelText.length <= 350 &&
      /(?:kkk|rs|nossa|tô|né|uai|simm|imagino|🥰|descansa|hospital|dorm|dia|trabalho|frio|calor|café|casa|viagem|filme)/i.test(
        modelText
      );

    if (isExpressive) {
      curatedGeminiExamples.push(gEx);
      curatedOpenAiExamples.push(oEx);
    }
  }

  const OUTPUT_GEMINI_CURATED = path.resolve(process.cwd(), 'dataset_larissa_gemini_curated.jsonl');
  const OUTPUT_OPENAI_CURATED = path.resolve(process.cwd(), 'dataset_larissa_openai_curated.jsonl');

  // Limita a curadoria em até 1.200 exemplos para treino ótimo e rápido
  const finalCuratedGemini = curatedGeminiExamples.slice(0, 1200);
  const finalCuratedOpenAi = curatedOpenAiExamples.slice(0, 1200);

  console.log(`💎 Versão Curada de Elite gerada com: ${finalCuratedGemini.length} diálogos ricos`);

  // Grava arquivo oficial Gemini JSONL Completo
  const geminiWriteStream = fs.createWriteStream(OUTPUT_GEMINI);
  for (const example of validGeminiExamples) {
    geminiWriteStream.write(JSON.stringify(example) + '\n');
  }
  geminiWriteStream.end();

  // Grava arquivo oficial Gemini JSONL Curado
  const geminiCuratedStream = fs.createWriteStream(OUTPUT_GEMINI_CURATED);
  for (const example of finalCuratedGemini) {
    geminiCuratedStream.write(JSON.stringify(example) + '\n');
  }
  geminiCuratedStream.end();

  // Grava arquivo oficial OpenAI/Unsloth JSONL Completo
  const openAiWriteStream = fs.createWriteStream(OUTPUT_OPENAI);
  for (const example of validOpenAiExamples) {
    openAiWriteStream.write(JSON.stringify(example) + '\n');
  }
  openAiWriteStream.end();

  // Grava arquivo oficial OpenAI/Unsloth JSONL Curado
  const openAiCuratedStream = fs.createWriteStream(OUTPUT_OPENAI_CURATED);
  for (const example of finalCuratedOpenAi) {
    openAiCuratedStream.write(JSON.stringify(example) + '\n');
  }
  openAiCuratedStream.end();

  // Grava relatório de estatísticas
  const stats = {
    inputFile: path.basename(INPUT_FILE),
    totalRawMessages: rawMessages.length,
    skippedJunkOrMedia: skippedJunk,
    clusteredTurnsCount: clusteredTurns.length,
    totalSessions: sessions.length,
    totalTuningExamplesFull: validGeminiExamples.length,
    curatedExamplesCount: finalCuratedGemini.length,
    geminiCuratedOutputFile: path.basename(OUTPUT_GEMINI_CURATED),
    geminiFullOutputFile: path.basename(OUTPUT_GEMINI),
    openAiCuratedOutputFile: path.basename(OUTPUT_OPENAI_CURATED),
    openAiFullOutputFile: path.basename(OUTPUT_OPENAI),
    generatedAt: new Date().toISOString(),
  };

  fs.writeFileSync(OUTPUT_STATS, JSON.stringify(stats, null, 2), 'utf-8');

  console.log(`📁 Arquivo Gemini Curado (Recomendado): ${OUTPUT_GEMINI_CURATED}`);
  console.log(`📁 Arquivo Gemini Completo: ${OUTPUT_GEMINI}`);
  console.log(`📊 Relatório salvo em: ${OUTPUT_STATS}`);
}

processDataset().catch((err) => {
  console.error('❌ Erro durante o processamento do dataset:', err);
  process.exit(1);
});
