import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  hasNewConversationMessage,
  runDeduplicatedConversationFetch,
} from "../src/presentation/components/chat/instagram-message-loading.ts";

const projectRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const clientSource = readFileSync(join(projectRoot, "src/presentation/components/chat/InstagramDirect.tsx"), "utf8");
const nextRouteSource = readFileSync(join(projectRoot, "src/app/api/instagram/messages/[conversationId]/route.ts"), "utf8");
const edgeSource = readFileSync(join(projectRoot, "supabase/functions/api/index.ts"), "utf8");
const repositorySource = readFileSync(join(projectRoot, "src/infrastructure/repositories/SupabaseInstagramRepository.ts"), "utf8");

test("GET de mensagens é somente leitura e não atualiza a conversa", () => {
  assert.doesNotMatch(nextRouteSource, /saveConversation\(\{\s*id:\s*conversationId,\s*unread:\s*false/);
  assert.doesNotMatch(nextRouteSource, /from\(["']instagram_conversations["']\)[\s\S]{0,180}\.update\(/);

  const messagesRouteStart = edgeSource.indexOf('const messagesMatch = path.match(/^\\/instagram\\/messages');
  const messagesRouteEnd = edgeSource.indexOf("// POST: Envio de mensagem", messagesRouteStart);
  assert.ok(messagesRouteStart >= 0 && messagesRouteEnd > messagesRouteStart);
  const getRoute = edgeSource.slice(messagesRouteStart, messagesRouteEnd);
  assert.doesNotMatch(getRoute, /from\(["']instagram_conversations["']\)[\s\S]{0,180}\.update\(/);
  assert.match(getRoute, /const shouldSyncWithMeta = forceSync/);
});

test("abrir chat busca Supabase sem sync=true e não consulta Supabase no navegador para enriquecer", () => {
  const openStart = clientSource.indexOf("const handleOpenConversation = async");
  const openEnd = clientSource.indexOf("// Navegação automática para o chat", openStart);
  const openHandler = clientSource.slice(openStart, openEnd);
  assert.ok(openStart >= 0 && openEnd > openStart);
  assert.match(openHandler, /\/api\/instagram\/messages\/\$\{conv\.id\}`/);
  assert.doesNotMatch(openHandler, /\/api\/instagram\/messages\/\$\{conv\.id\}\?sync=true/);
  assert.doesNotMatch(openHandler, /getSupabaseBrowserClient\(\)/);
  assert.match(openHandler, /void fetch\(getApiUrl\("\/api\/instagram\/sync"\)/);
  assert.match(openHandler, /setLoadingConversationId\(\(current\) => current === conv\.id \? null : current\)/);
  assert.match(clientSource, /\/api\/instagram\/messages\/\$\{conversationId\}\?sync=true/);
});

test("sync=true fica restrito à ação manual e histórico vazio sincroniza sem segurar loading", () => {
  const manualStart = clientSource.indexOf("const handleManualSyncChat = useCallback");
  const manualEnd = clientSource.indexOf("// isRealtimeHealthy", manualStart);
  const manualHandler = clientSource.slice(manualStart, manualEnd);
  assert.match(manualHandler, /\/api\/instagram\/messages\/\$\{conversationId\}\?sync=true/);

  const openStart = clientSource.indexOf("const handleOpenConversation = async");
  const openEnd = clientSource.indexOf("// Navegação automática para o chat", openStart);
  const openHandler = clientSource.slice(openStart, openEnd);
  const emptyHistoryBranch = openHandler.slice(openHandler.indexOf("if (formatted.length === 0"));
  assert.match(emptyHistoryBranch, /void fetch\(getApiUrl\("\/api\/instagram\/sync"\)/);
  assert.match(emptyHistoryBranch, /\.then\(async \(syncResponse\)/);
  assert.match(openHandler, /finally \{\s*setLoadingConversationId/);
});

test("cache abre sem skeleton e continua revalidando mensagens em segundo plano", () => {
  const openStart = clientSource.indexOf("const handleOpenConversation = async");
  const openEnd = clientSource.indexOf("// Navegação automática para o chat", openStart);
  const openHandler = clientSource.slice(openStart, openEnd);
  assert.match(openHandler, /const cached = messages\[conv\.id\]/);
  assert.match(openHandler, /setLoadingConversationId\(hasCache \? null : conv\.id\)/);
  assert.match(openHandler, /await runDeduplicatedConversationFetch/);
});

test("payload recente preserva campos de reply, mídia, transcrição e status", () => {
  assert.match(repositorySource, /\.limit\(limit\)/);
  assert.match(repositorySource, /limit = 150/);
  for (const column of ["id", "conversation_id", "sender_id", "text", "timestamp", "is_mine", "status", "seen_at", "deliver_at", "reply_to_message_id", "media_url", "media_type", "audio_transcript"]) {
    assert.match(repositorySource, new RegExp(`select\\(["'][^"']*\\b${column}\\b`));
  }
  assert.match(clientSource, /audioTranscript: m\.audioTranscript/);
});

test("dez chamadas concorrentes da mesma conversa compartilham um único request", async () => {
  const inFlight = new Map();
  let requests = 0;
  let releaseRequest;
  const requestGate = new Promise((resolve) => { releaseRequest = resolve; });
  const load = () => runDeduplicatedConversationFetch(inFlight, "conv-123", async () => {
    requests += 1;
    await requestGate;
  });

  const calls = Array.from({ length: 10 }, load);
  await Promise.resolve();
  assert.equal(requests, 1);
  releaseRequest();
  await Promise.all(calls);
  assert.equal(inFlight.size, 0);
});

test("falha remove a entrada de dedup e permite nova tentativa", async () => {
  const inFlight = new Map();
  await assert.rejects(runDeduplicatedConversationFetch(inFlight, "conv-123", async () => {
    throw new Error("falha simulada");
  }), /falha simulada/);
  assert.equal(inFlight.has("conv-123"), false);

  let retries = 0;
  await runDeduplicatedConversationFetch(inFlight, "conv-123", async () => { retries += 1; });
  assert.equal(retries, 1);
  assert.equal(inFlight.size, 0);
});

test("conversas diferentes podem carregar em paralelo", async () => {
  const inFlight = new Map();
  let requests = 0;
  let releaseRequests;
  const requestGate = new Promise((resolve) => { releaseRequests = resolve; });
  const request = () => runDeduplicatedConversationFetch(inFlight, "conv", async () => {
    requests += 1;
    await requestGate;
  });
  const first = request().then(() => undefined);
  const second = runDeduplicatedConversationFetch(inFlight, "other-conv", async () => {
    requests += 1;
    await requestGate;
  });
  await Promise.resolve();
  assert.equal(requests, 2);
  releaseRequests();
  await Promise.all([first, second]);
});

test("Realtime sem last_message_at novo não solicita histórico; delta real solicita", () => {
  const knownAt = Date.parse("2026-09-27T20:30:00.000Z");
  assert.equal(hasNewConversationMessage(Number.NaN, knownAt), false);
  assert.equal(hasNewConversationMessage(knownAt, knownAt), false);
  assert.equal(hasNewConversationMessage(knownAt + 60_000, knownAt), true);
});

test("INSERT recebido e burst repetido não geram GET redundante", async () => {
  const inFlight = new Map();
  const insertTimestamp = Date.parse("2026-09-27T20:31:00.000Z");
  let latestRealtimeTimestamp = insertTimestamp;
  let latestFetchedTimestamp = 0;
  let requests = 0;
  let releaseRequest;
  const requestGate = new Promise((resolve) => { releaseRequest = resolve; });

  const maybeRefresh = (timestamp) => {
    if (!hasNewConversationMessage(timestamp, 0, Math.max(latestRealtimeTimestamp, latestFetchedTimestamp))) return Promise.resolve();
    return runDeduplicatedConversationFetch(inFlight, "conv-123", async () => {
      requests += 1;
      await requestGate;
      latestFetchedTimestamp = timestamp;
    });
  };

  // O INSERT do Realtime já trouxe esta mensagem: UPDATE equivalente não refaz GET.
  await Promise.all(Array.from({ length: 10 }, () => maybeRefresh(insertTimestamp)));
  assert.equal(requests, 0);

  // Um delta sem INSERT provoca um único request, mesmo com dez updates em burst.
  latestRealtimeTimestamp = 0;
  const newTimestamp = insertTimestamp + 60_000;
  const calls = Array.from({ length: 10 }, () => maybeRefresh(newTimestamp));
  await Promise.resolve();
  assert.equal(requests, 1);
  releaseRequest();
  await Promise.all(calls);
  assert.equal(requests, 1);
  assert.equal(await maybeRefresh(newTimestamp), undefined);
  assert.equal(requests, 1);
});

test("resultado de A é guardado na chave de A e não encerra loading de B", () => {
  assert.match(clientSource, /setMessages\(\(previous\) => \(\{ \.\.\.previous, \[conv\.id\]: formatted \}\)\)/);
  assert.match(clientSource, /setLoadingConversationId\(\(current\) => current === conv\.id \? null : current\)/);
  assert.match(clientSource, /const isLoadingMessages = loadingConversationId === activeChat\?\.id/);
});
