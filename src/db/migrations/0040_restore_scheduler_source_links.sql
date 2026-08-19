-- Migration 0038 installed a temporary fence while Eco Audit was deliberately
-- delinked from Scheduler. Eco Audit and Solar Sense remain supported backend
-- sources; only the portal's new-work selector hides them. Remove the write
-- fence without rewriting cancelled events or notification history because the
-- database does not retain enough provenance to identify rows cancelled by the
-- earlier cutover safely.
DROP TRIGGER IF EXISTS "portal_schedule_events_active_source_fence_trigger"
ON "portal_schedule_events";--> statement-breakpoint
DROP FUNCTION IF EXISTS "scheduler_active_source_fence"();
