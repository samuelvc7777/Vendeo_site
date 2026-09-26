import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const projectRoot = path.resolve('.');

test('1. select("*") não aparece em nenhuma query de lista de conversas em todo o codebase', () => {
  const filesToCheck = [
    'src/presentation/components/chat/InstagramDirect.tsx',
    'src/infrastructure/repositories/SupabaseInstagramRepository.ts',
    'src/infrastructure/repositories/SupabaseChatRepository.ts',
    'src/presentation/hooks/useRaffles.ts',
    'src/app/api/ai/prompt/[conversationId]/route.ts'
  ];

  for (const relPath of filesToCheck) {
    const fullPath = path.join(projectRoot, relPath);
    const content = fs.readFileSync(fullPath, 'utf8');

    // Regex procurando .from("instagram_conversations").select("*")
    const hasWildcardSelect = /\.from\(["']instagram_conversations["']\)\s*\.select\(["']\*["']\)/.test(content);
    assert.equal(
      hasWildcardSelect,
      false,
      `Arquivo ${relPath} ainda contém .from("instagram_conversations").select("*")`
    );
  }
});

test('2. stage_completed_rules foi omitido do select das listas de conversas', () => {
  const directPath = path.join(projectRoot, 'src/presentation/components/chat/InstagramDirect.tsx');
  const directContent = fs.readFileSync(directPath, 'utf8');
  const directSelect = directContent.match(/\.from\(["']instagram_conversations["']\)\s*\.select\(["']([^"']+)["']\)/);
  assert.ok(directSelect, 'Query de select de conversas deve existir');
  assert.equal(
    directSelect[1].includes('stage_completed_rules'),
    false,
    'InstagramDirect.tsx não deve incluir stage_completed_rules na listagem'
  );

  const repoPath = path.join(projectRoot, 'src/infrastructure/repositories/SupabaseInstagramRepository.ts');
  const repoContent = fs.readFileSync(repoPath, 'utf8');
  const repoSelect = repoContent.match(/\.from\(["']instagram_conversations["']\)\s*\.select\([\s\S]*?["']([^"']+)["']\s*\)/);
  assert.ok(repoSelect, 'Query no repositório deve existir');
  assert.equal(
    repoSelect[1].includes('stage_completed_rules'),
    false,
    'SupabaseInstagramRepository não deve incluir stage_completed_rules na listagem'
  );
});

test('3. In-flight dedup implementado em loadInstagramConversations', () => {
  const directPath = path.join(projectRoot, 'src/presentation/components/chat/InstagramDirect.tsx');
  const content = fs.readFileSync(directPath, 'utf8');

  assert.ok(content.includes('isDirectLoadingConvsRef'), 'Deve conter isDirectLoadingConvsRef');
  assert.ok(content.includes('if (isDirectLoadingConvsRef.current) return;'), 'Deve abortar se já em voo');
  assert.ok(content.includes('isDirectLoadingConvsRef.current = false;'), 'Deve liberar no finally');
});

test('4. In-flight dedup implementado no POLLING 1 (conversa ativa)', () => {
  const directPath = path.join(projectRoot, 'src/presentation/components/chat/InstagramDirect.tsx');
  const content = fs.readFileSync(directPath, 'utf8');

  assert.ok(content.includes('isFetchingMessagesRef'), 'Deve conter isFetchingMessagesRef');
  assert.ok(content.includes('if (isFetchingMessagesRef.current)'), 'POLLING 1 deve checar isFetchingMessagesRef');
  assert.ok(content.includes('isFetchingMessagesRef.current = false;'), 'POLLING 1 deve liberar no finally');
});

test('5. In-flight dedup implementado no POLLING 2 (lista de conversas)', () => {
  const directPath = path.join(projectRoot, 'src/presentation/components/chat/InstagramDirect.tsx');
  const content = fs.readFileSync(directPath, 'utf8');

  assert.ok(content.includes('isFetchingConversationsRef'), 'Deve conter isFetchingConversationsRef');
  assert.ok(content.includes('if (isFetchingConversationsRef.current)'), 'POLLING 2 deve checar isFetchingConversationsRef');
  assert.ok(content.includes('isFetchingConversationsRef.current = false;'), 'POLLING 2 deve liberar no finally');
});

test('6. POLLING 1 respeita supressão com Realtime saudável (janela de 5 min) e fallback quando degradado (>=60s)', () => {
  const directPath = path.join(projectRoot, 'src/presentation/components/chat/InstagramDirect.tsx');
  const content = fs.readFileSync(directPath, 'utf8');

  assert.ok(content.includes('if (isRealtimeConnectedRef.current)'), 'Deve verificar saúde do Realtime');
  assert.ok(content.includes('300000'), 'Deve aguardar 300s quando Realtime conectado');
  assert.ok(content.includes('const base = isVisible ? 60000 : 120000;'), 'Fallback degradado deve ter base >= 60s');
});

test('7. POLLING 2 respeita supressão com Realtime saudável (janela de 2 min) e fallback quando degradado (>=120s)', () => {
  const directPath = path.join(projectRoot, 'src/presentation/components/chat/InstagramDirect.tsx');
  const content = fs.readFileSync(directPath, 'utf8');

  assert.ok(content.includes('120000'), 'Deve aguardar pelo menos 120s quando Realtime conectado');
  assert.ok(content.includes('const base = isVisible ? 120000 : 300000;'), 'Fallback degradado deve ter base >= 120s');
});

test('8. Janela mínima em focus/visibilitychange para evitar tempestade de requisições', () => {
  const directPath = path.join(projectRoot, 'src/presentation/components/chat/InstagramDirect.tsx');
  const content = fs.readFileSync(directPath, 'utf8');

  assert.ok(content.includes('sinceLastMs < 30000'), 'handleImmediateChatRevalidate deve exigir pelo menos 30s');
  assert.ok(content.includes('sinceLastMs < 60000'), 'handleImmediateListRevalidate deve exigir pelo menos 60s');
});

test('9. Handler de mensagem Realtime não dispara mais full fetch de 300 conversas', () => {
  const directPath = path.join(projectRoot, 'src/presentation/components/chat/InstagramDirect.tsx');
  const content = fs.readFileSync(directPath, 'utf8');

  // Não pode haver setTimeout com loadInstagramConversations dentro de handleRealtimeInstagramMessage
  assert.equal(
    content.includes('setTimeout(() => loadInstagramConversations(), 250);'),
    false,
    'Não deve disparar full fetch ao receber mensagem de conversa não listada'
  );
});

test('10. Subscription de INSERT de conversa existe e atualiza a lista incrementalmente', () => {
  const realtimePath = path.join(projectRoot, 'src/presentation/hooks/useChatRealtime.ts');
  const content = fs.readFileSync(realtimePath, 'utf8');

  assert.ok(content.includes('event: "INSERT"'), 'Deve registrar listener de INSERT');
  assert.ok(content.includes('table: "instagram_conversations"'), 'Deve registrar listener para instagram_conversations');
  assert.ok(content.includes('onInstagramConversationInsert'), 'Deve conter callback onInstagramConversationInsert');

  const directPath = path.join(projectRoot, 'src/presentation/components/chat/InstagramDirect.tsx');
  const directContent = fs.readFileSync(directPath, 'utf8');
  assert.ok(directContent.includes('handleRealtimeInstagramConversationInsert'), 'InstagramDirect deve implementar o handler');
  assert.ok(directContent.includes('onInstagramConversationInsert: handleRealtimeInstagramConversationInsert'), 'Deve passar para useChatRealtime');
});

test('11. Query de enriquecimento de mensagens possui LIMIT e CUTOFF temporal', () => {
  const directPath = path.join(projectRoot, 'src/presentation/components/chat/InstagramDirect.tsx');
  const content = fs.readFileSync(directPath, 'utf8');

  // Verifica se as queries de enriquecimento de mensagens usam cutoff e limit
  const matches = content.match(/\.from\(["']instagram_messages["']\)[\s\S]*?\.limit\(150\)/g);
  assert.ok(matches && matches.length >= 2, 'Ambas as queries de enriquecimento devem possuir limit(150)');
});

test('12. useChatStages filtra por id da conversa e useAutoPilot respeita saúde do Realtime', () => {
  const stagesPath = path.join(projectRoot, 'src/presentation/hooks/useChatStages.ts');
  const stagesContent = fs.readFileSync(stagesPath, 'utf8');
  assert.ok(stagesContent.includes('filter: `id=eq.${activeConversationId}`'), 'useChatStages deve filtrar pela PK id');

  const apPath = path.join(projectRoot, 'src/presentation/hooks/useAutoPilot.ts');
  const apContent = fs.readFileSync(apPath, 'utf8');
  assert.ok(apContent.includes('isRealtimeHealthy'), 'useAutoPilot deve suportar isRealtimeHealthy');
  assert.ok(apContent.includes('if (isRealtimeHealthyRef.current) return;'), 'useAutoPilot deve suprimir polling quando Realtime saudável');
});
