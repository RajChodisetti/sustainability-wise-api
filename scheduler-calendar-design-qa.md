# Scheduler calendar design QA

- Source visual truth: user-provided desktop dispatch-calendar screenshot in the current conversation.
- Implementation screenshot: unavailable; the local `/scheduler` route redirected to the authenticated sign-in boundary before the calendar rendered.
- Viewport: connected desktop Chrome viewport; exact pixels and density could not be recorded for the protected calendar state.
- State: local development Scheduler, unauthenticated redirect.
- Primary interactions tested visually: none; the protected calendar and drag state were not reachable without an authenticated local portal session.
- Console errors checked: not applicable because the implementation state did not render.
- Full-view comparison evidence: blocked because no authenticated implementation capture exists.
- Focused-region comparison evidence: blocked for the same reason.

## Findings

- [P0] Authenticated implementation capture is unavailable.
  - Location: local `/scheduler` route.
  - Evidence: the browser rendered only `Redirecting to sign in…`.
  - Impact: day expansion, technician lanes, drag affordances, confirmation-dialog composition, overflow, and responsive behavior cannot be visually compared with the supplied reference.
  - Fix: open the local portal with a normal authenticated development session, capture the default calendar, the expanded-day drag state, and the confirmation dialog at the reference desktop viewport, then run the combined comparison.

## Open questions

- None about the requested interaction. Visual acceptance remains pending only because the protected state could not be captured safely.

## Implementation checklist

- Capture the authenticated default calendar with the jobs tray open.
- Capture a job hovering over a day with technician lanes expanded.
- Capture the post-drop confirmation dialog showing technician, job, and date/time.
- Compare those states with the supplied reference and resolve any P0/P1/P2 visual differences.

## Comparison history

- Initial pass: blocked before comparison; no implementation screenshot was available and no visual fixes were claimed from code-only inspection.

final result: blocked
