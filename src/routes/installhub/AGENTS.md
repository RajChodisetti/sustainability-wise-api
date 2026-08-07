# Field App Complete Backend Contract

Field App Complete routes are mounted at `/v1/installhub` and require the `installhub`
auth namespace. Protected sync operations require at least the `inspector` role,
and inspector records remain scoped to their own or explicitly assigned installations.

## Domain Shape

- Parent flow: installation -> zones -> electrical assets/site assets.
- Electrical assets retain embedded meter and channel structures as JSON.
- Versioned commissioning forms are independent submissions linked to an
  installation and optionally a zone, board, meter, or site asset.
- The six current form types are `ww-installation`, `comms-fault`,
  `ace-switchboard`, `honeywell-q400`, `captis-logger`, and `sums-logger`.
  Preserve `a3rm-installation` and `a6m-installation` as schema-v1 read/sync
  compatibility types.
- Business capture fields and evidence are optional, including device details,
  serials, ratings, descriptions, form answers, and photos. Supplied values must
  retain their structural payload/attachment shape, but no companion business
  field becomes mandatory for completion/readiness.
- Completion/readiness is blocked only by an explicit `TBC` electrical supply,
  asset metering state, or measurement target. Missing or invalid optional
  capture must not be promoted into a readiness issue.
- A push is a complete installation snapshot. All four child arrays are
  structurally required by the full-snapshot transport, and absent existing
  children are soft-deleted; this is not a business-field completeness rule.
- Keep local IDs stable. Server IDs and record versions are reconciliation
  metadata, not replacements for mobile IDs.

## Photos and Backup

The mobile implementation is `../../../../installhub-mobile/`. Metadata is
pushed before media so upload ownership can be validated. Media uses the shared
photo registry and storage pipeline:

1. check exact scoped checksum;
2. create an upload session;
3. PUT raw bytes to the session URL;
4. confirm the upload;
5. push the snapshot again with confirmed remote URLs.

Cover zone photos, board primary/extra photos, embedded meter photos, site-asset
photos, and form attachments. A device-only or otherwise unresolved optional
evidence reference is omitted from the immutable canonical-v2.7 snapshot; it is
never persisted as confirmed media. Evidence that is confirmed is retained by
its exact registry identity and remains immutable. Deduplication and upload
lookup must remain scoped to `app = installhub`, installation, entity, field,
and checksum.

## Compatibility

Cloud backup is opt-in per mobile installation. `/sync/pull` supplies the explicit remote browser
and local `cpN` import workflow for creators, assigned inspectors, and elevated users. Imported
copies retain original evidence URLs; when such a copy is later backed up, reconcile shared
`photo_copy_references` rather than duplicating photo bytes. Keep push field names, full-snapshot
deletion semantics, upload responses, and auth behavior backward compatible for installed clients.
The optional-capture and TBC-only readiness policy is enforced server-side
without requiring an installed mobile client upgrade. Authentication,
ownership/parentage, compare-and-swap revisions, stable IDs, and structural
payload/attachment validation remain enforced.
Permanent Cloud Backup purge is limited to the creator or an elevated user, must reject active PDF
jobs, and must preserve immutable originals that another backed-up copy still references.

Run API typecheck/tests and the Field App Complete mobile typecheck/tests for contract
changes.
