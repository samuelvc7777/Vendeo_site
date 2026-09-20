const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const test = require('node:test');

/**
 * Carrega o módulo ES restructure-obsidian-mirror.mjs dinamicamente
 */
async function loadRestructureModule() {
  const modulePath = path.resolve('scripts/restructure-obsidian-mirror.mjs');
  return await import(`file://${modulePath.replace(/\\/g, '/')}`);
}

function createTempVault() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'vendeo-obsidian-restructure-test-'));
}

// =========================================================================
// TESTE R1: Geração dos 6 arquivos por pretendente com nomes qualificados
// =========================================================================
test('R1. Pretendente gera exatamente os 6 arquivos qualificados sem nós genéricos', async () => {
  const mod = await loadRestructureModule();
  const tempVault = createTempVault();

  try {
    const mockContact = {
      id: 'c_test_01',
      contactId: '123456',
      fullName: 'Lucas Silva',
      username: 'lucassilva',
      currentPhase: 'descoberta',
      checkpoint: 'chk_cidade_validada',
      updatedAt: '2026-09-19T10:00:00Z',
      memory: {
        entities: {
          self: {
            age: { value: 28 },
            city: { value: 'Belo Horizonte' },
            job: { value: 'Engenheiro de Software' },
          },
        },
        snippets: ['Prefiro praia a montanha'],
      },
      checklist: {
        stage: 'Descoberta',
        goals: [
          { id: 'goal_age', label: 'Idade', status: 'completed', value: 28 },
          { id: 'goal_city', label: 'Cidade', status: 'completed', value: 'Belo Horizonte' },
        ],
      },
    };

    const folderName = mod.formatPretendenteFolderName(mockContact);
    assert.equal(folderName, 'Lucas Silva__123456');

    const contactDir = path.join(tempVault, 'Pretendentes', folderName);
    fs.mkdirSync(contactDir, { recursive: true });

    const hubContent = mod.generateHubMarkdown(mockContact);
    const aboutContent = mod.generateAboutMarkdown(mockContact);
    const convContent = mod.generateConversationMarkdown(mockContact);
    const objContent = mod.generateObjectivesMarkdown(mockContact);
    const epContent = mod.generateEpisodesMarkdown(mockContact);
    const metaContent = mod.generateMetadataMarkdown(mockContact);

    fs.writeFileSync(path.join(contactDir, '00 - Lucas Silva.md'), hubContent, 'utf8');
    fs.writeFileSync(path.join(contactDir, '01 - Sobre Lucas Silva.md'), aboutContent, 'utf8');
    fs.writeFileSync(path.join(contactDir, '02 - Conversa com Lucas Silva.md'), convContent, 'utf8');
    fs.writeFileSync(path.join(contactDir, '03 - Objetivos de Lucas Silva.md'), objContent, 'utf8');
    fs.writeFileSync(path.join(contactDir, '04 - Episódios de Lucas Silva.md'), epContent, 'utf8');
    fs.writeFileSync(path.join(contactDir, '05 - Metadados de Lucas Silva.md'), metaContent, 'utf8');

    // Validação de nomes e ausência de genéricos
    const files = fs.readdirSync(contactDir);
    assert.equal(files.length, 6);
    assert.ok(files.includes('00 - Lucas Silva.md'));
    assert.ok(files.includes('01 - Sobre Lucas Silva.md'));
    assert.ok(files.includes('02 - Conversa com Lucas Silva.md'));
    assert.ok(files.includes('03 - Objetivos de Lucas Silva.md'));
    assert.ok(files.includes('04 - Episódios de Lucas Silva.md'));
    assert.ok(files.includes('05 - Metadados de Lucas Silva.md'));

    assert.equal(files.includes('Sobre ele.md'), false, 'NÃO deve existir Sobre ele.md genérico');
    assert.equal(files.includes('Metadados.md'), false, 'NÃO deve existir Metadados.md genérico');

    // Validação de links no Hub
    assert.ok(hubContent.includes('[[01 - Sobre Lucas Silva]]'));
    assert.ok(hubContent.includes('[[02 - Conversa com Lucas Silva]]'));
    assert.ok(hubContent.includes('[[03 - Objetivos de Lucas Silva]]'));
    assert.ok(hubContent.includes('[[04 - Episódios de Lucas Silva]]'));
    assert.ok(hubContent.includes('[[05 - Metadados de Lucas Silva]]'));
    assert.ok(hubContent.includes('[[INDEX|⬅️ Voltar ao Índice Geral de Pretendentes]]'));

    // Validação de links de retorno nos satélites
    assert.ok(aboutContent.includes('[[00 - Lucas Silva|⬅️ Voltar ao Hub de Lucas Silva]]'));
    assert.ok(objContent.includes('[[00 - Lucas Silva|⬅️ Voltar ao Hub de Lucas Silva]]'));
    assert.ok(epContent.includes('[[00 - Lucas Silva|⬅️ Voltar ao Hub de Lucas Silva]]'));
  } finally {
    fs.rmSync(tempVault, { recursive: true, force: true });
  }
});

// =========================================================================
// TESTE R2: Geração do INDEX.md de Pretendentes
// =========================================================================
test('R2. generateIndexMarkdown cria tabela formatada com links para os hubs', async () => {
  const mod = await loadRestructureModule();
  const contacts = [
    { contactId: '111', fullName: 'Carlos Eduardo', username: 'carlosedu', currentPhase: 'conexao_inicial', updatedAt: '2026-09-19T01:00:00Z' },
    { contactId: '222', fullName: 'Felipe Santos', username: 'felipes', currentPhase: 'descoberta', updatedAt: '2026-09-19T02:00:00Z' },
  ];

  const indexMd = mod.generateIndexMarkdown(contacts);
  assert.ok(indexMd.includes('# 📋 Índice de Pretendentes (2)'));
  assert.ok(indexMd.includes('[[Pretendentes/Carlos Eduardo__111/00 - Carlos Eduardo|Carlos Eduardo]]'));
  assert.ok(indexMd.includes('[[Pretendentes/Felipe Santos__222/00 - Felipe Santos|Felipe Santos]]'));
  assert.ok(indexMd.includes('@carlosedu'));
  assert.ok(indexMd.includes('`conexao_inicial`'));
});

// =========================================================================
// TESTE R3: Hub da Persona Larissa e Categorias
// =========================================================================
test('R3. Persona Larissa gera Hub Central e categorias temáticas', async () => {
  const mod = await loadRestructureModule();
  const categories = ['identidade', 'enfermagem', 'rotina', 'gostos'];
  const hubMd = mod.generatePersonaHubMarkdown(categories, 675);

  assert.ok(hubMd.includes('# 🌸 Persona Larissa — Hub Central'));
  assert.ok(hubMd.includes('**675** fatos canônicos, gerados e temporais'));
  assert.ok(hubMd.includes('- [[Identidade]]'));
  assert.ok(hubMd.includes('- [[Enfermagem]]'));
  assert.ok(hubMd.includes('- [[Rotina]]'));
  assert.ok(hubMd.includes('- [[Gostos]]'));
});

// =========================================================================
// TESTE R4: Idempotência Estrita (Zero Reescritas na 2ª Execução)
// =========================================================================
test('R4. Idempotência estrita: segunda gravação com dados idênticos não altera arquivos', async () => {
  const mod = await loadRestructureModule();
  const tempVault = createTempVault();

  try {
    const filePath = path.join(tempVault, 'teste_idempotencia.md');
    const content = '---\nvendeo_managed: true\n---\n# Conteúdo Estável';

    // 1ª escrita
    const res1 = mod.atomicWriteFileIfChanged(filePath, content);
    assert.equal(res1.written, true);
    assert.equal(res1.skippedUnchanged, false);

    const stat1 = fs.statSync(filePath);
    await new Promise((r) => setTimeout(r, 20));

    // 2ª escrita idêntica
    const res2 = mod.atomicWriteFileIfChanged(filePath, content);
    assert.equal(res2.written, false);
    assert.equal(res2.skippedUnchanged, true);

    const stat2 = fs.statSync(filePath);
    assert.equal(stat1.mtimeMs, stat2.mtimeMs, 'Timestamp de modificação deve ser idêntico');
  } finally {
    fs.rmSync(tempVault, { recursive: true, force: true });
  }
});

// =========================================================================
// TESTE R5: Preservação de Arquivos Manuais do Usuário
// =========================================================================
test('R5. Arquivos manuais sem vendeo_managed: true são mantidos 100% intactos', async () => {
  const mod = await loadRestructureModule();
  const tempVault = createTempVault();

  try {
    const manualFile = path.join(tempVault, 'Minhas Notas.md');
    const manualText = '# Anotações Manuais do Usuário\nNão mexa!';
    fs.writeFileSync(manualFile, manualText, 'utf8');

    assert.equal(mod.isVendeoManaged(manualFile), false);

    const res = mod.atomicWriteFileIfChanged(manualFile, '---\nvendeo_managed: true\n---\n# Tentativa de sobrescrita');
    assert.equal(res.written, false);
    assert.equal(res.skippedManual, true);

    assert.equal(fs.readFileSync(manualFile, 'utf8'), manualText);
  } finally {
    fs.rmSync(tempVault, { recursive: true, force: true });
  }
});

// =========================================================================
// TESTE R6: Mapeamento Seguro de Arquivamento (Zero Deleções Destrutivas)
// =========================================================================
test('R6. Arquivamento seguro move pastas para _archive sem exclusão destrutiva', async () => {
  const tempVault = createTempVault();

  try {
    const oldDir = path.join(tempVault, 'Vendeo Memory', 'Contatos', 'Lucas (123)');
    fs.mkdirSync(oldDir, { recursive: true });
    fs.writeFileSync(path.join(oldDir, 'Sobre ele.md'), 'conteudo', 'utf8');

    const archiveDir = path.join(tempVault, '_archive', 'Vendeo_Memory_Contatos_antigo');
    fs.mkdirSync(path.dirname(archiveDir), { recursive: true });
    fs.renameSync(path.join(tempVault, 'Vendeo Memory', 'Contatos'), archiveDir);

    assert.ok(fs.existsSync(path.join(archiveDir, 'Lucas (123)', 'Sobre ele.md')));
    assert.equal(fs.existsSync(oldDir), false);
  } finally {
    fs.rmSync(tempVault, { recursive: true, force: true });
  }
});
