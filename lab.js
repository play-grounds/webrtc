// Dashboard wiring — binds buttons to the isolated lab modules and renders
// live feedback. No framework, no build. Config (signaling URL, room, STUN,
// TURN creds) is read from the query string first, then localStorage, so a
// link can carry everything without hard-coding a server into the repo.
import { onLog, log, hhmmss } from './log.js';
import { probe } from './probe.js';
import { gatherCandidates } from './ice.js';
import { loopback } from './loopback.js';
import { Signal } from './signaling.js';
import { Mesh, toHexResource } from './mesh.js';
import { fetchTurnCredentials, relayLoopback, credentialTtl } from './turn.js';

const $ = (id) => document.getElementById(id);
const LS = 'webrtc-lab.config';

// ---- config ----
const qs = new URLSearchParams(location.search);
const saved = JSON.parse(localStorage.getItem(LS) || '{}');
const cfg = {
  sig: qs.get('sig') || saved.sig || '',
  room: qs.get('room') || saved.room || 'webrtc-lab-demo',
  stun: qs.get('stun') || saved.stun || 'stun:stun.l.google.com:19302',
  turn: qs.get('turn') || saved.turn || '',
  tu: qs.get('tu') || saved.tu || '',
  tc: qs.get('tc') || saved.tc || '',
  turnrest: qs.get('turnrest') || saved.turnrest || '',
};
function readCfg() {
  cfg.sig = $('cfg-sig').value.trim(); cfg.room = $('cfg-room').value.trim();
  cfg.stun = $('cfg-stun').value.trim(); cfg.turn = $('cfg-turn').value.trim();
  cfg.tu = $('cfg-tu').value.trim(); cfg.tc = $('cfg-tc').value.trim();
  cfg.turnrest = $('cfg-turnrest').value.trim();
  localStorage.setItem(LS, JSON.stringify(cfg));
}
function fillCfg() {
  $('cfg-sig').value = cfg.sig; $('cfg-room').value = cfg.room; $('cfg-stun').value = cfg.stun;
  $('cfg-turn').value = cfg.turn; $('cfg-tu').value = cfg.tu; $('cfg-tc').value = cfg.tc;
  $('cfg-turnrest').value = cfg.turnrest;
}
// Room hashing comes from the canonical library (mesh.js re-export), so a
// human room name lands in the SAME resource here as in the apps that vendor
// the library — the lab can join an app's room by name, not just by raw hex.
// Credentials fetched from a TURN REST endpoint this session. Not persisted
// on purpose — they expire; the endpoint is the durable config (cfg.turnrest).
let turnCreds = null;
function iceServers() {
  const s = [];
  if (cfg.stun) s.push({ urls: cfg.stun });
  if (turnCreds && (credentialTtl(turnCreds) ?? 1) > 0) s.push(...turnCreds);
  else if (cfg.turn) s.push({ urls: cfg.turn, username: cfg.tu, credential: cfg.tc });
  return s;
}
function shareLink() {
  readCfg();
  const p = new URLSearchParams();
  for (const k of ['sig', 'room', 'stun', 'turn', 'tu', 'tc', 'turnrest']) if (cfg[k]) p.set(k, cfg[k]);
  return location.origin + location.pathname + '?' + p.toString();
}

// ---- badges ----
function badge(el, state, text) {
  el.className = 'badge ' + state; el.textContent = text;
}

// ---- 0. environment ----
function renderProbe() {
  const rows = probe();
  $('probe-out').innerHTML = rows.map((r) =>
    `<div class="kv"><span class="dot ${r.info ? 'info' : r.ok ? 'ok' : 'bad'}"></span><b>${escapeHtml(r.name)}</b><span class="muted">${escapeHtml(r.detail || (r.ok ? 'yes' : 'no'))}</span></div>`).join('');
  const fails = rows.filter((r) => !r.ok && !r.info).length;
  badge($('probe-badge'), fails ? 'warn' : 'ok', fails ? `${fails} missing` : 'all present');
}

// ---- 1. ICE gather ----
$('btn-ice').onclick = async () => {
  readCfg(); badge($('ice-badge'), 'run', 'gathering…'); $('ice-out').innerHTML = '';
  try {
    const { candidates, verdict } = await gatherCandidates({ iceServers: iceServers() });
    const table = `<table class="cand"><tr><th>type</th><th>proto</th><th>address</th><th>port</th><th>via</th></tr>${candidates.map((c) =>
      `<tr class="${escapeHtml(c.type)}${c.isMdns ? ' mdns' : ''}"><td>${escapeHtml(c.type)}</td><td>${escapeHtml(c.protocol)}</td><td>${escapeHtml(c.address)}${c.isMdns ? ' ⚠' : ''}</td><td>${escapeHtml(c.port)}</td><td class="muted">${escapeHtml(c.related || '')}</td></tr>`).join('')}</table>`;
    const notes = `<ul class="notes">${verdict.notes.map((n) => `<li>${escapeHtml(n)}</li>`).join('')}</ul>`;
    $('ice-out').innerHTML = table + notes;
    badge($('ice-badge'), verdict.level === 'ok' ? 'ok' : 'warn', verdict.summary);
  } catch (e) { badge($('ice-badge'), 'bad', 'error'); log('ice', e.message, 'error'); }
};

// ---- 2. loopback ----
$('btn-loop').onclick = async () => {
  readCfg(); badge($('loop-badge'), 'run', 'connecting…'); $('loop-out').innerHTML = '';
  try {
    const r = await loopback({ iceServers: iceServers() });
    $('loop-out').innerHTML = `<div class="kv"><span class="dot ok"></span><b>channel open</b><span class="muted">${r.openMs} ms</span></div>
      <div class="kv"><span class="dot ok"></span><b>round-trip</b><span class="muted">${r.rtt} ms</span></div>
      <div class="kv"><span class="dot info"></span><b>path</b><span class="muted">${r.pair?.path ?? '?'} (${r.pair?.state ?? '?'})</span></div>`;
    badge($('loop-badge'), 'ok', `pass · ${r.rtt}ms`);
  } catch (e) { $('loop-out').innerHTML = `<div class="kv"><span class="dot bad"></span><b>failed</b><span class="muted">${escapeHtml(e.message)}</span></div>`; badge($('loop-badge'), 'bad', 'fail'); }
};

// ---- 5. TURN relay ----
$('btn-turn-fetch').onclick = async () => {
  readCfg(); badge($('turn-badge'), 'run', 'fetching…'); $('turn-out').innerHTML = '';
  try {
    if (!cfg.turnrest) throw new Error('set the TURN REST URL in the config bar');
    turnCreds = await fetchTurnCredentials(cfg.turnrest);
    const s = turnCreds[0];
    const ttl = credentialTtl(turnCreds);
    $('turn-out').innerHTML = `<div class="kv"><span class="dot ok"></span><b>credentials</b><span class="muted">user ${escapeHtml(String(s.username))}${ttl != null ? ` · expires in ~${Math.round(ttl / 60)}m` : ''}</span></div>
      <div class="kv"><span class="dot info"></span><b>uris</b><span class="muted">${escapeHtml([].concat(s.urls).join(' · '))}</span></div>`;
    badge($('turn-badge'), 'ok', 'credentials ready');
    return true;
  } catch (e) {
    $('turn-out').innerHTML = `<div class="kv"><span class="dot bad"></span><b>fetch failed</b><span class="muted">${escapeHtml(e.message)}</span></div>`;
    badge($('turn-badge'), 'bad', 'fetch failed'); log('turn', e.message, 'error');
    return false;
  }
};
$('btn-turn-test').onclick = async () => {
  readCfg();
  if (!turnCreds && cfg.turnrest) { if (!await $('btn-turn-fetch').onclick()) return; }
  badge($('turn-badge'), 'run', 'relaying…');
  try {
    const r = await relayLoopback({ iceServers: iceServers() });
    $('turn-out').innerHTML += `<div class="kv"><span class="dot ok"></span><b>relay loopback</b><span class="muted">open in ${r.openMs}ms · RTT ${r.rtt}ms · path ${escapeHtml(r.pair?.path ?? '?')}</span></div>`;
    badge($('turn-badge'), 'ok', `relay OK · ${r.rtt}ms`);
  } catch (e) {
    $('turn-out').innerHTML += `<div class="kv"><span class="dot bad"></span><b>relay loopback failed</b><span class="muted">${escapeHtml(e.message)}</span></div>`;
    badge($('turn-badge'), 'bad', 'relay failed'); log('turn', e.message, 'error');
  }
};

// ---- 3. signaling ----
let sig = null;
$('btn-sig-connect').onclick = async () => {
  readCfg(); if (!cfg.sig) { log('signal', 'set a signaling URL first', 'warn'); return; }
  badge($('sig-badge'), 'run', 'connecting…');
  sig?.close(); // don't leak the previous socket on re-connect
  const resource = await toHexResource(cfg.room);
  if (resource !== cfg.room) log('signal', `room "${cfg.room}" → resource ${resource}`);
  sig = new Signal(cfg.sig, resource);
  sig.onmsg = () => {};
  try { await sig.connect(); badge($('sig-badge'), 'ok', 'open'); }
  catch { badge($('sig-badge'), 'bad', 'error'); }
};
$('btn-sig-announce').onclick = () => { if (!sig) { log('signal', 'connect first', 'warn'); return; } sig.announce([]); };
$('btn-sig-close').onclick = () => { sig?.close(); badge($('sig-badge'), 'idle', 'closed'); };

// ---- 4. mesh (real peers) ----
let mesh = null;
function renderPeers(peers, sigState) {
  badge($('mesh-badge'), peers.length ? 'ok' : (mesh ? 'run' : 'idle'),
    mesh ? `${peers.length} peer${peers.length === 1 ? '' : 's'} · ws ${['connecting', 'open', 'closing', 'closed'][sigState] ?? '—'}` : 'stopped');
  $('mesh-count').textContent = peers.length;
  $('mesh-out').innerHTML = peers.length ? `<table class="cand"><tr><th>peer</th><th>ice</th><th>conn</th><th>chan</th><th>path</th><th>rtt</th></tr>${peers.map((p) =>
    `<tr><td>${escapeHtml(p.short)}</td><td class="${p.ice === 'connected' || p.ice === 'completed' ? 'good' : p.ice === 'failed' ? 'baddim' : ''}">${escapeHtml(p.ice)}</td><td>${escapeHtml(p.conn)}</td><td>${p.open ? '✓ open' : '—'}</td><td class="muted">${escapeHtml(p.path ?? '…')}</td><td>${p.rtt != null ? p.rtt + 'ms' : '—'}</td></tr>`).join('')}</table>`
    : `<p class="muted">No peers yet. Open this page (same room) in another tab, browser, or device.</p>`;
}
$('btn-mesh-start').onclick = async () => {
  readCfg(); if (!cfg.sig) { log('mesh', 'set a signaling URL first', 'warn'); return; }
  if (mesh) mesh.stop();
  badge($('mesh-badge'), 'run', 'starting…');
  mesh = new Mesh({ url: cfg.sig, room: cfg.room, iceServers: iceServers(), onPeers: renderPeers });
  try { await mesh.start(); } catch (e) { badge($('mesh-badge'), 'bad', 'error'); log('mesh', e.message, 'error'); }
};
$('btn-mesh-stop').onclick = () => { mesh?.stop(); mesh = null; renderPeers([], -1); badge($('mesh-badge'), 'idle', 'stopped'); };

// ---- run-all ----
$('btn-all').onclick = async () => { renderProbe(); await $('btn-ice').onclick(); await $('btn-loop').onclick(); };

// ---- share ----
$('btn-share').onclick = async () => {
  const link = shareLink();
  try { await navigator.clipboard.writeText(link); log('lab', 'share link copied to clipboard'); } catch { log('lab', link); }
  $('share-out').textContent = link;
};

// ---- log console ----
const logEl = $('console');
let logLevel = 'info';
const wraps = [];
function logLine(e) {
  const div = document.createElement('div');
  div.className = 'logline ' + e.level;
  div.innerHTML = `<span class="lt">${hhmmss(e.ts)}</span><span class="ltag">${escapeHtml(e.tag)}</span>${escapeHtml(e.msg)}`;
  return div;
}
onLog((e) => {
  wraps.push(e);
  if (wraps.length > 2000) wraps.shift();
  if (logLevel === 'warn' && e.level === 'info') return;
  logEl.appendChild(logLine(e));
  while (logEl.childElementCount > 2000) logEl.firstChild.remove(); // keep the DOM bounded like the buffer
  if ($('autoscroll').checked) logEl.scrollTop = logEl.scrollHeight;
});
function escapeHtml(s) { return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
$('btn-log-clear').onclick = () => { logEl.innerHTML = ''; wraps.length = 0; };
$('btn-log-copy').onclick = async () => {
  const text = wraps.map((e) => `${hhmmss(e.ts)} [${e.tag}] ${e.msg}`).join('\n');
  try { await navigator.clipboard.writeText(text); log('lab', `copied ${wraps.length} log lines`); } catch {}
};
$('log-filter').onchange = (e) => {
  logLevel = e.target.value;
  logEl.innerHTML = ''; // repaint from the buffer so switching back to "all" restores info lines
  for (const en of wraps) if (!(logLevel === 'warn' && en.level === 'info')) logEl.appendChild(logLine(en));
  if ($('autoscroll').checked) logEl.scrollTop = logEl.scrollHeight;
};

// ---- theme toggle ----
$('btn-theme').onclick = () => {
  const cur = document.documentElement.getAttribute('data-theme')
    || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
  const next = cur === 'dark' ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', next);
  try { localStorage.setItem('webrtc-lab.theme', next); } catch {}
};

// ---- init ----
fillCfg();
renderProbe();
renderPeers([], -1);
document.querySelectorAll('.cfg input').forEach((i) => i.addEventListener('change', readCfg));
log('lab', `WebRTC Lab ready · room "${cfg.room}"${cfg.sig ? ' · signaling ' + cfg.sig : ' · no signaling set'}`);
window.LAB = { probe, gatherCandidates, loopback, Signal, Mesh, cfg, iceServers, fetchTurnCredentials, relayLoopback, get turnCreds() { return turnCreds; }, get mesh() { return mesh; }, get sig() { return sig; } };
