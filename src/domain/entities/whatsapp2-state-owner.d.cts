export function selectWhatsApp2StateOwner<T extends {
  id: string;
  current_stage_id?: string | null;
  ai_auto_respond?: boolean | null;
  autopilot_status?: string | null;
  stage_completed_rules?: Record<string, any> | null;
  last_message_at?: string | null;
}>(rows: readonly T[]): T | undefined;
