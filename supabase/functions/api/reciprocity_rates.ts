/** USD por milhão de tokens. Fontes oficiais consultadas em 03/11/2026. */
export const RECIPROCITY_TARIFF_VERSION = 'openai-standard-2026-11-03';
export const RECIPROCITY_TARIFF_SOURCES = {
  'gpt-6-luna': 'https://developers.openai.com/api/docs/models/gpt-6-luna',
  'gpt-6.1-terra': 'https://developers.openai.com/api/docs/models/gpt-6.1-terra',
  'gpt-6.1-sol': 'https://developers.openai.com/api/docs/models/gpt-6.1-sol',
};
export type ReciprocityTokenRates = { input: number; output: number; cachedInput?: number };
export const RECIPROCITY_STANDARD_RATES: Record<string, ReciprocityTokenRates> = {
  'gpt-6-luna': { input: 0.10, output: 0.50, cachedInput: 0.01 },
  'gpt-6.1-terra': { input: 1.00, output: 5.00, cachedInput: 0.05 },
  'gpt-6.1-sol': { input: 2.00, output: 10.00, cachedInput: 0.10 },
};
