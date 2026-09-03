# Live Event Gateway ↔ Wordly Appliance — Two-Version Sync Guide

**Read before changing the appliance.** This file keeps the two versions honest.

There are now **two versions of the Wordly presenter appliance**, on purpose:

1. **Solo appliance** — repo `Wordly_Audio_Appliance_Web`. Pure browser, **no Firebase, no server**. Standalone, deployed on its own GitHub Pages. This is the **canonical source of truth** for the appliance.
2. **LEG agent** — repo `live_event_gateway`, `index.html`. This is the *same appliance file* plus one appended `<script>` block that loads a Firebase control layer (check-in + remote Start / Mute / Unmute / Split / Leave / End). All Firebase code lives in **separate files** (`agent-firebase.js`, `firebase-config.js`) that only the LEG version loads. The appliance's own ~778 lines are byte-identical in both.

## Rules

- **Direction of flow is one-way: appliance → LEG.** The appliance is upstream. LEG mirrors it and wraps it. LEG never edits appliance logic, and appliance changes never flow back from LEG.
- **Keep the solo appliance pure.** Do NOT add Firebase to it. Do NOT reintroduce `socket.io` or any `/api/*` / local-server code — that regression already broke the deploy once (a "full file" regen silently swapped the pure-browser app for an old socket.io client).
- **Every appliance change must be mirrored into LEG,** or the two drift apart.

## Sync Procedure (do this after any appliance change)

1. Update the solo appliance as normal, in its own repo.
2. Copy its `index.html` into the LEG repo, replacing LEG's `index.html`.
3. Re-append this block at the very bottom, just before `</body>`:

```html
<script src="https://www.gstatic.com/firebasejs/10.12.5/firebase-app-compat.js"></script>
<script src="https://www.gstatic.com/firebasejs/10.12.5/firebase-auth-compat.js"></script>
<script src="https://www.gstatic.com/firebasejs/10.12.5/firebase-database-compat.js"></script>
<script src="firebase-config.js"></script>
<script src="agent-firebase.js"></script>
```

That's the whole diff between the two versions. The appliance never needs to know Firebase exists; the Firebase files never change when the appliance does.

## Quick Reference

| | Solo appliance | LEG agent |
|---|---|---|
| Repo | `Wordly_Audio_Appliance_Web` | `live_event_gateway` |
| Firebase | No | Yes (appended script + `agent-firebase.js`, `firebase-config.js`) |
| Server / socket.io | Never | Never |
| Role | Source of truth | Mirror + control layer |
| Hosting | Own GitHub Pages | LEG GitHub Pages |

_Last updated: 2026-09-02 — v0.1_
