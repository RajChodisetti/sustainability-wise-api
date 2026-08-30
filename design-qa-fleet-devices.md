# Fleet devices list design QA

- Source visual: conversation attachment showing a compact device list
- Implementation route: `http://localhost:3210/fleet/devices`
- Requested visible columns: Device, Model, Condition
- Explicitly excluded fields: network and signal
- Browser state checked: unauthenticated local session at the portal sign-in screen

## Verification

- Source inspection confirms the table renders only Device, Model, and Condition.
- Device labels retain the device ID as secondary text.
- Model falls back to `N/A` when unavailable.
- Condition uses the existing Fleet status badge semantics, including the awaiting-collection state.
- Portal typecheck, lint, and the 351-test portal suite pass.

## Blocker

The authenticated Fleet Devices page could not be rendered in the local browser session because the route redirected to the sign-in screen. The supplied reference image is also a conversation attachment without a local source path, so a pixel-level side-by-side comparison could not be produced.

final result: blocked
