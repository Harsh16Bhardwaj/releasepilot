# Bite implementation — 25 November 2026

Owner requested useful repository and website work while Docker downloads, explicitly allowing independent work ahead of Sprint 1's Flagsmith gate.

## Working application

- React/Vite interface, normal original experience and a separately labelled redesign preview.
- Search, categories, vegetarian/rating filters, sorting, favourites and item details.
- Persistent local cart, quantities, delivery threshold, delivery label and simulated checkout.
- Server validates quantities, calculates total, and uses order idempotency keys.
- SQLite stores server-assigned versions, sessions, events, orders and request timings. Concurrent requests are serialized by synchronous transactions in one server process. Event IDs are globally unique and cannot be reused by another session.
- Sessions finalize after 30 seconds of inactivity. Late events are rejected; frontend refreshes the session. Preview events remain explicitly distinct from normal traffic.
- Actual Flagsmith SDK evaluation is wired for normal sessions, with the original experience as an honest fallback when unconfigured/unreachable.
- Build metadata includes the Git commit, dirty state and build time. Development does not qualify as a verified deployment.

## Verification

`npm.cmd run check` and the production Vite build pass. Thirteen tests pass, including API session assignment, parallel duplicate events, concurrent checkout idempotency, server-side pricing, cross-origin rejection, finalized-session invariants and React interaction tests against the real HTTP backend.

The React test searches the menu, opens/closes an item dialog, adds an item, opens checkout, places an order and observes confirmation. It uses jsdom (with a dialog API shim), not a real browser. Production/static asset HTTP smoke checks are separate from visual acceptance.

Local browser automation was unavailable because Work settings disable local browser access. No visual screenshot or real-browser responsive acceptance is claimed. Responsive layouts are implemented for desktop, tablet and mobile; owner visual review remains pending.

## Remaining

Live Flagsmith account/environment proof; rollout approval engine and stage attribution; traffic generation; metric windows; rollback/session-cache invalidation; full ReleasePilot dashboard; actual demonstration PR. The healthy/failed autonomous release demonstrations are not yet implemented.

No paid service or live payment integration was introduced. Photography is locally stored with source URLs in `apps/bite/public/food/SOURCES.md`. Optional Google fonts have system fallbacks.
