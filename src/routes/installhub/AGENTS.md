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
- Completed WW Installation and Comms Fault payloads require one canonical
  device ID / serial, A3RM/A6M type, and an exact matching sensor value. The
  older device-number answer remains an optional read/sync compatibility alias. A3RM
  permits only the three 3000A Rogowski sizes; A6M permits only
  60A/120A/200A/400A/600A CT values.
- A push is a complete installation snapshot. All four child arrays are
  mandatory, and absent existing children are soft-deleted.
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
photos, and form attachments. Never persist a device-only URI. Deduplication and
upload lookup must remain scoped to `app = installhub`, installation, entity,
field, and checksum.

## Compatibility

Cloud backup is opt-in per mobile installation. `/sync/pull` supplies the explicit remote browser
and local `cpN` import workflow for creators, assigned inspectors, and elevated users. Imported
copies retain original evidence URLs; when such a copy is later backed up, reconcile shared
`photo_copy_references` rather than duplicating photo bytes. Keep push field names, full-snapshot
deletion semantics, upload responses, and auth behavior backward compatible for installed clients.
Permanent Cloud Backup purge is limited to the creator or an elevated user, must reject active PDF
jobs, and must preserve immutable originals that another backed-up copy still references.

Run API typecheck/tests and the Field App Complete mobile typecheck/tests for contract
changes.
