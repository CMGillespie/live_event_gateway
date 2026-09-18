# Live Event Gateway — Next-Phase Roadmap

**Status as of 2026-09-03:** Control loop is live and proven — browser agent checks into Firebase, admin (Mission Control look, Google auth) sees every room in realtime, remote Start/Mute/Split/Leave/End round-trip, bulk arm-or-fire, drop alerts, sortable/filterable table, clear/remove. Appliance has reconnect resilience. This doc plans the next three items for team review before execution.

---

## Accepted decisions (not up for redesign)

- **Wordly session ID + passcode travel in the clear.** That is Wordly's native model (join/attend links, portal, API all work this way). LEG will not re-engineer it. Passcodes live in the auth-gated Firebase DB and in per-room links; we keep those links internal, and that's the end of it.
- **Only the agent can start/stop a Wordly session** (it holds the WSS). The head-end never talks to Wordly's session layer directly; it commands agents. This is settled and shapes everything below.

---

## Item 1 — Wordly metadata enrichment (API key + spreadsheet fallback)

**Goal.** Today a card only knows what the room device typed in (session ID, passcode, name, device). The Wordly portal holds far more per session — title, presenter, custom labels/fields, glossary, language config, scheduled start/stop, pool of minutes. Pull that in so an operator can search across the full metadata ("is the molecular-nanobiology session live?") and so transcripts can later be reconciled to real names (Phase 3).

**Approach — two paths, ship the cheap one first.**

1. **Non-API (do first, zero infrastructure).** Admin uploads the portal's "Download all sessions" spreadsheet. Parse it client-side, cache it (Firebase or localStorage), join to agent records by session ID. Instant enrichment, works on any account, no keys, no cost. Good enough for demos and for accounts without API access.
2. **API (the real version).** Wordly REST `/sessions` (needs the API key) returns all sessions with metadata — Mission Control already does exactly this (paginates 100/page). Join by session ID to the Firebase agents.

**Key decision — where the API key lives.** It must never touch a room device, and a static GitHub Pages page can't hold a secret or (likely) call `api.wordly.ai` without CORS trouble. So the API path needs a **Firebase Cloud Function** that holds the key server-side, calls Wordly REST, and returns metadata to the admin (which is Google-authed). This is the "runs inside Firebase" piece we flagged earlier. It also keeps the key entirely out of the browser and the rooms.

**Flags.**

- Cloud Functions with outbound network requires the Firebase **Blaze (pay-as-you-go) plan** — Spark won't do outbound. So the API path = a billing-plan change. The spreadsheet path needs none of this.
- Wordly REST gotchas carry over: **no `api-version` header**, and **paginate** until `total` is reached.

**Robustness dividend — API as a verify/reconcile layer, NOT a second command channel.** Deliberate design choice: **all commands stay agent-side** (Start/Mute/Split/Leave/End go through the room), so there is a single writer and no split-brain between the agent's state machine and the head-end. The API key is used only to **read Wordly's actual session state and reconcile** it against what agents report:

- **Matched** — agent and Wordly agree → normal.
- **Zombie** — agent claims live, Wordly says ended → flag the card stale, prompt a reset. Detection only; no API command.
- **Orphan** — Wordly session live but no agent checked in → surface as "live in Wordly, unmanaged." **Reunite** by pointing a device at that session ID (a preconfigured link); the appliance opens a present connection to the existing session and it's back under management — no restart, no interruption. The API's job is only to tell you *which* sessions need reuniting.

This closes the "admin only knows what the agent reports about itself" gap noted when the table was built, without introducing a routine competing command path.

**Backstop (End only).** The API is confirmation *and* backstop. When an agent is frozen or disagreeing and a session must be killed, the operator force-ends it directly — today via the Wordly portal by hand; once the API is integrated, via a "force end" button in admin that fires the direct WSS kill (`disconnect end:true`). This is a **reserved manual override, not an automatic second channel** — and it's split-brain-safe precisely because it only fires *after* the agent has stopped agreeing (there's no healthy agent state left to race). Routine End still goes through the agent.

Command-set reality (why routine commands stay agent-side): Start needs the audio-holding present connection, Mute/Unmute is the agent stopping its own stream, Leave is the agent detaching, device/config visibility is client-side. So the agent is the only sensible routine writer; the API adds verify, reunite, and the End backstop.

**Note.** Adopting the API key / Blaze is a Wordly (company) decision, not just a project call.

**Dependency.** Independent of Items 2–3. The spreadsheet fallback can land immediately; the API path waits on a Blaze decision.

---

## Item 2 — Hierarchy: LEG accounts → Events → rooms

**Goal.** Multi-tenant structure. A **LEG account** (e.g. Scott M as an onsite lead) owns **Events**; an Event groups the rooms/sessions for one show; per-room links belong to an Event. This is what lets a generic link land in the right place.

**The link model you described.** A single **event-generic link** — event code only, no session details:
`…/live_event_gateway/?event=EVENTCODE`
The tech opens it → the agent checks into *that event's* node → it pops up in the correct event's dashboard as "online, waiting, unconfigured" → the room operator then enters the session ID / passcode / name locally. One link to hand out, correct event automatically, details filled in the room. (A fully pre-configured per-room link — `?event=…&session=…&passcode=…&name=…` — remains available for when you want zero touch.)

**Note on the URL shape.** You wrote it as a path (`/EVENTCODE/…`). GitHub Pages is static, so a real path segment would need per-event files or an SPA 404-fallback trick. A **query param (`?event=CODE`)** or hash gives the same "generic link, right event" behavior with none of that. Recommend query param.

**Data model.**
- `accounts/{accountId}` — owner, name, members
- `accounts/{accountId}/events/{eventId}` — name, event code, dates, venue
- Agents check in under their event: `events/{eventCode}/agents/{agentId}` (replacing today's flat `agents/`)

Admin becomes event-aware: pick an event, see its rooms; account view spans all its events.

**Key decision — data layer.** Nested multi-tenant data plus per-account/per-event security rules get materially easier in **Firestore** than in Realtime Database. Worth deciding now whether to migrate the data layer before the hierarchy hardens, or to structure RTDB carefully. (RTDB's presence/`onDisconnect` is why we chose it; Firestore has workable presence patterns too.)

**Security evolves.** Rules move from today's flat "any signed-in user" to **account/event-scoped** — an event's rooms are readable/controllable only by that account's members. This is the foundation Item 3 shares access on top of.

**Dependency.** Foundational for Item 3 (you share access to an account/event, which must first exist). Item 1's enrichment applies per-event once this lands.

---

## Item 3 — Sharing admin access (internal now, external is an MRD question)

**Goal.** Let the right people into the right dashboard.

**Internal (buildable now).** Wordly staff are already Google-authed. "Share" = add a Google email to an account/event's member list; they sign in and see what's shared. No permission tiers yet (internal, trusted) — just membership. Standard, low-risk.

**External (structural — think, don't build yet).** Venue techs, AV partners, and event staff won't have Wordly Google accounts. Your instinct is the right frame: **access should be ephemeral and event-scoped**, because an event from setup to teardown rarely exceeds ~5 days.

Options to weigh (for the MRD, not to decide here):
- **Firebase passwordless email-link / email-PIN sign-in** (native): they click a link, get a code at that email, they're in — no password to create. Pair with a short session lifetime.
- **Custom event-scoped access token** minted by a Cloud Function: scoped to one event, ~5-day TTL, stored client-side; auto-expires with the event.
- **Simple shared event passcode** for view-only cases.

Open governance questions to settle before any of these: revocation mid-event, scope (single event vs whole account), view-only vs control, and audit (who did what). These are genuinely structural — right to defer.

**Flag.** The external-auth token/PIN paths lean on Cloud Functions → same **Blaze** dependency as Item 1's API path.

**Dependency.** Internal sharing needs Item 2 (accounts/events to share). External auth is a parallel design track.

---

## Cross-cutting threads

- **Blaze plan** gates two things: the Item 1 API path and Item 3 external auth. The spreadsheet fallback, the hierarchy, and internal sharing do not need it. So a cheap, useful slice (spreadsheet enrichment + hierarchy + internal sharing) is possible with no billing change.
- **RTDB vs Firestore** is the one architectural fork worth settling early — it surfaces in Item 2 and colors 1 and 3.
- **Security model** grows from flat auth → account/event-scoped rules. Design it with Item 2, not after.

## Suggested sequence (team to confirm)

1. **Item 1 spreadsheet fallback** — immediate, no infra, real value.
2. **Item 2 hierarchy** — the backbone everything else hangs on; settle RTDB-vs-Firestore here.
3. **Item 1 API path** + **Item 3 internal sharing** — once Blaze and events exist.
4. **Item 3 external auth** — its own design track, after the MRD questions are answered.

## Concept (for MRD) — Caption Display Layout Page

**Status: concept, not in the build queue.** Feasible and straightforward when we pick it up.

**Context LEG didn't have.** The appliance side has two display tools:
1. **`Wordly_iframe_landing`** — a full-screen, caption-only page with silence watchdog and session gate. Battle-tested across 95 rooms at ACS. Standalone (`https://cmgillespie.github.io/Wordly_iframe_landing/`). **Untouched by this idea.**
2. **New concept** — a room-facing *compositor-aware layout* page, below.

**The idea.** Instead of a dedicated caption monitor, deliver Wordly captions inside a digital-signage-style layout on the room's **existing main projector screen** (a sunk cost the room already has for presentations), composited by a rented video mixer or a signage player (e.g. BrightSign):
- **Left/right sidebars** — customer/sponsor/conference graphics.
- **Center** — true-black void; the mixer/DSP keys the laptop presentation over our black background (we don't touch the center).
- **Bottom strip (~25–30% height)** — the Wordly caption iframe, small, not full-screen (`attend.wordly.ai/frame/{SESSION}?bgcolor=000000&fgcolor=ffffff`). Wordly branding is already built into the iframe.

**Business case.** At the 97-room conference, the dedicated caption monitor + stand + install labor ran **>$300k** (gear alone, before shipping/labor). This layout eliminates the dedicated monitor by using the existing screen. Rough model: charge ~$100k for platform setup + administration of the display layer; customer nets ~$260k saved, more once shipping/labor are counted. Opens a recurring administration revenue line.

**What to build.** New standalone page, own repo (e.g. `Wordly_caption_layout`): sidebars + black center void + bottom caption iframe — all HTML/CSS.

**LEG/Firebase angle.** Same pattern as the appliance agent: Mission Control pushes graphic URLs and rotation schedules to each room's display page. Static graphics first, schedule-driven rotation later — and the rotation reuses the **same schedule primitives** as the appliance's scheduling (Item 2 / Phase 2). Clean seam, same architecture.

**Architecture notes / flags (for when it's built):**
- **True-black keying.** Center must render pure `#000` with no anti-alias bleed at the void edges, or the mixer's key will fringe. Lock the layout to the target resolution (typically 1920×1080) and verify edges on the actual keyer.
- **Signage-player rendering.** BrightSign (and some mixers) run older/embedded Chromium — the CSS layout and the caption iframe should be fine, but test on-device; don't assume desktop-Chrome behavior. Page must be kiosk-safe: static URL, no auth prompts, survives reload.
- **Graphics asset hosting.** Sidebar graphics need somewhere to live (Firebase Storage or plain URLs) — decide alongside the push mechanism.
- **Aspect fit.** Decide how the keyed presentation's 16:9 content maps into the center void given the sidebars + bottom strip eat screen real estate.

---

## Still-open MRD questions (carried from earlier)

- **Schedule vs. manual-operator authority** (human-wins default, scoped override, consent/privacy implications in gov/edu/enterprise). Already drafted for the MRD.
- **External admin auth** model and governance (this doc, Item 3).
