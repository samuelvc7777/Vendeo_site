import test from 'node:test';
import assert from 'node:assert/strict';
import { handleReciprocityEvents } from '../supabase/functions/api/reciprocity_events.ts';

test('eventos de análise recusam conversa fora do escopo antes de assinar alterações', async () => {
  let subscribed = false;
  const response = await handleReciprocityEvents({
    request: new Request('https://example.test/operator/reciprocity/events?conversationId=other'),
    authorize: async () => false,
    subscribe: async () => { subscribed = true; return () => {}; },
    corsHeaders: {},
  });
  assert.equal(response.status, 403);
  assert.equal(subscribed, false);
});

test('eventos autorizados notificam mudança sem expor resultado e liberam assinatura ao sair', async () => {
  const controller = new AbortController();
  let notify;
  let unsubscribed = false;
  const response = await handleReciprocityEvents({
    request: new Request('https://example.test/operator/reciprocity/events?conversationId=chat', { signal: controller.signal }),
    authorize: async (_request, id) => id === 'chat',
    subscribe: async (_id, onChange) => { notify = onChange; return () => { unsubscribed = true; }; },
    corsHeaders: {},
  });
  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type'), /text\/event-stream/);
  const reader = response.body.getReader();
  assert.equal(new TextDecoder().decode((await reader.read()).value), 'event: ready\ndata: {}\n\n');
  notify();
  assert.equal(new TextDecoder().decode((await reader.read()).value), 'event: change\ndata: {}\n\n');
  controller.abort();
  assert.equal((await reader.read()).done, true);
  assert.equal(unsubscribed, true);
});
