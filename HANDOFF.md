# Live Event Gateway — Cross-Chat Handoff

**Cold-start context for any Claude chat (or human) with zero prior knowledge of this project. Last updated: 2026-09-18.**

## What it is

The automation + head-end control layer for Wordly at scale in non-integrated AV rooms. Core constraint that shapes everything: **no Wordly API can start/stop a session — only the client holding the WSS present connection can.** So control is **head-end → agent → WSS**, never head-end → Wordly directly.

## What's built and working (Phase 1 / Goal One — done and deployed)

- **Agent** (`index.html`) — the pure-browser Wordly appliance + an append-only Firebase layer (`agent-firebase.js`, `firebase-config.js`). Checks into Firebase on load, reports presence/status/device/session-age, listens for remote commands, executes them on its own WSS connection. Reconnect resilience is in (stopReason model + `shouldAutoRecover()` gate).
- **Admin / Mission Control** (`admin.html`) — Google-auth'd realtime dashboard, Mission-Control look. Dense sortable/filterable table, color status flags, live session-age, Active/Inactive filters, per-row + bulk arm-or-fire Start/Mute/Split/Leave/End (confirm on all), Attend/Present links, drop alerts, clear/remove cards.
- **Firebase** project `live-event-gateway`: Realtime Database + Google & Anonymous auth. Locked security rules written (`database.rules.json`). Still on Spark (free) plan.

## Where it lives

- Repo/local: `github.com/CMGillespie/live_event_gateway` → `~/Documents/Code/live_event_gateway`. Deployed on GitHub Pages: agent at `/live_event_gateway/`, admin at `/live_event_gateway/admin.html`.
- The appliance is also maintained as a **separate standalone repo** (`Wordly_Audio_Appliance_Web`) — see the sync rule below.

## Settled decisions (don't relitigate)

- Wordly session ID + passcode travel in the clear — that's Wordly's native model, not ours to fix.
- Commands stay agent-side (single writer, no split-brain). The API key, when integrated, is a verify/reconcile layer + a reserved force-end backstop — **not** a second command channel.
- Vanilla JS, no framework. GitHub Pages for hosting; Firebase for the realtime/control plane only.

## ⚠ Two-version sync rule (critical for the appliance chat)

There are two versions of the appliance: the **solo** `Wordly_Audio_Appliance_Web` (pure browser, no Firebase, **canonical source of truth**) and the **LEG agent** (same file + 5 Firebase script tags). Flow is one-way, **appliance → LEG**. **Never regenerate the whole appliance file** — a full-file regen has silently reintroduced an obsolete socket.io/local-server client three times and broken the deploy. Edit surgically. Full detail and the exact re-mirror procedure are in `SYNC.md`.

## In-repo docs that hold the detail

- `PROJECT_LOG.md` — current state, technical map (URLs, endpoints, RTDB shape, WSS facts), gotchas, last-known-good.
- `SYNC.md` — the two-version relationship and re-mirror procedure.
- `ROADMAP_next.md` — next phases and the caption-display concept.

## Next up (awaiting team/roadmap alignment — see `ROADMAP_next.md`)

1. **Wordly metadata enrichment** — spreadsheet ingest first (zero infra), then API-key path via a Cloud Function (key stays server-side).
2. **Multi-tenant hierarchy** — accounts → events → rooms, with generic `?event=CODE` provisioning links; settle RTDB-vs-Firestore here.
3. **Admin sharing** — internal (add a Google email) now; ephemeral, event-scoped external auth is an open MRD question.

Plus a concept: a caption-display signage-compositing layout page to replace ~$300k of dedicated caption-monitor hardware per large conference.

## Open MRD questions

- **Schedule vs. manual-operator authority** — human-wins default with a scoped override; carries consent/privacy (SOC 2) weight in gov/edu/enterprise.
- **External admin auth** model and governance.

## Cost gate

Cloud Functions (needed for the API path and external-auth tokens) require the Firebase **Blaze** plan — a Wordly-company decision. The spreadsheet enrichment, the hierarchy, and internal sharing need no billing change.
