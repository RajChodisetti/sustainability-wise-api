import { closeDb, sql } from '../src/db/client.js';
import {
  planLegacyInstallationBackfill,
  type ExistingGridRow,
  type ExistingCanonicalMeter,
  type ExistingCanonicalAssignment,
  type LegacyBoardRow,
  type LegacyFormRow,
  type LegacySiteAssetRow,
} from '../src/routes/installhub/legacyBackfill.js';

type Options = {
  apply: boolean;
  installationId: string | null;
  validateConstraints: boolean;
};

function option(name: string): string | null {
  const prefix = `--${name}=`;
  const value = process.argv.find((argument) => argument.startsWith(prefix));
  return value ? value.slice(prefix.length).trim() || null : null;
}

function options(): Options {
  const apply = process.argv.includes('--apply');
  const validateConstraints = process.argv.includes('--validate-constraints');
  if (validateConstraints && !apply) {
    throw new Error('--validate-constraints requires --apply');
  }
  return {
    apply,
    installationId: option('installation-id'),
    validateConstraints,
  };
}

async function loadPlan(installationId: string, siteCode: string, expectedTreeRevision: number) {
  const [grids, boards, siteAssets, forms, meterRows, channelRows, assignmentRows] = await Promise.all([
    sql<ExistingGridRow[]>`
      SELECT id, is_default AS "isDefault", nmi, external_key AS "externalKey", deleted_at AS "deletedAt"
      FROM ih_grid_supplies
      WHERE installation_id = ${installationId}
      ORDER BY id
    `,
    sql<LegacyBoardRow[]>`
      SELECT
        id,
        installation_id AS "installationId",
        asset_type AS "assetType",
        display_code AS "displayCode",
        electrical_parent_id AS "electricalParentId",
        electrical_parent_tbc AS "electricalParentTbc",
        site_nmi AS "siteNmi",
        meter_present AS "meterPresent",
        meters,
        created_at AS "createdAt",
        updated_at AS "updatedAt",
        deleted_at AS "deletedAt"
      FROM ih_electrical_assets
      WHERE installation_id = ${installationId}
      ORDER BY id
    `,
    sql<LegacySiteAssetRow[]>`
      SELECT
        id,
        installation_id AS "installationId",
        asset_type AS "assetType",
        display_code AS "displayCode",
        electrical_board_id AS "electricalBoardId",
        electrical_board_tbc AS "electricalBoardTbc",
        meter_present AS "meterPresent",
        meter_switchboard_id AS "meterSwitchboardId",
        meter_switchboard_tbc AS "meterSwitchboardTbc",
        meter_channels AS "meterChannels",
        created_at AS "createdAt",
        updated_at AS "updatedAt",
        deleted_at AS "deletedAt"
      FROM ih_site_assets
      WHERE installation_id = ${installationId}
      ORDER BY id
    `,
    sql<LegacyFormRow[]>`
      SELECT
        id,
        form_type AS "formType",
        status,
        board_id AS "boardId",
        meter_id AS "meterId",
        answers
      FROM ih_form_submissions
      WHERE installation_id = ${installationId} AND deleted_at IS NULL
      ORDER BY id
    `,
    sql<Array<{
      id: string;
      installedOnBoardId: string;
      deviceModel: ExistingCanonicalMeter['deviceModel'];
      deviceFamily: ExistingCanonicalMeter['deviceFamily'];
      customManufacturerName: string | null;
      customModelName: string | null;
      deviceNumber: string | null;
      serialNumber: string;
      displayCode: string;
    }>>`
      SELECT
        id,
        installed_on_board_id AS "installedOnBoardId",
        device_family AS "deviceFamily",
        device_model AS "deviceModel",
        custom_manufacturer_name AS "customManufacturerName",
        custom_model_name AS "customModelName",
        device_number AS "deviceNumber",
        serial_number AS "serialNumber",
        display_code AS "displayCode"
      FROM ih_meter_devices
      WHERE installation_id = ${installationId}
      ORDER BY id
    `,
    sql<Array<{
      id: string;
      meterId: string;
      ordinal: number;
      purpose: ExistingCanonicalMeter['channels'][number]['purpose'];
      phaseLabel: string | null;
      loadTypeCode: ExistingCanonicalMeter['channels'][number]['loadTypeCode'];
      customLoadTypeName: string | null;
      sensorRating: string | null;
      description: string | null;
      capabilities: Record<string, unknown>;
    }>>`
      SELECT
        id, meter_id AS "meterId", ordinal, purpose,
        phase_label AS "phaseLabel", load_type_code AS "loadTypeCode",
        custom_load_type_name AS "customLoadTypeName",
        sensor_rating AS "sensorRating", description, capabilities
      FROM ih_meter_channels
      WHERE installation_id = ${installationId}
      ORDER BY id
    `,
    sql<ExistingCanonicalAssignment[]>`
      SELECT
        assignment.id,
        assignment.meter_id AS "meterId",
        COALESCE(
          array_agg(link.channel_id ORDER BY link.position)
            FILTER (WHERE link.channel_id IS NOT NULL),
          ARRAY[]::text[]
        ) AS "channelIds",
        assignment.target_kind AS "targetKind",
        assignment.target_site_asset_id AS "targetSiteAssetId",
        assignment.direction,
        assignment.status,
        assignment.deleted_at AS "deletedAt"
      FROM ih_measurement_assignments assignment
      LEFT JOIN ih_measurement_assignment_channels link
        ON link.installation_id = assignment.installation_id
        AND link.assignment_id = assignment.id
      WHERE assignment.installation_id = ${installationId}
      GROUP BY assignment.id
      ORDER BY assignment.id
    `,
  ]);
  const existingMeters: ExistingCanonicalMeter[] = meterRows.map((meter) => ({
    ...meter,
    channels: channelRows.filter((channel) => channel.meterId === meter.id).map((channel) => ({
      id: channel.id,
      ordinal: channel.ordinal,
      purpose: channel.purpose,
      phaseLabel: channel.phaseLabel,
      loadTypeCode: channel.loadTypeCode,
      customLoadTypeName: channel.customLoadTypeName,
      sensorRating: channel.sensorRating,
      description: channel.description,
      capabilities: channel.capabilities,
    })),
  }));
  return planLegacyInstallationBackfill({
    installationId,
    siteCode,
    expectedTreeRevision,
    grids,
    boards,
    siteAssets,
    forms,
    existingMeters,
    existingChannelIds: channelRows.map((channel) => channel.id),
    existingAssignments: assignmentRows,
  });
}

async function applyPlan(plan: Awaited<ReturnType<typeof loadPlan>>): Promise<{
  photoRegistryRowsReconciled: number;
  photoCopyRowsReconciled: number;
  promoted: boolean;
}> {
  return sql.begin(async (tx) => {
    const [locked] = await tx<Array<{ treeRevision: number; treeSchemaVersion: number }>>`
      SELECT tree_revision AS "treeRevision", tree_schema_version AS "treeSchemaVersion"
      FROM ih_installations
      WHERE id = ${plan.installationId}
      FOR UPDATE
    `;
    if (!locked) throw new Error(`Installation ${plan.installationId} disappeared before backfill apply`);
    if (locked.treeRevision !== plan.expectedTreeRevision) {
      throw new Error(
        `STALE_BACKFILL_PLAN:${plan.installationId}:expected=${plan.expectedTreeRevision}:actual=${locked.treeRevision}`,
      );
    }
    let domainChanges = 0;
    if (plan.deterministicGrid) {
      const grid = plan.deterministicGrid;
      const inserted = await tx`
        INSERT INTO ih_grid_supplies (
          id, installation_id, name, is_default, nmi, sync_status,
          created_at, updated_at
        ) VALUES (
          ${grid.id}, ${plan.installationId}, ${grid.name}, true, ${grid.nmi},
          'synced', now(), now()
        )
        ON CONFLICT (id) DO NOTHING
        RETURNING id
      `;
      domainChanges += inserted.length;
    }
    for (const board of plan.boardUpdates) {
      const updated = await tx`
        UPDATE ih_electrical_assets
        SET
          type_code = ${board.typeCode},
          custom_type_name = ${board.customTypeName},
          source_kind = ${board.sourceKind},
          grid_supply_id = NULL,
          electrical_parent_id = ${board.electricalParentId},
          electrical_parent_tbc = ${board.electricalParentTbc},
          generated_display_code = display_code,
          display_code_overridden = ${board.displayCodeOverridden},
          display_code_rule_version = 1,
          display_code_override_reason = CASE
            WHEN ${board.displayCodeOverridden} THEN 'Preserved from schema-v1 backfill'
            ELSE NULL
          END
        WHERE installation_id = ${plan.installationId} AND id = ${board.id}
          AND ROW(
            type_code, custom_type_name, source_kind, grid_supply_id,
            electrical_parent_id, electrical_parent_tbc, generated_display_code,
            display_code_overridden, display_code_rule_version
          ) IS DISTINCT FROM ROW(
            ${board.typeCode}, ${board.customTypeName}, ${board.sourceKind}, NULL,
            ${board.electricalParentId}, ${board.electricalParentTbc}, display_code,
            ${board.displayCodeOverridden}, 1
          )
        RETURNING id
      `;
      domainChanges += updated.length;
    }
    for (const asset of plan.siteAssetUpdates) {
      const updated = await tx`
        UPDATE ih_site_assets
        SET
          type_code = ${asset.typeCode},
          custom_type_name = ${asset.customTypeName},
          source_kind = ${asset.sourceKind},
          grid_supply_id = NULL,
          electrical_board_id = ${asset.electricalBoardId},
          electrical_board_tbc = ${asset.electricalBoardTbc},
          generated_display_code = display_code,
          display_code_overridden = ${asset.displayCodeOverridden},
          display_code_rule_version = 1,
          display_code_override_reason = CASE
            WHEN ${asset.displayCodeOverridden} THEN 'Preserved from schema-v1 backfill'
            ELSE NULL
          END,
          metering_state_kind = ${asset.meteringStateKind},
          measurement_assignment_ids = ${JSON.stringify(asset.measurementAssignmentIds)}::jsonb
        WHERE installation_id = ${plan.installationId} AND id = ${asset.id}
          AND ROW(
            type_code, custom_type_name, source_kind, grid_supply_id,
            electrical_board_id, electrical_board_tbc, generated_display_code,
            display_code_overridden, display_code_rule_version,
            metering_state_kind, measurement_assignment_ids
          ) IS DISTINCT FROM ROW(
            ${asset.typeCode}, ${asset.customTypeName}, ${asset.sourceKind}, NULL,
            ${asset.electricalBoardId}, ${asset.electricalBoardTbc}, display_code,
            ${asset.displayCodeOverridden}, 1, ${asset.meteringStateKind},
            ${JSON.stringify(asset.measurementAssignmentIds)}::jsonb
          )
        RETURNING id
      `;
      domainChanges += updated.length;
    }
    for (const claim of plan.displayClaims) {
      const inserted = await tx`
        INSERT INTO ih_display_code_claims (
          id, installation_id, entity_type, entity_id, type_code, sequence,
          display_code, normalized_display_code, generated, rule_version
        ) VALUES (
          ${claim.id}, ${plan.installationId}, ${claim.entityType}, ${claim.entityId},
          ${claim.typeCode}, ${claim.sequence}, ${claim.displayCode}, ${claim.normalizedDisplayCode},
          ${claim.generated}, 1
        )
        ON CONFLICT DO NOTHING
        RETURNING id
      `;
      domainChanges += inserted.length;
    }

    let photoRegistryRowsReconciled = 0;
    let photoCopyRowsReconciled = 0;
    for (const meter of plan.meterDevices) {
      const meterClaim = plan.displayClaims.find((claim) => (
        claim.entityType === 'meter' && claim.entityId === meter.id
      ));
      const insertedMeter = await tx`
        INSERT INTO ih_meter_devices (
          id, installation_id, installed_on_board_id, device_family,
          device_model, custom_manufacturer_name, custom_model_name,
          device_number, serial_number, display_code, generated_display_code,
          display_code_overridden, display_code_rule_version,
          display_code_override_reason, ww_photos, notes, sync_status,
          created_at, updated_at, deleted_at
        ) VALUES (
          ${meter.id}, ${meter.installationId}, ${meter.installedOnBoardId},
          ${meter.deviceFamily}, ${meter.deviceModel}, ${meter.customManufacturerName},
          ${meter.customModelName}, ${meter.deviceNumber}, ${meter.serialNumber},
          ${meter.displayCode}, ${meter.displayCode}, ${!meterClaim?.generated}, 1,
          ${meterClaim?.generated ? null : 'Preserved from schema-v1 backfill'},
          ${JSON.stringify(meter.wwPhotos)}::jsonb, ${meter.notes},
          'synced', ${meter.createdAt}, ${meter.updatedAt}, ${meter.deletedAt}
        )
        ON CONFLICT (id) DO NOTHING
        RETURNING id
      `;
      domainChanges += insertedMeter.length;
      for (const channel of meter.channels) {
        const insertedChannel = await tx`
          INSERT INTO ih_meter_channels (
            id, installation_id, meter_id, ordinal, phase_label, purpose,
            load_type_code, custom_load_type_name, sensor_rating, description,
            capabilities, sync_status, created_at, updated_at, deleted_at
          ) VALUES (
            ${channel.id}, ${meter.installationId}, ${meter.id}, ${channel.ordinal},
            ${channel.phaseLabel}, ${channel.purpose}, ${channel.loadTypeCode},
            ${channel.customLoadTypeName}, ${channel.sensorRating}, ${channel.description},
            ${JSON.stringify(channel.capabilities)}::jsonb, 'synced', ${meter.createdAt},
            ${meter.updatedAt}, ${meter.deletedAt}
          )
          ON CONFLICT (id) DO NOTHING
          RETURNING id
        `;
        domainChanges += insertedChannel.length;
      }
    }
    for (const reconciliation of plan.photoReconciliations) {
      const oldPrefix = `meters[${reconciliation.legacyMeterIndex}].wwPhotos.`;
      const registryRows = await tx`
        UPDATE photo_registry
        SET
          entity_type = 'meter_device',
          entity_id = ${reconciliation.meterId},
          field_name = 'wwPhotos.' || substring(field_name FROM ${oldPrefix.length + 1})
        WHERE app = 'installhub'
          AND parent_id = ${plan.installationId}
          AND entity_type = 'electrical_asset'
          AND entity_id = ${reconciliation.legacyBoardId}
          AND field_name LIKE ${`${oldPrefix}%`}
        RETURNING id
      `;
      photoRegistryRowsReconciled += registryRows.length;
      domainChanges += registryRows.length;
      const copyRows = await tx`
        UPDATE photo_copy_references
        SET
          target_entity_type = 'meter_device',
          target_entity_id = ${reconciliation.meterId},
          target_field_name = 'wwPhotos.' || substring(target_field_name FROM ${oldPrefix.length + 1})
        WHERE app = 'installhub'
          AND target_parent_id = ${plan.installationId}
          AND target_entity_type = 'electrical_asset'
          AND target_entity_id = ${reconciliation.legacyBoardId}
          AND target_field_name LIKE ${`${oldPrefix}%`}
        RETURNING id
      `;
      photoCopyRowsReconciled += copyRows.length;
      domainChanges += copyRows.length;
    }
    for (const assignment of plan.measurementAssignments) {
      await tx`
        INSERT INTO ih_measurement_assignments (
          id, installation_id, meter_id, phase_mode, target_kind,
          target_site_asset_id, direction, status, sync_status, created_at, updated_at
        ) VALUES (
          ${assignment.id}, ${plan.installationId}, ${assignment.meterId},
          ${assignment.phaseMode}, 'SITE_ASSET', ${assignment.targetSiteAssetId},
          ${assignment.direction}, 'CONFIRMED', 'synced', now(), now()
        )
        ON CONFLICT (id) DO UPDATE SET
          meter_id = EXCLUDED.meter_id,
          phase_mode = EXCLUDED.phase_mode,
          target_kind = EXCLUDED.target_kind,
          target_board_id = NULL,
          target_site_asset_id = EXCLUDED.target_site_asset_id,
          target_grid_supply_id = NULL,
          direction = EXCLUDED.direction,
          status = EXCLUDED.status,
          deleted_at = NULL
      `;
      domainChanges += 1;
      await tx`
        DELETE FROM ih_measurement_assignment_channels
        WHERE installation_id = ${plan.installationId} AND assignment_id = ${assignment.id}
      `;
      for (let position = 0; position < assignment.channelIds.length; position += 1) {
        const channelId = assignment.channelIds[position];
        await tx`
          INSERT INTO ih_measurement_assignment_channels (
            id, installation_id, assignment_id, meter_id, channel_id, position
          ) VALUES (
            ${`${assignment.id}:${channelId}`}, ${plan.installationId}, ${assignment.id},
            ${assignment.meterId}, ${channelId}, ${position}
          )
        `;
      }
    }
    for (const form of plan.formUpdates) {
      const updated = await tx`
        UPDATE ih_form_submissions
        SET meter_id = ${form.meterId}
        WHERE installation_id = ${plan.installationId} AND id = ${form.id} AND meter_id IS NULL
        RETURNING id
      `;
      domainChanges += updated.length;
    }
    const promoted = plan.promotable && locked.treeSchemaVersion < 2;
    if (domainChanges > 0 || promoted) {
      const revised = await tx`
        UPDATE ih_installations
        SET
          tree_schema_version = CASE WHEN ${plan.promotable} THEN 2 ELSE tree_schema_version END,
          tree_revision = tree_revision + 1,
          sync_status = 'synced',
          updated_at = now()
        WHERE id = ${plan.installationId}
          AND tree_revision = ${plan.expectedTreeRevision}
        RETURNING id
      `;
      if (revised.length !== 1) throw new Error(`STALE_BACKFILL_PLAN:${plan.installationId}`);
    }
    return {
      photoRegistryRowsReconciled,
      photoCopyRowsReconciled,
      promoted,
    };
  });
}

async function validateInstallHubConstraints(): Promise<Array<{
  tableName: string;
  constraintName: string;
  status: 'validated' | 'failed';
  error?: string;
}>> {
  const constraints = await sql<Array<{ tableName: string; constraintName: string }>>`
    SELECT
      conrelid::regclass::text AS "tableName",
      conname AS "constraintName"
    FROM pg_constraint
    WHERE NOT convalidated AND conname LIKE 'ih\\_%' ESCAPE '\\'
    ORDER BY conrelid::regclass::text, conname
  `;
  const results: Array<{
    tableName: string;
    constraintName: string;
    status: 'validated' | 'failed';
    error?: string;
  }> = [];
  for (const constraint of constraints) {
    if (
      !/^[a-z0-9_]+$/i.test(constraint.tableName)
      || !/^[a-z0-9_]+$/i.test(constraint.constraintName)
    ) {
      throw new Error('Unsafe constraint identifier returned by PostgreSQL');
    }
    try {
      await sql.unsafe(
        `ALTER TABLE "${constraint.tableName}" VALIDATE CONSTRAINT "${constraint.constraintName}"`,
      );
      results.push({ ...constraint, status: 'validated' });
    } catch (error) {
      results.push({
        ...constraint,
        status: 'failed',
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return results;
}

async function main(): Promise<void> {
  const selected = options();
  const installations = selected.installationId
    ? await sql<Array<{ id: string; siteCode: string; treeSchemaVersion: number; treeRevision: number }>>`
        SELECT id, site_code AS "siteCode", tree_schema_version AS "treeSchemaVersion", tree_revision AS "treeRevision"
        FROM ih_installations
        WHERE deleted_at IS NULL AND id = ${selected.installationId}
        ORDER BY id
      `
    : await sql<Array<{ id: string; siteCode: string; treeSchemaVersion: number; treeRevision: number }>>`
        SELECT id, site_code AS "siteCode", tree_schema_version AS "treeSchemaVersion", tree_revision AS "treeRevision"
        FROM ih_installations
        WHERE deleted_at IS NULL
        ORDER BY id
      `;
  const totals = {
    installations: installations.length,
    promotable: 0,
    promoted: 0,
    reviewExceptions: 0,
    blockingExceptions: 0,
    gridsPlanned: 0,
    metersPlanned: 0,
    metersAlreadyMigrated: 0,
    channelsPlanned: 0,
    displayClaimsPlanned: 0,
    photoRegistryRowsReconciled: 0,
    photoCopyRowsReconciled: 0,
  };
  for (const installation of installations) {
    const plan = await loadPlan(installation.id, installation.siteCode, installation.treeRevision);
    if (plan.promotable) totals.promotable += 1;
    totals.reviewExceptions += plan.exceptions.filter((item) => item.severity === 'REVIEW').length;
    totals.blockingExceptions += plan.exceptions.filter((item) => item.severity === 'BLOCKING').length;
    totals.gridsPlanned += plan.deterministicGrid ? 1 : 0;
    totals.metersPlanned += plan.meterDevices.length;
    totals.metersAlreadyMigrated += plan.alreadyMigratedMeters;
    totals.channelsPlanned += plan.meterDevices.reduce((sum, meter) => sum + meter.channels.length, 0);
    totals.displayClaimsPlanned += plan.displayClaims.length;
    let result = null;
    if (selected.apply) {
      result = await applyPlan(plan);
      if (result.promoted && installation.treeSchemaVersion < 2) totals.promoted += 1;
      totals.photoRegistryRowsReconciled += result.photoRegistryRowsReconciled;
      totals.photoCopyRowsReconciled += result.photoCopyRowsReconciled;
    }
    console.log(JSON.stringify({
      event: 'installation_backfill',
      dryRun: !selected.apply,
      installationId: installation.id,
      alreadySchemaVersion: installation.treeSchemaVersion,
      promotable: plan.promotable,
      planned: {
        grid: Boolean(plan.deterministicGrid),
        boards: plan.boardUpdates.length,
        siteAssets: plan.siteAssetUpdates.length,
        meters: plan.meterDevices.length,
        channels: plan.meterDevices.reduce((sum, meter) => sum + meter.channels.length, 0),
        displayClaims: plan.displayClaims.length,
        measurementAssignments: plan.measurementAssignments.length,
        formUpdates: plan.formUpdates.length,
        photoReconciliations: plan.photoReconciliations.length,
      },
      exceptions: plan.exceptions,
      applied: result,
    }));
  }
  let constraintValidation: Awaited<ReturnType<typeof validateInstallHubConstraints>> = [];
  if (selected.validateConstraints) {
    if (totals.blockingExceptions > 0) {
      throw new Error('Constraint validation refused while blocking backfill exceptions remain');
    }
    constraintValidation = await validateInstallHubConstraints();
    if (constraintValidation.some((result) => result.status === 'failed')) process.exitCode = 1;
  }
  console.log(JSON.stringify({
    event: 'backfill_summary',
    dryRun: !selected.apply,
    ...totals,
    constraintValidation,
  }));
}

try {
  await main();
} finally {
  await closeDb();
}
