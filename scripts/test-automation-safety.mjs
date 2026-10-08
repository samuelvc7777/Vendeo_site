import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const root=fileURLToPath(new URL('../',import.meta.url));
const tests=[
  'tests/test_whatsapp2_account_scope.mjs',
  'tests/test_whatsapp2_autopilot_activation.mjs',
  'tests/test_whatsapp2_canonical_identity.mjs',
  'tests/test_whatsapp2_canonical_state_owner.mjs',
  'tests/test_whatsapp2_conversation_identity.mjs',
  'tests/test_whatsapp2_delivery_queue.mjs',
  'tests/test_whatsapp2_history_preservation.mjs',
  'tests/test_whatsapp2_latest_message_sync.mjs',
  'tests/test_whatsapp2_outbox_recipient.mjs',
  'tests/test_whatsapp2_view_reconciliation.mjs',
  'tests/test_autopilot_completed_schedule_activation.mjs',
  'tests/test_brain_stage_commit_snapshot.mjs',
  'tests/test_whatsapp2_delivery_failure_boundaries.mjs',
  'tests/test_outbox_reconciliation_evidence.mjs',
  'tests/test_whatsapp2_delivery_poll_failure.mjs',
  'tests/test_outbox_finalization_failure.mjs',
  'tests/test_durable_dispatch_persistence_failure.mjs',
  'tests/test_provider_confirmation_required.mjs',
  'tests/test_confirmed_action_projection_recovery.mjs',
  'tests/test_brain_late_recovery_regression.mjs',
  'tests/test_channel_transfer_deterministic.mjs',
  'tests/test_tinder_sync_service.mjs',
  'scripts/test-manual-retry-once.mjs',
];
const result=spawnSync(process.execPath,['--import','./scripts/register-loader.mjs','--test',...tests],{cwd:root,stdio:'inherit'});
if(result.error)throw result.error;
process.exitCode=result.status??1;
