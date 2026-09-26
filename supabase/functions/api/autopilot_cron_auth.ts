export async function isAuthorizedAutopilotCron(
  supabase: { rpc: (name: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: unknown }> },
  suppliedToken: string | null,
): Promise<boolean> {
  if (!suppliedToken) return false;

  const { data, error } = await supabase.rpc("verify_autopilot_cron_token", {
    p_token: suppliedToken,
  });

  return !error && data === true;
}
