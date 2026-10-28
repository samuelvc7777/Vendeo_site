import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
const {chromium, webkit} = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const baseUrl = process.env.VAULT_UI_URL || 'http://127.0.0.1:3017';
assert.ok(['127.0.0.1', 'localhost'].includes(new URL(baseUrl).hostname), 'Use somente o servidor local de teste.');
const artifactDir = process.env.VAULT_UI_ARTIFACTS || `${process.env.TEMP || '/tmp'}/vendeo-cofres-ui`;
await fs.mkdir(artifactDir, {recursive: true});
const timestamp = '2026-10-28T12:00:00.000Z';
const initialTables = {
  chat_stages: [{id: 'stage-test', name: 'Etapa de teste', schedule_id: 'schedule-test', stage_order: 0, is_required: true,
    goals: [{id: 'goal-test', title: 'Objetivo de teste', enabled: true}], created_at: timestamp, updated_at: timestamp}],
  conversation_schedules: [{id: 'schedule-test', name: 'Cronograma de teste', category: 'custom', schedule_order: 0, is_active: true, response_delay_mode: 'fixed', response_delay_fixed_seconds: 180}],
  persona_images: [{id: 'image-test', title: 'Foto cadastrada', image_url: 'https://vault-ui.invalid/photo.svg', whatsapp_image_url: 'https://vault-ui.invalid/photo-wa.svg', objective_id: 'goal-test',
    description: 'Descrição preservada', usage_instruction: 'Instrução preservada', caption: 'Legenda preservada', enabled: true, is_view_once: true,
    allowed_time_start: '08:00', allowed_time_end: '22:00', created_at: timestamp, updated_at: timestamp}],
  persona_audios: [{id: 'audio-test', title: 'Áudio cadastrado', audio_url: 'https://vault-ui.invalid/voice.mp3', whatsapp_audio_url: 'https://vault-ui.invalid/voice.ogg', objective_id: 'goal-test',
    transcript: 'Transcrição preservada', usage_instruction: 'Instrução do áudio', enabled: true, duration: 12, created_at: timestamp, updated_at: timestamp}],
};
async function mockNetwork(context) {
  const tables = structuredClone(initialTables);
  const writes = [];
  await context.routeWebSocket('**/realtime/**', socket => socket.close());
  await context.route('**/*', async route => {
    const request = route.request(), url = new URL(request.url());
    const json = (body, status = 200) => route.fulfill({status, contentType: 'application/json', body: JSON.stringify(body)});
    if (url.pathname.includes('/rest/v1/')) {
      const table = url.pathname.split('/rest/v1/')[1].split('/')[0];
      if (request.method() === 'OPTIONS') return json({});
      if (request.method() === 'GET' || request.method() === 'HEAD') {
        const id = url.searchParams.get('id')?.replace(/^eq\./, '');
        const rows = (tables[table] || []).filter(row => !id || row.id === id);
        const single = request.headers().accept?.includes('vnd.pgrst.object');
        return json(single ? rows[0] || null : rows);
      }
      if (['persona_images', 'persona_audios'].includes(table)) {
        const data = request.postDataJSON(), id = url.searchParams.get('id')?.replace(/^eq\./, '');
        writes.push({table, method: request.method(), data});
        if (request.method() === 'POST') {tables[table].push(data); return json(data);}
        if (request.method() === 'PATCH') {
          const row = tables[table].find(row => row.id === id); Object.assign(row, data); return json(row);
        }
        if (request.method() === 'DELETE') {tables[table] = tables[table].filter(row => row.id !== id); return json(null);}
      }
      return json({});
    }
    if (url.pathname.endsWith('/instagram/upload')) return json({url: 'https://vault-ui.invalid/uploaded.png'});
    if (url.pathname.endsWith('/photo.svg') || url.pathname.endsWith('/photo-wa.svg')) return route.fulfill({contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="500" height="500"><rect width="500" height="500" fill="#f472b6"/><text x="80" y="260" font-size="30" fill="white">Foto de teste</text></svg>'});
    if (request.headers().accept?.includes('text/event-stream')) return route.fulfill({contentType: 'text/event-stream', body: ': fixture\n\n'});
    if (url.pathname.endsWith('/wa2-config.json')) return json({gatewayUrl: `${baseUrl}/mock-gateway`});
    if (url.pathname === '/mock-gateway/status') return json({ok: true, status: 'ready', me: {wid: '5511000000000@c.us', pushname: 'Conta de teste'}});
    if (url.pathname === '/mock-gateway/chats') return json({ok: true, chats: [{id: '5511222222222@c.us', name: 'Contato de teste', isGroup: false, unreadCount: 0, timestamp: 1793188800,
      lastMessage: {id: 'fixture-message', body: 'Mensagem de teste', timestamp: 1793188800, fromMe: false, type: 'chat', from: '5511222222222@c.us'}}]});
    const isLocal = url.origin === new URL(baseUrl).origin;
    if (!isLocal || url.pathname.startsWith('/api/') || url.pathname.startsWith('/mock-gateway')) {
      if (url.pathname.includes('conversations')) return json({conversations: [], messages: []});
      return json({ok: true, connected: false, status: 'disconnected', chats: [], configured: false, accounts: []});
    }
    return route.continue();
  });
  return {tables, writes};
}
// Rota temporária de fixture: executa o compositor real com callbacks em memória.
// É criada somente pelo teste e removida antes de qualquer build/publicação.
const fixtureRoot = new URL('../src/app/vault-composer-fixture/', import.meta.url);
const engine = process.env.VAULT_UI_BROWSER === "webkit" ? webkit : chromium;
const browser = await engine.launch({headless: true});
const results = [];
try {
  let fixtureCreated = false;
  try {
    await fs.mkdir(fixtureRoot);
    fixtureCreated = true;
await fs.writeFile(new URL('page.tsx', fixtureRoot), `"use client";
import {useState} from "react";
import {InstagramChatComposer} from "@/presentation/components/chat/InstagramChatComposer";
export default function Fixture() {
  const [events, setEvents] = useState<Record<string, number>>({});
  const record = (name: string) => setEvents(current => ({...current, [name]: (current[name] || 0) + 1}));
  return <main style={{padding: 24}}>
    {(["instagram", "whatsapp"] as const).map(variant => <section key={variant} data-variant={variant} style={{minHeight: 280, display: "flex", flexDirection: "column", justifyContent: "end"}}>
      <h1>{variant}</h1><InstagramChatComposer variant={variant} isUploadingMedia={false} hasPendingImage={false}
        onSendMessage={() => record(variant + "-message")}
        onSelectImage={() => record(variant + "-image")}
        onSelectMediaFile={() => record(variant + "-document")}
        onStartRecording={() => record(variant + "-recording")}
        onOpenStickers={() => record(variant + "-stickers")}
        onOpenConsole={() => record(variant + "-console")} />
    </section>)}
    <output data-testid="composer-events">{JSON.stringify(events)}</output>
  </main>;
}`);
  for (const [device, viewport] of [['desktop', {width: 1365, height: 1000}], ['mobile', {width: 390, height: 844}]]) {
    for (const theme of ['light', 'dark']) {
      const context = await browser.newContext({viewport, serviceWorkers: 'block', isMobile: device === 'mobile', hasTouch: device === 'mobile'});
      await context.addInitScript(theme => localStorage.setItem('vendeo-theme', theme), theme);
      const mock = await mockNetwork(context);
      const page = await context.newPage(); page.setDefaultTimeout(10000);
      const errors = []; page.on('pageerror', error => errors.push(error.message));
      try {
        await page.goto(baseUrl, {waitUntil: 'domcontentloaded'});
        await page.waitForFunction(() => [...document.querySelectorAll('button')].some(button => button.textContent.trim() === 'Config' && Object.keys(button).some(key => key.startsWith('__reactProps'))));
        await page.getByRole('button', {name: 'Config', exact: true}).click();
        const audioAccess = page.getByRole('button', {name: /^Cofre de Áudios/});
        const photoAccess = page.getByRole('button', {name: /^Cofre de Fotos/});
        await audioAccess.waitFor(); await photoAccess.waitFor();
        await audioAccess.scrollIntoViewIfNeeded();
        await page.screenshot({path: `${artifactDir}/${device}-${theme}-config.png`});
        const originalOverflow = await page.evaluate(() => document.body.style.overflow);
        await audioAccess.click();
        const vault = page.getByRole('dialog', {name: 'Cofres da IA', exact: true});
        await vault.getByRole('heading', {name: 'Áudio cadastrado', exact: true}).waitFor();
        assert.equal(await vault.getByRole('button', {name: /^Áudios/}).getAttribute('aria-pressed'), 'true');
        assert.equal(await page.getByTitle('Enviar para chat').count(), 0);
        assert.equal(await page.evaluate(() => document.body.style.overflow), 'hidden');
        assert.deepEqual(mock.writes, [], 'Abrir e alternar bibliotecas não grava dados.');
        await vault.getByRole('button', {name: /^Fotos/}).click();
        await vault.getByRole('heading', {name: 'Foto cadastrada', exact: true}).waitFor();
        await page.screenshot({path: `${artifactDir}/${device}-${theme}-fotos.png`});
        const background = await vault.evaluate(element => getComputedStyle(element).backgroundColor);
        assert.equal(background, theme === 'light' ? 'rgb(255, 255, 255)' : 'rgb(18, 18, 20)');
        await vault.getByRole('button', {name: 'Editar foto Foto cadastrada', exact: true}).click();
        let form = page.getByRole('dialog', {name: 'Editar Foto', exact: true});
        await form.waitFor();
        assert.equal(await form.getByLabel('Título *', {exact: true}).inputValue(), 'Foto cadastrada');
        assert.equal(await form.getByLabel('Objetivo (Opcional)', {exact: true}).inputValue(), 'goal-test');
        assert.equal(await form.getByLabel('Legenda da foto (opcional)', {exact: false}).inputValue(), 'Legenda preservada');
        assert.equal(await form.getByLabel('Início', {exact: true}).inputValue(), '08:00');
        assert.equal(await form.getByLabel('Fim', {exact: true}).inputValue(), '22:00');
        assert.equal(await form.locator('input[type=checkbox]').isChecked(), true);
        await page.screenshot({path: `${artifactDir}/${device}-${theme}-formulario.png`});
        const bounds = await form.locator('button[type=submit]').boundingBox();
        assert.ok(bounds.y >= 0 && bounds.y + bounds.height <= viewport.height, 'Salvar permanece dentro do viewport.');
        await form.getByLabel('Legenda da foto (opcional)', {exact: false}).fill('Legenda alterada no teste');
        await form.getByRole('button', {name: 'Salvar', exact: true}).click();
        await vault.getByText('Legenda alterada no teste', {exact: true}).waitFor();
        assert.equal(mock.tables.persona_images[0].whatsapp_image_url, initialTables.persona_images[0].whatsapp_image_url);
        assert.equal(mock.tables.persona_images[0].image_url, initialTables.persona_images[0].image_url);
        await vault.getByRole('button', {name: /^Áudios/}).click();
        await vault.getByRole('button', {name: 'Editar áudio Áudio cadastrado', exact: true}).click();
        form = page.getByRole('dialog', {name: 'Editar Áudio', exact: true});
        assert.equal(await form.getByLabel('Transcrição', {exact: true}).inputValue(), 'Transcrição preservada');
        await form.getByLabel('Título *', {exact: true}).fill('Áudio editado');
        await form.getByRole('button', {name: 'Salvar', exact: true}).click();
        await vault.getByRole('heading', {name: 'Áudio editado', exact: true}).waitFor();
        assert.equal(mock.tables.persona_audios[0].audio_url, initialTables.persona_audios[0].audio_url);
        assert.equal(mock.tables.persona_audios[0].whatsapp_audio_url, initialTables.persona_audios[0].whatsapp_audio_url);
        await vault.getByRole('button', {name: 'Novo Áudio', exact: true}).click();
        await page.getByRole('dialog', {name: 'Novo Áudio', exact: true}).waitFor();
        await page.keyboard.press('Escape');
        await page.getByRole('dialog', {name: 'Novo Áudio', exact: true}).waitFor({state: 'hidden'});
        await vault.waitFor();
        await page.keyboard.press('Escape'); await vault.waitFor({state: 'hidden'});
        assert.equal(await page.evaluate(() => document.body.style.overflow), originalOverflow);
        await photoAccess.click();
        await vault.getByRole('heading', {name: 'Foto cadastrada', exact: true}).waitFor();
        assert.equal(await vault.getByRole('button', {name: /^Fotos/}).getAttribute('aria-pressed'), 'true');
        await vault.getByRole('button', {name: 'Nova Foto', exact: true}).click();
        form = page.getByRole('dialog', {name: 'Nova Foto', exact: true});
        await form.getByLabel('Título *', {exact: true}).fill('Foto criada no teste');
        await form.getByLabel('Objetivo (Opcional)', {exact: true}).selectOption('goal-test');
        await form.locator('input[type=file]').setInputFiles({name: 'fixture.png', mimeType: 'image/png', buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=', 'base64')});
        await page.waitForFunction(() => document.querySelector('input[readonly]')?.value === 'Arquivo carregado ✓');
        await form.getByRole('button', {name: 'Salvar', exact: true}).click();
        await vault.getByRole('heading', {name: 'Foto criada no teste', exact: true}).waitFor();
        await vault.getByRole('button', {name: 'Editar foto Foto criada no teste', exact: true}).click();
        page.once('dialog', dialog => dialog.accept());
        await page.getByRole('dialog', {name: 'Editar Foto', exact: true}).getByRole('button', {name: 'Excluir', exact: true}).click();
        await vault.getByRole('heading', {name: 'Foto criada no teste', exact: true}).waitFor({state: 'hidden'});
        await page.goBack(); await vault.waitFor({state: 'hidden'});
        await audioAccess.waitFor();
        await photoAccess.click(); await vault.waitFor();
        await vault.getByRole('button', {name: 'Fechar cofre', exact: true}).click(); await vault.waitFor({state: 'hidden'});
        assert.equal(await page.evaluate(() => Boolean(history.state?.vendeoSettingsVault)), false);
        assert.deepEqual(errors, []);
        results.push({device, theme, passed: true, mockedWrites: mock.writes.length});
      } catch (error) {
        await page.screenshot({path: `${artifactDir}/${device}-${theme}-failure.png`});
        console.error((await page.locator('body').innerText()).slice(-1800));
        throw error;
      } finally {await context.close();}
    }
  }
  for (const viewport of [{width: 1365, height: 1000}, {width: 390, height: 844}]) {
    const context = await browser.newContext({viewport, serviceWorkers: 'block'});
    await mockNetwork(context);
    const page = await context.newPage(); page.setDefaultTimeout(10000);
    await page.goto(`${baseUrl}/vault-composer-fixture`, {waitUntil: 'networkidle'});
    for (const variant of ['instagram', 'whatsapp']) {
      const area = page.locator(`[data-variant="${variant}"]`);
      assert.equal(await area.getByRole('button', {name: /cofre/i}).count(), 0);
      await area.getByRole('button', {name: 'Gravar áudio', exact: true}).click();
      if (variant === 'whatsapp') {
        await area.getByRole('button', {name: 'Abrir figurinhas', exact: true}).click();
        await area.getByRole('button', {name: 'Abrir console do Brain', exact: true}).click();
        await area.getByRole('button', {name: 'Anexar', exact: true}).click();
        const chooser = page.waitForEvent('filechooser');
        await area.getByRole('button', {name: 'Fotos', exact: true}).click();
        await (await chooser).setFiles({name: 'photo.png', mimeType: 'image/png', buffer: Buffer.from('fixture')});
        await area.getByRole('button', {name: 'Anexar', exact: true}).click();
        const documentChooser = page.waitForEvent('filechooser');
        await area.getByRole('button', {name: 'Documento', exact: true}).click();
        await (await documentChooser).setFiles({name: 'document.pdf', mimeType: 'application/pdf', buffer: Buffer.from('fixture')});
      } else {
        await area.locator('input[type=file]').first().setInputFiles({name: 'photo.png', mimeType: 'image/png', buffer: Buffer.from('fixture')});
        const chooser = page.waitForEvent('filechooser');
        await area.getByTitle('Enviar documento ou mídia', {exact: true}).click();
        await (await chooser).setFiles({name: 'document.pdf', mimeType: 'application/pdf', buffer: Buffer.from('fixture')});
      }
      await area.locator('textarea').fill('Mensagem apenas da fixture');
      await area.getByRole('button', {name: 'Enviar mensagem', exact: true}).click();
      const events = JSON.parse(await page.getByTestId('composer-events').innerText());
      for (const key of ['recording', 'image', 'document', 'message']) assert.equal(events[`${variant}-${key}`], 1);
      if (variant === 'whatsapp') for (const key of ['stickers', 'console']) assert.equal(events[`${variant}-${key}`], 1);
      results.push({composer: variant, width: viewport.width, passed: true});
    }
    await context.close();
  }
  console.log(JSON.stringify({browser: engine.name(), results, artifactDir}));
  } finally {
    if (fixtureCreated) {
      await fs.unlink(new URL('page.tsx', fixtureRoot)).catch(error => { if (error.code !== 'ENOENT') throw error; });
      await fs.rmdir(fixtureRoot);
    }
  }
} finally {
  await browser.close();
}
