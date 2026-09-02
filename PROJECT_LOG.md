# Live Event Gateway — Project Log

**Timestamp:** 2026-09-02
**Phase:** 1 (Goal One) — remote control of one room agent via Firebase
**Version:** v0.1 (Firebase agent + admin control loop, pre-live-test)

---

## Project Overview

LEG delivers Wordly translation/transcription AT SCALE in non-integrated AV environments. Goal One: prove a Firebase control loop — a browser room agent checks in, an admin console sees it live, and the admin can remotely Start / Mute / Unmute / Split / Leave / End a session on that agent. Start with one device.

**Key platform truth (settled this session):** No Wordly API can start/stop a session. REST (apikey) is observe/admin only. WSS Endpoint Services is audio in/out with no remote command channel. Therefore the ONLY thing that can start/end/split a session is whatever holds the WSS connection — the local browser agent. LEG's control path is: **Admin → Firebase → agent → agent runs the WSS op.** Mission Control's REST role is verification, not control.

---

## Current State

Built and syntax-verified (not yet live-tested against a real Wordly session):

- `index.html` — the LEG **agent**. This is the pure-browser Wordly appliance (from `wordly_appliance_V3`, 778 lines: getUserMedia → 16 kHz resample → 1600-frame binary chunks → WSS `wss://endpoint.wordly.ai/present`, connectionCode 9005, full controls, ALS, portrait mode) with ONE added script block at the end that loads Firebase + the bridge. **Zero changes to the appliance's own logic.**
- `agent-firebase.js` — bridge. Anonymous auth → writes presence to `agents/{agentId}` → listens `agents/{agentId}/command` → calls the appliance's existing globals (`startSession`, `toggleMute`, `doSplit`, `doLeave`, `doEnd`), reading its state vars (`muted`, `connected`, `cfg`). `onDisconnect` flips agent offline. 2s heartbeat.
- `admin.html` — admin console. Google sign-in → live roster of agents (`agents` listener) → per-agent Start/Mute/Unmute/Split/Leave/End buttons that write a command with a unique id. Buttons enable/disable to mirror agent-side guards.
- `firebase-config.js` — shared Firebase config (public by design; NOT the Wordly apikey).
- `database.rules.json` — LOCKED ruleset (auth != null) ready to apply when leaving test mode.

**Verified:** all JS syntax valid; RTDB reachable; `agents` node empty (null).
**Not yet verified:** live end-to-end (agent appears in admin, remote Start actually connects WSS). Needs the agent page served from an authorized domain and pointed at a real configured session.

---

## Technical Map

- **Local folder:** `/Users/wordly_apps/Documents/Code/live_event_gateway`
- **GitHub:** https://github.com/CMGillespie/live_event_gateway (origin/main). NOT yet pushed by Claude — Chris pushes.
- **Firebase project:** `live-event-gateway` (Spark plan)
  - RTDB: `https://live-event-gateway-default-rtdb.firebaseio.com` (currently **test mode** — open, 30-day)
  - Auth: Google (admin) + Anonymous (agent) enabled
  - Authorized domain added: `cmgillespie.github.io`
- **Firebase SDK:** compat 10.12.5 from gstatic
- **RTDB shape:**
  - `agents/{agentId}` → `{label, presenter, sessionId, deviceLabel, status, muted, configReady, online, updatedAt}`
  - `agents/{agentId}/command` → `{id, action, by, ts}` (admin writes; agent dedupes by id)
  - `agents/{agentId}/lastResult` → `{action, ok, note, ts}` (agent writes)
  - status values: idle | connecting | live | muted | error | ended | offline
- **Wordly WSS (in the appliance):** `wss://endpoint.wordly.ai/present`, connectionCode `9005`, message key `type`, mute=`{type:stop}`/unmute=`{type:start,...}`, split=`{type:split}`, disconnect end:true=kill / end:false=leave, echo keepalive 30s.

## Reference copies (gitignored, local only)
- `wordly_appliance_V3/` — pristine pure-browser appliance (source of index.html)
- `_reference_mission_control/` — MC Python/Flask app (`app_v3.py`)
- `wordly-reaction-engine/` — Firebase presence pattern reference

---

## Last Known Good State

v0.1 as above — files created, syntax-clean, DB reachable. Local git commit on `main`. No live test yet.

**Incident resolved this session:** the deployed `Wordly_Audio_Appliance_Web` had been clobbered — a Sep-1 commit (`e794920`, labeled "portrait mode toggle") replaced the working pure-browser file wholesale with an OLD socket.io/local-server client (another chat pushed bad code). Symptom: live GitHub Pages page threw `/api/* 404` + "Unexpected token '<'". Fixed by Chris restoring the good file. Recurring risk: asking an AI for "the full file" can reintroduce socket.io — watch for it.

---

## Open Questions & Next Steps

1. **Live test (next):** push to GitHub Pages (or serve on an authorized domain), configure one agent with a real session ID + passcode + audio device, confirm it appears in admin, then remote Start → verify WSS connects and audio flows; test Mute/Unmute/Split/Leave/End.
2. Agent identity is an auto-generated `agentId` in localStorage. Room labels (human names) deferred — add next.
3. Remote **audio-device change** not built (browser permission constraints). Current design only *reports* the device; alert-on-wrong-device is the fallback plan.
4. Lock down RTDB rules (apply `database.rules.json`) before anything real; then tighten so only non-anonymous (admin) users can write commands.
5. Multi-event awareness in admin — deferred to a later phase.
6. Eventually fold the admin console into the real Mission Control (GCP/Vue) rather than this standalone page.

## Secrets Checklist
- No runtime secrets in these files. Firebase web config is public. The Wordly apikey is NOT used by the agent or admin (agent uses WSS = sessionID + passcode only, entered locally by the operator). Keep it that way.
