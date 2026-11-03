import type { ReciprocityAttempt, ReciprocityConfiguration, ReciprocityReason, ReciprocityResult, ReciprocityView } from '../../../src/domain/entities/Reciprocity.ts';

export type ReciprocityScope = { scopeId: string; conversationIds?: string[]; accountIds?: string[]; allConversations?: boolean };
export type ReciprocityMessage = { id: string; role: 'contact' | 'larissa'; text: string; at: string; mediaMissing: boolean };
export type StoredReciprocityAttempt = Omit<ReciprocityAttempt, 'coverage'> & { messages: ReciprocityMessage[]; leaseToken?: string };
export interface ReciprocityStore {
  authorize(scope: ReciprocityScope, conversationId: string): Promise<boolean>;
  eligible(conversationId: string): Promise<boolean>;
  settings(scopeId: string): Promise<ReciprocityConfiguration>;
  saveSettings(scopeId:string,configuration:ReciprocityConfiguration):Promise<ReciprocityConfiguration>;
  list(scopeId: string, conversationId: string): Promise<StoredReciprocityAttempt[]>;
  enqueue(scopeId: string, conversationId: string, reason: ReciprocityReason, configuration: ReciprocityConfiguration): Promise<StoredReciprocityAttempt>;
  claim(): Promise<StoredReciprocityAttempt | null>;
  finish(id: string, state: 'completed' | 'failed', values: Partial<StoredReciprocityAttempt>, leaseToken?: string): Promise<boolean>;
}
export interface ReciprocityProvider {
  preflight(configuration: ReciprocityConfiguration): Promise<void>;
  evaluate(messages: ReciprocityMessage[], configuration: ReciprocityConfiguration): Promise<{ result: ReciprocityResult; usage: NonNullable<ReciprocityAttempt['usage']>; estimatedCostUsd: number | null; durationMs: number }>;
}
export class ReciprocityError extends Error {
  status: number;
  usage?:ReciprocityAttempt['usage'];
  durationMs?:number;
  estimatedCostUsd?:number|null;
  constructor(message: string, status = 400) { super(message); this.status = status; }
}
export function publicReciprocityAttempt(attempt: StoredReciprocityAttempt): ReciprocityAttempt {
  const { messages, leaseToken: _lease, ...safe } = attempt;
  return { ...safe, coverage: {
    firstMessageId: messages[0]?.id ?? null,
    lastMessageId: messages.at(-1)?.id ?? null,
    from: messages[0]?.at ?? null,
    to: messages.at(-1)?.at ?? null,
    messageCount: messages.length,
    missingMediaCount: messages.filter(m => m.mediaMissing).length,
  } };
}
export function validateReciprocityResult(value: unknown, messages: ReciprocityMessage[]): ReciprocityResult {
  const v = value as ReciprocityResult;
  const categories = ['baixa', 'moderada', 'alta', 'evidencia_insuficiente'];
  if (!v || !categories.includes(v.participation) || !categories.includes(v.curiosity)
    || !['aumento','diminuicao','estavel','indeterminada'].includes(v.evolution)
    || typeof v.summary !== 'string' || !v.summary.trim()
    || !Array.isArray(v.reasons) || !v.reasons.every(x => typeof x === 'string')
    || !Array.isArray(v.limitations) || !v.limitations.every(x => typeof x === 'string')
    || !Array.isArray(v.evidence)) throw new ReciprocityError('A avaliação retornou uma estrutura inválida.', 502);
  for (const e of v.evidence) {
    const message = messages.find(m => m.id === e?.messageId);
    if (!message || typeof e.quote !== 'string' || !e.quote.trim() || !message.text.includes(e.quote)
      || typeof e.reason !== 'string' || !e.reason.trim()) {
      throw new ReciprocityError('A avaliação citou uma mensagem ou trecho fora do recorte autorizado.', 502);
    }
  }
  if (v.evidence.length === 0 && (v.participation !== 'evidencia_insuficiente' || v.curiosity !== 'evidencia_insuficiente')) {
    throw new ReciprocityError('Classificações precisam de evidências verificáveis.', 502);
  }
  return v;
}
export class ReciprocityService {
  store: ReciprocityStore;
  provider: ReciprocityProvider;
  constructor(store: ReciprocityStore, provider: ReciprocityProvider) { this.store = store; this.provider = provider; }
  async getSettings(scope:ReciprocityScope){
    return this.store.settings(scope.scopeId);
  }
  async saveSettings(scope:ReciprocityScope,value:unknown){
    const input=value as Partial<ReciprocityConfiguration>|null;
    if(!input||!['gpt-6-luna','gpt-6.1-terra','gpt-6.1-sol'].includes(input.model||'')
      ||!['low','medium','high'].includes(input.reasoning||''))throw new ReciprocityError('Modelo ou nível de raciocínio inválido.');
    const configuration:ReciprocityConfiguration={model:input.model!,reasoning:input.reasoning!};
    // Verificar disponibilidade não valida qualidade e não dispara avaliações.
    await this.provider.preflight(configuration);
    return this.store.saveSettings(scope.scopeId,configuration);
  }
  private async authorized(scope: ReciprocityScope, id: string) {
    if (!id || !await this.store.authorize(scope, id)) throw new ReciprocityError('Conversa fora do escopo autorizado.', 404);
  }
  async request(scope: ReciprocityScope, id: string, reason: ReciprocityReason = 'manual') {
    await this.authorized(scope, id);
    if (!['manual','retry','reevaluation','automatic'].includes(reason)) throw new ReciprocityError('Motivo de avaliação inválido.');
    if (!await this.store.eligible(id)) throw new ReciprocityError('Conclua todo o primeiro checklist da etapa Conexão antes da análise.', 409);
    const configuration = await this.store.settings(scope.scopeId);
    await this.provider.preflight(configuration);
    const attempt = await this.store.enqueue(scope.scopeId, id, reason, configuration);
    return { attempt: publicReciprocityAttempt(attempt) };
  }
  async view(scope: ReciprocityScope, id: string): Promise<ReciprocityView> {
    await this.authorized(scope, id);
    const attempts = (await this.store.list(scope.scopeId, id)).map(publicReciprocityAttempt);
    return { state: attempts[0]?.state ?? 'none', latestCompleted: attempts.find(a => a.state === 'completed') ?? null,
      attempts, eligible: await this.store.eligible(id) };
  }
  async evidence(scope: ReciprocityScope, id: string, attemptId: string, messageId: string) {
    await this.authorized(scope,id);
    const attempt = (await this.store.list(scope.scopeId,id)).find(a => a.id === attemptId && a.state === 'completed');
    const index = attempt?.messages.findIndex(m => m.id === messageId) ?? -1;
    if (!attempt || index < 0) throw new ReciprocityError('Evidência fora da avaliação autorizada.',404);
    return {messages: attempt.messages.slice(Math.max(0,index-2),index+3)};
  }
  async processOne(scopes:ReciprocityScope[]): Promise<boolean> {
    const attempt = await this.store.claim();
    if (!attempt) return false;
    let telemetry:Partial<StoredReciprocityAttempt>={};
    try {
      const scope=scopes.find(s=>s.scopeId===attempt.scopeId);
      if(!scope||!await this.store.authorize(scope,attempt.conversationId))throw new ReciprocityError('O escopo da análise foi revogado ou não autoriza mais esta conversa.',403);
      const output = await this.provider.evaluate(attempt.messages, attempt.configuration);
      telemetry={usage:output.usage,durationMs:output.durationMs,estimatedCostUsd:output.estimatedCostUsd};
      const result = validateReciprocityResult(output.result, attempt.messages);
      // Lacunas de mídia são fatos do recorte, não decisões do modelo.
      if (attempt.messages.some(m => m.mediaMissing)) {
        result.limitations = [...new Set([...result.limitations, 'Há mídias sem transcrição ou descrição disponível; não foram processadas novamente.'])];
      }
      await this.store.finish(attempt.id, 'completed', { ...output, result, completedAt: new Date().toISOString() }, attempt.leaseToken);
    } catch (error) {
      if(error instanceof ReciprocityError){
        telemetry={...telemetry,...(error.usage?{usage:error.usage}:{}),...(error.durationMs!==undefined?{durationMs:error.durationMs}:{}),...(error.estimatedCostUsd!==undefined?{estimatedCostUsd:error.estimatedCostUsd}:{})};
      }
      await this.store.finish(attempt.id, 'failed', {...telemetry,error: error instanceof Error ? error.message : 'Falha na análise.', completedAt: new Date().toISOString() }, attempt.leaseToken);
    }
    return true;
  }
}
