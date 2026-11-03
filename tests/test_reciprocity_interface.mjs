import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import ts from 'typescript';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
const require = createRequire(import.meta.url);
function loadComponent() {
  const filename = new URL('../src/presentation/components/chat/ReciprocityAnalysisView.tsx', import.meta.url);
  const source = fs.readFileSync(filename, 'utf8');
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true, target: ts.ScriptTarget.ES2022 } }).outputText;
  const module = { exports: {} };
  new Function('require', 'module', 'exports', code)(require, module, module.exports);
  return module.exports;
}
test('botão do cabeçalho aparece somente depois de existir resultado concluído', () => {
  const { ReciprocityHeaderButton } = loadComponent();
  assert.equal(renderToStaticMarkup(React.createElement(ReciprocityHeaderButton, { available: false, onOpen() {} })), '');
  assert.match(renderToStaticMarkup(React.createElement(ReciprocityHeaderButton, { available: true, onOpen() {} })), /Abrir análise de reciprocidade/);
});
test('primeira análise em processamento oferece atualização sem permitir chamada concorrente', () => {
  const { ReciprocityStageStatus } = loadComponent();
  const html = renderToStaticMarkup(React.createElement(ReciprocityStageStatus, { hasAccess: true, snapshot: {state:'processing',latestCompleted:null,attempts:[],eligible:true}, busy:false, onRequest(){},onRefresh(){} }));
  assert.match(html, /Análise em andamento/);
  assert.match(html, /Atualizar/);
  assert.doesNotMatch(html, /Analisar conversa/);
});
test('resultado anterior continua acessível quando uma nova tentativa falha', () => {
  const { ReciprocityStageStatus } = loadComponent();
  const html = renderToStaticMarkup(React.createElement(ReciprocityStageStatus, { hasAccess:true,snapshot:{state:'failed',latestCompleted:{id:'done'},attempts:[{error:'Modelo indisponível'}],eligible:true},busy:false,onRequest(){},onRefresh(){} }));
  assert.match(html, /resultado anterior continua disponível/);
  assert.match(html, /Tentar novamente/);
});

test('análise exibe categorias separadas, cobertura e evidências que podem ser abertas no contexto', () => {
  const filename = new URL('../src/presentation/components/chat/ReciprocityResultDialog.tsx', import.meta.url);
  const source = fs.readFileSync(filename,'utf8');
  const code = ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,esModuleInterop:true,target:ts.ScriptTarget.ES2022}}).outputText;
  const module = {exports:{}};
  new Function('require','module','exports',code)(name => name.includes('reciprocity-client') ? {reciprocityJson:async() => ({messages:[]})} : require(name),module,module.exports);
  const attempt = {id:'analysis-1',configuration:{model:'gpt-6-luna',reasoning:'low'},coverage:{from:'2026-09-01T12:00:00Z',to:'2026-11-03T12:00:00Z',messageCount:12,lastMessageId:'message-12',missingMediaCount:1},result:{participation:'alta',curiosity:'evidencia_insuficiente',summary:'Participa com continuidade.',reasons:['Desenvolve os assuntos.'],evolution:'indeterminada',limitations:['Houve pouca oportunidade para falar da Larissa.'],evidence:[{messageId:'message-10',quote:'<script>não executar</script>',reason:'Trecho verificável.'}]}};
  const html = renderToStaticMarkup(React.createElement(module.exports.ReciprocityResultDialog,{attempt,conversationId:'chat-a',onClose(){},onNavigate(){}}));
  assert.match(html,/Participação/);
  assert.match(html,/Curiosidade pela Larissa/);
  assert.match(html,/Evidência insuficiente/);
  assert.match(html,/Abrir mensagem no contexto/);
  assert.match(html,/12 mensagens/);
  assert.match(html,/message-12/);
  assert.match(html,/pouca oportunidade/);
  assert.doesNotMatch(html,/<script>/);
});

test('tela permite escolher avaliações anteriores e reavaliar mesmo sem mensagens novas',()=>{
  const filename = new URL('../src/presentation/components/chat/ReciprocityResultDialog.tsx', import.meta.url);
  const source=fs.readFileSync(filename,'utf8');
  const code=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,esModuleInterop:true,target:ts.ScriptTarget.ES2022}}).outputText;
  const module={exports:{}};
  new Function('require','module','exports',code)(name=>name.includes('reciprocity-client')?{reciprocityJson:async()=>({messages:[]})}:require(name),module,module.exports);
  const result={participation:'alta',curiosity:'moderada',summary:'Resultado mais recente.',reasons:[],evolution:'estavel',limitations:[],evidence:[]};
  const first={id:'old',createdAt:'2026-11-01T10:00:00Z',state:'completed',configuration:{model:'gpt-6-luna',reasoning:'low'},coverage:{from:'2026-11-01T09:00:00Z',to:'2026-11-01T10:00:00Z',messageCount:2,lastMessageId:'m2'},result:{...result,summary:'Resultado anterior.'}};
  const latest={...first,id:'latest',createdAt:'2026-11-03T10:00:00Z',result};
  const html=renderToStaticMarkup(React.createElement(module.exports.ReciprocityResultDialog,{attempt:latest,attempts:[latest,first],conversationId:'chat-a',state:'completed',onClose(){},onNavigate(){},onReevaluate(){}}));
  assert.match(html,/Histórico de avaliações/);
  assert.match(html,/value="old"/);
  assert.match(html,/Reavaliar conversa/);
  assert.match(html,/Resultado mais recente/);
});
