/** current_stage_id é a única autoridade; os valores JSON são projeções legadas. */
export function resolveCurrentStageId(
  canonicalStageId?: string | null,
  configuredFallback?: string | null,
): string {
  return canonicalStageId?.trim()
    || configuredFallback?.trim()
    || "";
}
