-- The mobile domain model has always exposed this lighting image as
-- switchboardControlsPhoto. Canonicalize persisted metadata and registry field
-- names while retaining the existing physical equipment column.
UPDATE "ea_lighting_systems"
SET "photo_descs" =
  ("photo_descs" - 'switchboardPhotoNotes')
  || CASE
    WHEN "photo_descs" ? 'switchboardControlsPhoto' THEN '{}'::jsonb
    ELSE jsonb_build_object(
      'switchboardControlsPhoto',
      "photo_descs" -> 'switchboardPhotoNotes'
    )
  END
WHERE "photo_descs" ? 'switchboardPhotoNotes';
--> statement-breakpoint
UPDATE "photo_registry"
SET "field_name" = 'switchboardControlsPhoto'
WHERE "app" = 'ecoaudit'
  AND "entity_type" = 'lighting_system'
  AND "field_name" = 'switchboardPhotoNotes';
--> statement-breakpoint
DELETE FROM "photo_copy_references" AS legacy
USING "photo_copy_references" AS canonical
WHERE legacy."app" = 'ecoaudit'
  AND legacy."target_entity_type" = 'lighting_system'
  AND legacy."target_field_name" = 'switchboardPhotoNotes'
  AND canonical."app" = legacy."app"
  AND canonical."photo_id" = legacy."photo_id"
  AND canonical."target_parent_id" = legacy."target_parent_id"
  AND canonical."target_entity_id" = legacy."target_entity_id"
  AND canonical."target_field_name" = 'switchboardControlsPhoto';
--> statement-breakpoint
UPDATE "photo_copy_references"
SET "target_field_name" = 'switchboardControlsPhoto'
WHERE "app" = 'ecoaudit'
  AND "target_entity_type" = 'lighting_system'
  AND "target_field_name" = 'switchboardPhotoNotes';
