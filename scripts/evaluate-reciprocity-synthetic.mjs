import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { tmpdir } from 'node:os';
import { OpenAiReciprocityProvider, RECIPROCITY_PROMPT_VERSION } from '../supabase/functions/api/reciprocity_openai.ts';
import { RECIPROCITY_STANDARD_RATES, RECIPROCITY_TARIFF_SOURCES, RECIPROCITY_TARIFF_VERSION } from '../supabase/functions/api/reciprocity_rates.ts';
import { reciprocitySyntheticCases } from './fixtures/reciprocity-synthetic-cases.mjs';

export async function evaluateSyntheticReciprocity(provider, configuration, onCase = async () => {}) {
  await provider.preflight(configuration);
  const report = {
    generatedAt: new Date().toISOString(),
    dataOrigin: 'conversas inteiramente fictícias; nenhuma leitura de chats reais',
    configuration,
    promptVersion: RECIPROCITY_PROMPT_VERSION,
    tariffVersion: RECIPROCITY_TARIFF_VERSION,
    tariffSources: RECIPROCITY_TARIFF_SOURCES,
    qualityStatus: 'aguarda_revisao_humana',
    humanReview: { reviewer: null, reviewedAt: null, decision: null },
    cases: [],
  };
  for (const scenario of reciprocitySyntheticCases) {
    const record = { ...scenario, humanReview: { approved: null, notes: '' } };
    try {
      Object.assign(record, await provider.evaluate(scenario.messages, configuration), { status: 'completed' });
    } catch (error) {
      Object.assign(record, {
        status: 'failed',
        error: error instanceof Error ? error.message : 'Falha na análise sintética.',
        usage: error?.usage || null,
        estimatedCostUsd: error?.estimatedCostUsd ?? null,
        durationMs: error?.durationMs ?? null,
      });
    }
    report.cases.push(record);
    report.totals = report.cases.reduce((totals, item) => ({
      completed: totals.completed + Number(item.status === 'completed'),
      failed: totals.failed + Number(item.status === 'failed'),
      inputTokens: totals.inputTokens + (item.usage?.inputTokens || 0),
      outputTokens: totals.outputTokens + (item.usage?.outputTokens || 0),
      durationMs: totals.durationMs + (item.durationMs || 0),
      estimatedCostUsd: totals.estimatedCostUsd + (item.estimatedCostUsd || 0),
      casesWithoutCostEstimate: totals.casesWithoutCostEstimate + Number(item.estimatedCostUsd == null),
    }), { completed: 0, failed: 0, inputTokens: 0, outputTokens: 0, durationMs: 0, estimatedCostUsd: 0, casesWithoutCostEstimate: 0 });
    await onCase(report);
  }
  return report;
}

async function main() {
  const args = process.argv.slice(2);
  const options = { model: 'gpt-6-luna', reasoning: 'low', output: resolve(tmpdir(), `reciprocity-synthetic-${Date.now()}.json`) };
  for (let index = 0; index < args.length; index += 2) {
    const name = args[index]?.replace(/^--/, '');
    if (!['model', 'reasoning', 'output'].includes(name) || !args[index + 1]) throw new Error('Use --model <id> --reasoning <low|medium|high> --output <arquivo.json>.');
    options[name] = args[index + 1];
  }
  if (!['gpt-6-luna', 'gpt-6.1-terra', 'gpt-6.1-sol'].includes(options.model) || !['low', 'medium', 'high'].includes(options.reasoning)) throw new Error('Modelo ou nível de raciocínio inválido.');
  const apiKey = process.env.OPENAI_API_KEY || '';
  if (!apiKey) throw new Error('Defina OPENAI_API_KEY somente no ambiente para executar os casos sintéticos.');
  const configuration = { model: options.model, reasoning: options.reasoning };
  // Liberação restrita a este runner sintético: não altera a lista validada do worker.
  const provider = new OpenAiReciprocityProvider({ apiKey, validatedModels: [options.model], rates: RECIPROCITY_STANDARD_RATES });
  const output = resolve(options.output);
  await mkdir(dirname(output), { recursive: true });
  const report = await evaluateSyntheticReciprocity(provider, configuration, async partial => {
    await writeFile(output, `${JSON.stringify(partial, null, 2)}\n`, { mode: 0o600 });
    const last = partial.cases.at(-1);
    process.stdout.write(`${last.id}: ${last.status}\n`);
  });
  process.stdout.write(`${JSON.stringify({ output, qualityStatus: report.qualityStatus, totals: report.totals })}\n`);
  if (report.totals.failed) process.exitCode = 1;
}
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  main().catch(error => { process.stderr.write(`${error instanceof Error ? error.message : 'Falha no runner sintético.'}\n`); process.exitCode = 1; });
}
