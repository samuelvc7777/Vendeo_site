import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';

const wrapper = new URL('../scripts/build-static-export.mjs', import.meta.url);
const fixtureFiles = {
  'route.ts': 'export const fixture = true;\n',
  'nested/payload.bin': Buffer.from([0, 255, 128, 13, 10, 42]),
};

function writeFiles(directory, files = fixtureFiles) {
  for (const [relative, bytes] of Object.entries(files)) {
    const filename = path.join(directory, relative);
    fs.mkdirSync(path.dirname(filename), {recursive: true});
    fs.writeFileSync(filename, bytes);
  }
}

function assertFiles(directory, files = fixtureFiles) {
  for (const [relative, bytes] of Object.entries(files)) {
    assert.deepEqual(fs.readFileSync(path.join(directory, relative)), Buffer.from(bytes), `Arquivo preservado: ${relative}`);
  }
}

function fixture(t, {devTypes = false, api = true} = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'vendeo-static-export-'));
  t.after(() => {
    const absolute = path.resolve(root);
    assert.equal(path.dirname(absolute), path.resolve(os.tmpdir()));
    assert.ok(path.basename(absolute).startsWith('vendeo-static-export-'));
    assert.equal(fs.lstatSync(absolute).isSymbolicLink(), false);
    fs.rmSync(absolute, {recursive: true, force: true});
  });
  const paths = {
    root,
    api: path.join(root, 'src/app/api'),
    apiBackup: path.join(root, 'node_modules/.vendeo-static-api-routes-backup'),
    dev: path.join(root, '.next/dev/types'),
    devBackup: path.join(root, '.next/dev/types-build-backup'),
    marker: path.join(root, 'builder-ran'),
    events: path.join(root, 'events.jsonl'),
  };
  fs.mkdirSync(path.join(root, 'scripts'), {recursive: true});
  fs.mkdirSync(path.join(root, 'node_modules'), {recursive: true});
  fs.copyFileSync(wrapper, path.join(root, 'scripts/build-static-export.mjs'));
  if (api) writeFiles(paths.api);
  if (devTypes) writeFiles(paths.dev);
  fs.writeFileSync(path.join(root, 'fake-build.cjs'), `
    const fs=require('node:fs'),path=require('node:path');
    const options=JSON.parse(process.env.WRAPPER_TEST_OPTIONS);
    fs.writeFileSync('builder-ran','fixture');
    if(fs.existsSync('src/app/api')||fs.existsSync('.next/dev/types')) process.exit(97);
    for(const name of options.recreate||[]){
      const target=name==='api'?'src/app/api':'.next/dev/types';
      fs.mkdirSync(target,{recursive:true});fs.writeFileSync(path.join(target,'created-during-build.txt'),'preserve this too');
    }
    process.exit(options.buildExit||0);
  `);
  fs.writeFileSync(path.join(root, 'faults.cjs'), `
    const fs=require('node:fs'),path=require('node:path'),cp=require('node:child_process');
    const {syncBuiltinESMExports}=require('node:module');
    const root=path.resolve(process.env.WRAPPER_TEST_ROOT);
    if(root!==path.resolve(process.cwd())||!path.basename(root).startsWith('vendeo-static-export-')) throw Error('Fixture fora do escopo');
    const options=JSON.parse(process.env.WRAPPER_TEST_OPTIONS),rename=fs.renameSync,spawn=cp.spawnSync,lstat=fs.lstatSync;
    const targets={api:path.join(root,'src/app/api'),apiBackup:path.join(root,'node_modules/.vendeo-static-api-routes-backup'),dev:path.join(root,'.next/dev/types'),devBackup:path.join(root,'.next/dev/types-build-backup')};
    const event=value=>fs.appendFileSync(path.join(root,'events.jsonl'),JSON.stringify(value)+'\\n');
    Object.defineProperty(process,'platform',{value:'win32'});
    fs.lstatSync=function(filename,...rest){
      if(options.metadataError&&filename===targets.apiBackup)throw Object.assign(Error('Fixture metadata error'),{code:options.metadataError});
      return lstat.call(this,filename,...rest);
    };
    fs.renameSync=function(from,to){
      const at=from===targets.api?'preserve-api':from===targets.apiBackup?'restore-api':from===targets.dev?'preserve-dev':from===targets.devBackup?'restore-dev':'other';
      event({operation:'rename',at});const fault=(options.faults||[]).find(item=>item.at===at);
      if(fault)throw Object.assign(Error('Falha isolada '+fault.code),{code:fault.code});
      return rename.call(this,from,to);
    };
    cp.spawnSync=function(command,args,settings){
      if(String(command).toLowerCase()==='robocopy'){
        event({operation:'robocopy',status:8});
        fs.mkdirSync(args[1],{recursive:true});fs.writeFileSync(path.join(args[1],'partial-copy.txt'),'partial');
        return {status:8,stdout:Buffer.alloc(0),stderr:Buffer.alloc(0)};
      }
      if(options.spawnError&&command===process.execPath)return {status:null,error:Object.assign(Error('Fixture spawn error'),{code:options.spawnError})};
      if(options.spawnSignal&&command===process.execPath)return {status:null,signal:options.spawnSignal};
      return spawn.call(this,command,args,settings);
    };
    syncBuiltinESMExports();
  `);
  function run(options = {}) {
    const result = spawnSync(process.execPath, ['--require', path.join(root, 'faults.cjs'), path.join(root, 'scripts/build-static-export.mjs')], {
      cwd: root,
      env: {...process.env, npm_execpath: path.join(root, 'fake-build.cjs'), WRAPPER_TEST_ROOT: root, WRAPPER_TEST_OPTIONS: JSON.stringify(options)},
      encoding: 'utf8', timeout: 15000,
    });
    assert.equal(result.error, undefined);
    const events = fs.existsSync(paths.events) ? fs.readFileSync(paths.events, 'utf8').trim().split('\n').filter(Boolean).map(line => JSON.parse(line)) : [];
    assert.equal(events.some(event => event.operation === 'robocopy'), false, 'O wrapper não deve iniciar cópia externa');
    return {...result, events};
  }
  return {...paths, run};
}

test('EPERM com robocopy 8 e destino parcial não perde arquivos nem inicia build', t => {
  const f = fixture(t);
  const result = f.run({faults: [{at: 'preserve-api', code: 'EPERM'}]});
  assertFiles(f.api);
  assert.notEqual(result.status, 0);
  assert.equal(fs.existsSync(f.marker), false);
  assert.equal(result.events.some(event => event.operation === 'robocopy'), false);
});

test('caminho normal restaura rotas, binários e tipos depois do build', t => {
  const f = fixture(t, {devTypes: true});
  const result = f.run();
  assert.equal(result.status, 0, result.stderr);
  assert.equal(fs.existsSync(f.marker), true);
  assertFiles(f.api);
  assertFiles(f.dev);
  assert.equal(fs.existsSync(f.apiBackup), false);
  assert.equal(fs.existsSync(f.devBackup), false);
});

for (const [code, label] of [['EBUSY', 'arquivo bloqueado'], ['EACCES', 'permissão negada'], ['ENOSPC', 'falta de espaço']]) {
  test(`${label} ao preservar rotas interrompe o build sem perder arquivos`, t => {
    const f = fixture(t, {devTypes: true});
    const result = f.run({faults: [{at: 'preserve-api', code}]});
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, new RegExp(code));
    assertFiles(f.api);
    assertFiles(f.dev);
    assert.equal(fs.existsSync(f.marker), false);
    assert.equal(fs.existsSync(f.apiBackup), false);
  });
}

for (const target of ['apiBackup', 'devBackup']) {
  test(`backup antigo em ${target} é preservado e impede o build`, t => {
    const f = fixture(t, {devTypes: true});
    const oldFiles = {'old-backup.bin': Buffer.from([19, 0, 255, 12])};
    writeFiles(f[target], oldFiles);
    const result = f.run();
    assert.notEqual(result.status, 0);
    assertFiles(f[target], oldFiles);
    assertFiles(f.api);
    assertFiles(f.dev);
    assert.equal(fs.existsSync(f.marker), false);
  });
}

test('falha ao preservar tipos restaura rotas já movidas e não inicia build', t => {
  const f = fixture(t, {devTypes: true});
  const result = f.run({faults: [{at: 'preserve-dev', code: 'EPERM'}]});
  assert.notEqual(result.status, 0);
  assertFiles(f.api);
  assertFiles(f.dev);
  assert.equal(fs.existsSync(f.apiBackup), false);
  assert.equal(fs.existsSync(f.marker), false);
});

for (const code of ['EPERM', 'EBUSY', 'EACCES', 'ENOSPC']) {
  test(`falha ${code} na restauração das rotas preserva backup completo e retorna erro`, t => {
    const f = fixture(t, {devTypes: true});
    const result = f.run({faults: [{at: 'restore-api', code}]});
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Restaurar src\/app\/api/);
    assert.match(result.stderr, new RegExp(code));
    assertFiles(f.apiBackup);
    assertFiles(f.dev);
    assert.equal(fs.existsSync(f.api), false);
    assert.equal(fs.existsSync(f.marker), true);
  });
}

test('falha ao restaurar tipos não impede a restauração completa das rotas', t => {
  const f = fixture(t, {devTypes: true});
  const result = f.run({faults: [{at: 'restore-dev', code: 'EPERM'}]});
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Restaurar .next\/dev\/types/);
  assertFiles(f.devBackup);
  assertFiles(f.api);
  assert.equal(fs.existsSync(f.apiBackup), false);
});

test('falhas nas duas restaurações são sinalizadas e preservam os dois backups', t => {
  const f = fixture(t, {devTypes: true});
  const result = f.run({faults: [{at: 'restore-dev', code: 'EBUSY'}, {at: 'restore-api', code: 'EACCES'}]});
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Restaurar .next\/dev\/types/);
  assert.match(result.stderr, /Restaurar src\/app\/api/);
  assertFiles(f.devBackup);
  assertFiles(f.apiBackup);
});

for (const target of ['api', 'dev']) {
  test(`destino parcial recriado em ${target} não é sobrescrito na restauração`, t => {
    const f = fixture(t, {devTypes: true});
    const result = f.run({recreate: [target]});
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /destino já existe/);
    assertFiles(f[target === 'api' ? 'apiBackup' : 'devBackup']);
    assertFiles(f[target], {'created-during-build.txt': 'preserve this too'});
    assertFiles(f[target === 'api' ? 'dev' : 'api']);
  });
}

test('build malsucedido mantém código de saída e restaura todos os arquivos', t => {
  const f = fixture(t, {devTypes: true});
  const result = f.run({buildExit: 7});
  assert.equal(result.status, 7);
  assertFiles(f.api);
  assertFiles(f.dev);
});

test('erro ao iniciar o subprocesso retorna falha e restaura todos os arquivos', t => {
  const f = fixture(t, {devTypes: true});
  const result = f.run({spawnError: 'EACCES'});
  assert.notEqual(result.status, 0);
  assert.equal(fs.existsSync(f.marker), false);
  assertFiles(f.api);
  assertFiles(f.dev);
});

test('subprocesso interrompido por sinal retorna falha e restaura todos os arquivos', t => {
  const f = fixture(t, {devTypes: true});
  const result = f.run({spawnSignal: 'SIGTERM'});
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /SIGTERM/);
  assertFiles(f.api);
  assertFiles(f.dev);
});

test('origem ausente interrompe o processo antes de mover outras pastas', t => {
  const f = fixture(t, {devTypes: true, api: false});
  const result = f.run();
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /origem ausente/);
  assertFiles(f.dev);
  assert.equal(fs.existsSync(f.marker), false);
});

test('erro de permissão ao verificar backup não é confundido com destino livre', t => {
  const f = fixture(t, {devTypes: true});
  const result = f.run({metadataError: 'EACCES'});
  assert.notEqual(result.status, 0);
  assertFiles(f.api);
  assertFiles(f.dev);
  assert.equal(fs.existsSync(f.marker), false);
});
