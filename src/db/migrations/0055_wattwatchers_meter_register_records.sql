CREATE TABLE "ww_meter_register_records" (
	"entry_id" text PRIMARY KEY NOT NULL,
	"business_client_id" text NOT NULL,
	"business_site_id" text NOT NULL,
	"customer_name" text NOT NULL,
	"details" jsonb NOT NULL,
	"revision" integer DEFAULT 1 NOT NULL,
	"updated_by_user_id" text,
	"manually_corrected_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ww_meter_register_records_customer_check" CHECK (
    char_length(btrim("ww_meter_register_records"."customer_name")) BETWEEN 1 AND 300
  ),
	CONSTRAINT "ww_meter_register_records_details_check" CHECK (jsonb_typeof("ww_meter_register_records"."details") = 'object'),
	CONSTRAINT "ww_meter_register_records_revision_check" CHECK ("ww_meter_register_records"."revision" >= 1)
);
--> statement-breakpoint
ALTER TABLE "ww_meter_register_records" ADD CONSTRAINT "ww_meter_register_records_entry_id_ww_meter_register_entries_id_fk" FOREIGN KEY ("entry_id") REFERENCES "public"."ww_meter_register_entries"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ww_meter_register_records" ADD CONSTRAINT "ww_meter_register_records_business_client_id_business_clients_id_fk" FOREIGN KEY ("business_client_id") REFERENCES "public"."business_clients"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ww_meter_register_records" ADD CONSTRAINT "ww_meter_register_records_business_site_id_business_sites_id_fk" FOREIGN KEY ("business_site_id") REFERENCES "public"."business_sites"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ww_meter_register_records_client_idx" ON "ww_meter_register_records" USING btree ("business_client_id");--> statement-breakpoint
CREATE INDEX "ww_meter_register_records_site_idx" ON "ww_meter_register_records" USING btree ("business_site_id");--> statement-breakpoint
CREATE INDEX "ww_meter_register_records_updated_idx" ON "ww_meter_register_records" USING btree ("updated_at");--> statement-breakpoint

CREATE FUNCTION "sw_ww_meter_register_record_guard"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
	IF NOT EXISTS (
		SELECT 1
		FROM "ww_meter_register_entries" entry
		WHERE entry."id" = NEW."entry_id"
			AND entry."current_device_identifier" IS NOT NULL
	) THEN
		RAISE EXCEPTION 'Meter Register operational records require a current identifier';
	END IF;

	IF NOT EXISTS (
		SELECT 1
		FROM "business_sites" site
		WHERE site."id" = NEW."business_site_id"
			AND site."client_id" = NEW."business_client_id"
	) THEN
		RAISE EXCEPTION 'Meter Register operational site must belong to its business client';
	END IF;

	RETURN NEW;
END;
$$;--> statement-breakpoint

CREATE TRIGGER "ww_meter_register_records_guard"
BEFORE INSERT OR UPDATE OF "entry_id", "business_client_id", "business_site_id"
ON "ww_meter_register_records"
FOR EACH ROW
EXECUTE FUNCTION "sw_ww_meter_register_record_guard"();--> statement-breakpoint

CREATE TEMP TABLE "ww_meter_register_record_stage" AS
WITH normalized AS (
	SELECT
		entry.*,
		CASE
			WHEN upper(regexp_replace(btrim(coalesce(entry."client_name_snapshot", '')), '[[:space:]]+', ' ', 'g')) IN ('', '0', 'NA', 'N/A') THEN NULL
			ELSE regexp_replace(btrim(entry."client_name_snapshot"), '[[:space:]]+', ' ', 'g')
		END AS source_client_name,
		CASE
			WHEN upper(regexp_replace(btrim(coalesce(entry."customer_name_snapshot", '')), '[[:space:]]+', ' ', 'g')) IN ('', '0', 'NA', 'N/A') THEN NULL
			ELSE regexp_replace(btrim(entry."customer_name_snapshot"), '[[:space:]]+', ' ', 'g')
		END AS source_customer_name,
		CASE
			WHEN upper(regexp_replace(btrim(coalesce(entry."site_address_snapshot", '')), '[[:space:]]+', ' ', 'g')) IN ('', '0', 'NA', 'N/A') THEN NULL
			ELSE regexp_replace(btrim(entry."site_address_snapshot"), '[[:space:]]+', ' ', 'g')
		END AS source_site_address,
		CASE
			WHEN upper(btrim(coalesce(entry."site_state_snapshot", ''))) IN ('ACT', 'NSW', 'NT', 'QLD', 'SA', 'TAS', 'VIC', 'WA')
				THEN upper(btrim(entry."site_state_snapshot"))
			ELSE NULL
		END AS source_site_state
	FROM "ww_meter_register_entries" entry
	WHERE entry."current_device_identifier" IS NOT NULL
), extracted AS (
	SELECT
		normalized.*,
		NULLIF(btrim(substring(
			normalized.source_customer_name
			FROM '\(([^()]*)\)[[:space:]]*$'
		)), '') AS customer_detail_candidate,
		NULLIF(btrim(regexp_replace(
			normalized.source_customer_name,
			'[[:space:]]*(-[[:space:]]*)?\([^()]*\)[[:space:]]*$',
			''
		)), '') AS customer_base_candidate,
		NULLIF(btrim(substring(
			normalized.source_site_address
			FROM '\(([^()]*)\)[[:space:]]*$'
		)), '') AS site_detail_candidate,
		NULLIF(btrim(regexp_replace(
			normalized.source_site_address,
			'[[:space:]]*(-[[:space:]]*)?\([^()]*\)[[:space:]]*$',
			''
		)), '') AS site_base_candidate
	FROM normalized
), classified AS (
	SELECT
		extracted.*,
		(
			extracted.customer_base_candidate IS NOT NULL
			AND extracted.customer_detail_candidate IS NOT NULL
			AND (
				extracted.customer_detail_candidate ~* '(^|[^[:alnum:]])(hvac|pac|mssb|msb|hdb|evdb|pvdb|solar|grid|supply|lighting|power|electric vehicle|hws|pool heater|switchboard|distribution board|office board|mains|circuits?|escalators?|travelators?|lifts?|inverter|generation|chargers?|a[[:space:]]*/?[[:space:]]*c|e[[:space:]]*/?[[:space:]]*v[[:space:]]+charg(er|ers|ing)|ev[[:space:]]+charg(er|ers|ing)|db([._ -]?[[:alnum:]]+)?|fcu(s|[[:space:]]*[0-9]+)?|cu[[:space:]]*[0-9]+|pv[0-9]*)($|[^[:alnum:]])'
				OR (
					extracted.source_site_address IS NULL
					AND lower(normalize(coalesce(extracted.source_client_name, ''), NFKC))
						IN ('national storage', 'sums')
					AND extracted.customer_detail_candidate ~* '^(pool|house|rear|front|office|shed|front[[:space:]]+office|left[[:space:]]+shed|[a-z]([[:space:]]*&[[:space:]]*[a-z])?[[:space:]]+block|[a-z],[[:space:]]*office)$'
				)
			)
		) AS customer_detail_is_installation,
		(
			extracted.site_base_candidate IS NOT NULL
			AND extracted.site_detail_candidate IS NOT NULL
			AND extracted.site_detail_candidate ~* '(^|[^[:alnum:]])(hvac|pac|mssb|msb|hdb|evdb|pvdb|solar|grid|supply|lighting|power|electric vehicle|hws|pool heater|switchboard|distribution board|office board|mains|circuits?|escalators?|travelators?|lifts?|inverter|generation|chargers?|a[[:space:]]*/?[[:space:]]*c|e[[:space:]]*/?[[:space:]]*v[[:space:]]+charg(er|ers|ing)|ev[[:space:]]+charg(er|ers|ing)|db([._ -]?[[:alnum:]]+)?|fcu(s|[[:space:]]*[0-9]+)?|cu[[:space:]]*[0-9]+|pv[0-9]*)($|[^[:alnum:]])'
		) AS site_detail_is_installation
	FROM extracted
), interpreted AS (
	SELECT
		classified.*,
		CASE
			WHEN classified.customer_detail_is_installation
				THEN classified.customer_base_candidate
			ELSE classified.source_customer_name
		END AS interpreted_customer_name,
		CASE
			WHEN classified.customer_detail_is_installation
				THEN classified.customer_detail_candidate
			ELSE NULL
		END AS customer_installation_detail,
		CASE
			WHEN classified.site_detail_is_installation
				THEN classified.site_base_candidate
			ELSE classified.source_site_address
		END AS interpreted_site_value,
		CASE
			WHEN classified.site_detail_is_installation
				THEN classified.site_detail_candidate
			ELSE NULL
		END AS site_installation_detail
	FROM classified
), canonical AS (
	SELECT
		interpreted.*,
		CASE
			WHEN lower(normalize(interpreted.interpreted_customer_name, NFKC))
				IN ('subaru - essendon fields', 'subaru essendon')
				THEN 'Subaru Essendon'
			ELSE interpreted.interpreted_customer_name
		END AS operational_customer_name
	FROM interpreted
), projected AS (
	SELECT
		canonical.*,
		(
			canonical.operational_customer_name = 'Subaru Essendon'
			AND lower(normalize(coalesce(canonical.source_client_name, ''), NFKC)) = 'inchcape'
		) AS is_subaru_essendon,
		CASE
			WHEN canonical.customer_installation_detail IS NULL
				THEN canonical.site_installation_detail
			WHEN canonical.site_installation_detail IS NULL
				THEN canonical.customer_installation_detail
			WHEN lower(normalize(canonical.customer_installation_detail, NFKC))
				= lower(normalize(canonical.site_installation_detail, NFKC))
				THEN canonical.customer_installation_detail
			ELSE left(
				'Customer: ' || canonical.customer_installation_detail
				|| ' | Site: ' || canonical.site_installation_detail,
				300
			)
		END AS installation_detail
	FROM canonical
)
SELECT
	projected."id" AS entry_id,
	left(CASE
		WHEN projected.is_subaru_essendon THEN 'Subaru Essendon'
		ELSE coalesce(projected.source_client_name, projected.operational_customer_name, 'NA')
	END, 300) AS business_client_name,
	lower(normalize(left(CASE
		WHEN projected.is_subaru_essendon THEN 'Subaru Essendon'
		ELSE coalesce(projected.source_client_name, projected.operational_customer_name, 'NA')
	END, 300), NFKC)) AS business_client_normalized_key,
	left(coalesce(projected.operational_customer_name, 'NA'), 300) AS customer_name,
	left(CASE
		WHEN projected.site_installation_detail IS NOT NULL THEN projected.interpreted_site_value
		ELSE coalesce(projected.operational_customer_name, projected.source_site_address, 'NA')
	END, 300) AS site_name,
	lower(normalize(left(CASE
		WHEN projected.site_installation_detail IS NOT NULL THEN projected.interpreted_site_value
		ELSE coalesce(projected.operational_customer_name, projected.source_site_address, 'NA')
	END, 300), NFKC)) AS site_name_normalized_key,
	left(CASE
		WHEN projected.is_subaru_essendon
			THEN '344 Wirraway Road, Essendon Fields VIC 3041'
		WHEN projected.site_installation_detail IS NOT NULL THEN 'NA'
		ELSE coalesce(projected.source_site_address, 'NA')
	END, 1000) AS site_address,
	CASE WHEN projected.is_subaru_essendon THEN 'VIC' ELSE projected.source_site_state END AS site_state,
	(
		NOT projected.is_subaru_essendon
		AND (projected.source_site_address IS NULL OR projected.site_installation_detail IS NOT NULL)
	) AS placeholder_site,
	CASE
		WHEN NOT projected.is_subaru_essendon
			AND (projected.source_site_address IS NULL OR projected.site_installation_detail IS NOT NULL)
			THEN projected."id"
		ELSE ''
	END AS site_identity_discriminator,
	"sw_business_site_address_fingerprint"(
		CASE
			WHEN projected.is_subaru_essendon
				THEN '344 Wirraway Road, Essendon Fields VIC 3041'
			WHEN projected.site_installation_detail IS NOT NULL THEN 'NA'
			ELSE coalesce(projected.source_site_address, 'NA')
		END,
		NULL,
		CASE WHEN projected.is_subaru_essendon THEN 'VIC' ELSE projected.source_site_state END,
		NULL,
		'AU'
	) AS address_fingerprint,
	jsonb_build_object(
		'status', projected."status_snapshot",
		'serviceType', projected."service_type_snapshot",
		'meteringSolutionType', projected."metering_solution_type_snapshot",
		'installationDetail', projected.installation_detail,
		'meterType', projected."meter_type_snapshot",
		'fergusJobNumber', projected."fergus_job_number_snapshot",
		'quoteNumber', projected."quote_number_snapshot",
		'purchaseOrderNumber', projected."purchase_order_number_snapshot",
		'jobCompletionDate', projected."job_completion_date",
		'jobCompletedBy', projected."job_completed_by_snapshot",
		'hardwareInstalled', projected."hardware_installed_snapshot",
		'maas', projected."maas",
		'maasStartDate', projected."maas_start_date",
		'maasTerm', projected."maas_term_snapshot",
		'maasReportingRequired', projected."maas_reporting_required",
		'dataEnabled', projected."data_enabled",
		'productName', projected."product_name_snapshot",
		'xeroInvoiceNumber', projected."xero_invoice_number_snapshot",
		'meterCostExGstCents', projected."meter_cost_ex_gst_cents",
		'meteringRecurringFeeExGstCents', projected."metering_recurring_fee_ex_gst_cents",
		'otherInvoiceCostsExGstCents', projected."other_invoice_costs_ex_gst_cents",
		'invoiceAmountExGstCents', projected."invoice_amount_ex_gst_cents",
		'recurringFeePo', projected."recurring_fee_po_snapshot",
		'invoicingClientContact', projected."invoicing_client_contact_snapshot",
		'comments', projected."comments_snapshot",
		'recurringStartDate', projected."recurring_start_date",
		'recurringFrequency', projected."recurring_frequency_snapshot",
		'recurringNextInvoiceIssueDate', projected."recurring_next_invoice_issue_date",
		'invoiceIssuedDate', projected."invoice_issued_date",
		'billingPeriod', projected."billing_period_snapshot",
		'issuedPeriodNextInvoiceIssueDate', projected."issued_period_next_invoice_issue_date"
	) AS details
FROM projected;--> statement-breakpoint

ALTER TABLE "ww_meter_register_record_stage" ADD PRIMARY KEY ("entry_id");--> statement-breakpoint

SELECT pg_advisory_xact_lock(hashtextextended(
	'sustainability-wise:meter-register-entry:' || entry_locks."entry_id",
	0
))
FROM (
	SELECT stage."entry_id"
	FROM "ww_meter_register_record_stage" stage
	ORDER BY stage."entry_id"
) entry_locks;--> statement-breakpoint

-- Serialize against the runtime client resolver while the additive backfill is running.
SELECT pg_advisory_xact_lock(hashtextextended(
	'sustainability-wise:client:' || client_locks."business_client_normalized_key",
	0
))
FROM (
	SELECT DISTINCT stage."business_client_normalized_key"
	FROM "ww_meter_register_record_stage" stage
	ORDER BY stage."business_client_normalized_key"
) client_locks;--> statement-breakpoint

INSERT INTO "business_clients" (
	"id", "company_key", "name", "normalized_key", "created_at", "updated_at"
)
SELECT DISTINCT ON (stage."business_client_normalized_key")
	'bc_wwmr_' || md5(stage."business_client_normalized_key"),
	'sustainability-wise',
	stage."business_client_name",
	stage."business_client_normalized_key",
	now(),
	now()
FROM "ww_meter_register_record_stage" stage
WHERE NOT EXISTS (
	SELECT 1
	FROM "business_clients" existing
	WHERE existing."company_key" = 'sustainability-wise'
		AND existing."normalized_key" = stage."business_client_normalized_key"
)
ORDER BY stage."business_client_normalized_key", stage."entry_id"
ON CONFLICT ("id") DO NOTHING;--> statement-breakpoint

CREATE TEMP TABLE "ww_meter_register_record_client_map" AS
WITH RECURSIVE client_roots AS (
	SELECT
		keys."business_client_normalized_key",
		candidate."id" AS business_client_id,
		candidate."merged_into_client_id",
		ARRAY[candidate."id"]::text[] AS visited_ids,
		0 AS depth
	FROM (
		SELECT DISTINCT stage."business_client_normalized_key"
		FROM "ww_meter_register_record_stage" stage
	) keys
	JOIN LATERAL (
		SELECT client."id", client."merged_into_client_id"
		FROM "business_clients" client
		WHERE client."company_key" = 'sustainability-wise'
			AND client."normalized_key" = keys."business_client_normalized_key"
		ORDER BY
			(client."merged_into_client_id" IS NULL) DESC,
			client."created_at",
			client."id"
		LIMIT 1
	) candidate ON true
), client_chain AS (
	SELECT * FROM client_roots
	UNION ALL
	SELECT
		client_chain."business_client_normalized_key",
		next_client."id",
		next_client."merged_into_client_id",
		client_chain."visited_ids" || next_client."id",
		client_chain."depth" + 1
	FROM client_chain
	JOIN "business_clients" next_client
		ON next_client."id" = client_chain."merged_into_client_id"
		AND next_client."company_key" = 'sustainability-wise'
	WHERE client_chain."merged_into_client_id" IS NOT NULL
		AND client_chain."depth" < 19
		AND NOT (next_client."id" = ANY(client_chain."visited_ids"))
)
SELECT DISTINCT ON (client_chain."business_client_normalized_key")
	client_chain."business_client_normalized_key",
	client_chain."business_client_id"
FROM client_chain
WHERE client_chain."merged_into_client_id" IS NULL
ORDER BY
	client_chain."business_client_normalized_key",
	client_chain."depth" DESC,
	client_chain."business_client_id";--> statement-breakpoint

ALTER TABLE "ww_meter_register_record_client_map"
	ADD PRIMARY KEY ("business_client_normalized_key");--> statement-breakpoint

DO $$
BEGIN
	IF EXISTS (
		SELECT 1
		FROM "ww_meter_register_record_stage" stage
		LEFT JOIN "ww_meter_register_record_client_map" client_map
			ON client_map."business_client_normalized_key" = stage."business_client_normalized_key"
		WHERE client_map."business_client_id" IS NULL
	) THEN
		RAISE EXCEPTION 'Meter Register client alias has an invalid merge target, cycle, or excessive depth';
	END IF;
END $$;--> statement-breakpoint

-- Site locks deliberately use client + canonical address fingerprint, matching
-- the shared runtime lock namespace. Logical site-name identity remains a
-- separate resolver dimension (the same dispatch address may host named sites).
SELECT pg_advisory_xact_lock(hashtextextended(site_locks."lock_key", 0))
FROM (
	SELECT DISTINCT
		'sustainability-wise:site:' || client_map."business_client_id"
			|| ':' || stage."address_fingerprint" AS lock_key
	FROM "ww_meter_register_record_stage" stage
	JOIN "ww_meter_register_record_client_map" client_map
		ON client_map."business_client_normalized_key" = stage."business_client_normalized_key"
	ORDER BY lock_key
) site_locks;--> statement-breakpoint

WITH resolved AS (
	SELECT stage.*, client_map."business_client_id"
	FROM "ww_meter_register_record_stage" stage
	JOIN "ww_meter_register_record_client_map" client_map
		ON client_map."business_client_normalized_key" = stage."business_client_normalized_key"
), site_sources AS (
	SELECT resolved.*
	FROM resolved
), canonical_sites AS (
	SELECT DISTINCT ON (
		site_sources."business_client_id",
		site_sources."site_name_normalized_key",
		site_sources."address_fingerprint",
		site_sources."site_identity_discriminator"
	)
		site_sources.*
	FROM site_sources
	ORDER BY
		site_sources."business_client_id",
		site_sources."site_name_normalized_key",
		site_sources."address_fingerprint",
		site_sources."site_identity_discriminator",
		site_sources."entry_id"
)
INSERT INTO "business_sites" (
	"id", "client_id", "name", "address", "state", "country_code",
	"address_source", "geocode_status", "address_fingerprint", "timezone",
	"created_at", "updated_at"
)
SELECT
	CASE WHEN canonical_sites."placeholder_site" THEN
		'bs_wwmr_' || md5(
			canonical_sites."business_client_id" || chr(31)
			|| 'entry:' || canonical_sites."entry_id"
		)
	ELSE
		'bs_wwmr_' || md5(
			canonical_sites."business_client_id" || chr(31)
			|| canonical_sites."site_name_normalized_key" || chr(31)
			|| canonical_sites."address_fingerprint"
		)
	END,
	canonical_sites."business_client_id",
	canonical_sites."site_name",
	canonical_sites."site_address",
	canonical_sites."site_state",
	'AU',
	'manual',
	'unresolved',
	canonical_sites."address_fingerprint",
	CASE canonical_sites."site_state"
		WHEN 'QLD' THEN 'Australia/Brisbane'
		WHEN 'NT' THEN 'Australia/Darwin'
		WHEN 'SA' THEN 'Australia/Adelaide'
		WHEN 'TAS' THEN 'Australia/Hobart'
		WHEN 'VIC' THEN 'Australia/Melbourne'
		WHEN 'WA' THEN 'Australia/Perth'
		ELSE 'Australia/Sydney'
	END,
	now(),
	now()
FROM canonical_sites
WHERE NOT EXISTS (
	SELECT 1
	FROM "business_sites" existing
	WHERE (
		canonical_sites."placeholder_site"
		AND existing."id" = 'bs_wwmr_' || md5(
			canonical_sites."business_client_id" || chr(31)
			|| 'entry:' || canonical_sites."entry_id"
		)
	) OR (
		NOT canonical_sites."placeholder_site"
		AND existing."client_id" = canonical_sites."business_client_id"
		AND lower(regexp_replace(btrim(normalize(existing."name", NFKC)), '[[:space:]]+', ' ', 'g'))
			= canonical_sites."site_name_normalized_key"
		AND existing."address_fingerprint" = canonical_sites."address_fingerprint"
	)
)
ON CONFLICT ("id") DO NOTHING;--> statement-breakpoint

WITH resolved AS (
	SELECT
		stage.*,
		client_map."business_client_id" AS resolved_business_client_id,
		CASE WHEN stage."placeholder_site" THEN
			'bs_wwmr_' || md5(client_map."business_client_id" || chr(31) || 'entry:' || stage."entry_id")
		ELSE NULL END AS placeholder_business_site_id
	FROM "ww_meter_register_record_stage" stage
	JOIN "ww_meter_register_record_client_map" client_map
		ON client_map."business_client_normalized_key" = stage."business_client_normalized_key"
), linked AS (
	SELECT
		resolved.*,
		site."id" AS resolved_business_site_id
	FROM resolved
	JOIN LATERAL (
		SELECT candidate."id"
		FROM "business_sites" candidate
		WHERE (
			resolved."placeholder_site"
			AND candidate."client_id" = resolved."resolved_business_client_id"
			AND candidate."id" = resolved."placeholder_business_site_id"
		) OR (
			NOT resolved."placeholder_site"
			AND candidate."client_id" = resolved."resolved_business_client_id"
			AND lower(regexp_replace(btrim(normalize(candidate."name", NFKC)), '[[:space:]]+', ' ', 'g'))
				= resolved."site_name_normalized_key"
			AND candidate."address_fingerprint" = resolved."address_fingerprint"
		)
		ORDER BY candidate."created_at", candidate."id"
		LIMIT 1
	) site ON true
)
INSERT INTO "ww_meter_register_records" (
	"entry_id", "business_client_id", "business_site_id", "customer_name",
	"details", "revision", "updated_by_user_id", "created_at", "updated_at"
)
SELECT
	linked."entry_id",
	linked."resolved_business_client_id",
	linked."resolved_business_site_id",
	linked."customer_name",
	linked."details",
	1,
	NULL,
	now(),
	now()
FROM linked
ON CONFLICT ("entry_id") DO NOTHING;--> statement-breakpoint

DO $$
BEGIN
	IF EXISTS (
		SELECT 1
		FROM "ww_meter_register_entries" entry
		LEFT JOIN "ww_meter_register_records" record ON record."entry_id" = entry."id"
		WHERE entry."current_device_identifier" IS NOT NULL
			AND record."entry_id" IS NULL
	) THEN
		RAISE EXCEPTION 'Every Meter Register entry with a current identifier must have an operational record';
	END IF;

	IF EXISTS (
		SELECT 1
		FROM "ww_meter_register_records" record
		JOIN "ww_meter_register_entries" entry ON entry."id" = record."entry_id"
		WHERE entry."current_device_identifier" IS NULL
	) THEN
		RAISE EXCEPTION 'A Meter Register operational record has no current identifier';
	END IF;

	IF EXISTS (
		SELECT 1
		FROM "ww_meter_register_records" record
		JOIN "business_sites" site ON site."id" = record."business_site_id"
		WHERE site."client_id" <> record."business_client_id"
	) THEN
		RAISE EXCEPTION 'A Meter Register operational site belongs to another business client';
	END IF;
END $$;--> statement-breakpoint

DROP TABLE "ww_meter_register_record_client_map";
DROP TABLE "ww_meter_register_record_stage";
