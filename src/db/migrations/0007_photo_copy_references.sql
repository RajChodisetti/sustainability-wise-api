CREATE TABLE IF NOT EXISTS "photo_copy_references" (
	"id" text PRIMARY KEY NOT NULL,
	"app" text NOT NULL,
	"photo_id" text NOT NULL,
	"target_parent_id" text NOT NULL,
	"target_entity_type" text NOT NULL,
	"target_entity_id" text NOT NULL,
	"target_field_name" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "photo_copy_references_photo_id_photo_registry_id_fk"
		FOREIGN KEY ("photo_id") REFERENCES "public"."photo_registry"("id")
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "photo_copy_references_target_unique"
	ON "photo_copy_references" USING btree (
		"app", "photo_id", "target_parent_id", "target_entity_id", "target_field_name"
	);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "photo_copy_references_photo_idx"
	ON "photo_copy_references" USING btree ("app", "photo_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "photo_copy_references_parent_idx"
	ON "photo_copy_references" USING btree ("app", "target_parent_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "photo_copy_references_entity_idx"
	ON "photo_copy_references" USING btree ("app", "target_entity_id");
--> statement-breakpoint

-- Existing copies predate explicit source identifiers. Scan only the known
-- photo-bearing columns; arbitrary notes/text can never create a grant.
WITH eco_records AS (
	SELECT z.audit_id AS target_parent_id, 'zone'::text AS target_entity_type,
		z.id AS target_entity_id,
		jsonb_build_object('photos', to_jsonb(z.photos)) AS photo_fields
	FROM ea_zones z WHERE z.deleted_at IS NULL
	UNION ALL
	SELECT r.audit_id, 'main_switchboard', r.id,
		jsonb_build_object('photo', r.photo, 'extraPhotos', to_jsonb(r.extra_photos))
	FROM ea_main_switchboards r WHERE r.deleted_at IS NULL
	UNION ALL
	SELECT r.audit_id, 'additional_switchboard', r.id,
		jsonb_build_object('photo', r.photo, 'extraPhotos', to_jsonb(r.extra_photos))
	FROM ea_additional_switchboards r WHERE r.deleted_at IS NULL
	UNION ALL
	SELECT r.audit_id, 'hvac_unit', r.id, jsonb_build_object(
		'photo', r.photo,
		'nameplatePhotos', r.nameplate_photos,
		'indoorUnitNameplatePhoto', r.indoor_unit_nameplate_photo,
		'controllerPhoto', r.controller_photo,
		'extraPhotos', to_jsonb(r.extra_photos)
	)
	FROM ea_hvac_units r WHERE r.deleted_at IS NULL
	UNION ALL
	SELECT r.audit_id, 'lighting_system', r.id, jsonb_build_object(
		'photo', r.photo,
		'fixturesPhoto', r.fixtures_photo,
		'mountingConstraintsPhoto', r.mounting_constraints_photo,
		'sensorsPhoto', r.sensors_photo,
		'extraPhotos', to_jsonb(r.extra_photos)
	)
	FROM ea_lighting_systems r WHERE r.deleted_at IS NULL
	UNION ALL
	SELECT r.audit_id, 'solar_pv', r.id, jsonb_build_object(
		'roofPhoto', r.roof_photo,
		'inverterLabelPhoto', r.inverter_label_photo,
		'electricityMeterPhoto', r.electricity_meter_photo,
		'additionalSolarSpacePhoto', r.additional_solar_space_photo,
		'switchboardPhoto', r.switchboard_photo,
		'extraPhotos', to_jsonb(r.extra_photos)
	)
	FROM ea_solar_pv r WHERE r.deleted_at IS NULL
	UNION ALL
	SELECT r.audit_id, 'forklift_charger', r.id, jsonb_build_object(
		'chargerPhoto', r.charger_photo,
		'chargerLabelPhoto', r.charger_label_photo,
		'electricConnectionPhoto', r.electric_connection_photo,
		'chargerSpacePhoto', r.charger_space_photo,
		'socketConnectionPhoto', r.socket_connection_photo,
		'extraPhotos', to_jsonb(r.extra_photos)
	)
	FROM ea_forklift_chargers r WHERE r.deleted_at IS NULL
	UNION ALL
	SELECT r.audit_id, 'hot_water_system', r.id, jsonb_build_object(
		'photo', r.photo,
		'additionalPhoto', r.additional_photo,
		'extraPhotos', to_jsonb(r.extra_photos)
	)
	FROM ea_hot_water_systems r WHERE r.deleted_at IS NULL
	UNION ALL
	SELECT r.audit_id, 'general_water', r.id, jsonb_build_object(
		'photos', to_jsonb(r.photos), 'extraPhotos', to_jsonb(r.extra_photos)
	)
	FROM ea_general_water r WHERE r.deleted_at IS NULL
	UNION ALL
	SELECT r.audit_id, 'general_electricity', r.id, jsonb_build_object(
		'photos', to_jsonb(r.photos), 'extraPhotos', to_jsonb(r.extra_photos)
	)
	FROM ea_general_electricity r WHERE r.deleted_at IS NULL
), eco_values AS (
	SELECT r.target_parent_id, r.target_entity_type, r.target_entity_id,
		v.target_field_name, v.uri
	FROM eco_records r
	CROSS JOIN LATERAL jsonb_each(r.photo_fields) f(field_name, field_value)
	CROSS JOIN LATERAL (
		SELECT f.field_name AS target_field_name, f.field_value #>> '{}' AS uri
		WHERE jsonb_typeof(f.field_value) = 'string'
		UNION ALL
		SELECT format('%s[%s]', f.field_name, e.ordinality - 1), e.value #>> '{}'
		FROM jsonb_array_elements(
			CASE WHEN jsonb_typeof(f.field_value) = 'array' THEN f.field_value ELSE '[]'::jsonb END
		) WITH ORDINALITY e(value, ordinality)
		WHERE jsonb_typeof(e.value) = 'string'
	) v
), eco_references AS (
	SELECT v.target_parent_id, v.target_entity_type, v.target_entity_id,
		v.target_field_name, (matched.parts)[1] AS photo_id
	FROM eco_values v
	CROSS JOIN LATERAL regexp_matches(
		lower(v.uri),
		'([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})',
		'g'
	) matched(parts)
), eco_target_actors AS (
	-- The earliest server-authored version identifies the actor who introduced
	-- the historical target. Select the earliest version first, then reject a
	-- null actor so a later updater can never become substitute provenance.
	SELECT targets.target_parent_id,
		first_version.created_by_user_id AS actor_user_id
	FROM (
		SELECT DISTINCT target_parent_id
		FROM eco_references
	) targets
	CROSS JOIN LATERAL (
		SELECT rv.created_by_user_id
		FROM record_versions rv
		WHERE rv.app = 'ecoaudit'
			AND rv.entity_type = 'audit'
			AND rv.entity_id = targets.target_parent_id
		ORDER BY rv.version_number ASC, rv.created_at ASC, rv.id ASC
		LIMIT 1
	) first_version
	WHERE first_version.created_by_user_id IS NOT NULL
)
INSERT INTO photo_copy_references (
	id, app, photo_id, target_parent_id, target_entity_type,
	target_entity_id, target_field_name
)
SELECT
	md5(concat_ws(':', 'ecoaudit', p.id, r.target_parent_id, r.target_entity_id, r.target_field_name)),
	'ecoaudit', p.id, r.target_parent_id, r.target_entity_type,
	r.target_entity_id, r.target_field_name
FROM eco_references r
JOIN photo_registry p
	ON p.id = r.photo_id AND r.target_parent_id <> p.parent_id
JOIN ea_audits a
	ON a.id = r.target_parent_id AND a.deleted_at IS NULL
JOIN ea_audits source_a
	ON source_a.id = p.parent_id AND source_a.deleted_at IS NULL
JOIN eco_target_actors actor
	ON actor.target_parent_id = r.target_parent_id
WHERE p.app = 'ecoaudit' AND p.status = 'confirmed' AND p.storage_key IS NOT NULL
	AND (
		a.created_by_user_id = actor.actor_user_id
		OR a.assigned_inspector_user_id = actor.actor_user_id
	)
	AND (
		source_a.created_by_user_id = actor.actor_user_id
		OR source_a.assigned_inspector_user_id = actor.actor_user_id
	)
ON CONFLICT DO NOTHING;
--> statement-breakpoint

WITH solar_values AS (
	SELECT s.id AS target_parent_id, 'site'::text AS target_entity_type,
		s.id AS target_entity_id,
		format('appendix_items[%s].uri', item.ordinality - 1) AS target_field_name,
		item.value ->> 'uri' AS uri
	FROM ss_sites s
	CROSS JOIN LATERAL jsonb_array_elements(
		CASE WHEN jsonb_typeof(s.appendix_items) = 'array' THEN s.appendix_items ELSE '[]'::jsonb END
	) WITH ORDINALITY item(value, ordinality)
	WHERE s.deleted_at IS NULL AND item.value ->> 'type' = 'image'
	UNION ALL
	SELECT r.site_id, 'rooftop_assessment', r.id, v.target_field_name, v.uri
	FROM ss_rooftop_assessments r
	CROSS JOIN LATERAL (VALUES
		('aerial_photo_uri'::text, r.aerial_photo_uri),
		('msb_photo_uri'::text, r.msb_photo_uri)
	) v(target_field_name, uri)
	WHERE r.deleted_at IS NULL AND r.site_id IS NOT NULL
	UNION ALL
	SELECT r.site_id, 'rooftop_assessment', r.id,
		format('switchboards[%s].photoUri', sb.ordinality - 1),
		coalesce(sb.value ->> 'photoUri', sb.value ->> 'photo_uri')
	FROM ss_rooftop_assessments r
	CROSS JOIN LATERAL jsonb_array_elements(
		CASE WHEN jsonb_typeof(r.switchboards) = 'array' THEN r.switchboards ELSE '[]'::jsonb END
	) WITH ORDINALITY sb(value, ordinality)
	WHERE r.deleted_at IS NULL AND r.site_id IS NOT NULL
	UNION ALL
	SELECT r.site_id, 'rooftop_assessment', r.id,
		format('other_considerations[%s].photoUris[%s]', oc.ordinality - 1, ph.ordinality - 1),
		ph.value #>> '{}'
	FROM ss_rooftop_assessments r
	CROSS JOIN LATERAL jsonb_array_elements(
		CASE WHEN jsonb_typeof(r.other_considerations) = 'array' THEN r.other_considerations ELSE '[]'::jsonb END
	) WITH ORDINALITY oc(value, ordinality)
	CROSS JOIN LATERAL jsonb_array_elements(
		CASE
			WHEN jsonb_typeof(coalesce(oc.value -> 'photoUris', oc.value -> 'photo_uris')) = 'array'
			THEN coalesce(oc.value -> 'photoUris', oc.value -> 'photo_uris')
			ELSE '[]'::jsonb
		END
	) WITH ORDINALITY ph(value, ordinality)
	WHERE r.deleted_at IS NULL AND r.site_id IS NOT NULL AND jsonb_typeof(ph.value) = 'string'
	UNION ALL
	SELECT r.site_id, 'rooftop_assessment', r.id,
		format('additional_photos[%s]', ph.ordinality - 1), ph.value #>> '{}'
	FROM ss_rooftop_assessments r
	CROSS JOIN LATERAL jsonb_array_elements(
		CASE WHEN jsonb_typeof(r.additional_photos) = 'array' THEN r.additional_photos ELSE '[]'::jsonb END
	) WITH ORDINALITY ph(value, ordinality)
	WHERE r.deleted_at IS NULL AND r.site_id IS NOT NULL AND jsonb_typeof(ph.value) = 'string'
), solar_references AS (
	SELECT v.target_parent_id, v.target_entity_type, v.target_entity_id,
		v.target_field_name, (matched.parts)[1] AS photo_id
	FROM solar_values v
	CROSS JOIN LATERAL regexp_matches(
		lower(v.uri),
		'([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})',
		'g'
	) matched(parts)
), solar_target_actors AS (
	SELECT targets.target_parent_id,
		first_version.created_by_user_id AS actor_user_id
	FROM (
		SELECT DISTINCT target_parent_id
		FROM solar_references
	) targets
	CROSS JOIN LATERAL (
		SELECT rv.created_by_user_id
		FROM record_versions rv
		WHERE rv.app = 'solarsense'
			AND rv.entity_type = 'site'
			AND rv.entity_id = targets.target_parent_id
		ORDER BY rv.version_number ASC, rv.created_at ASC, rv.id ASC
		LIMIT 1
	) first_version
	WHERE first_version.created_by_user_id IS NOT NULL
)
INSERT INTO photo_copy_references (
	id, app, photo_id, target_parent_id, target_entity_type,
	target_entity_id, target_field_name
)
SELECT
	md5(concat_ws(':', 'solarsense', p.id, r.target_parent_id, r.target_entity_id, r.target_field_name)),
	'solarsense', p.id, r.target_parent_id, r.target_entity_type,
	r.target_entity_id, r.target_field_name
FROM solar_references r
JOIN photo_registry p
	ON p.id = r.photo_id AND r.target_parent_id <> p.parent_id
JOIN ss_sites s
	ON s.id = r.target_parent_id AND s.deleted_at IS NULL
JOIN ss_sites source_s
	ON source_s.id = p.parent_id AND source_s.deleted_at IS NULL
JOIN solar_target_actors actor
	ON actor.target_parent_id = r.target_parent_id
WHERE p.app = 'solarsense' AND p.status = 'confirmed' AND p.storage_key IS NOT NULL
	AND s.created_by_user_id = actor.actor_user_id
	AND source_s.created_by_user_id = actor.actor_user_id
ON CONFLICT DO NOTHING;
