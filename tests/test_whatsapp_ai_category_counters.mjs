import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

const src = fs.readFileSync(new URL('../src/presentation/components/chat/InstagramDirect.tsx', import.meta.url), 'utf8');
function section(from, to) {
  const a = src.indexOf(from);
  const b = src.indexOf(to, a);
  assert.ok(a >= 0 && b > a, `trecho de código encontrado: ${from}`);
  return src.slice(a, b);
}

const filterFns = section('function isWhatsAppConversationArchived(', 'function formatWhatsApp2Preview(');
const counters = section('  const matchesSelectedWhatsAppCategory =', '  const effectiveStageFilter =');
const list = section('  const filteredConversations =', '  // Ordenação Temporal:');

const conversations = [
  { id: 'active-on', aiAutoRespond: true, lastSender: 'me', status: 'active' },
  { id: 'active-off', aiAutoRespond: false, lastSender: 'them', status: 'active' },
  { id: 'active-missing', lastSender: 'them', status: 'active', unread: true },
  { id: 'active-restricted', aiAutoRespond: true, restricted: true, status: 'active' },
  { id: 'active-pending', aiAutoRespond: true, status: 'pending' },
  { id: 'archived-on', aiAutoRespond: true, archived: true, status: 'archived' },
  { id: 'archived-off', aiAutoRespond: false, archived: true, status: 'archived' },
  { id: 'locked-on', aiAutoRespond: true, isLocked: true, status: 'locked' },
  { id: 'locked-off', aiAutoRespond: false, isLocked: true, status: 'locked' },
  { id: 'blocked-on', aiAutoRespond: true, isBlocked: true, status: 'active' },
  { id: 'blocked-off', aiAutoRespond: false, isBlocked: true, archived: true, status: 'archived' },
];

function evaluate(category, quick = 'todas', overrides = {}) {
  const context = {
    platformConversations: conversations.map(c => ({ ...c, fullName: c.id, username: c.id })),
    effectiveWhatsAppResponseFilter: category,
    activeChannel: 'whatsapp2',
    isWhatsAppInboxChannel: true,
    isChatRestricted: (chat) => chat.restricted === true,
    isConversationUnread: (chat) => chat.unread === true,
    effectiveStageFilter: 'todas',
    stages: [],
    aiFilter: 'todas',
    whatsappQuickFilter: quick,
    deferredSearchQuery: '',
    ...overrides,
  };
  const compiled = ts.transpile(filterFns + '\n' + counters + '\n' + list, { target: ts.ScriptTarget.ES2022 });
  const result = vm.runInNewContext(compiled +
    '\n({ aiEnabledCount, aiDisabledCount, filteredConversations, whatsappCategoryConversations });',
    context);
  return {
    comIA: result.aiEnabledCount,
    semIA: result.aiDisabledCount,
    visible: Array.from(result.filteredConversations, c => c.id),
    allInCategory: Array.from(result.whatsappCategoryConversations, c => c.id),
  };
}

const expectations = [
  ['todos', 1, 2, ['active-on', 'active-off', 'active-missing']],
  ['respondidos', 1, 0, ['active-on']],
  ['nao_respondidos', 0, 2, ['active-off', 'active-missing']],
  ['arquivados', 1, 1, ['archived-on', 'archived-off']],
  ['trancadas', 1, 1, ['locked-on', 'locked-off']],
  ['bloqueados', 1, 1, ['blocked-on', 'blocked-off']],
];

for (const [category, comIA, semIA, ids] of expectations) {
  test(`contadores Com/Sem IA acompanham categoria ${category}`, () => {
    const state = evaluate(category);
    assert.equal(state.comIA, comIA);
    assert.equal(state.semIA, semIA);
    assert.deepEqual(state.visible, ids);
    assert.equal(state.comIA + state.semIA, ids.length);
  });
  test(`filtros rápidos Com/Sem IA realmente filtram ${category}`, () => {
    const on = evaluate(category, 'com_ia');
    const off = evaluate(category, 'sem_ia');
    assert.equal(on.visible.length, comIA);
    assert.equal(off.visible.length, semIA);
    assert.ok(on.visible.every(id => conversations.find(c => c.id === id).aiAutoRespond === true));
    assert.ok(off.visible.every(id => conversations.find(c => c.id === id).aiAutoRespond !== true));
    assert.equal(on.comIA, comIA, 'selecionar Com IA não zera contador Sem IA');
    assert.equal(on.semIA, semIA);
    assert.equal(off.comIA, comIA);
    assert.equal(off.semIA, semIA);
  });
}

test('filtro de etapas e busca permanecem independentes dos totais por categoria', () => {
  const state = evaluate('arquivados', 'todas', {deferredSearchQuery: 'archived-on'});
  assert.deepEqual(state.visible, ['archived-on']);
  assert.equal(state.comIA, 1);
  assert.equal(state.semIA, 1);
});
