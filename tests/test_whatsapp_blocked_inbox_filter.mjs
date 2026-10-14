import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

const ui=fs.readFileSync(new URL('../src/presentation/components/chat/InstagramDirect.tsx',import.meta.url),'utf8');
const start=ui.indexOf('function isWhatsAppConversationBlocked(');
const end=ui.indexOf('function formatWhatsApp2Preview(',start);
assert.ok(start>=0&&end>start,'funções de visibilidade identificadas');
const functions=ts.transpile(ui.slice(start,end),{target:ts.ScriptTarget.ES2022});
const {matchesWhatsAppBlockFilter,isWhatsAppConversationBlocked}=vm.runInNewContext(functions+';({matchesWhatsAppBlockFilter,isWhatsAppConversationBlocked})');
const blocked=[
  {phone:'5513992075172',isBlocked:true,archived:false},
  {phone:'5511951082128',isBlocked:true,archived:false},
  {phone:'553299510929',isBlocked:true,archived:false},
];
const other=[
  {phone:'553299217794',isBlocked:false},
  {phone:'447723442971',isBlocked:false},
];
test('os três exemplos bloqueados deixam a caixa Todos/Respondidos/Não respondidos',()=>{
  for(const item of blocked) {
    assert.ok(isWhatsAppConversationBlocked(item));
    for(const filter of ['todos','respondidos','nao_respondidos','arquivados','trancadas']) {
      assert.equal(matchesWhatsAppBlockFilter(item,filter),false,filter+': '+item.phone);
    }
    assert.equal(matchesWhatsAppBlockFilter(item,'bloqueados'),true);
  }
});
test('contatos não bloqueados continuam visíveis na caixa principal',()=>{
  for(const item of other) {
    assert.equal(matchesWhatsAppBlockFilter(item,'todos'),true);
    assert.equal(matchesWhatsAppBlockFilter(item,'bloqueados'),false);
  }
});
test('a interface expõe Bloqueados sem apagar histórico e sem mudar conta/IA',()=>{
 assert.match(ui,/\{ id: "bloqueados" as WhatsAppResponseFilter, label: "Bloqueados"/);
 assert.match(ui,/if \(!matchesWhatsAppBlockFilter\(c, effectiveWhatsAppResponseFilter\)\) return false;/);
 assert.match(ui,/if \(effectiveWhatsAppResponseFilter === "bloqueados"\) return true;/);
 assert.match(ui,/!isWhatsAppConversationBlocked\(c\) &&\n\s*!isWhatsAppConversationArchived\(c\)/);
 assert.match(ui,/selectedChatForActionSheet\.isBlocked\s*\? "Desbloquear contato"/);
});
