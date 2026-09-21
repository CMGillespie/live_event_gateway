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
  const base = 'events/' + eventId + '/agents/' + agentId;
  const presenceRef = db.ref(base);
  const commandRef  = db.ref(base + '/command');
  const resultRef   = db.ref(base + '/lastResult');

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
  let lastStatus = null, startedAt = null, endedAt = null;

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
      configReady: configReady(),
      online:      true,
      agentId:     agentId,
      eventId:     eventId,
      startedAt:   startedAt,
      endedAt:     endedAt,
      userAgent:   navigator.userAgent,
      updatedAt:   firebase.database.ServerValue.TIMESTAMP
    }, extra || {});
    presenceRef.update(data).catch(function (e) { console.warn('[LEG] presence write failed', e); });
  }

  // ---- Execute a remote command against the appliance ----
  function dispatch(action) {
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

  // ---- Wire everything once we have an auth session ----
  function begin() {
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
