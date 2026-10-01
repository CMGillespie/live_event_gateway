// ============================================================
// Live Event Gateway — Agent Firebase Bridge
// v0.1 — check-in presence + remote command listener
// ------------------------------------------------------------
// ADD-ONLY layer. Reads the appliance's existing globals
// (muted, connected, cfg) and calls its existing functions
// (startSession, toggleMute, doSplit, doLeave, doEnd).
// Touches none of the appliance's own logic.
//
// Presence : agents/{agentId}            -> live status, device, session
// Commands : agents/{agentId}/command    -> {id, action} written by admin
// Results  : agents/{agentId}/lastResult -> {action, ok, note, ts}
// ============================================================
(function () {
  // ---- LEG identity: tab title + version suffix (base stays untouched) ----
  // LEG_VERSION tracks as a sub of the base appliance version shown in the footer.
  // Footer reads e.g. "v3.2e · LEG v1" — base number lets Chris eyeball sync state.
  const LEG_VERSION = 'LEG v1';
  try { document.title = 'Wordly LEG Presenter'; } catch (e) {}
  function stampLeg() {
    // Header label next to the logo: "Presenter" -> "LEG Presenter"
    document.querySelectorAll('.brand-sub').forEach(function (e) {
      if (/LEG/.test(e.textContent)) return;
      e.textContent = 'LEG ' + (e.textContent || '').trim();
    });
    buildFooter();
  }
  // Rebuild the footer to mirror wordly.ai (linked items), keeping the version.
  // Version reads "<base> · LEG vN" so Chris can eyeball sync against the base app.
  function buildFooter() {
    const f = document.getElementById('app-footer'); if (!f) return;
    const verEl = f.querySelector('.app-ver');
    let baseVer = verEl ? (verEl.textContent || '').trim() : '';
    baseVer = baseVer.replace(/\s*·\s*LEG.*$/i, '').trim();      // drop any prior LEG suffix
    const ver = baseVer ? (baseVer + ' · ' + LEG_VERSION) : LEG_VERSION;
    const a = (href, txt) => '<a href="' + href + '" target="_blank" rel="noopener" style="color:inherit;text-decoration:underline">' + txt + '</a>';
    f.innerHTML =
      a('https://wordly.ai/', 'Wordly AI Interpretation') + ' | ' +
      a('https://wordly.ai/privacy-policy', 'Privacy Policy') + ' | ' +
      a('https://wordly.ai/wordly-inc-terms-of-service', 'Terms of Service') + ' | ' +
      'Copyright © 2019–2026 Wordly, Inc. | <span class="app-ver">' + ver + '</span>';
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () { setTimeout(stampLeg, 0); });
  } else { setTimeout(stampLeg, 0); }

  // Use a SEPARATE Firebase app instance ('legAgent') so the agent's anonymous
  // sign-in has its own isolated auth storage and NEVER overwrites the admin's
  // Google session on the same origin (they'd otherwise share one login slot).
  let legApp;
  try { legApp = firebase.app('legAgent'); }
  catch (e) { legApp = firebase.initializeApp(firebaseConfig, 'legAgent'); }
  const db = legApp.database();
  const authRef = legApp.auth();

  // ---- URL params: which event bucket, and optional preconfig ----
  // Ghost link:         ?event=EVENTID
  // Preconfigured link: ?event=EVENTID&session=ABCD-1234&passcode=123456&name=Room%20204
  const qs = new URLSearchParams(location.search);
  const eventId = (qs.get('event') || '').trim() || '_unassigned';

  // Fill session/passcode/name from the link if present (device is still picked locally).
  (function preconfigFromLink(){
    const sid = qs.get('session'), pass = qs.get('passcode'), nm = qs.get('name');
    if (!sid && !pass && !nm) return;
    try {
      if (typeof cfg !== 'object' || !cfg) return;
      const clean = v => String(v).replace(/^=+/, '').replace(/^"(.*)"$/, '$1').trim();
      if (sid)  cfg.sessionId = (typeof normSid === 'function' ? (normSid(clean(sid)) || clean(sid)) : clean(sid));
      if (pass) cfg.passcode  = clean(pass);
      if (nm)   cfg.presenter = clean(nm);
      if (typeof saveCfg === 'function') saveCfg();
      if (typeof loadIdle === 'function') loadIdle();  // refresh idle card + Start-enabled state
      console.log('[LEG] preconfigured from link for event', eventId);
    } catch (e) { console.warn('[LEG] preconfig failed', e); }
  })();

  // ---- Stable per-device identity (persists across reloads) ----
  let agentId = '';
  try { agentId = localStorage.getItem('leg_agent_id') || ''; } catch (e) {}
  if (!agentId) {
    agentId = 'agent-' + Math.random().toString(36).slice(2, 8) + Date.now().toString(36).slice(-4);
    try { localStorage.setItem('leg_agent_id', agentId); } catch (e) {}
  }
  // Presence refs — may re-point to the shared "_unassigned" bucket if the event is invalid,
  // so rogue/bad-link devices all surface in the admin's rogue bar instead of a hidden bucket.
  let presenceRef, commandRef, resultRef;
  function setBucket(bucket) {
    const b = 'events/' + bucket + '/agents/' + agentId;
    presenceRef = db.ref(b);
    commandRef  = db.ref(b + '/command');
    resultRef   = db.ref(b + '/lastResult');
  }
  setBucket(eventId);

  let lastCmdId = null;

  // ---- Read the appliance config safely ----
  function getCfg() {
    try { if (typeof cfg === 'object' && cfg) return cfg; } catch (e) {}
    try { return JSON.parse(localStorage.getItem('wordly_cfg') || '{}'); } catch (e) { return {}; }
  }
  function isMuted()     { try { return !!muted; } catch (e) { return false; } }
  function isConnected() { try { return !!connected; } catch (e) { return false; } }

  function activeScreen() {
    const el = document.querySelector('.screen.active');
    return el ? el.id : '';
  }
  function deriveStatus() {
    switch (activeScreen()) {
      case 'screen-streaming': {
        // Appliance shows "◌ Reconnecting… (n/5)" in #si-status during recovery
        const st = (document.getElementById('si-status') || {}).textContent || '';
        if (/reconnect/i.test(st)) return 'reconnecting';
        if (isMuted())     return 'muted';
        if (isConnected()) return 'live';
        return 'connecting';
      }
      case 'screen-error': return 'error';
      case 'screen-ended': return 'ended';
      default:             return 'idle';
    }
  }
  function isStreamingStatus(s) {
    return s === 'live' || s === 'muted' || s === 'connecting' || s === 'reconnecting';
  }
  function configReady() {
    const c = getCfg();
    return !!(c.sessionId && c.passcode && c.deviceId !== undefined && c.deviceId !== null && c.deviceId !== '');
  }

  // ---- Session start/stop timestamps (client clock, stamped once per transition) ----
  let lastStatus = null, startedAt = null, endedAt = null, lastAudioAt = null;

  // ---- Push current state up to Firebase ----
  function pushPresence(extra) {
    const c = getCfg();
    const status = deriveStatus();
    if (isStreamingStatus(status) && !isStreamingStatus(lastStatus)) { startedAt = Date.now(); endedAt = null; }
    if (!isStreamingStatus(status) && isStreamingStatus(lastStatus))  { endedAt = Date.now(); }
    lastStatus = status;
    const data = Object.assign({
      label:       c.presenter || ('Agent ' + agentId.slice(-4)),
      presenter:   c.presenter || '',
      sessionId:   c.sessionId || '',
      passcode:    c.passcode || '',        // enables Attend/Present links in admin (RTDB is auth-gated)
      deviceLabel: c.deviceLabel || '',
      status:      status,
      muted:       isMuted(),
      privacy:     isLockedOut(),
      configReady: configReady(),
      online:      true,
      agentId:     agentId,
      eventId:     eventId,
      startedAt:   startedAt,
      endedAt:     endedAt,
      lastAudioAt: lastAudioAt,
      userAgent:   navigator.userAgent,
      updatedAt:   firebase.database.ServerValue.TIMESTAMP
    }, extra || {});
    presenceRef.update(data).catch(function (e) { console.warn('[LEG] presence write failed', e); });
  }

  // ---- Privacy + captions are now NATIVE in the base app (gated to LEG builds) ----
  // Base provides the cloud-lockout toggle (stored as cfg.cloudLockout) and the Caption
  // Screen pill. The bridge injects nothing — it only enforces + reports the lockout.
  function isLockedOut() { try { return !!getCfg().cloudLockout; } catch (e) { return false; } }

  // ---- Execute a remote command against the appliance ----
  function dispatch(action) {
    if (isLockedOut()) {
      resultRef.set({ action: action, ok: false, note: 'ignored — room locked out (cloud control off)', ts: firebase.database.ServerValue.TIMESTAMP }).catch(function(){});
      return;
    }
    let ok = true, note = '';
    try {
      switch (action) {
        case 'start':
          if (activeScreen() === 'screen-streaming') { note = 'already streaming'; }
          else if (!configReady())                    { ok = false; note = 'device not configured'; }
          else                                         { startSession(); note = 'start issued'; }
          break;
        case 'mute':
          if (!isConnected())     { ok = false; note = 'not connected'; }
          else if (isMuted())     { note = 'already muted'; }
          else                    { toggleMute(); note = 'muted'; }
          break;
        case 'unmute':
          if (!isConnected())     { ok = false; note = 'not connected'; }
          else if (!isMuted())    { note = 'already live'; }
          else                    { toggleMute(); note = 'unmuted'; }
          break;
        case 'split':
          if (!isConnected())     { ok = false; note = 'not connected'; }
          else                    { doSplit(); note = 'split issued'; }
          break;
        case 'leave':
          doLeave(); note = 'left (session continues)';
          break;
        case 'end':
          doEnd(); note = 'session ended';
          break;
        default:
          ok = false; note = 'unknown action: ' + action;
      }
    } catch (e) {
      ok = false; note = 'error: ' + (e && e.message ? e.message : e);
    }
    resultRef.set({ action: action, ok: ok, note: note, ts: firebase.database.ServerValue.TIMESTAMP })
      .catch(function () {});
    // Reflect the resulting state quickly, then again shortly after
    setTimeout(pushPresence, 150);
    setTimeout(pushPresence, 1500);
  }

  // ---- Warn if this link points at an event that doesn't exist ----
  function showEventWarning() {
    if (document.getElementById('leg-event-warn')) return;
    const host = document.querySelector('#screen-idle .idle-left') || document.body;
    const div = document.createElement('div');
    div.id = 'leg-event-warn';
    div.style.cssText = 'background:#FDE68A;color:#78350F;font-weight:bold;font-size:12px;padding:8px 26px 8px 10px;border-radius:8px;margin:8px 0;position:relative;';
    div.innerHTML = '⚠ This page is not associated to a specific event. Check with your admin if this is not expected.<span style="position:absolute;right:8px;top:6px;cursor:pointer;font-weight:900;font-size:14px" onclick="this.parentNode.remove()">×</span>';
    host.insertBefore(div, host.firstChild);
  }
  // ---- Pick the bucket (real event, or shared _unassigned for rogue/bad links), then wire ----
  function begin() {
    if (eventId === '_unassigned') {
      showEventWarning();
      wire(); return;
    }
    db.ref('eventIndex/' + eventId).once('value')
      .then(function (s) {
        if (!s.exists()) {
          showEventWarning();
          setBucket('_unassigned');   // route rogue/bad-link device to the shared bucket so admin sees it
        }
        wire();
      })
      .catch(function () { wire(); });
  }

  function wire() {
    // Mark offline automatically if the tab dies / device drops
    presenceRef.child('online').onDisconnect().set(false);
    presenceRef.child('status').onDisconnect().set('offline');

    pushPresence({ connectedAt: firebase.database.ServerValue.TIMESTAMP });

    // Listen for remote commands (dedupe by id)
    commandRef.on('value', function (snap) {
      const c = snap.val();
      if (!c || !c.id) return;
      if (c.id === lastCmdId) return;
      lastCmdId = c.id;
      console.log('[LEG] command received:', c.action, c.id);
      dispatch(c.action);
    });

    // Audio-activity watch: read the appliance's meter as a reliable "someone is speaking"
    // signal (no appliance change). Feeds the monitor page's silence detection.
    setInterval(function () {
      try {
        const fill = document.getElementById('meter-fill');
        if (fill && isStreamingStatus(deriveStatus()) && !isMuted()) {
          const w = parseFloat(fill.style.width) || 0;
          if (w > 5) lastAudioAt = Date.now();
        }
      } catch (e) {}
    }, 1000);

    // Heartbeat / status poller
    setInterval(pushPresence, 2000);
    window.addEventListener('online',  pushPresence);
    window.addEventListener('offline', pushPresence);
    window.addEventListener('beforeunload', function () {
      try { presenceRef.update({ online: false, status: 'offline' }); } catch (e) {}
    });

    console.log('[LEG] agent online as', agentId);
  }

  authRef.signInAnonymously()
    .then(function () { authRef.onAuthStateChanged(function (u) { if (u) begin(); }); })
    .catch(function (e) { console.error('[LEG] anonymous auth failed', e); });

  // Expose ids for debugging
  window.LEG_AGENT_ID = agentId;
  window.LEG_EVENT_ID = eventId;
})();
