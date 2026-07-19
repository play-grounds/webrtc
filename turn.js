// Layer 5 — TURN relay. Proves the *relay* path end to end: fetch short-lived
// credentials from a TURN REST endpoint (draft-uberti-behave-turn-rest-00 —
// e.g. the JSS `turn` plugin at https://pod/.turn/credentials), then force a
// loopback through the relay alone (iceTransportPolicy 'relay': no host/srflx
// shortcuts allowed). If this passes, two peers whose NATs defeat STUN will
// still connect — the relay carries them.
import { log } from './log.js';
import { loopback } from './loopback.js';

// Accepts the draft's {uris, username, password} and/or a ready-made
// {iceServers} array (the JSS plugin serves both in one document).
export function normalizeTurnCredentials(body) {
  if (body && Array.isArray(body.iceServers) && body.iceServers.length) return body.iceServers;
  if (body && Array.isArray(body.uris) && body.uris.length && body.username && (body.password || body.credential)) {
    return [{ urls: body.uris, username: body.username, credential: body.password || body.credential }];
  }
  throw new Error('unrecognised credentials shape — want {iceServers} or {uris, username, password}');
}

// Seconds until the credential's embedded unix expiry ("<expiry>[:tag]"),
// or null when the username carries no timestamp.
export function credentialTtl(iceServers, now = Date.now()) {
  const expiry = Number(String(iceServers?.[0]?.username ?? '').split(':')[0]);
  return Number.isFinite(expiry) && expiry > 0 ? Math.round(expiry - now / 1000) : null;
}

export async function fetchTurnCredentials(url, { timeoutMs = 10000 } = {}) {
  log('turn', 'GET ' + url);
  const r = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
  if (!r.ok) throw new Error(`credentials endpoint: HTTP ${r.status}`);
  const iceServers = normalizeTurnCredentials(await r.json());
  const ttl = credentialTtl(iceServers);
  const uris = [].concat(iceServers[0].urls);
  log('turn', `credentials for ${uris.length} uri(s)${ttl != null ? `, expire in ~${Math.round(ttl / 60)}m` : ''}`);
  return iceServers;
}

export async function relayLoopback({ iceServers = [], timeoutMs = 15000 } = {}) {
  const turnOnly = iceServers.filter((s) => [].concat(s.urls).some((u) => /^turns?:/.test(u)));
  if (!turnOnly.length) throw new Error('no turn:/turns: uris among the ice servers');
  log('turn', 'loopback forced through the relay (iceTransportPolicy: relay)…');
  const r = await loopback({ iceServers: turnOnly, timeoutMs, iceTransportPolicy: 'relay' });
  // with policy 'relay' any connection IS relayed; a non-relay pair here
  // would mean the browser ignored the policy — flag it, don't fail it
  if (r.ok && r.pair && !/relay/.test(r.pair.path || '')) {
    log('turn', `unexpected path ${r.pair.path} on a relay-only connection`, 'warn');
  }
  return r;
}
