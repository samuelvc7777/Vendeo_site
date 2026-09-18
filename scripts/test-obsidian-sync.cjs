const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const test = require('node:test');

/**
 * Carrega o módulo ES obsidian-memory-sync.mjs dinamicamente
 */
async function loadSyncModule() {
  const modulePath = path.resolve('scripts/obsidian-memory-sync.mjs');
  return await import(`file://${modulePath.replace(/\\/g, '/')}`);
}

/**
 * Cria diretório temporário isolado para testes
 */
function createTempVault() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'vendeo-obsidian-test-'));
}

// =========================================================================
// TESTE C1: Criação de Estrutura de Pastas e Arquivos
// =========================================================================
test('C1. syncContactToVault cria estrutura Vendeo Memory/Contatos/<Nome>/Sobre ele.md e Metadados.md', async () => {
  const { syncContactToVault } = await loadSyncModule();
  const tempVault = createTempVault();

  try {
    const mockContact = {
      id: 'c_001',
      contactId: '1771103754015024',
      fullName: 'Moose Teste',
      username: 'mooseteste',
      currentPhase: 'conexao_inicial',
      checkpoint: 'chk_saudacao_feita',
      updatedAt: '2026-09-18T10:00:00Z',
      memory: {
        entities: {
          self: {
            city: { entity: 'self', field: 'city', value: 'Curitiba', sourceMessageId: 'm1' },
          },
        },
        snippets: ['Gosto de clima frio'],
      },
    };

    const res = syncContactToVault(tempVault, mockContact);
    assert.equal(res.updatedCount, 2, 'Deve criar Sobre ele.md e Metadados.md');

    const profileFile = path.join(res.contactDir, 'Sobre ele.md');
    const metaFile = path.join(res.contactDir, 'Metadados.md');

    assert.ok(fs.existsSync(profileFile), 'Sobre ele.md deve existir');
    assert.ok(fs.existsSync(metaFile), 'Metadados.md deve existir');

    const profileContent = fs.readFileSync(profileFile, 'utf8');
    assert.ok(profileContent.includes('# Perfil: Moose Teste'));
    assert.ok(profileContent.includes('Curitiba'));
    assert.ok(profileContent.includes('Gosto de clima frio'));
  } finally {
    fs.rmSync(tempVault, { recursive: true, force: true });
  }
});

// =========================================================================
// TESTE C2: Frontmatter vendeo_managed: true e Metadados YAML
// =========================================================================
test('C2. Arquivos gerados contêm frontmatter YAML com vendeo_managed: true e metadados', async () => {
  const { syncContactToVault, isVendeoManaged } = await loadSyncModule();
  const tempVault = createTempVault();

  try {
    const mockContact = {
      id: 'c_002',
      contactId: '123456789',
      fullName: 'Ana Clara',
      currentPhase: 'descoberta',
      checkpoint: 'chk_pergunta_sobre_ele',
      updatedAt: '2026-09-18T11:00:00Z',
      memory: { entities: {}, snippets: [] },
    };

    const res = syncContactToVault(tempVault, mockContact);
    const profileFile = path.join(res.contactDir, 'Sobre ele.md');
    const metaFile = path.join(res.contactDir, 'Metadados.md');

    assert.equal(isVendeoManaged(profileFile), true);
    assert.equal(isVendeoManaged(metaFile), true);

    const profileContent = fs.readFileSync(profileFile, 'utf8');
    assert.match(profileContent, /vendeo_managed:\s*true/);
    assert.match(profileContent, /vendeo_contact_id:\s*"123456789"/);
    assert.match(profileContent, /current_phase:\s*"descoberta"/);
  } finally {
    fs.rmSync(tempVault, { recursive: true, force: true });
  }
});

// =========================================================================
// TESTE C3: Sanitização de Nomes de Pastas e Entidades
// =========================================================================
test('C3. Sanitização remove caracteres proibidos no Windows sem gerar erros de sistema de arquivos', async () => {
  const { syncContactToVault, sanitizePathSegment } = await loadSyncModule();
  const tempVault = createTempVault();

  try {
    assert.equal(sanitizePathSegment('João: / * ? < > | Silva'), 'João_Silva');
    assert.equal(sanitizePathSegment(''), 'sem_nome');
    assert.equal(sanitizePathSegment(null), 'sem_nome');

    const dirtyContact = {
      id: 'c_dirty',
      contactId: '99999',
      fullName: 'Carlos: O "Grande" <VIP>? /teste\\',
      currentPhase: 'conexao_inicial',
      memory: {
        entities: {
          'tio/joão:novo': { idade: 50 },
        },
      },
    };

    const res = syncContactToVault(tempVault, dirtyContact);
    assert.ok(fs.existsSync(res.contactDir), 'Pasta do contato com nome sanitizado deve ser criada');

    const entityFile = path.join(res.contactDir, 'Pessoas', 'tio_joão_novo.md');
    assert.ok(fs.existsSync(entityFile), 'Arquivo de entidade com nome sanitizado deve ser criado');
  } finally {
    fs.rmSync(tempVault, { recursive: true, force: true });
  }
});

// =========================================================================
// TESTE C4: Separação de Entidades em Pessoas/<Entidade>.md
// =========================================================================
test('C4. Entidades secundárias são separadas em arquivos independentes em Pessoas/<Entidade>.md', async () => {
  const { syncContactToVault } = await loadSyncModule();
  const tempVault = createTempVault();

  try {
    const mockContact = {
      id: 'c_004',
      contactId: '44444',
      fullName: 'Marcos Vinicius',
      currentPhase: 'descoberta',
      memory: {
        entities: {
          self: { age: { value: 35 } },
          prima_maria: { age: { value: 25, sourceMessageId: 'msg_25' } },
          irmao_pedro: { profissao: { value: 'Engenheiro' } },
        },
      },
    };

    const res = syncContactToVault(tempVault, mockContact);
    assert.equal(res.updatedCount, 4, 'Sobre ele + Metadados + prima_maria + irmao_pedro = 4 arquivos');

    const primaFile = path.join(res.contactDir, 'Pessoas', 'prima_maria.md');
    const pedroFile = path.join(res.contactDir, 'Pessoas', 'irmao_pedro.md');

    assert.ok(fs.existsSync(primaFile));
    assert.ok(fs.existsSync(pedroFile));

    const primaContent = fs.readFileSync(primaFile, 'utf8');
    assert.ok(primaContent.includes('# Entidade Relacionada: prima_maria'));
    assert.ok(primaContent.includes('**age:** 25 *(origem: msg_25)*'));
  } finally {
    fs.rmSync(tempVault, { recursive: true, force: true });
  }
});

// =========================================================================
// TESTE C5: Idempotência & Hash SHA-256 (Incremental)
// =========================================================================
test('C5. Segunda execução com dados idênticos é 100% incremental (zero reescritas)', async () => {
  const { syncContactToVault } = await loadSyncModule();
  const tempVault = createTempVault();

  try {
    const mockContact = {
      id: 'c_005',
      contactId: '55555',
      fullName: 'Roberto Silva',
      currentPhase: 'conexao_inicial',
      updatedAt: '2026-09-18T12:00:00Z',
      memory: {
        entities: {
          self: { age: { value: 42 } },
        },
      },
    };

    // 1ª execução: cria arquivos
    const res1 = syncContactToVault(tempVault, mockContact);
    assert.equal(res1.updatedCount, 2);
    assert.equal(res1.unchangedCount, 0);

    const profileFile = path.join(res1.contactDir, 'Sobre ele.md');
    const stat1 = fs.statSync(profileFile);

    // Pequena pausa para garantir que mtime mudaria se houvesse reescrita
    await new Promise((r) => setTimeout(r, 50));

    // 2ª execução: dados idênticos
    const res2 = syncContactToVault(tempVault, mockContact);
    assert.equal(res2.updatedCount, 0, 'Nenhum arquivo deve ser reescrito');
    assert.equal(res2.unchangedCount, 2, 'Ambos os arquivos devem ser identificados como inalterados');

    const stat2 = fs.statSync(profileFile);
    assert.equal(stat1.mtimeMs, stat2.mtimeMs, 'Timestamp de modificação (mtime) deve permanecer idêntico');
  } finally {
    fs.rmSync(tempVault, { recursive: true, force: true });
  }
});

// =========================================================================
// TESTE C6: Atualização Incremental quando os dados mudam
// =========================================================================
test('C6. Atualização modifica apenas arquivos que sofreram alteração real', async () => {
  const { syncContactToVault } = await loadSyncModule();
  const tempVault = createTempVault();

  try {
    const mockContactV1 = {
      id: 'c_006',
      contactId: '66666',
      fullName: 'Lucas Lima',
      currentPhase: 'conexao_inicial',
      updatedAt: '2026-09-18T12:00:00Z',
      memory: {
        entities: {
          self: { city: { value: 'São Paulo' } },
          amigo_joao: { hobby: { value: 'Futebol' } },
        },
      },
    };

    syncContactToVault(tempVault, mockContactV1);

    // Modifica apenas a entidade 'amigo_joao' (Sobre ele permanece idêntico)
    const mockContactV2 = {
      ...mockContactV1,
      memory: {
        entities: {
          self: { city: { value: 'São Paulo' } },
          amigo_joao: { hobby: { value: 'Futebol e Basquete' } },
        },
      },
    };

    const res2 = syncContactToVault(tempVault, mockContactV2);
    // amigo_joao e Metadados mudam; Sobre ele.md permanece inalterado!
    assert.equal(res2.updatedCount, 2, 'Metadados e amigo_joao devem ser atualizados');
    assert.equal(res2.unchangedCount, 1, 'Sobre ele.md deve ser inalterado');
  } finally {
    fs.rmSync(tempVault, { recursive: true, force: true });
  }
});

// =========================================================================
// TESTE C7: Preservação Estrita de Arquivos Manuais do Usuário
// =========================================================================
test('C7. Arquivo manual sem vendeo_managed: true NUNCA é sobrescrito nem apagado', async () => {
  const { syncContactToVault, isVendeoManaged } = await loadSyncModule();
  const tempVault = createTempVault();

  try {
    const contactDir = path.join(tempVault, 'Vendeo Memory', 'Contatos', 'Cliente Especial (77777)');
    fs.mkdirSync(contactDir, { recursive: true });

    // Cria arquivo manual do usuário sem header do Vendeo
    const manualFile = path.join(contactDir, 'Sobre ele.md');
    const manualContent = '# Minhas Anotações Manuais Secretas\nNão apague isso!';
    fs.writeFileSync(manualFile, manualContent, 'utf8');

    assert.equal(isVendeoManaged(manualFile), false, 'Arquivo sem frontmatter não é gerenciado pelo Vendeo');

    const mockContact = {
      id: 'c_007',
      contactId: '77777',
      fullName: 'Cliente Especial',
      currentPhase: 'descoberta',
      memory: { entities: { self: { city: 'Recife' } } },
    };

    const res = syncContactToVault(tempVault, mockContact);
    assert.equal(res.preservedCount, 1, 'Deve registrar 1 arquivo manual preservado');

    // Confere que o conteúdo manual permaneceu 100% intacto
    const currentContent = fs.readFileSync(manualFile, 'utf8');
    assert.equal(currentContent, manualContent, 'Conteúdo manual deve ser preservado rigorosamente');
  } finally {
    fs.rmSync(tempVault, { recursive: true, force: true });
  }
});

// =========================================================================
// TESTE C8: Isolamento por Contato (--contact <id>)
// =========================================================================
test('C8. Sincronização por contato isola e afeta exclusivamente o diretório do contato indicado', async () => {
  const { syncContactToVault } = await loadSyncModule();
  const tempVault = createTempVault();

  try {
    const contactA = { id: 'c_A', contactId: '111', fullName: 'Contato A', memory: {} };
    const contactB = { id: 'c_B', contactId: '222', fullName: 'Contato B', memory: {} };

    const resA = syncContactToVault(tempVault, contactA);
    assert.ok(fs.existsSync(resA.contactDir));

    const pathB = path.join(tempVault, 'Vendeo Memory', 'Contatos', 'Contato B (222)');
    assert.equal(fs.existsSync(pathB), false, 'Contato B não deve ter sido tocado');

    const resB = syncContactToVault(tempVault, contactB);
    assert.ok(fs.existsSync(resB.contactDir));
  } finally {
    fs.rmSync(tempVault, { recursive: true, force: true });
  }
});

// =========================================================================
// TESTE C9: Escrita Atômica (Zero arquivos corrompidos)
// =========================================================================
test('C9. atomicWriteFileIfChanged grava via .tmp e conclui com arquivo íntegro sem resíduos temporários', async () => {
  const { atomicWriteFileIfChanged } = await loadSyncModule();
  const tempVault = createTempVault();

  try {
    const targetFile = path.join(tempVault, 'test_dir', 'arquivo_teste.md');
    const content = '---\nvendeo_managed: true\n---\n# Conteúdo Íntegro';

    const res = atomicWriteFileIfChanged(targetFile, content);
    assert.equal(res.written, true);
    assert.ok(fs.existsSync(targetFile));
    assert.equal(fs.readFileSync(targetFile, 'utf8'), content);

    // Verifica que não ficaram arquivos temporários residuais
    const dirFiles = fs.readdirSync(path.dirname(targetFile));
    const tmpFiles = dirFiles.filter((f) => f.includes('.tmp.'));
    assert.equal(tmpFiles.length, 0, 'Nenhum arquivo .tmp deve restar após a gravação atômica');
  } finally {
    fs.rmSync(tempVault, { recursive: true, force: true });
  }
});

// =========================================================================
// TESTE C10: Resolução de Vault - 0 Vaults Detectados
// =========================================================================
test('C10. resolveVaultPath falha com erro explícito se 0 vaults válidos forem encontrados', async () => {
  const { resolveVaultPath } = await loadSyncModule();
  const tempDir = createTempVault();
  const fakeConfigFile = path.join(tempDir, 'obsidian.json');

  try {
    // Config sem vaults ou com vaults apontando para diretórios inexistentes
    fs.writeFileSync(fakeConfigFile, JSON.stringify({ vaults: { v1: { path: path.join(tempDir, 'inexistente') } } }), 'utf8');

    const oldVaultEnv = process.env.OBSIDIAN_VAULT_PATH;
    delete process.env.OBSIDIAN_VAULT_PATH;

    try {
      assert.throws(
        () => resolveVaultPath(null, fakeConfigFile),
        /Nenhum vault do Obsidian foi encontrado/i
      );
    } finally {
      if (oldVaultEnv) process.env.OBSIDIAN_VAULT_PATH = oldVaultEnv;
    }
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

// =========================================================================
// TESTE C11: Resolução de Vault - Exatamente 1 Vault Válido
// =========================================================================
test('C11. resolveVaultPath seleciona o vault quando existe exatamente 1 válido', async () => {
  const { resolveVaultPath } = await loadSyncModule();
  const tempDir = createTempVault();
  const singleVaultDir = path.join(tempDir, 'meu_vault_unico');
  fs.mkdirSync(singleVaultDir, { recursive: true });
  const fakeConfigFile = path.join(tempDir, 'obsidian.json');

  try {
    fs.writeFileSync(fakeConfigFile, JSON.stringify({
      vaults: {
        v1: { path: singleVaultDir },
        v2_invalido: { path: path.join(tempDir, 'pasta_fantasma') }, // Ignorado porque não existe fisicamente
      },
    }), 'utf8');

    const oldVaultEnv = process.env.OBSIDIAN_VAULT_PATH;
    delete process.env.OBSIDIAN_VAULT_PATH;

    try {
      const selected = resolveVaultPath(null, fakeConfigFile);
      assert.equal(selected, path.resolve(singleVaultDir), 'Deve selecionar o único vault válido');
    } finally {
      if (oldVaultEnv) process.env.OBSIDIAN_VAULT_PATH = oldVaultEnv;
    }
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

// =========================================================================
// TESTE C12: Resolução de Vault - 2 ou Mais Vaults Válidos (Erro e Listagem)
// =========================================================================
test('C12. resolveVaultPath FALHA e lista os caminhos se existirem 2 ou mais vaults válidos', async () => {
  const { resolveVaultPath } = await loadSyncModule();
  const tempDir = createTempVault();
  const vault1 = path.join(tempDir, 'vault_alpha');
  const vault2 = path.join(tempDir, 'vault_beta');
  fs.mkdirSync(vault1, { recursive: true });
  fs.mkdirSync(vault2, { recursive: true });
  const fakeConfigFile = path.join(tempDir, 'obsidian.json');

  try {
    fs.writeFileSync(fakeConfigFile, JSON.stringify({
      vaults: {
        v1: { path: vault1 },
        v2: { path: vault2 },
      },
    }), 'utf8');

    const oldVaultEnv = process.env.OBSIDIAN_VAULT_PATH;
    delete process.env.OBSIDIAN_VAULT_PATH;

    try {
      assert.throws(
        () => resolveVaultPath(null, fakeConfigFile),
        (err) => {
          assert.match(err.message, /Múltiplos vaults do Obsidian foram encontrados/i);
          assert.ok(err.message.includes('vault_alpha'), 'Mensagem deve listar vault_alpha');
          assert.ok(err.message.includes('vault_beta'), 'Mensagem deve listar vault_beta');
          assert.match(err.message, /OBSIDIAN_VAULT_PATH|--vault/i);
          return true;
        }
      );
    } finally {
      if (oldVaultEnv) process.env.OBSIDIAN_VAULT_PATH = oldVaultEnv;
    }
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

// =========================================================================
// TESTE C13: Precedência de OBSIDIAN_VAULT_PATH
// =========================================================================
test('C13. OBSIDIAN_VAULT_PATH tem precedência sobre obsidian.json e falha se inexistente', async () => {
  const { resolveVaultPath } = await loadSyncModule();
  const tempDir = createTempVault();
  const envVaultDir = path.join(tempDir, 'vault_via_env');
  fs.mkdirSync(envVaultDir, { recursive: true });

  const oldVaultEnv = process.env.OBSIDIAN_VAULT_PATH;
  try {
    process.env.OBSIDIAN_VAULT_PATH = envVaultDir;
    const selected = resolveVaultPath(null, null);
    assert.equal(selected, path.resolve(envVaultDir));

    // Se o caminho da env não existir, deve falhar explicitamente
    process.env.OBSIDIAN_VAULT_PATH = path.join(tempDir, 'nao_existe');
    assert.throws(
      () => resolveVaultPath(null, null),
      /Caminho em OBSIDIAN_VAULT_PATH não existe/i
    );
  } finally {
    if (oldVaultEnv) process.env.OBSIDIAN_VAULT_PATH = oldVaultEnv;
    else delete process.env.OBSIDIAN_VAULT_PATH;
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

// =========================================================================
// TESTE C14: Precedência Absoluta de --vault
// =========================================================================
test('C14. --vault (explicitPath) tem precedência máxima sobre OBSIDIAN_VAULT_PATH e obsidian.json', async () => {
  const { resolveVaultPath } = await loadSyncModule();
  const tempDir = createTempVault();
  const cliVaultDir = path.join(tempDir, 'vault_cli');
  const envVaultDir = path.join(tempDir, 'vault_env');
  fs.mkdirSync(cliVaultDir, { recursive: true });
  fs.mkdirSync(envVaultDir, { recursive: true });

  const oldVaultEnv = process.env.OBSIDIAN_VAULT_PATH;
  try {
    process.env.OBSIDIAN_VAULT_PATH = envVaultDir;
    // Passa cliVaultDir explicitamente
    const selected = resolveVaultPath(cliVaultDir, null);
    assert.equal(selected, path.resolve(cliVaultDir), 'CLI deve prevalecer sobre ENV');

    // Se CLI for inválido, deve falhar
    assert.throws(
      () => resolveVaultPath(path.join(tempDir, 'fantasma'), null),
      /Caminho de vault fornecido via --vault não existe/i
    );
  } finally {
    if (oldVaultEnv) process.env.OBSIDIAN_VAULT_PATH = oldVaultEnv;
    else delete process.env.OBSIDIAN_VAULT_PATH;
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

// =========================================================================
// TESTE C15: runSync Exige Exclusivamente OBSIDIAN_SYNC_TOKEN
// =========================================================================
test('C15. runSync exige OBSIDIAN_SYNC_TOKEN e recusa SUPABASE_SERVICE_ROLE_KEY como substituto', async () => {
  const { runSync } = await loadSyncModule();
  const tempDir = createTempVault();

  const oldSyncToken = process.env.OBSIDIAN_SYNC_TOKEN;
  const oldServiceRole = process.env.SUPABASE_SERVICE_ROLE_KEY;

  try {
    // Configura service role mas NÃO OBSIDIAN_SYNC_TOKEN
    delete process.env.OBSIDIAN_SYNC_TOKEN;
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'service_role_admin_key';
    process.env.SUPABASE_URL = 'https://fake.supabase.co';

    await assert.rejects(
      async () => await runSync({ vault: tempDir }),
      /OBSIDIAN_SYNC_TOKEN não configurado/i,
      'runSync não deve aceitar service role e deve exigir OBSIDIAN_SYNC_TOKEN'
    );
  } finally {
    if (oldSyncToken) process.env.OBSIDIAN_SYNC_TOKEN = oldSyncToken;
    else delete process.env.OBSIDIAN_SYNC_TOKEN;

    if (oldServiceRole) process.env.SUPABASE_SERVICE_ROLE_KEY = oldServiceRole;
    else delete process.env.SUPABASE_SERVICE_ROLE_KEY;

    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

