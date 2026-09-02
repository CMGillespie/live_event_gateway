// ============================================================
// Live Event Gateway — shared Firebase config
// v0.1 — initial: RTDB + Google/Anonymous auth for agent + admin
// ------------------------------------------------------------
// NOTE: Firebase web config is PUBLIC by design (it ships in the
// browser). It is NOT a secret and NOT the Wordly API key. Access
// is controlled by Firebase Auth + Realtime Database security rules
// (see database.rules.json). Safe to commit.
// ============================================================
const firebaseConfig = {
  apiKey: "AIzaSyBrBYWF4EXf71ZxB5uDpAqJkOgZlHJzlAE",
  authDomain: "live-event-gateway.firebaseapp.com",
  databaseURL: "https://live-event-gateway-default-rtdb.firebaseio.com",
  projectId: "live-event-gateway",
  storageBucket: "live-event-gateway.firebasestorage.app",
  messagingSenderId: "539038937579",
  appId: "1:539038937579:web:2112ce23bc5903be76a9ae"
};

// Initialize (Firebase compat SDK must be loaded before this file)
firebase.initializeApp(firebaseConfig);
