# Storage and Photo Reference Rules

Storage can be local disk or DigitalOcean Spaces. Callers must use the helpers in
this directory and must not depend on provider-specific paths or SDK responses.

- `photo_registry` rows identify originals and must be confirmed before general
  use. Validate app, parent, entity, ownership, and storage existence.
- `photo_copy_references` grants virtual access to an existing original. Copying
  records must not duplicate bytes or weaken ownership boundaries.
- Preserve immutable photo IDs, checksum identity, and legacy reference parsing.
  Do not replace an original URL with a thumbnail or downloaded local preview.
- Thumbnail URLs are authenticated derived previews. Cache keys/ETags must remain
  deterministic and variant-specific.
- Never load large originals into memory when a bounded stream is available.
  Sequentially consume remote streams in ZIP/report workflows.
- Keep local and Spaces behavior equivalent and avoid leaking absolute local
  paths, object-store credentials, or unrestricted storage keys.

Changes require storage reference, copy reference, and thumbnail tests plus
impact review for sync, PDF, ZIP, delete, and imported-copy flows.

