/**
 * Roteamento tecnico de indisponibilidade de capacidade do provider.
 * Nao analisa mensagens, objetivos, fontes nem conteudo produzido pelo Brian.
 */
export function shouldRetryFlexCapacityOnStandard(
  errorMessage: string,
  configuredTier: string,
  alreadyRetried: boolean,
): boolean {
  return configuredTier === "flex"
    && !alreadyRetried
    && /(?:^|\D)429(?:\D|$)/.test(errorMessage)
    && /Flex processing is temporarily unavailable/i.test(errorMessage);
}
