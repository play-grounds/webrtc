// Dashboard wiring — binds buttons to the isolated lab modules and renders
// live feedback. No framework, no build. Config (signaling URL, room, STUN,
// TURN creds) is read from the query string first, then localStorage, so a
// link can carry everything without hard-coding a server into the repo.
import { onLog, log, hhmmss } from './log.js';
import { probe } from './probe.js';
import { gatherCandidates } from './ice.js';
import { loopback } from './loopback.js';
import { Signal } from './signaling.js';
import { Mesh } from './mesh.js';

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
};
function readCfg() {
  cfg.sig = $('cfg-sig').value.trim(); cfg.room = $('cfg-room').value.trim();
  cfg.stun = $('cfg-stun').value.trim(); cfg.turn = $('cfg-turn').value.trim();
  cfg.tu = $('cfg-tu').value.trim(); cfg.tc = $('cfg-tc').value.trim();
  localStorage.setItem(LS, JSON.stringify(cfg));
}
function fillCfg() {
  $('cfg-sig').value = cfg.sig; $('cfg-room').value = cfg.room; $('cfg-stun').value = cfg.stun;
  $('cfg-turn').value = cfg.turn; $('cfg-tu').value = cfg.tu; $('cfg-tc').value = cfg.tc;
}
// JSS rooms must be hex [a-f0-9]{8,128}. Accept any human name by hashing it to
// a stable hex resource; pass raw hex through unchanged (so you can also join a
// specific hex room to interop with another app).
async function toHexResource(room) {
  if (/^[a-f0-9]{8,128}$/i.test(room)) return room.toLowerCase();
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode('webrtc-lab:' + room));
  return [...new Uint8Array(buf)].slice(0, 16).map((b) => b.toString(16).padStart(2, '0')).join('');
}
function iceServers() {
  const s = [];
  if (cfg.stun) s.push({ urls: cfg.stun });
  if (cfg.turn) s.push({ urls: cfg.turn, username: cfg.tu, credential: cfg.tc });
  return s;
}
function shareLink() {
  readCfg();
  const p = new URLSearchParams();
  for (const k of ['sig', 'room', 'stun', 'turn', 'tu', 'tc']) if (cfg[k]) p.set(k, cfg[k]);
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
    `<div class="kv"><span class="dot ${r.info ? 'info' : r.ok ? 'ok' : 'bad'}"></span><b>${r.name}</b><span class="muted">${r.detail || (r.ok ? 'yes' : 'no')}</span></div>`).join('');
  const fails = rows.filter((r) => !r.ok && !r.info).length;
  badge($('probe-badge'), fails ? 'warn' : 'ok', fails ? `${fails} missing` : 'all present');
}

// ---- 1. ICE gather ----
$('btn-ice').onclick = async () => {
  readCfg(); badge($('ice-badge'), 'run', 'gathering…'); $('ice-out').innerHTML = '';
  try {
    const { candidates, verdict } = await gatherCandidates({ iceServers: iceServers() });
    const table = `<table class="cand"><tr><th>type</th><th>proto</th><th>address</th><th>port</th><th>via</th></tr>${candidates.map((c) =>
      `<tr class="${c.type}${c.isMdns ? ' mdns' : ''}"><td>${c.type}</td><td>${c.protocol}</td><td>${c.address}${c.isMdns ? ' ⚠' : ''}</td><td>${c.port}</td><td class="muted">${c.related || ''}</td></tr>`).join('')}</table>`;
    const notes = `<ul class="notes">${verdict.notes.map((n) => `<li>${n}</li>`).join('')}</ul>`;
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
  } catch (e) { $('loop-out').innerHTML = `<div class="kv"><span class="dot bad"></span><b>failed</b><span class="muted">${e.message}</span></div>`; badge($('loop-badge'), 'bad', 'fail'); }
};

// ---- 3. signaling ----
let sig = null;
$('btn-sig-connect').onclick = async () => {
  readCfg(); if (!cfg.sig) { log('signal', 'set a signaling URL first', 'warn'); return; }
  badge($('sig-badge'), 'run', 'connecting…');
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
    `<tr><td>${p.short}</td><td class="${p.ice === 'connected' || p.ice === 'completed' ? 'good' : p.ice === 'failed' ? 'baddim' : ''}">${p.ice}</td><td>${p.conn}</td><td>${p.open ? '✓ open' : '—'}</td><td class="muted">${p.pair?.path ?? '…'}${p.pair?.state ? ' (' + p.pair.state + ')' : ''}</td><td>${p.rtt != null ? p.rtt + 'ms' : '—'}</td></tr>`).join('')}</table>`
    : `<p class="muted">No peers yet. Open this page (same room) in another tab, browser, or device.</p>`;
}
$('btn-mesh-start').onclick = async () => {
  readCfg(); if (!cfg.sig) { log('mesh', 'set a signaling URL first', 'warn'); return; }
  if (mesh) mesh.stop();
  badge($('mesh-badge'), 'run', 'starting…');
  const resource = await toHexResource(cfg.room);
  if (resource !== cfg.room) log('mesh', `room "${cfg.room}" → resource ${resource}`);
  mesh = new Mesh({ url: cfg.sig, room: resource, iceServers: iceServers(), onPeers: renderPeers });
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
onLog((e) => {
  wraps.push(e);
  if (wraps.length > 2000) wraps.shift();
  if (logLevel === 'warn' && e.level === 'info') return;
  const div = document.createElement('div');
  div.className = 'logline ' + e.level;
  div.innerHTML = `<span class="lt">${hhmmss(e.ts)}</span><span class="ltag">${e.tag}</span>${escapeHtml(e.msg)}`;
  logEl.appendChild(div);
  if ($('autoscroll').checked) logEl.scrollTop = logEl.scrollHeight;
});
function escapeHtml(s) { return String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c])); }
$('btn-log-clear').onclick = () => { logEl.innerHTML = ''; wraps.length = 0; };
$('btn-log-copy').onclick = async () => {
  const text = wraps.map((e) => `${hhmmss(e.ts)} [${e.tag}] ${e.msg}`).join('\n');
  try { await navigator.clipboard.writeText(text); log('lab', `copied ${wraps.length} log lines`); } catch {}
};
$('log-filter').onchange = (e) => { logLevel = e.target.value; };

// ---- init ----
fillCfg();
renderProbe();
renderPeers([], -1);
document.querySelectorAll('.cfg input').forEach((i) => i.addEventListener('change', readCfg));
log('lab', `WebRTC Lab ready · room "${cfg.room}"${cfg.sig ? ' · signaling ' + cfg.sig : ' · no signaling set'}`);
window.LAB = { probe, gatherCandidates, loopback, Signal, Mesh, cfg, iceServers, get mesh() { return mesh; }, get sig() { return sig; } };
