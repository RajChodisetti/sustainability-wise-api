CREATE OR REPLACE FUNCTION "ih_reject_installation_id_update"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
	IF OLD."installation_id" IS DISTINCT FROM NEW."installation_id" THEN
		RAISE EXCEPTION 'InstallHub canonical child ownership is immutable'
			USING ERRCODE = '23514',
				CONSTRAINT = 'ih_canonical_child_installation_immutable';
	END IF;
	RETURN NEW;
END;
$$;
--> statement-breakpoint

CREATE TRIGGER "ih_grid_supplies_installation_id_immutable"
	BEFORE UPDATE OF "installation_id" ON "ih_grid_supplies"
	FOR EACH ROW EXECUTE FUNCTION "ih_reject_installation_id_update"();
--> statement-breakpoint
CREATE TRIGGER "ih_zones_installation_id_immutable"
	BEFORE UPDATE OF "installation_id" ON "ih_zones"
	FOR EACH ROW EXECUTE FUNCTION "ih_reject_installation_id_update"();
--> statement-breakpoint
CREATE TRIGGER "ih_electrical_assets_installation_id_immutable"
	BEFORE UPDATE OF "installation_id" ON "ih_electrical_assets"
	FOR EACH ROW EXECUTE FUNCTION "ih_reject_installation_id_update"();
--> statement-breakpoint
CREATE TRIGGER "ih_site_assets_installation_id_immutable"
	BEFORE UPDATE OF "installation_id" ON "ih_site_assets"
	FOR EACH ROW EXECUTE FUNCTION "ih_reject_installation_id_update"();
--> statement-breakpoint
CREATE TRIGGER "ih_meter_devices_installation_id_immutable"
	BEFORE UPDATE OF "installation_id" ON "ih_meter_devices"
	FOR EACH ROW EXECUTE FUNCTION "ih_reject_installation_id_update"();
--> statement-breakpoint
CREATE TRIGGER "ih_meter_channels_installation_id_immutable"
	BEFORE UPDATE OF "installation_id" ON "ih_meter_channels"
	FOR EACH ROW EXECUTE FUNCTION "ih_reject_installation_id_update"();
--> statement-breakpoint
CREATE TRIGGER "ih_measurement_assignments_installation_id_immutable"
	BEFORE UPDATE OF "installation_id" ON "ih_measurement_assignments"
	FOR EACH ROW EXECUTE FUNCTION "ih_reject_installation_id_update"();
--> statement-breakpoint
CREATE TRIGGER "ih_assignment_channels_installation_id_immutable"
	BEFORE UPDATE OF "installation_id" ON "ih_measurement_assignment_channels"
	FOR EACH ROW EXECUTE FUNCTION "ih_reject_installation_id_update"();
--> statement-breakpoint
CREATE TRIGGER "ih_form_submissions_installation_id_immutable"
	BEFORE UPDATE OF "installation_id" ON "ih_form_submissions"
	FOR EACH ROW EXECUTE FUNCTION "ih_reject_installation_id_update"();
--> statement-breakpoint
CREATE TRIGGER "ih_display_code_claims_installation_id_immutable"
	BEFORE UPDATE OF "installation_id" ON "ih_display_code_claims"
	FOR EACH ROW EXECUTE FUNCTION "ih_reject_installation_id_update"();
--> statement-breakpoint
CREATE TRIGGER "ih_completion_idempotency_installation_id_immutable"
	BEFORE UPDATE OF "installation_id" ON "ih_completion_idempotency"
	FOR EACH ROW EXECUTE FUNCTION "ih_reject_installation_id_update"();
