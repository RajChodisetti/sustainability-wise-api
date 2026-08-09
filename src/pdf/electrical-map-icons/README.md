# Electrical map icon assets

These transparent pictograms were generated through fal.ai with
`fal-ai/recraft/v4.1/text-to-vector`, then rasterized to 256 x 256 PNGs while
preserving alpha transparency. The prompts explicitly excluded tiles,
backgrounds, frames, text, shadows, and app-icon containers.

The client-map refinement adds dedicated indoor AC and outdoor condenser
pictograms, plus a front-facing smart-meter symbol with an LCD and channel
ports so those items remain recognisable at small map sizes.

The second refinement replaces the abstract switchboard marks with a coherent
front-facing cabinet family. MSB, MSSB, DB, HVAC DB, lighting DB, PV DB and MCC
now use visible doors, breaker rows and a single familiar equipment cue. The
assets were regenerated with the same Recraft model, palette and transparent
background constraints.

The matching browser copies live in
`apps/ecoaudit/public/installhub/electrical-map-icons/`. Keep both sets byte-for-byte
identical so portal and PDF maps use the same symbol language.
