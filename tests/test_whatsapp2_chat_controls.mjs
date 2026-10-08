import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { EventEmitter } from 'node:events';
import { createRequire } from 'node:module';

const ui = fs.readFileSync(new URL('../src/presentation/components/chat/InstagramDirect.tsx', import.meta.url), 'utf8');
const gateway = fs.readFileSync(new URL('../services/whatsapp2-gateway/index.cjs', import.meta.url), 'utf8');
const { limitChatSnapshot } = createRequire(import.meta.url)('../services/whatsapp2-gateway/chat-snapshot-policy.cjs');
const accountScope = createRequire(import.meta.url)('../src/domain/entities/whatsapp2-account-scope.cjs');
const activeAccountId = 'account-5511999998888';

function realtimeUpdate(current, update) {
  const start = ui.indexOf('const handleRealtimeWhatsApp2Conversation =');
  const end = ui.indexOf('\n  // ---', start);
  const source = ts.transpile(ui.slice(start, end), { target: ts.ScriptTarget.ES2022 });
  let rows = [current];
  const context = {
    useCallback: (fn) => fn,
    activeWhatsAppAccountIdRef: { current: activeAccountId },
    whatsappConversationBelongsToAccount: accountScope.whatsappConversationBelongsToAccount,
    resolveWhatsAppContactDisplayName: accountScope.resolveWhatsAppContactDisplayName,
    whatsappProviderIdFromConversationId: accountScope.whatsappProviderIdFromConversationId,
    setWhatsApp2Conversations: (fn) => { rows = fn(rows); },
    activeChatIdRef: { current: null },
    getMessageTimestampMs: (value) => Date.parse(value) || 0,
    formatMessageTime: () => '',
  };
  vm.runInNewContext(`${source}\nhandleRealtimeWhatsApp2Conversation(input);`, { ...context, input: { id: current.id, channel: 'whatsapp2', ...update } });
  return rows[0];
}

for (const status of ['archived', 'locked']) {
  test(`realtime move conversa ativa para ${status} sem nova mensagem`, () => {
    const row = realtimeUpdate({ id: `wa2:${activeAccountId}:123@c.us`, status: 'active', archived: false, isLocked: false }, { status });
    assert.equal(row.status, status);
    assert.equal(row.archived, status === 'archived');
    assert.equal(row.isLocked, status === 'locked');
  });
  test(`realtime retira conversa de ${status}`, () => {
    const row = realtimeUpdate({ id: `wa2:${activeAccountId}:123@c.us`, status, archived: status === 'archived', isLocked: status === 'locked' }, { status: 'active' });
    assert.equal(row.status, 'active');
    assert.equal(row.archived, false);
    assert.equal(row.isLocked, false);
  });
}
test('atualização de mensagem sem status preserva controles', () => {
  const row = realtimeUpdate({ id: `wa2:${activeAccountId}:123@c.us`, status: 'locked', archived: false, isLocked: true }, { lastMessage: 'oi' });
  assert.equal(row.status, 'locked');
  assert.equal(row.isLocked, true);
});

test('snapshot mantém arquivadas e trancadas antigas', async () => {
  const chats = [
    { id: { _serialized: 'archive@c.us' }, archived: true, timestamp: 1 },
    { id: { _serialized: 'locked@c.us' }, isLocked: true, timestamp: 1 },
    { id: { _serialized: 'old@c.us' }, timestamp: 1 },
  ];
  const start = gateway.indexOf('async function getRecentChatSnapshot(');
  const end = gateway.indexOf('\nasync function ', start + 1);
  const result = await vm.runInNewContext(`${gateway.slice(start, end)}\ngetRecentChatSnapshot();`, {
    chatSnapshotCache: null, chatSnapshotCacheAt: 0, chatSnapshotPending: null, chatSnapshotGeneration: 0,
    CHAT_SNAPSHOT_CACHE_TTL_MS: 15000, MAX_CHAT_SNAPSHOT_ROWS: 1000,
    ensureReady: () => ({ getChats: async () => chats }),
    getWhatsApp2BlockedChatIds: async () => new Set(),
    resolveVisibleLastMessage: async () => null,
    isInternalWhatsApp2Message: () => false,
    serializeMessage: () => null, limitChatSnapshot,
  });
  assert.deepEqual(Array.from(result, (row) => row.id).sort(), ['archive@c.us', 'locked@c.us']);
});

test('snapshot mantém chats trancados e arquivados com última mensagem interna', async () => {
  const internal = { type: 'notification_template' };
  const chats = [
    { id: { _serialized: 'locked@lid' }, isLocked: true, timestamp: 1, lastMessage: internal },
    { id: { _serialized: 'archived@lid' }, archived: true, timestamp: 1, lastMessage: internal },
    { id: { _serialized: 'internal@lid' }, timestamp: 1, lastMessage: internal },
  ];
  const start = gateway.indexOf('async function getRecentChatSnapshot(');
  const end = gateway.indexOf('\nconst chatControlSyncPending', start);
  const result = await vm.runInNewContext(`${gateway.slice(start,end)}\ngetRecentChatSnapshot();`, {
    chatSnapshotCache: null, chatSnapshotCacheAt: 0, chatSnapshotPending: null, chatSnapshotGeneration: 0,
    CHAT_SNAPSHOT_CACHE_TTL_MS: 15000, MAX_CHAT_SNAPSHOT_ROWS: 1000,
    ensureReady: () => ({ getChats: async () => chats }),
    getWhatsApp2BlockedChatIds: async () => new Set(),
    resolveVisibleLastMessage: async () => null,
    isInternalWhatsApp2Message: message => message.type === 'notification_template',
    serializeMessage: () => null, limitChatSnapshot,
  });
  assert.deepEqual(Array.from(result, row => row.id).sort(), ['archived@lid', 'locked@lid']);
});

test('limite da caixa principal preserva todas as arquivadas e trancadas', () => {
  const rows = [
    { id: 'recent1' }, { id: 'recent2' },
    { id: 'archived', archived: true }, { id: 'locked', isLocked: true },
  ];
  assert.deepEqual(limitChatSnapshot(rows, 1).map(row => row.id), ['recent1', 'archived', 'locked']);
});

test('snapshot de controle sem mensagem visível preserva a prévia e a data no banco', async () => {
  const existing = { id: 'wa2:locked@lid', status: 'active', last_message: 'Prévia salva', last_message_preview: 'Prévia salva', last_message_at: '2020-01-01T00:00:00Z', last_direction: 'out', last_status: 'seen' };
  let saved;
  const source = gateway.slice(gateway.indexOf('async function syncChatSnapshots()'), gateway.indexOf('\nfunction formatWhatsApp2PreviewForGateway('));
  await vm.runInNewContext(`${source}\nsyncChatSnapshots();`, {
    state: { status: 'ready' }, console, limitChatSnapshot,
    getRecentChatSnapshot: async () => [{ id: 'locked@lid', isLocked: true, timestamp: Math.floor(Date.now()/1000), lastMessage: null }],
    resolveWhatsApp2PhoneNumbers: async () => [],
    whatsapp2ConversationId: id => 'wa2:' + id,
    getCachedProfilePic: () => null, setProfilePicCacheEntry: () => {},
    formatWhatsApp2PreviewForGateway: () => '',
    supabase: { from: () => ({
      select: () => ({ in: async () => ({ data: [existing], error: null }) }),
      upsert: async rows => { saved = rows[0]; return { error: null }; },
    }) },
  });
  assert.equal(saved.status, 'locked');
  assert.equal(saved.last_message, existing.last_message);
  assert.equal(saved.last_message_at, existing.last_message_at);
  assert.equal(saved.last_status, 'seen');
});

test('evento com data antiga mantém conversa arquivada', () => {
  const row = realtimeUpdate({ id: `wa2:${activeAccountId}:123@c.us`, status: 'active' }, { status: 'archived', lastMessageAt: '2020-01-01T00:00:00Z' });
  assert.equal(row.status, 'archived');
});

test('realtime ignora conversa de outro número conectado', () => {
  const otherAccountRow = {
    id: 'wa2:account-5511888877666:123@c.us',
    status: 'active',
    lastMessage: 'antigo',
  };
  const row = realtimeUpdate(otherAccountRow, { lastMessage: 'não deve entrar' });
  assert.equal(row.lastMessage, 'antigo');
});

test('nome salvo no celular não é sobrescrito por nome de perfil em realtime', () => {
  const row = realtimeUpdate({
    id: `wa2:${activeAccountId}:551188887777@c.us`,
    fullName: 'Nome salvo no celular',
    savedContactName: 'Nome salvo no celular',
    status: 'active',
  }, { fullName: 'Nome do perfil' });
  assert.equal(row.fullName, 'Nome salvo no celular');
});

test('ponte transmite controles de qualquer chat e não duplica listeners', async () => {
  const chats = new EventEmitter();
  // A collection do WhatsApp aceita vários eventos separados por espaço.
  const on = chats.on.bind(chats);
  chats.on = (events, listener) => { for (const event of events.split(' ')) on(event, listener); };
  const browser = vm.createContext({ window: { require: () => ({ Chat: chats }) } });
  const page = {
    evaluate: async (fn, arg) => vm.runInContext(`(${fn.toString()})(input)`, Object.assign(browser, { input: arg })),
    exposeFunction: async (name, fn) => { browser[name] = async (...args) => fn(...args); },
  };
  const active = { pupPage: page };
  const events = [];
  let invalidations = 0;
  const start = gateway.indexOf('async function ensureChatControlBridge(');
  const end = gateway.indexOf('\nasync function ', start + 1);
  const context = vm.createContext({ client: active, active,
    invalidateChatSnapshot: () => invalidations++,
    emitEvent: async (type, payload) => events.push({ type, payload }),
    syncChatControlState: async () => {},
  });
  vm.runInContext(gateway.slice(start, end), context);
  await vm.runInContext('ensureChatControlBridge(active)', context);
  await vm.runInContext('ensureChatControlBridge(active)', context);
  assert.equal(chats.listenerCount('change:isLocked'), 1);
  const chat = { id: { _serialized: '123@c.us' }, archive: true, isLocked: false };
  chats.emit('change:archive', chat);
  chat.archive = false;
  chat.isLocked = true;
  chats.emit('change:isLocked', chat);
  chat.isLocked = false;
  chats.emit('change:isLocked', chat);
  assert.equal(invalidations, 3);
  assert.deepEqual(events.map(({ type, payload }) => [type, payload.archived, payload.isLocked]), [
    ['chat_state_changed', true, false], ['chat_state_changed', false, true], ['chat_state_changed', false, false],
  ]);
});

test('controles persistem em ordem na identidade canônica e protegem restrições', async () => {
  const writes = [];
  const start = gateway.indexOf('const chatControlSyncPending =');
  const end = gateway.indexOf('\nasync function ensureChatControlBridge(', start);
  const context = vm.createContext({
    resolveCanonicalConversationId: async () => 'canonical:123',
    supabase: { from: (table) => ({ update: (value) => {
      const write = { table, ...value };
      return { eq: (key, id) => {
        write[key] = id;
        const query = {
          in: (field, values) => { write.allowed = Array.from(values); return query; },
          then: (resolve) => { writes.push(write); resolve({ error: null }); },
        };
        return query;
      } };
    } }) },
  });
  vm.runInContext(gateway.slice(start, end), context);
  await vm.runInContext(`Promise.all([
    syncChatControlState({chatId:'123@c.us',archived:true,isLocked:false}),
    syncChatControlState({chatId:'123@c.us',archived:false,isLocked:true}),
    syncChatControlState({chatId:'123@c.us',archived:false,isLocked:false})
  ])`, context);
  assert.deepEqual(writes.map((row) => row.status), ['archived', 'locked', 'active']);
  assert.ok(writes.every((row) => row.id === 'canonical:123'));
  assert.deepEqual(writes[2].allowed, ['archived', 'locked']);
});

test('controle com LID resolve telefone a partir da lista retornada pelo gateway', async () => {
  const require = createRequire(import.meta.url);
  const { resolveWhatsApp2CanonicalConversationId } = require('../services/whatsapp2-gateway/canonical-identity.cjs');
  const start = gateway.indexOf('async function resolveCanonicalConversationId(');
  const end = gateway.indexOf('\nfunction mimeExtension(', start);
  const chain = {
    select: () => chain, in: () => chain, eq: () => chain, like: () => chain,
    order: () => chain, limit: () => chain, maybeSingle: async () => ({ data: null, error: null }),
  };
  const resolved = await vm.runInNewContext(`${gateway.slice(start,end)}\nresolveCanonicalConversationId('contact@lid')`, {
    state: { me: { wid: '5511999998888@c.us' } },
    currentWhatsApp2AccountId: () => activeAccountId,
    whatsapp2ConversationId: (id) => `wa2:${activeAccountId}:${id}`,
    whatsapp2ConversationIdForAccount: accountScope.whatsapp2ConversationIdForAccount,
    whatsappProviderIdFromConversationId: accountScope.whatsappProviderIdFromConversationId,
    supabase: { from: () => chain },
    resolveWhatsApp2CanonicalIdentity: resolveWhatsApp2CanonicalConversationId,
    resolveWhatsApp2PhoneNumbers: async () => [{ chatId: 'contact@lid', phoneNumber: '+5511999999999' }],
  });
  assert.equal(resolved, `wa2:${activeAccountId}:5511999999999@c.us`);
});
