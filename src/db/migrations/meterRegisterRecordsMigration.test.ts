import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const migrationUrl = new URL('./0055_wattwatchers_meter_register_records.sql', import.meta.url);
const journalUrl = new URL('./meta/_journal.json', import.meta.url);
const previousSnapshotUrl = new URL('./meta/0054_snapshot.json', import.meta.url);
const snapshotUrl = new URL('./meta/0055_snapshot.json', import.meta.url);

test('0055 adds editable Meter Register records without rewriting source evidence', async () => {
  const migration = await readFile(migrationUrl, 'utf8');

  assert.match(migration, /CREATE TABLE "ww_meter_register_records"/u);
  assert.match(migration, /"entry_id" text PRIMARY KEY NOT NULL/u);
  assert.match(migration, /"business_client_id" text NOT NULL/u);
  assert.match(migration, /"business_site_id" text NOT NULL/u);
  assert.match(migration, /"customer_name" text NOT NULL/u);
  assert.match(migration, /"details" jsonb NOT NULL/u);
  assert.match(migration, /"revision" integer DEFAULT 1 NOT NULL/u);
  assert.match(migration, /"updated_by_user_id" text/u);
  assert.match(migration, /"manually_corrected_at" timestamp with time zone/u);

  assert.match(migration, /ww_meter_register_records_customer_check/u);
  assert.match(migration, /ww_meter_register_records_details_check/u);
  assert.match(migration, /ww_meter_register_records_revision_check/u);
  assert.match(migration, /ww_meter_register_records_client_idx/u);
  assert.match(migration, /ww_meter_register_records_site_idx/u);
  assert.match(migration, /ww_meter_register_records_updated_idx/u);
  assert.match(migration, /REFERENCES "public"\."ww_meter_register_entries"\("id"\) ON DELETE restrict/u);
  assert.match(migration, /REFERENCES "public"\."business_clients"\("id"\) ON DELETE restrict/u);
  assert.match(migration, /REFERENCES "public"\."business_sites"\("id"\) ON DELETE restrict/u);

  assert.match(migration, /CREATE TRIGGER "ww_meter_register_records_guard"/u);
  assert.match(migration, /operational records require a current identifier/u);
  assert.match(migration, /operational site must belong to its business client/u);
  assert.doesNotMatch(migration, /UPDATE\s+"ww_meter_register_entries"/iu);
  assert.doesNotMatch(migration, /DELETE\s+FROM\s+"ww_meter_register_entries"/iu);
});

test('0055 backfills every current identifier with deterministic client and site fallbacks', async () => {
  const migration = await readFile(migrationUrl, 'utf8');

  assert.match(migration, /WHERE entry\."current_device_identifier" IS NOT NULL/u);
  assert.match(
    migration,
    /coalesce\(projected\.source_client_name, projected\.operational_customer_name, 'NA'\)/u,
  );
  assert.match(migration, /coalesce\(projected\.operational_customer_name, 'NA'\)/u);
  assert.match(
    migration,
    /coalesce\(projected\.operational_customer_name, projected\.source_site_address, 'NA'\)/u,
  );
  assert.match(migration, /coalesce\(projected\.source_site_address, 'NA'\)/u);
  assert.match(
    migration,
    /projected\.source_site_address IS NULL OR projected\.site_installation_detail IS NOT NULL/u,
  );
  assert.match(migration, /site_identity_discriminator/u);
  assert.match(migration, /AS site_name_normalized_key/u);
  assert.match(migration, /normalize\(left\(CASE[\s\S]*projected\.site_installation_detail/u);
  assert.match(migration, /site_sources\."site_name_normalized_key"/u);
  assert.match(
    migration,
    /normalize\(existing\."name", NFKC\)[\s\S]*canonical_sites\."site_name_normalized_key"/u,
  );
  assert.match(
    migration,
    /"sw_business_site_address_fingerprint"\([\s\S]*projected\.is_subaru_essendon[\s\S]*344 Wirraway Road, Essendon Fields VIC 3041/u,
  );
  assert.match(migration, /customer_installation_detail/u);
  assert.match(migration, /site_installation_detail/u);
  assert.match(migration, /AS customer_detail_is_installation/u);
  assert.match(migration, /IN \('national storage', 'sums'\)/u);
  assert.match(migration, /pool\|house\|rear\|front\|office\|shed/u);
  assert.match(migration, /'installationDetail', projected\.installation_detail/u);
  assert.match(migration, /IN \('subaru - essendon fields', 'subaru essendon'\)/u);
  assert.match(migration, /AS is_subaru_essendon/u);
  assert.match(migration, /WHEN projected\.is_subaru_essendon THEN 'Subaru Essendon'/u);
  assert.match(migration, /WHEN projected\.site_installation_detail IS NOT NULL THEN 'NA'/u);
  assert.match(migration, /business_client_id" \|\| chr\(31\)[\s\S]*'entry:' \|\| canonical_sites\."entry_id"/u);
  assert.match(migration, /candidate\."id" = resolved\."placeholder_business_site_id"/u);
  assert.match(migration, /IN \('', '0', 'NA', 'N\/A'\)/u);
  assert.match(migration, /IN \('ACT', 'NSW', 'NT', 'QLD', 'SA', 'TAS', 'VIC', 'WA'\)/u);
  assert.match(migration, /'bc_wwmr_' \|\| md5/u);
  assert.match(migration, /'bs_wwmr_' \|\| md5/u);
  assert.match(migration, /CREATE TEMP TABLE "ww_meter_register_record_client_map"/u);
  assert.match(migration, /WITH RECURSIVE client_roots/u);
  assert.match(migration, /\(client\."merged_into_client_id" IS NULL\) DESC/u);
  assert.match(migration, /next_client\."id" = client_chain\."merged_into_client_id"/u);
  assert.match(migration, /invalid merge target, cycle, or excessive depth/u);
  assert.match(migration, /sustainability-wise:client:/u);
  assert.match(migration, /sustainability-wise:site:/u);
  assert.match(migration, /sustainability-wise:meter-register-entry:/u);
  assert.match(migration, /pg_advisory_xact_lock\(hashtextextended/u);
  assert.match(migration, /INSERT INTO "business_clients"/u);
  assert.match(migration, /INSERT INTO "business_sites"/u);
  assert.match(migration, /INSERT INTO "ww_meter_register_records"/u);
  assert.match(migration, /ON CONFLICT \("entry_id"\) DO NOTHING/u);
  assert.match(
    migration,
    /Every Meter Register entry with a current identifier must have an operational record/u,
  );

  for (const field of [
    'status',
    'serviceType',
    'meteringSolutionType',
    'installationDetail',
    'meterType',
    'fergusJobNumber',
    'quoteNumber',
    'purchaseOrderNumber',
    'jobCompletionDate',
    'jobCompletedBy',
    'hardwareInstalled',
    'maas',
    'maasStartDate',
    'maasTerm',
    'maasReportingRequired',
    'dataEnabled',
    'productName',
    'xeroInvoiceNumber',
    'meterCostExGstCents',
    'meteringRecurringFeeExGstCents',
    'otherInvoiceCostsExGstCents',
    'invoiceAmountExGstCents',
    'recurringFeePo',
    'invoicingClientContact',
    'comments',
    'recurringStartDate',
    'recurringFrequency',
    'recurringNextInvoiceIssueDate',
    'invoiceIssuedDate',
    'billingPeriod',
    'issuedPeriodNextInvoiceIssueDate',
  ]) {
    assert.match(migration, new RegExp(`'${field}'`), `missing operational detail ${field}`);
  }
});

test('0055 snapshot and append-only journal follow 0054', async () => {
  const journal = JSON.parse(await readFile(journalUrl, 'utf8')) as {
    entries: Array<{ idx: number; tag: string }>;
  };
  assert.equal(
    journal.entries.find(({ idx }) => idx === 55)?.tag,
    '0055_wattwatchers_meter_register_records',
  );

  const previousSnapshot = JSON.parse(await readFile(previousSnapshotUrl, 'utf8')) as { id: string };
  const snapshot = JSON.parse(await readFile(snapshotUrl, 'utf8')) as {
    prevId: string;
    tables: Record<string, {
      columns: Record<string, { notNull?: boolean; type?: string }>;
      indexes: Record<string, unknown>;
      foreignKeys: Record<string, { onDelete?: string }>;
      checkConstraints: Record<string, unknown>;
    }>;
  };
  assert.equal(snapshot.prevId, previousSnapshot.id);

  const records = snapshot.tables['public.ww_meter_register_records'];
  assert.ok(records);
  for (const column of [
    'entry_id',
    'business_client_id',
    'business_site_id',
    'customer_name',
    'details',
    'revision',
    'updated_by_user_id',
    'manually_corrected_at',
    'created_at',
    'updated_at',
  ]) {
    assert.ok(records.columns[column], `missing snapshot column ${column}`);
  }
  for (const column of ['entry_id', 'business_client_id', 'business_site_id', 'customer_name', 'details']) {
    assert.equal(records.columns[column]?.notNull, true, `${column} must be non-null`);
  }
  assert.equal(records.columns.manually_corrected_at?.type, 'timestamp with time zone');
  assert.equal(records.columns.manually_corrected_at?.notNull, false);
  assert.ok(records.indexes.ww_meter_register_records_client_idx);
  assert.ok(records.indexes.ww_meter_register_records_site_idx);
  assert.ok(records.indexes.ww_meter_register_records_updated_idx);
  assert.ok(records.checkConstraints.ww_meter_register_records_customer_check);
  assert.ok(records.checkConstraints.ww_meter_register_records_details_check);
  assert.ok(records.checkConstraints.ww_meter_register_records_revision_check);
  for (const foreignKey of Object.values(records.foreignKeys)) {
    assert.equal(foreignKey.onDelete, 'restrict');
  }
});
